const { WebSocketServer } = require('ws');
const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');
const apiKeyService = require('../services/apiKeyService');
const callService = require('../services/callService');
const callEvents = require('../services/callEvents');
const connectionStats = require('./connectionStats');
const { extractBearerToken } = require('../middleware/auth');
const { serializeCall } = require('../utils/serializeCall');

// Protocol:
//   ws://host/ws                  connect, then send {"type":"subscribe","callId":"..."} per call
//   ws://host/ws/calls/:id        connect, auto-subscribed to just that call
// Auth: "Authorization: Bearer <api-key>" header (works for any WS client library that can set
// headers), or ?apiKey= query param as a fallback for browsers, which can't set custom headers
// on the native WebSocket handshake.
// A client only ever receives updates for calls owned by its own api key.
function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map(); // clientId -> { ws, apiKey, subscriptions: Set<callId> }
  let nextClientId = 1;

  httpServer.on('upgrade', async (req, socket, head) => {
    let pathname;
    try {
      const parsed = new URL(req.url, 'http://localhost');
      pathname = parsed.pathname;
      req.__query = parsed.searchParams;
    } catch {
      socket.destroy();
      return;
    }

    if (!pathname.startsWith('/ws')) {
      socket.destroy();
      return;
    }

    const apiKeyValue = extractBearerToken(req) || req.__query.get('apiKey');
    const apiKeyRecord = apiKeyValue ? await apiKeyService.getApiKey(apiKeyValue).catch(() => null) : null;
    if (!apiKeyRecord) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { apiKeyRecord, pathname });
    });
  });

  wss.on('connection', (ws, req, { apiKeyRecord, pathname }) => {
    const clientId = nextClientId++;
    const subscriptions = new Set();
    clients.set(clientId, { ws, apiKey: apiKeyRecord.key, subscriptions });
    connectionStats.count += 1;

    ws.send(JSON.stringify({ type: 'connected', clientId }));

    const directMatch = pathname.match(/^\/ws\/calls\/([^/]+)$/);
    if (directMatch) {
      subscribeToCall(directMatch[1]);
    }

    async function subscribeToCall(callId) {
      const call = await callService.getCall(callId).catch(() => null);
      if (!call || call.apiKey !== apiKeyRecord.key) {
        ws.send(JSON.stringify({ type: 'error', error: 'call not found', call_id: callId }));
        return;
      }
      subscriptions.add(callId);
      ws.send(JSON.stringify({ type: 'subscribed', call_id: callId, call: serializeCall(call) }));
    }

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'invalid JSON message' }));
        return;
      }

      if (msg.type === 'subscribe' && typeof msg.call_id === 'string') {
        subscribeToCall(msg.call_id);
      } else if (msg.type === 'unsubscribe' && typeof msg.call_id === 'string') {
        subscriptions.delete(msg.call_id);
        ws.send(JSON.stringify({ type: 'unsubscribed', call_id: msg.call_id }));
      } else {
        ws.send(JSON.stringify({ type: 'error', error: 'unknown message type' }));
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      connectionStats.count -= 1;
    });

    ws.on('error', (err) => logger.warn({ err, clientId }, 'websocket client error'));
  });

  // One dedicated subscriber connection per process (ioredis subscriber connections can't run
  // other commands), fanned out in-memory to whichever connected clients are subscribed.
  const subscriber = new Redis(config.redisUrl);
  subscriber.subscribe(callEvents.CHANNEL).catch((err) => logger.error({ err }, 'failed to subscribe to call-updates'));

  subscriber.on('message', (channel, message) => {
    if (channel !== callEvents.CHANNEL) return;
    let call;
    try {
      call = JSON.parse(message);
    } catch {
      return;
    }

    for (const { ws, apiKey, subscriptions } of clients.values()) {
      if (apiKey !== call.apiKey || !subscriptions.has(call.id)) continue;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'call.update', call: serializeCall(call) }));
      }
    }
  });

  return wss;
}

module.exports = { attachWebSocketServer };
