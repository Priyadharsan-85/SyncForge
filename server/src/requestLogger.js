import { randomUUID } from 'node:crypto'

/**
 * Lightweight request logging middleware.
 * In development: logs method, path, status, and duration to stdout.
 * In production: same but skips health check endpoints to reduce noise.
 */
export function requestLogger(request, response, next) {
  const id = randomUUID().slice(0, 8)
  const start = Date.now()

  // Attach request ID for downstream error logging
  request.id = id

  response.on('finish', () => {
    const path = request.path ?? request.url ?? ''
    if (process.env.NODE_ENV === 'production' && (path === '/health' || path === '/ready')) return

    const duration = Date.now() - start
    const level = response.statusCode >= 500 ? 'ERROR' : response.statusCode >= 400 ? 'WARN' : 'INFO'
    console.log(
      JSON.stringify({
        level,
        reqId: id,
        method: request.method,
        path,
        status: response.statusCode,
        durationMs: duration,
      }),
    )
  })

  next()
}
