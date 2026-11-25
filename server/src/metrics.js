/**
 * In-process metrics collector.
 *
 * Tracks three metric kinds without pulling in a dependency:
 *
 * - **Counters** — monotonically increasing totals (requests, errors, rooms).
 * - **Gauges** — values that move up and down (rooms resident in memory,
 *   live WebSocket connections).
 * - **Histograms** — bucketed observations used for latency percentiles.
 *
 * Exposed at `GET /metrics` as JSON (default) or as Prometheus text
 * exposition format (`?format=prometheus`, or an `Accept: text/plain`
 * request header) so the endpoint can be scraped directly by Prometheus,
 * Grafana Agent, or OpenTelemetry Collector without a sidecar translator.
 */

/** Histogram bucket upper bounds, in seconds. */
export const DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]

/**
 * Metric descriptors. The key is the name used by callers; `metric` is the
 * Prometheus metric name and `help` becomes the `# HELP` line.
 */
const COUNTER_SPECS = {
  requestsTotal: { metric: 'syncforge_http_requests_total', help: 'Total HTTP requests handled.' },
  requestErrors: { metric: 'syncforge_http_request_errors_total', help: 'HTTP responses with a 5xx status.' },
  requestsClientError: { metric: 'syncforge_http_client_errors_total', help: 'HTTP responses with a 4xx status.' },
  wsConnections: { metric: 'syncforge_ws_connections_total', help: 'WebSocket connections accepted.' },
  wsDisconnections: { metric: 'syncforge_ws_disconnections_total', help: 'WebSocket connections closed.' },
  roomsCreated: { metric: 'syncforge_rooms_created_total', help: 'Workspaces created.' },
  documentUpdates: { metric: 'syncforge_document_updates_total', help: 'Yjs document updates applied.' },
  documentUpdateErrors: { metric: 'syncforge_document_update_errors_total', help: 'Yjs document updates that failed to apply or persist.' },
  rateLimitRejections: { metric: 'syncforge_rate_limit_rejections_total', help: 'Requests rejected by a rate limit.' },
}

const GAUGE_SPECS = {
  roomsResident: { metric: 'syncforge_rooms_resident', help: 'Workspace documents currently held in memory.' },
  wsConnectionsActive: { metric: 'syncforge_ws_connections_active', help: 'WebSocket connections currently open.' },
}

const HISTOGRAM_SPECS = {
  requestDurationSeconds: {
    metric: 'syncforge_http_request_duration_seconds',
    help: 'HTTP request latency in seconds.',
    buckets: DURATION_BUCKETS_SECONDS,
  },
}

const counters = {}
const gauges = {}
const histograms = {}

function freshHistogram(spec) {
  return { counts: new Array(spec.buckets.length + 1).fill(0), sum: 0, count: 0 }
}

function initialise() {
  for (const name of Object.keys(COUNTER_SPECS)) counters[name] = 0
  for (const name of Object.keys(GAUGE_SPECS)) gauges[name] = 0
  for (const [name, spec] of Object.entries(HISTOGRAM_SPECS)) histograms[name] = freshHistogram(spec)
}

initialise()

const startedAt = Date.now()

/**
 * Increment a counter. Unknown names and non-finite amounts are ignored so a
 * typo in instrumentation can never crash a request.
 *
 * @param {string} name
 * @param {number} [by]
 */
export function incrementCounter(name, by = 1) {
  if (!Object.hasOwn(counters, name)) return
  if (!Number.isFinite(by) || by < 0) return
  counters[name] += by
}

/**
 * Overwrite a gauge with an absolute value.
 *
 * @param {string} name
 * @param {number} value
 */
export function setGauge(name, value) {
  if (!Object.hasOwn(gauges, name)) return
  if (!Number.isFinite(value)) return
  gauges[name] = value
}

/**
 * Move a gauge by a relative delta, clamped at zero.
 *
 * @param {string} name
 * @param {number} delta
 */
export function adjustGauge(name, delta) {
  if (!Object.hasOwn(gauges, name)) return
  if (!Number.isFinite(delta)) return
  gauges[name] = Math.max(0, gauges[name] + delta)
}

/**
 * Record a single observation into a histogram.
 *
 * @param {string} name
 * @param {number} value Observation in the histogram's native unit (seconds).
 */
export function observeHistogram(name, value) {
  const spec = HISTOGRAM_SPECS[name]
  if (!spec) return
  if (!Number.isFinite(value) || value < 0) return
  const histogram = histograms[name]
  let index = spec.buckets.findIndex((bound) => value <= bound)
  if (index < 0) index = spec.buckets.length
  histogram.counts[index] += 1
  histogram.sum += value
  histogram.count += 1
}

/**
 * Snapshot every metric as a plain JSON object. Counters stay at the top
 * level for backwards compatibility with existing consumers.
 *
 * @returns {Record<string, unknown>}
 */
export function getMetrics() {
  const histogramSnapshot = {}
  for (const [name, spec] of Object.entries(HISTOGRAM_SPECS)) {
    const histogram = histograms[name]
    histogramSnapshot[name] = {
      buckets: spec.buckets.map((bound, index) => ({ le: bound, count: histogram.counts[index] })),
      sum: histogram.sum,
      count: histogram.count,
      average: histogram.count > 0 ? histogram.sum / histogram.count : 0,
    }
  }
  return {
    ...counters,
    gauges: { ...gauges },
    histograms: histogramSnapshot,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Render every metric in Prometheus text exposition format (version 0.0.4).
 *
 * @returns {string} Scrape body, newline terminated.
 */
export function renderPrometheus() {
  const lines = []

  for (const [name, spec] of Object.entries(COUNTER_SPECS)) {
    lines.push(`# HELP ${spec.metric} ${spec.help}`)
    lines.push(`# TYPE ${spec.metric} counter`)
    lines.push(`${spec.metric} ${counters[name]}`)
  }

  for (const [name, spec] of Object.entries(GAUGE_SPECS)) {
    lines.push(`# HELP ${spec.metric} ${spec.help}`)
    lines.push(`# TYPE ${spec.metric} gauge`)
    lines.push(`${spec.metric} ${gauges[name]}`)
  }

  for (const [name, spec] of Object.entries(HISTOGRAM_SPECS)) {
    const histogram = histograms[name]
    lines.push(`# HELP ${spec.metric} ${spec.help}`)
    lines.push(`# TYPE ${spec.metric} histogram`)
    let cumulative = 0
    for (const [index, bound] of spec.buckets.entries()) {
      cumulative += histogram.counts[index]
      lines.push(`${spec.metric}_bucket{le="${bound}"} ${cumulative}`)
    }
    cumulative += histogram.counts[spec.buckets.length]
    lines.push(`${spec.metric}_bucket{le="+Inf"} ${cumulative}`)
    lines.push(`${spec.metric}_sum ${histogram.sum}`)
    lines.push(`${spec.metric}_count ${histogram.count}`)
  }

  lines.push('# HELP syncforge_process_uptime_seconds Seconds since the server process started.')
  lines.push('# TYPE syncforge_process_uptime_seconds gauge')
  lines.push(`syncforge_process_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`)

  return `${lines.join('\n')}\n`
}

/** Zero every counter, gauge, and histogram. Used by the test suite. */
export function resetMetrics() {
  initialise()
}
