const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { randRange } = require('../utils/random');
const callStore = require('./callStore');
const statsService = require('./statsService');
const callEvents = require('./callEvents');
const apiKeyService = require('./apiKeyService');
const db = require('../db/postgres');
const { scheduleTransition } = require('../queue/queue');

class ConcurrencyLimitError extends Error {
  constructor(limit) {
    super(`concurrent call limit (${limit}) reached for this api key`);
    this.name = 'ConcurrencyLimitError';
    this.limit = limit;
  }
}

async function createCall({ from, to, metadata }, apiKeyRecord) {
  const id = uuidv4();

  const acquired = await apiKeyService.tryAcquireSlot(apiKeyRecord.key, id, apiKeyRecord.concurrencyLimit);
  if (!acquired) {
    throw new ConcurrencyLimitError(apiKeyRecord.concurrencyLimit);
  }

  const createdAt = new Date().toISOString();

  try {
    await callStore.createCall({
      id,
      from,
      to,
      metadata,
      apiKey: apiKeyRecord.key,
      status: 'queued',
      createdAt,
    });
  } catch (err) {
    await apiKeyService.releaseSlot(apiKeyRecord.key, id);
    throw err;
  }

  await statsService.recordCreated('queued');

  const call = await callStore.getCall(id);
  await callEvents.publishUpdate(call);

  const delay = randRange(config.timing.queuedToRinging);
  await scheduleTransition(id, 'ringing', delay);

  return call;
}

// Live state lives in Redis; if it's aged out (long after completion) or the process restarted
// before a call ever hit Redis again, fall back to the durable Postgres copy.
async function getCall(id) {
  const live = await callStore.getCall(id);
  if (live) return live;

  const { rows } = await db.query('SELECT * FROM calls WHERE id = $1', [id]);
  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    from: row.from_number,
    to: row.to_number,
    metadata: row.metadata,
    status: row.status,
    apiKey: row.api_key,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    answeredAt: row.answered_at ? row.answered_at.toISOString() : null,
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    durationSeconds: row.duration_seconds !== null ? parseFloat(row.duration_seconds) : null,
    audioUrl: row.audio_url || null,
  };
}

module.exports = { createCall, getCall, ConcurrencyLimitError };
