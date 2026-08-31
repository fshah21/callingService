const config = require('../config');
const { randRange } = require('../utils/random');
const callStore = require('./callStore');
const statsService = require('./statsService');
const callEvents = require('./callEvents');
const apiKeyService = require('./apiKeyService');
const persistenceService = require('./persistenceService');
const { scheduleTransition, scheduleRecordingUpload } = require('../queue/queue');
const logger = require('../utils/logger');

// Applies one status transition for a call (invoked by the BullMQ worker), then schedules
// whatever comes next in the state machine:
//
//   queued -> ringing -> answered -> completed
//                     \-> unanswered -> completed
async function applyTransition(callId, toStatus) {
  const call = await callStore.getCall(callId);
  if (!call) {
    logger.warn({ callId, toStatus }, 'transition job for unknown/expired call, skipping');
    return;
  }
  if (call.status === 'completed') {
    logger.warn({ callId, toStatus }, 'ignoring transition for already-completed call');
    return;
  }

  const fromStatus = call.status;

  if (toStatus === 'ringing') {
    await callStore.updateStatus(callId, 'ringing');
    await statsService.recordTransition(fromStatus, 'ringing');
    await callEvents.publishUpdate(await callStore.getCall(callId));

    const answered = Math.random() < config.timing.answerProbability;
    const next = answered ? 'answered' : 'unanswered';
    const delay = randRange(config.timing.ringing);
    await scheduleTransition(callId, next, delay);
    return;
  }

  if (toStatus === 'answered') {
    const answeredAt = new Date().toISOString();
    await callStore.markAnswered(callId, { answeredAt });
    await statsService.recordTransition(fromStatus, 'answered');
    await callEvents.publishUpdate(await callStore.getCall(callId));

    const delay = randRange(config.timing.answeredDuration);
    await scheduleTransition(callId, 'completed', delay);
    return;
  }

  if (toStatus === 'unanswered') {
    await callStore.updateStatus(callId, 'unanswered');
    await statsService.recordTransition(fromStatus, 'unanswered');
    await callEvents.publishUpdate(await callStore.getCall(callId));

    const delay = randRange(config.timing.unansweredToCompleted);
    await scheduleTransition(callId, 'completed', delay);
    return;
  }

  if (toStatus === 'completed') {
    const endedAt = new Date();
    const createdAt = new Date(call.createdAt);
    const durationSeconds = (endedAt.getTime() - createdAt.getTime()) / 1000;

    await callStore.markEnded(callId, { endedAt: endedAt.toISOString(), durationSeconds });
    await statsService.recordTransition(fromStatus, 'completed');

    if (fromStatus === 'answered' && call.answeredAt) {
      const talkSeconds = (endedAt.getTime() - new Date(call.answeredAt).getTime()) / 1000;
      await statsService.recordAnsweredDuration(talkSeconds);
    }

    await apiKeyService.releaseSlot(call.apiKey, callId);

    const finalCall = await callStore.getCall(callId);
    await callEvents.publishUpdate(finalCall);

    // Write straight through to Postgres on completion so a finished call is durable
    // immediately, rather than waiting for the next periodic flush.
    await persistenceService.persistCall(callId).catch((err) =>
      logger.error({ err, callId }, 'failed to persist completed call'),
    );

    // Fire-and-forget: enqueuing just writes the job to Redis, it does not wait for the
    // (separately-processed) upload, so this never blocks the completion path.
    await scheduleRecordingUpload(callId).catch((err) =>
      logger.error({ err, callId }, 'failed to enqueue recording upload'),
    );
    return;
  }

  logger.warn({ callId, toStatus }, 'unknown transition target status');
}

module.exports = { applyTransition };
