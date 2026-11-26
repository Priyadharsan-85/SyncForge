/**
 * Connect a node-redis client at startup, but give up instead of retrying
 * forever.
 *
 * node-redis reconnects indefinitely when the first connection fails — even
 * for a wrong password, which can never succeed. At boot that means the HTTP
 * server never listens, the platform health check never passes, and a deploy
 * hangs for many minutes printing the same stack trace. Here an
 * authentication error fails immediately with an actionable message, and any
 * other failure fails after `timeoutMs`.
 */

export const DEFAULT_CONNECT_TIMEOUT_MS = 20_000

const AUTH_ERROR = /^(WRONGPASS|NOAUTH|NOPERM)\b|invalid username-password|Authentication required/i

export class RedisStartupError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'RedisStartupError'
  }
}

/**
 * @param {Error} error
 * @returns {boolean}
 */
export function isRedisAuthError(error) {
  return AUTH_ERROR.test(String(error?.message ?? ''))
}

/**
 * @param {{ connect(): Promise<unknown>, on(event: 'error', listener: (error: Error) => void): unknown, off?(event: 'error', listener: (error: Error) => void): unknown }} client
 * @param {{ label?: string, timeoutMs?: number }} [options]
 */
export async function connectRedisOrFail(client, options = {}) {
  const label = options.label ?? 'Redis'
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  let timer
  let onError
  let lastError

  const failure = new Promise((_resolve, reject) => {
    onError = (error) => {
      lastError = error
      if (isRedisAuthError(error)) {
        reject(new RedisStartupError(
          `${label} rejected the credentials in REDIS_URL (${error.message.split('\n')[0]}). ` +
          'Copy the connection URL again from your Redis provider — with the real password, not a masked one — ' +
          'and check it has not been reset.',
          { cause: error },
        ))
      }
    }
    client.on('error', onError)
    timer = setTimeout(() => {
      const detail = lastError ? ` Last error: ${lastError.message.split('\n')[0]}.` : ''
      reject(new RedisStartupError(
        `${label} did not connect within ${Math.round(timeoutMs / 1000)}s.${detail} ` +
        'Check the host, port and scheme in REDIS_URL (rediss:// for TLS providers such as Upstash).',
        { cause: lastError },
      ))
    }, timeoutMs)
  })

  try {
    await Promise.race([client.connect(), failure])
  } finally {
    clearTimeout(timer)
    client.off?.('error', onError)
  }
}
