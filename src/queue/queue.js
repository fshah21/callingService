const { Queue } = require('bullmq');
const { createBullConnection } = require('../db/redis');

// Producer-side handle used by both the API process (to schedule the first transition on call
// creation) and the worker process (to schedule each subsequent transition). Job name = the
// status the call is transitioning *into*; job data = { callId }.
const callTransitionsQueue = new Queue('call-transitions', {
  connection: createBullConnection(),
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 1000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});

async function scheduleTransition(callId, toStatus, delayMs) {
  await callTransitionsQueue.add(toStatus, { callId }, { delay: delayMs });
}

// Fired once a call reaches "completed"; the worker uploads a mock recording to S3/MinIO out of
// band. Enqueuing just persists the job to Redis and returns — it does not wait for the upload,
// which is what keeps the completion transition non-blocking.
const callRecordingsQueue = new Queue('call-recordings', {
  connection: createBullConnection(),
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 1000,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

async function scheduleRecordingUpload(callId) {
  await callRecordingsQueue.add('upload', { callId });
}

module.exports = { callTransitionsQueue, scheduleTransition, callRecordingsQueue, scheduleRecordingUpload };
