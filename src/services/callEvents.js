const { redis } = require('../db/redis');

const CHANNEL = 'call-updates';

// Publishing (not the ws server's own subscriber connection) can safely reuse the shared
// general-purpose client — PUBLISH doesn't put the connection into subscriber mode.
async function publishUpdate(call) {
  await redis.publish(CHANNEL, JSON.stringify(call));
}

module.exports = { CHANNEL, publishUpdate };
