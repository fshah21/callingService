const express = require('express');
const statsService = require('../services/statsService');
const apiKeyService = require('../services/apiKeyService');
const { callTransitionsQueue } = require('../queue/queue');
const connectionStats = require('../ws/connectionStats');
const registry = require('../utils/metricsRegistry');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [statusCounts, counters, apiKeys, jobCounts] = await Promise.all([
      statsService.getStatusCounts(),
      statsService.getCounters(),
      apiKeyService.listAllApiKeys(),
      callTransitionsQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
    ]);

    for (const [status, count] of Object.entries(statusCounts)) {
      registry.callsByStatus.set({ status }, count);
    }
    registry.callsCreatedTotal.set(counters.callsCreatedTotal);
    registry.callsAnsweredTotal.set(counters.callsAnsweredTotal);
    registry.callsUnansweredTotal.set(counters.callsUnansweredTotal);
    registry.callsCompletedTotal.set(counters.callsCompletedTotal);
    registry.avgAnsweredDurationSeconds.set(counters.avgAnsweredDurationSeconds);
    registry.websocketConnections.set(connectionStats.count);

    for (const [state, count] of Object.entries(jobCounts)) {
      registry.queueJobCounts.set({ state }, count);
    }

    await Promise.all(
      apiKeys.map(async (k) => {
        const active = await apiKeyService.getActiveCount(k.key);
        registry.concurrentCalls.set({ api_key: k.key }, active);
        registry.concurrentCallsLimit.set({ api_key: k.key }, k.concurrency_limit);
      }),
    );

    res.set('Content-Type', registry.register.contentType);
    res.send(await registry.register.metrics());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
