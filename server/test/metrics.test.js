import assert from 'node:assert/strict'
import test from 'node:test'
import { getMetrics, incrementCounter, resetMetrics } from '../src/metrics.js'

test('incrementCounter increments the named counter', () => {
  resetMetrics()
  incrementCounter('requestsTotal')
  incrementCounter('requestsTotal')
  incrementCounter('requestErrors')
  const m = getMetrics()
  assert.equal(m.requestsTotal, 2)
  assert.equal(m.requestErrors, 1)
  assert.equal(m.wsConnections, 0)
})

test('getMetrics returns a snapshot with a timestamp', () => {
  resetMetrics()
  const m = getMetrics()
  assert.ok(typeof m.timestamp === 'string')
  assert.ok(m.timestamp.length > 0)
  assert.equal(m.requestsTotal, 0)
})

test('resetMetrics zeros all counters', () => {
  incrementCounter('wsConnections')
  incrementCounter('wsConnections')
  resetMetrics()
  const m = getMetrics()
  assert.equal(m.wsConnections, 0)
  assert.equal(m.roomsCreated, 0)
})

test('incrementCounter ignores unknown counter names', () => {
  resetMetrics()
  incrementCounter('unknownCounter')
  const m = getMetrics()
  assert.equal(m.unknownCounter, undefined)
  assert.equal(m.requestsTotal, 0)
})
