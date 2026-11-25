import { randomUUID } from 'node:crypto'

/**
 * Lightweight request logging middleware.
 * In development: logs method, path, status, and duration to stdout.
 * In production: same but skips health check endpoints to reduce noise.
 */
export function requestLogger(request, response, next) {
  const id = randomUUID().slice(0, 8)
  const start = Date.now()

  // Attach request ID for downstream error logging, and echo it back so a
  // caller can quote it when reporting a failure.
  request.id = id
  // setHeader, not Express's res.set, so this middleware stays usable on a
  // bare node:http response.
  if (!response.headersSent) response.setHeader('X-Request-Id', id)

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
