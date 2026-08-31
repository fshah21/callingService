require('dotenv').config();

function int(name, fallback) {
  const v = process.env[name];
  return v === undefined ? fallback : parseInt(v, 10);
}

function float(name, fallback) {
  const v = process.env[name];
  return v === undefined ? fallback : parseFloat(v);
}

module.exports = {
  port: int('PORT', 3000),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  databaseUrl: process.env.DATABASE_URL || 'postgres://callservice:callservice@localhost:5432/callservice',
  persistIntervalMs: int('PERSIST_INTERVAL_MS', 10000),
  logLevel: process.env.LOG_LEVEL || 'info',

  timing: {
    queuedToRinging: [int('CALL_QUEUED_TO_RINGING_MS_MIN', 500), int('CALL_QUEUED_TO_RINGING_MS_MAX', 2000)],
    ringing: [int('CALL_RINGING_MS_MIN', 2000), int('CALL_RINGING_MS_MAX', 6000)],
    answeredDuration: [int('CALL_ANSWERED_DURATION_MS_MIN', 5000), int('CALL_ANSWERED_DURATION_MS_MAX', 30000)],
    unansweredToCompleted: [int('CALL_UNANSWERED_TO_COMPLETED_MS_MIN', 500), int('CALL_UNANSWERED_TO_COMPLETED_MS_MAX', 1500)],
    answerProbability: float('CALL_ANSWER_PROBABILITY', 0.7),
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
    // Used to build the audio_url returned to clients; falls back to the internal endpoint if unset.
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || 'http://localhost:9000',
    region: process.env.S3_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || 'call-recordings',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
  },
};
