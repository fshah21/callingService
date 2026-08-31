const { redis } = require('../db/redis');

const WINDOW_MS = 1000;

// Fixed-window counter keyed by api key + current wall-clock second. INCR + a one-time PEXPIRE
// (set only on the first hit in a window) keeps this atomic and self-cleaning: the key expires
// on its own shortly after the window ends, so nothing accumulates in Redis.
const CPS_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, windowMs)
end
return count
`;

function windowKey(apiKey) {
  const windowSecond = Math.floor(Date.now() / WINDOW_MS);
  return `apikey:${apiKey}:cps:${windowSecond}`;
}

// Returns true if this request is within the per-second limit for apiKey (and counts it either
// way — a rejected request still occupies a slot in the window, which is standard CPS-limiter
// behavior and discourages retry storms).
async function checkAndConsume(apiKey, limit) {
  const count = await redis.eval(CPS_SCRIPT, 1, windowKey(apiKey), WINDOW_MS);
  return count <= limit;
}

module.exports = { checkAndConsume };
