const cpsLimiter = require('../services/cpsLimiter');

// Enforces the per-api-key calls-per-second limit on call creation. Must run after
// requireApiKey (needs req.apiKey).
async function enforceCps(req, res, next) {
  try {
    const allowed = await cpsLimiter.checkAndConsume(req.apiKey.key, req.apiKey.cpsLimit);
    if (!allowed) {
      return res.status(429).json({ error: 'rate limit exceeded' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { enforceCps };
