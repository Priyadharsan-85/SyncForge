/**
 * Terminal HTTP middleware: a JSON 404 for unmatched routes and a single
 * error handler that every route can throw into.
 *
 * Without these, an unmatched path returns Express's HTML "Cannot GET /x"
 * page and an unexpected throw returns an HTML stack trace — both of which
 * break a JSON client and the second of which leaks server internals.
 *
 * `NODE_ENV` is read at call time, not at module load, so a test can flip
 * the environment between assertions.
 */

/** Statuses a route may set deliberately; anything else is treated as a bug. */
const MIN_HTTP_ERROR = 400
const MAX_HTTP_ERROR = 599

/**
 * An error carrying an intended HTTP status. Routes and service modules
 * throw this (or anything with a `status`/`statusCode` field) and the
 * handler below turns it into a response.
 */
export class HttpError extends Error {
  /**
   * @param {string} message Message safe to show the caller.
   * @param {number} [status]
   * @param {{ code?: string, cause?: unknown }} [options]
   */
  constructor(message, status = 500, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'HttpError'
    this.status = status
    if (options.code) this.code = options.code
  }
}

function isProduction() {
  return process.env.NODE_ENV === 'production'
}

/**
 * Pull an intended status off an error, falling back to 500 for anything
 * that does not declare a valid HTTP error status.
 *
 * @param {unknown} error
 * @returns {number}
 */
export function resolveErrorStatus(error) {
  const declared = error?.status ?? error?.statusCode
  if (
    Number.isInteger(declared) &&
    declared >= MIN_HTTP_ERROR &&
    declared <= MAX_HTTP_ERROR
  ) return declared

  // body-parser tags its own failures rather than setting a status we trust.
  if (error?.type === 'entity.parse.failed') return 400
  if (error?.type === 'entity.too.large') return 413

  return 500
}

/**
 * Pick the message to send the caller. Deliberate 4xx messages are written
 * for users and pass through; 5xx messages may contain connection strings,
 * file paths, or driver internals, so they are replaced in production.
 *
 * @param {unknown} error
 * @param {number} status
 * @returns {string}
 */
export function resolveErrorMessage(error, status) {
  if (error?.type === 'entity.parse.failed') return 'The request body is not valid JSON.'
  if (error?.type === 'entity.too.large') return 'The request body is too large.'

  if (status < 500) {
    const message = typeof error?.message === 'string' ? error.message.trim() : ''
    return message || 'The request could not be processed.'
  }

  if (isProduction()) return 'An unexpected server error occurred.'
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message
    : 'An unexpected server error occurred.'
}

/**
 * Respond to any request that matched no route. Mount after every route.
 *
 * @param {import('express').Request} request
 * @param {import('express').Response} response
 */
export function notFoundHandler(request, response) {
  response.status(404).json({
    error: 'This endpoint does not exist.',
    path: request.path ?? request.url ?? '',
    requestId: request.id,
  })
}

/**
 * Express error handler. Must keep all four parameters for Express to
 * recognise it as an error handler, and must be mounted last.
 *
 * @param {unknown} error
 * @param {import('express').Request} request
 * @param {import('express').Response} response
 * @param {import('express').NextFunction} next
 */
export function errorHandler(error, request, response, next) {
  // The response is already streaming; Express's default handler is the only
  // thing that can close it cleanly.
  if (response.headersSent) {
    next(error)
    return
  }

  const status = resolveErrorStatus(error)

  if (status >= 500) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        reqId: request.id,
        method: request.method,
        path: request.path ?? request.url ?? '',
        status,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }),
    )
  }

  const body = {
    error: resolveErrorMessage(error, status),
    requestId: request.id,
  }
  if (typeof error?.code === 'string') body.code = error.code
  if (status >= 500 && !isProduction() && error instanceof Error) body.stack = error.stack

  response.status(status).json(body)
}
