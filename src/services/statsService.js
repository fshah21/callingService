const { redis } = require('../db/redis');

const STATUS_COUNTS_KEY = 'stats:status_counts';
const COUNTERS_KEY = 'stats:counters';
const DURATION_SUM_FIELD = 'answered_duration_sum_seconds';
const DURATION_COUNT_FIELD = 'answered_duration_count';

// Called once when a call is created (enters "queued").
async function recordCreated(status) {
  await redis
    .multi()
    .hincrby(STATUS_COUNTS_KEY, status, 1)
    .hincrby(COUNTERS_KEY, 'calls_created_total', 1)
    .exec();
}

// Called on every status transition after creation.
async function recordTransition(fromStatus, toStatus) {
  const multi = redis.multi().hincrby(STATUS_COUNTS_KEY, fromStatus, -1).hincrby(STATUS_COUNTS_KEY, toStatus, 1);

  if (toStatus === 'answered') multi.hincrby(COUNTERS_KEY, 'calls_answered_total', 1);
  if (toStatus === 'unanswered') multi.hincrby(COUNTERS_KEY, 'calls_unanswered_total', 1);
  if (toStatus === 'completed') multi.hincrby(COUNTERS_KEY, 'calls_completed_total', 1);

  await multi.exec();
}

async function recordAnsweredDuration(seconds) {
  await redis
    .multi()
    .hincrbyfloat(COUNTERS_KEY, DURATION_SUM_FIELD, seconds)
    .hincrby(COUNTERS_KEY, DURATION_COUNT_FIELD, 1)
    .exec();
}

async function getStatusCounts() {
  const raw = await redis.hgetall(STATUS_COUNTS_KEY);
  const counts = { queued: 0, ringing: 0, answered: 0, unanswered: 0, completed: 0 };
  for (const [status, value] of Object.entries(raw)) {
    counts[status] = parseInt(value, 10) || 0;
  }
  return counts;
}

async function getCounters() {
  const raw = await redis.hgetall(COUNTERS_KEY);
  const num = (field) => parseFloat(raw[field] || '0') || 0;
  const durationSum = num(DURATION_SUM_FIELD);
  const durationCount = num(DURATION_COUNT_FIELD);
  return {
    callsCreatedTotal: num('calls_created_total'),
    callsAnsweredTotal: num('calls_answered_total'),
    callsUnansweredTotal: num('calls_unanswered_total'),
    callsCompletedTotal: num('calls_completed_total'),
    avgAnsweredDurationSeconds: durationCount > 0 ? durationSum / durationCount : 0,
  };
}

module.exports = { recordCreated, recordTransition, recordAnsweredDuration, getStatusCounts, getCounters };
