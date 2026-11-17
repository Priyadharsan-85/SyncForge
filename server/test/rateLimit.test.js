import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeRateLimit } from '../src/rateLimit.js'

test('memory rate limits cap an actor without blocking other actions or users', async () => {
  const options = { scope: 'unit-test-action', actor: 'unit-test-user', limit: 2, windowSeconds: 60 }
  assert.deepEqual(await consumeRateLimit(null, options), {
    allowed: true,
    retryAfterSeconds: 60,
  })
  assert.equal((await consumeRateLimit(null, options)).allowed, true)
  const blocked = await consumeRateLimit(null, options)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterSeconds > 0)
  assert.equal((await consumeRateLimit(null, { ...options, actor: 'another-user' })).allowed, true)
  assert.equal((await consumeRateLimit(null, { ...options, scope: 'another-action' })).allowed, true)
})

test('Redis rate limits use one atomic counter across callers', async () => {
  const counts = new Map()
  const redis = {
    async eval(script, { keys, arguments: args }) {
      assert.match(script, /redis\.call\('INCR'/)
      const count = (counts.get(keys[0]) ?? 0) + 1
      counts.set(keys[0], count)
      return [count, Number(args[0])]
    },
  }
  const options = { scope: 'redis-test-action', actor: 'redis-test-user', limit: 1, windowSeconds: 90 }

  assert.equal((await consumeRateLimit(redis, options)).allowed, true)
  const blocked = await consumeRateLimit(redis, options)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.retryAfterSeconds, 90)
})
