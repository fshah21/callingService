// Shapes the internal (camelCase) call object into the external REST/WebSocket representation.
function serializeCall(call) {
  if (!call) return null;
  return {
    call_id: call.id,
    from: call.from,
    to: call.to,
    metadata: call.metadata,
    status: call.status,
    created_at: call.createdAt,
    updated_at: call.updatedAt,
    answered_at: call.answeredAt,
    ended_at: call.endedAt,
    duration_seconds: call.durationSeconds,
    audio_url: call.audioUrl,
  };
}

function buildWebsocketUrl(req, callId) {
  const proto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  return `${proto}://${req.get('host')}/ws/calls/${callId}`;
}

module.exports = { serializeCall, buildWebsocketUrl };
