const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const callsByStatus = new client.Gauge({
  name: 'calls_by_status',
  help: 'Current number of live calls in each status',
  labelNames: ['status'],
  registers: [register],
});

const callsCreatedTotal = new client.Gauge({
  name: 'calls_created_total',
  help: 'Total calls created since Redis stats were last reset',
  registers: [register],
});

const callsAnsweredTotal = new client.Gauge({
  name: 'calls_answered_total',
  help: 'Total calls that reached the answered status',
  registers: [register],
});

const callsUnansweredTotal = new client.Gauge({
  name: 'calls_unanswered_total',
  help: 'Total calls that reached the unanswered status',
  registers: [register],
});

const callsCompletedTotal = new client.Gauge({
  name: 'calls_completed_total',
  help: 'Total calls that reached the completed status',
  registers: [register],
});

const avgAnsweredDurationSeconds = new client.Gauge({
  name: 'call_answered_duration_seconds_avg',
  help: 'Average talk time (answered -> completed) across all answered calls',
  registers: [register],
});

const concurrentCalls = new client.Gauge({
  name: 'concurrent_calls',
  help: 'Current number of in-flight calls per api key',
  labelNames: ['api_key'],
  registers: [register],
});

const concurrentCallsLimit = new client.Gauge({
  name: 'concurrent_calls_limit',
  help: 'Configured concurrency limit per api key',
  labelNames: ['api_key'],
  registers: [register],
});

const queueJobCounts = new client.Gauge({
  name: 'call_queue_jobs',
  help: 'BullMQ call-transitions queue job counts by state',
  labelNames: ['state'],
  registers: [register],
});

const websocketConnections = new client.Gauge({
  name: 'websocket_connections',
  help: 'Currently connected websocket clients on this process',
  registers: [register],
});

module.exports = {
  register,
  callsByStatus,
  callsCreatedTotal,
  callsAnsweredTotal,
  callsUnansweredTotal,
  callsCompletedTotal,
  avgAnsweredDurationSeconds,
  concurrentCalls,
  concurrentCallsLimit,
  queueJobCounts,
  websocketConnections,
};
