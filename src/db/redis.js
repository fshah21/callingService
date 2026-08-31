const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

// General-purpose client for reads/writes on call state, api-key sets, stats counters.
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

redis.on('error', (err) => logger.error({ err }, 'redis connection error'));

// BullMQ requires its own dedicated connections (maxRetriesPerRequest: null, no auto-pipelining
// issues with blocking commands), so give queues/workers a fresh connection per instance rather
// than sharing `redis`.
function createBullConnection() {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

module.exports = { redis, createBullConnection };
