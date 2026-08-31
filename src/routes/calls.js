const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { enforceCps } = require('../middleware/rateLimiter');
const callService = require('../services/callService');
const { serializeCall, buildWebsocketUrl } = require('../utils/serializeCall');

const router = express.Router();

router.post('/', requireApiKey, enforceCps, async (req, res, next) => {
  const { from, to, metadata } = req.body || {};

  if (typeof from !== 'string' || from.trim() === '') {
    return res.status(400).json({ error: '"from" is required and must be a non-empty string' });
  }
  if (typeof to !== 'string' || to.trim() === '') {
    return res.status(400).json({ error: '"to" is required and must be a non-empty string' });
  }
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    return res.status(400).json({ error: '"metadata" must be a JSON object if provided' });
  }

  try {
    const call = await callService.createCall({ from, to, metadata }, req.apiKey);
    res.status(201).json({
      ...serializeCall(call),
      websocket_url: buildWebsocketUrl(req, call.id),
    });
  } catch (err) {
    if (err instanceof callService.ConcurrencyLimitError) {
      return res.status(429).json({ error: err.message });
    }
    next(err);
  }
});

router.get('/:id', requireApiKey, async (req, res, next) => {
  try {
    const call = await callService.getCall(req.params.id);
    if (!call || call.apiKey !== req.apiKey.key) {
      return res.status(404).json({ error: 'call not found' });
    }
    res.json({
      ...serializeCall(call),
      websocket_url: buildWebsocketUrl(req, call.id),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
