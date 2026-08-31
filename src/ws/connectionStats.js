// Process-local count of connected websocket clients, read by the /metrics route.
const state = { count: 0 };

module.exports = state;
