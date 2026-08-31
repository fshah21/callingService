const { Worker, Queue } = require('bullmq');
const config = require('../config');
const { createBullConnection } = require('../db/redis');
const logger = require('../utils/logger');
const { applyTransition } = require('../services/callStateMachine');
const persistenceService = require('../services/persistenceService');
const recordingService = require('../services/recordingService');

// --- call-transitions: advances individual calls through the state machine ---
const transitionsWorker = new Worker(
  'call-transitions',
  async (job) => {
    await applyTransition(job.data.callId, job.name);
  },
  { connection: createBullConnection(), concurrency: 20 },
);

transitionsWorker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id, callId: job?.data?.callId, toStatus: job?.name }, 'call transition job failed');
});

// --- call-recordings: uploads a mock audio file to S3/MinIO after a call completes ---
const recordingsWorker = new Worker(
  'call-recordings',
  async (job) => {
    await recordingService.uploadRecording(job.data.callId);
  },
  { connection: createBullConnection(), concurrency: 5 },
);

recordingsWorker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id, callId: job?.data?.callId }, 'recording upload job failed');
});

// --- maintenance: periodic Redis -> Postgres persistence sweep ---
const maintenanceQueue = new Queue('maintenance', { connection: createBullConnection() });

const maintenanceWorker = new Worker(
  'maintenance',
  async (job) => {
    if (job.name === 'flush-to-postgres') {
      const result = await persistenceService.flushAll();
      logger.info(result, 'periodic persistence flush complete');
    }
  },
  { connection: createBullConnection(), concurrency: 1 },
);

maintenanceWorker.on('failed', (job, err) => {
  logger.error({ err, jobId: job?.id }, 'maintenance job failed');
});

async function start() {
  await maintenanceQueue.add(
    'flush-to-postgres',
    {},
    {
      repeat: { every: config.persistIntervalMs },
      jobId: 'flush-to-postgres', // stable id so restarts don't stack duplicate repeatable jobs
      removeOnComplete: 10,
      removeOnFail: 10,
    },
  );
  logger.info({ intervalMs: config.persistIntervalMs }, 'worker started; periodic persistence scheduled');
}

start().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});

async function shutdown() {
  logger.info('worker shutting down');
  await Promise.all([
    transitionsWorker.close(),
    recordingsWorker.close(),
    maintenanceWorker.close(),
    maintenanceQueue.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
