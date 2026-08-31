const { redis } = require('../db/redis');

// Redis is the source of truth for *live* call state. Completed calls are kept around for a
// while (TTL below) so GET /calls/:id stays fast right after completion, then age out of Redis
// once the periodic persistence worker has durably written them to Postgres.
const COMPLETED_TTL_SECONDS = 60 * 60; // 1 hour

function callKey(id) {
  return `call:${id}`;
}

async function createCall({ id, from, to, metadata, apiKey, status, createdAt }) {
  const key = callKey(id);
  await redis.hset(key, {
    id,
    from,
    to,
    metadata: JSON.stringify(metadata || {}),
    status,
    apiKey,
    createdAt,
    updatedAt: createdAt,
    answeredAt: '',
    endedAt: '',
    durationSeconds: '',
    audioUrl: '',
  });
}

function deserialize(raw) {
  if (!raw || Object.keys(raw).length === 0) return null;
  return {
    id: raw.id,
    from: raw.from,
    to: raw.to,
    metadata: raw.metadata ? JSON.parse(raw.metadata) : {},
    status: raw.status,
    apiKey: raw.apiKey,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    answeredAt: raw.answeredAt || null,
    endedAt: raw.endedAt || null,
    durationSeconds: raw.durationSeconds ? parseFloat(raw.durationSeconds) : null,
    audioUrl: raw.audioUrl || null,
  };
}

async function getCall(id) {
  const raw = await redis.hgetall(callKey(id));
  return deserialize(raw);
}

async function updateStatus(id, status, { updatedAt = new Date().toISOString() } = {}) {
  await redis.hset(callKey(id), { status, updatedAt });
}

async function markAnswered(id, { answeredAt }) {
  await redis.hset(callKey(id), { status: 'answered', updatedAt: answeredAt, answeredAt });
}

async function markEnded(id, { endedAt, durationSeconds }) {
  const key = callKey(id);
  await redis.hset(key, {
    status: 'completed',
    updatedAt: endedAt,
    endedAt,
    durationSeconds: durationSeconds ?? '',
  });
  await redis.expire(key, COMPLETED_TTL_SECONDS);
}

async function setAudioUrl(id, audioUrl) {
  await redis.hset(callKey(id), { audioUrl, updatedAt: new Date().toISOString() });
}

// Used by the persistence worker to sweep all live call hashes and upsert them into Postgres.
async function scanAllCallIds() {
  const ids = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'call:*', 'COUNT', 200);
    cursor = next;
    ids.push(...keys.map((k) => k.slice('call:'.length)));
  } while (cursor !== '0');
  return ids;
}

module.exports = {
  createCall,
  getCall,
  updateStatus,
  markAnswered,
  markEnded,
  setAudioUrl,
  scanAllCallIds,
  callKey,
};
