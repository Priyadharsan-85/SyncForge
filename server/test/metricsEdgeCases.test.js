import assert from 'node:assert/strict'
import test from 'node:test'
import { getMetrics, incrementCounter, resetMetrics } from '../src/metrics.js'

test('all documented counters exist in initial metrics snapshot', () => {
  resetMetrics()
  const m = getMetrics()
  const expectedCounters = [
    'requestsTotal',
    'requestErrors',
    'wsConnections',
    'wsDisconnections',
    'roomsCreated',
  ]
  for (const counter of expectedCounters) {
    assert.equal(typeof m[counter], 'number', `Missing counter: ${counter}`)
    assert.equal(m[counter], 0)
  }
})

test('modifying snapshot returned by getMetrics does not mutate internal counters', () => {
  resetMetrics()
  incrementCounter('requestsTotal')
  const m1 = getMetrics()
  assert.equal(m1.requestsTotal, 1)

  // Mutate the returned object
  m1.requestsTotal = 999
  m1.roomsCreated = 42

  const m2 = getMetrics()
  assert.equal(m2.requestsTotal, 1)
  assert.equal(m2.roomsCreated, 0)
})

test('incrementCounter gracefully handles null, undefined, and non-string inputs', () => {
  resetMetrics()
  assert.doesNotThrow(() => incrementCounter(null))
  assert.doesNotThrow(() => incrementCounter(undefined))
  assert.doesNotThrow(() => incrementCounter(123))
  assert.doesNotThrow(() => incrementCounter({}))
  assert.doesNotThrow(() => incrementCounter(''))

  const m = getMetrics()
  assert.equal(m.requestsTotal, 0)
  assert.equal(m.requestErrors, 0)
})

test('metrics timestamp is a valid ISO 8601 string within recent seconds', () => {
  resetMetrics()
  const before = Date.now()
  const m = getMetrics()
  const parsed = Date.parse(m.timestamp)
  const after = Date.now()

  assert.ok(!Number.isNaN(parsed))
  assert.ok(parsed >= before - 1000)
  assert.ok(parsed <= after + 1000)
})

test('rapid sequential increments accumulate accurately', () => {
  resetMetrics()
  const count = 500
  for (let i = 0; i < count; i++) {
    incrementCounter('requestsTotal')
    incrementCounter('roomsCreated')
  }
  const m = getMetrics()
  assert.equal(m.requestsTotal, count)
  assert.equal(m.roomsCreated, count)
  assert.equal(m.requestErrors, 0)
})
