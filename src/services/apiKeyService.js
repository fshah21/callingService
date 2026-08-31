const { redis } = require('../db/redis');
const db = require('../db/postgres');

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // key -> { name, concurrencyLimit, expiresAt }

function activeSetKey(apiKey) {
  return `apikey:${apiKey}:active`;
}

async function getApiKey(key) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const { rows } = await db.query('SELECT key, name, concurrency_limit, cps_limit FROM api_keys WHERE key = $1', [
    key,
  ]);
  if (rows.length === 0) {
    cache.delete(key);
    return null;
  }

  const record = {
    key: rows[0].key,
    name: rows[0].name,
    concurrencyLimit: rows[0].concurrency_limit,
    cpsLimit: rows[0].cps_limit,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  cache.set(key, record);
  return record;
}

// Atomically checks the active-call count for this API key against its concurrency limit and,
// if there's room, reserves a slot for callId. Lua keeps the check-then-add race-free under
// concurrent POST /calls requests for the same key.
const ACQUIRE_SLOT_SCRIPT = `
local activeSetKey = KEYS[1]
local callId = ARGV[1]
local limit = tonumber(ARGV[2])
local current = redis.call('SCARD', activeSetKey)
if current >= limit then
  return 0
end
redis.call('SADD', activeSetKey, callId)
return 1
`;

async function tryAcquireSlot(apiKey, callId, concurrencyLimit) {
  const result = await redis.eval(ACQUIRE_SLOT_SCRIPT, 1, activeSetKey(apiKey), callId, concurrencyLimit);
  return result === 1;
}

async function releaseSlot(apiKey, callId) {
  await redis.srem(activeSetKey(apiKey), callId);
}

async function getActiveCount(apiKey) {
  return redis.scard(activeSetKey(apiKey));
}

async function listAllApiKeys() {
  const { rows } = await db.query('SELECT key, name, concurrency_limit FROM api_keys ORDER BY key');
  return rows;
}

module.exports = { getApiKey, tryAcquireSlot, releaseSlot, getActiveCount, listAllApiKeys };
