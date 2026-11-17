import { createHash } from 'node:crypto'
import { withRedisTimeout } from './redisStore.js'

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('TTL', KEYS[1]) }
`

const memoryCounters = new Map()
let memoryOperations = 0

function rateLimitKey(scope, actor) {
  const actorHash = createHash('sha256').update(actor).digest('hex')
  return `syncforge:rate-limit:${scope}:${actorHash}`
}

function validateOptions({ scope, actor, limit, windowSeconds }) {
  if (
    typeof scope !== 'string' ||
    !/^[a-z0-9-]+$/.test(scope) ||
    typeof actor !== 'string' ||
    !actor ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(windowSeconds) ||
    windowSeconds < 1
  ) {
    throw new TypeError('Invalid rate limit configuration.')
  }
}

export async function consumeRateLimit(client, options) {
  validateOptions(options)
  const { scope, actor, limit, windowSeconds } = options
  const key = rateLimitKey(scope, actor)

  if (client) {
    const result = await withRedisTimeout(
      client.eval(RATE_LIMIT_SCRIPT, {
        keys: [key],
        arguments: [String(windowSeconds)],
      }),
      'Rate limit check timed out',
    )
    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error('Redis returned an invalid rate limit result.')
    }
    const count = Number(result[0])
    const retryAfterSeconds = Math.max(1, Number(result[1]))
    if (!Number.isSafeInteger(count) || !Number.isFinite(retryAfterSeconds)) {
      throw new Error('Redis returned an invalid rate limit result.')
    }
    return { allowed: count <= limit, retryAfterSeconds }
  }

  const now = Date.now()
  let counter = memoryCounters.get(key)
  if (!counter || counter.expiresAt <= now) {
    counter = { count: 0, expiresAt: now + windowSeconds * 1000 }
  }
  counter.count += 1
  memoryCounters.set(key, counter)

  memoryOperations += 1
  if (memoryOperations % 256 === 0) {
    for (const [storedKey, storedCounter] of memoryCounters) {
      if (storedCounter.expiresAt <= now) memoryCounters.delete(storedKey)
    }
  }

  return {
    allowed: counter.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((counter.expiresAt - now) / 1000)),
  }
}
