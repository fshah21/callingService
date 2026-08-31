const db = require('../db/postgres');
const callStore = require('./callStore');
const logger = require('../utils/logger');

const UPSERT_SQL = `
  INSERT INTO calls (id, from_number, to_number, metadata, status, api_key, created_at, updated_at, answered_at, ended_at, duration_seconds, audio_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    metadata = EXCLUDED.metadata,
    updated_at = EXCLUDED.updated_at,
    answered_at = EXCLUDED.answered_at,
    ended_at = EXCLUDED.ended_at,
    duration_seconds = EXCLUDED.duration_seconds,
    audio_url = EXCLUDED.audio_url
`;

async function persistCall(callId) {
  const call = await callStore.getCall(callId);
  if (!call) return;

  await db.query(UPSERT_SQL, [
    call.id,
    call.from,
    call.to,
    JSON.stringify(call.metadata || {}),
    call.status,
    call.apiKey,
    call.createdAt,
    call.updatedAt,
    call.answeredAt,
    call.endedAt,
    call.durationSeconds,
    call.audioUrl,
  ]);
}

// Periodic sweep: mirrors every live call currently held in Redis into Postgres. Runs on a
// BullMQ repeatable job so both crash recovery and Postgres downtime are naturally handled —
// Redis keeps being the live source of truth and the next tick just catches Postgres back up.
async function flushAll() {
  const ids = await callStore.scanAllCallIds();
  const results = await Promise.allSettled(ids.map((id) => persistCall(id)));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    logger.error({ count: failed.length, total: ids.length }, 'some calls failed to persist during periodic flush');
  }
  return { total: ids.length, failed: failed.length };
}

module.exports = { persistCall, flushAll };
