const express = require('express');
const http = require('http');
const config = require('./config');
const logger = require('./utils/logger');
const { redis } = require('./db/redis');
const db = require('./db/postgres');
const callsRouter = require('./routes/calls');
const metricsRouter = require('./routes/metrics');
const { attachWebSocketServer } = require('./ws/server');

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  const checks = { redis: false, postgres: false };
  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    /* reported via checks */
  }
  try {
    await db.query('SELECT 1');
    checks.postgres = true;
  } catch {
    /* reported via checks */
  }
  const ok = checks.redis && checks.postgres;
  res.status(ok ? 200 : 503).json({ ok, ...checks });
});

app.use('/calls', callsRouter);
app.use('/metrics', metricsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err }, 'unhandled request error');
  res.status(500).json({ error: 'internal server error' });
});

const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(config.port, () => {
  logger.info({ port: config.port }, 'call-service api listening');
});

async function shutdown() {
  logger.info('api shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
