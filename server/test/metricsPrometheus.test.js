import assert from 'node:assert/strict'
import test from 'node:test'
import {
  adjustGauge,
  DURATION_BUCKETS_SECONDS,
  getMetrics,
  incrementCounter,
  observeHistogram,
  renderPrometheus,
  resetMetrics,
  setGauge,
} from '../src/metrics.js'

/** Parse an exposition body into a Map of series name (with labels) to value. */
function parseExposition(body) {
  const series = new Map()
  for (const line of body.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const separator = line.lastIndexOf(' ')
    series.set(line.slice(0, separator), Number(line.slice(separator + 1)))
  }
  return series
}

test('renderPrometheus emits HELP and TYPE headers for every metric', () => {
  resetMetrics()
  const body = renderPrometheus()

  const helpLines = body.split('\n').filter((line) => line.startsWith('# HELP '))
  const typeLines = body.split('\n').filter((line) => line.startsWith('# TYPE '))
  assert.equal(helpLines.length, typeLines.length)
  assert.ok(helpLines.length >= 12, 'expected a HELP line per declared metric')

  for (const line of typeLines) {
    const kind = line.split(' ').at(-1)
    assert.ok(
      ['counter', 'gauge', 'histogram'].includes(kind),
      `unexpected metric type: ${kind}`,
    )
  }
})

test('renderPrometheus body ends with a newline and has no blank interior lines', () => {
  resetMetrics()
  const body = renderPrometheus()
  assert.ok(body.endsWith('\n'))
  const interior = body.slice(0, -1).split('\n')
  assert.ok(interior.every((line) => line.length > 0))
})

test('counter values appear under their Prometheus metric names', () => {
  resetMetrics()
  incrementCounter('requestsTotal')
  incrementCounter('requestsTotal')
  incrementCounter('requestErrors')
  incrementCounter('rateLimitRejections', 3)

  const series = parseExposition(renderPrometheus())
  assert.equal(series.get('syncforge_http_requests_total'), 2)
  assert.equal(series.get('syncforge_http_request_errors_total'), 1)
  assert.equal(series.get('syncforge_rate_limit_rejections_total'), 3)
  assert.equal(series.get('syncforge_document_updates_total'), 0)
})

test('incrementCounter accepts a custom amount and rejects negative or non-finite ones', () => {
  resetMetrics()
  incrementCounter('documentUpdates', 10)
  incrementCounter('documentUpdates', -5)
  incrementCounter('documentUpdates', Number.NaN)
  incrementCounter('documentUpdates', Number.POSITIVE_INFINITY)
  assert.equal(getMetrics().documentUpdates, 10)
})

test('setGauge overwrites and adjustGauge moves relative to the current value', () => {
  resetMetrics()
  setGauge('roomsResident', 7)
  assert.equal(getMetrics().gauges.roomsResident, 7)

  adjustGauge('roomsResident', 3)
  assert.equal(getMetrics().gauges.roomsResident, 10)

  adjustGauge('roomsResident', -4)
  assert.equal(getMetrics().gauges.roomsResident, 6)
})

test('adjustGauge clamps at zero so a double disconnect cannot go negative', () => {
  resetMetrics()
  adjustGauge('wsConnectionsActive', 1)
  adjustGauge('wsConnectionsActive', -1)
  adjustGauge('wsConnectionsActive', -1)
  assert.equal(getMetrics().gauges.wsConnectionsActive, 0)
})

test('gauge helpers ignore unknown names and non-finite values', () => {
  resetMetrics()
  assert.doesNotThrow(() => setGauge('nonexistentGauge', 5))
  assert.doesNotThrow(() => adjustGauge('nonexistentGauge', 5))
  setGauge('roomsResident', Number.NaN)
  adjustGauge('roomsResident', Number.POSITIVE_INFINITY)
  assert.equal(getMetrics().gauges.roomsResident, 0)
  assert.equal(getMetrics().gauges.nonexistentGauge, undefined)
})

test('histogram buckets are cumulative and the +Inf bucket equals the total count', () => {
  resetMetrics()
  // One observation per bucket boundary, plus one above the largest bound.
  observeHistogram('requestDurationSeconds', 0.003)
  observeHistogram('requestDurationSeconds', 0.03)
  observeHistogram('requestDurationSeconds', 0.3)
  observeHistogram('requestDurationSeconds', 42)

  const series = parseExposition(renderPrometheus())
  const bucket = (le) => series.get(`syncforge_http_request_duration_seconds_bucket{le="${le}"}`)

  assert.equal(bucket('0.005'), 1)
  assert.equal(bucket('0.01'), 1)
  assert.equal(bucket('0.05'), 2)
  assert.equal(bucket('0.5'), 3)
  assert.equal(bucket('10'), 3)
  assert.equal(bucket('+Inf'), 4)

  assert.equal(series.get('syncforge_http_request_duration_seconds_count'), 4)
  assert.ok(Math.abs(series.get('syncforge_http_request_duration_seconds_sum') - 42.333) < 1e-9)
})

test('an observation exactly on a bucket boundary lands in that bucket', () => {
  resetMetrics()
  observeHistogram('requestDurationSeconds', 0.025)
  const series = parseExposition(renderPrometheus())
  assert.equal(series.get('syncforge_http_request_duration_seconds_bucket{le="0.01"}'), 0)
  assert.equal(series.get('syncforge_http_request_duration_seconds_bucket{le="0.025"}'), 1)
})

test('observeHistogram ignores unknown names, negatives, and non-finite values', () => {
  resetMetrics()
  assert.doesNotThrow(() => observeHistogram('nonexistentHistogram', 1))
  observeHistogram('requestDurationSeconds', -1)
  observeHistogram('requestDurationSeconds', Number.NaN)
  observeHistogram('requestDurationSeconds', Number.POSITIVE_INFINITY)
  assert.equal(getMetrics().histograms.requestDurationSeconds.count, 0)
})

test('getMetrics reports histogram averages and a zero average when empty', () => {
  resetMetrics()
  assert.equal(getMetrics().histograms.requestDurationSeconds.average, 0)

  observeHistogram('requestDurationSeconds', 0.1)
  observeHistogram('requestDurationSeconds', 0.3)
  const snapshot = getMetrics().histograms.requestDurationSeconds
  assert.equal(snapshot.count, 2)
  assert.ok(Math.abs(snapshot.average - 0.2) < 1e-9)
  assert.equal(snapshot.buckets.length, DURATION_BUCKETS_SECONDS.length)
})

test('getMetrics snapshots are detached copies of gauges and histograms', () => {
  resetMetrics()
  setGauge('roomsResident', 2)
  observeHistogram('requestDurationSeconds', 0.05)

  const snapshot = getMetrics()
  snapshot.gauges.roomsResident = 999
  snapshot.histograms.requestDurationSeconds.count = 999
  snapshot.histograms.requestDurationSeconds.buckets[0].count = 999

  const fresh = getMetrics()
  assert.equal(fresh.gauges.roomsResident, 2)
  assert.equal(fresh.histograms.requestDurationSeconds.count, 1)
  assert.equal(fresh.histograms.requestDurationSeconds.buckets[0].count, 0)
})

test('resetMetrics clears gauges and histograms as well as counters', () => {
  incrementCounter('requestsTotal', 5)
  setGauge('roomsResident', 9)
  observeHistogram('requestDurationSeconds', 1)

  resetMetrics()

  const snapshot = getMetrics()
  assert.equal(snapshot.requestsTotal, 0)
  assert.equal(snapshot.gauges.roomsResident, 0)
  assert.equal(snapshot.histograms.requestDurationSeconds.count, 0)
  assert.equal(snapshot.histograms.requestDurationSeconds.sum, 0)

  const series = parseExposition(renderPrometheus())
  assert.equal(series.get('syncforge_http_request_duration_seconds_bucket{le="+Inf"}'), 0)
})

test('getMetrics reports a non-negative uptime in seconds', () => {
  resetMetrics()
  const uptime = getMetrics().uptimeSeconds
  assert.equal(typeof uptime, 'number')
  assert.ok(uptime >= 0)
})
