const s3 = require('./s3Client');
const callStore = require('./callStore');
const persistenceService = require('./persistenceService');
const callEvents = require('./callEvents');
const logger = require('../utils/logger');

const SAMPLE_RATE = 8000; // telephony-grade mono PCM, kept small on purpose — this is mock audio

// Builds a valid, playable silent WAV file sized to the call's talk time. There's no real audio
// to record in a simulator, so this stands in for "the recording" without pulling in an audio
// codec dependency.
function buildMockWavBuffer(durationSeconds) {
  const numSamples = Math.max(SAMPLE_RATE, Math.round(durationSeconds * SAMPLE_RATE)); // floor of 1s
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // sample data left as zero (silence) from Buffer.alloc

  return buffer;
}

// Runs as a BullMQ job after a call completes — never on the request/transition critical path.
async function uploadRecording(callId) {
  const call = await callStore.getCall(callId);
  if (!call || call.status !== 'completed') {
    logger.warn({ callId }, 'skipping recording upload: call missing or not completed');
    return;
  }

  const talkSeconds =
    call.answeredAt && call.endedAt ? (new Date(call.endedAt) - new Date(call.answeredAt)) / 1000 : 1;

  const buffer = buildMockWavBuffer(talkSeconds);
  const key = `recordings/${callId}.wav`;

  await s3.putObject(key, buffer, 'audio/wav');
  const audioUrl = s3.getObjectUrl(key);

  await callStore.setAudioUrl(callId, audioUrl);
  await persistenceService.persistCall(callId);

  const updated = await callStore.getCall(callId);
  await callEvents.publishUpdate(updated);

  logger.info({ callId, audioUrl, sizeBytes: buffer.length }, 'call recording uploaded');
}

module.exports = { uploadRecording, buildMockWavBuffer };
