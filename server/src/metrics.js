/**
 * Minimal in-process metrics collector.
 * Tracks request counts, error counts, and room counts.
 * Exposed at GET /metrics in development (not in production without auth).
 */

const counters = {
  requestsTotal: 0,
  requestErrors: 0,
  wsConnections: 0,
  wsDisconnections: 0,
  roomsCreated: 0,
}

export function incrementCounter(name) {
  if (name in counters) counters[name]++
}

export function getMetrics() {
  return { ...counters, timestamp: new Date().toISOString() }
}

export function resetMetrics() {
  for (const key of Object.keys(counters)) counters[key] = 0
}
