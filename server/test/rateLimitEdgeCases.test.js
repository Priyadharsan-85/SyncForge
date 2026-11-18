/**
 * Additional edge-case tests for the rate-limiting module.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeRateLimit } from '../src/rateLimit.js'

test('consumeRateLimit throws for missing scope', async () => {
  await assert.rejects(
    () => consumeRateLimit(null, { scope: '', actor: 'user1', limit: 5, windowSeconds: 60 }),
    TypeError,
  )
})

test('consumeRateLimit throws for non-string actor', async () => {
  await assert.rejects(
    () => consumeRateLimit(null, { scope: 'test', actor: 42, limit: 5, windowSeconds: 60 }),
    TypeError,
  )
})

test('consumeRateLimit throws for zero limit', async () => {
  await assert.rejects(
    () => consumeRateLimit(null, { scope: 'test', actor: 'user', limit: 0, windowSeconds: 60 }),
    TypeError,
  )
})

test('consumeRateLimit throws for negative windowSeconds', async () => {
  await assert.rejects(
    () => consumeRateLimit(null, { scope: 'test', actor: 'user', limit: 5, windowSeconds: -1 }),
    TypeError,
  )
})

test('consumeRateLimit allows requests up to the limit', async () => {
  const actor = `actor-allow-${Date.now()}`
  for (let i = 0; i < 5; i++) {
    const result = await consumeRateLimit(null, {
      scope: 'edge-allow',
      actor,
      limit: 5,
      windowSeconds: 3600,
    })
    assert.equal(result.allowed, true, `Request ${i + 1} should be allowed`)
  }
})

test('consumeRateLimit blocks requests over the limit', async () => {
  const actor = `actor-block-${Date.now()}`
  const opts = { scope: 'edge-block', actor, limit: 3, windowSeconds: 3600 }
  for (let i = 0; i < 3; i++) await consumeRateLimit(null, opts)
  const blocked = await consumeRateLimit(null, opts)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterSeconds > 0)
})

test('consumeRateLimit isolates different actors', async () => {
  const actorA = `actor-a-${Date.now()}`
  const actorB = `actor-b-${Date.now()}`
  const opts = { scope: 'edge-isolation', limit: 2, windowSeconds: 3600 }

  // Exhaust actor A
  await consumeRateLimit(null, { ...opts, actor: actorA })
  await consumeRateLimit(null, { ...opts, actor: actorA })
  const blockedA = await consumeRateLimit(null, { ...opts, actor: actorA })
  assert.equal(blockedA.allowed, false)

  // Actor B should still be allowed
  const allowedB = await consumeRateLimit(null, { ...opts, actor: actorB })
  assert.equal(allowedB.allowed, true)
})

test('consumeRateLimit isolates different scopes', async () => {
  const actor = `actor-scoped-${Date.now()}`
  const baseOpts = { actor, limit: 1, windowSeconds: 3600 }

  // Exhaust scope-X
  await consumeRateLimit(null, { ...baseOpts, scope: 'scope-x' })
  const blockedX = await consumeRateLimit(null, { ...baseOpts, scope: 'scope-x' })
  assert.equal(blockedX.allowed, false)

  // scope-Y should not be affected
  const allowedY = await consumeRateLimit(null, { ...baseOpts, scope: 'scope-y' })
  assert.equal(allowedY.allowed, true)
})
