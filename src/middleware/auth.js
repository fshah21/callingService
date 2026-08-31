const apiKeyService = require('../services/apiKeyService');

const BEARER_RE = /^Bearer\s+(.+)$/i;

// Reads straight from req.headers (rather than Express's req.header()) so this also works on
// the raw http.IncomingMessage passed to the WebSocket upgrade handler, not just Express routes.
function extractBearerToken(req) {
  const header = req.headers && req.headers.authorization;
  if (!header) return null;
  const match = header.match(BEARER_RE);
  return match ? match[1].trim() : null;
}

// Validates the "Authorization: Bearer <api-key>" header and attaches the resolved api key
// record (with its concurrency/cps limits) to req.apiKey. Concurrency enforcement itself
// happens in the call creation service, since it needs to be atomic with slot reservation.
async function requireApiKey(req, res, next) {
  const key = extractBearerToken(req);
  if (!key) {
    return res.status(401).json({ error: 'missing or malformed Authorization header; expected "Bearer <api-key>"' });
  }

  try {
    const record = await apiKeyService.getApiKey(key);
    if (!record) {
      return res.status(401).json({ error: 'invalid api key' });
    }
    req.apiKey = record;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireApiKey, extractBearerToken };
