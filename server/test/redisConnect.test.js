import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { connectRedisOrFail, isRedisAuthError, RedisStartupError } from '../src/redisConnect.js'

/** A client whose connect() never settles, like node-redis while it retries. */
function stuckClient() {
  const client = new EventEmitter()
  client.connect = () => new Promise(() => {})
  return client
}

test('isRedisAuthError recognises Redis and Upstash auth failures', () => {
  assert.ok(isRedisAuthError(new Error('WRONGPASS invalid username-password pair')))
  assert.ok(isRedisAuthError(new Error('NOAUTH Authentication required.')))
  assert.ok(!isRedisAuthError(new Error('Socket closed unexpectedly')))
  assert.ok(!isRedisAuthError(undefined))
})

test('resolves once the client connects', async () => {
  const client = new EventEmitter()
  client.connect = async () => {}
  await connectRedisOrFail(client, { timeoutMs: 1_000 })
  assert.equal(client.listenerCount('error'), 0)
})

test('fails immediately on an authentication error', async () => {
  const client = stuckClient()
  const started = Date.now()
  const pending = connectRedisOrFail(client, { label: 'Redis persistence', timeoutMs: 10_000 })
  client.emit('error', new Error('WRONGPASS invalid username-password pair'))
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof RedisStartupError)
    assert.match(error.message, /Redis persistence rejected the credentials in REDIS_URL/)
    return true
  })
  assert.ok(Date.now() - started < 1_000)
})

test('keeps waiting through transient errors, then times out with the last one', async () => {
  const client = stuckClient()
  const pending = connectRedisOrFail(client, { timeoutMs: 50 })
  client.emit('error', new Error('Socket closed unexpectedly'))
  await assert.rejects(pending, /did not connect within 0s\. Last error: Socket closed unexpectedly/)
  assert.equal(client.listenerCount('error'), 0)
})
