import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import {
  errorHandler,
  HttpError,
  notFoundHandler,
  resolveErrorMessage,
  resolveErrorStatus,
} from '../src/errorHandler.js'
import { requestLogger } from '../src/requestLogger.js'

/**
 * Build an Express app wired exactly like the real server: logger first,
 * routes, then the two terminal handlers.
 *
 * @param {(app: import('express').Express) => void} defineRoutes
 */
async function withApp(defineRoutes, run) {
  const app = express()
  app.use(requestLogger)
  app.use(express.json({ limit: '1kb' }))
  defineRoutes(app)
  app.use(notFoundHandler)
  app.use(errorHandler)

  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()

  // Error paths log to console by design; keep the test output readable.
  const originalError = console.error
  const originalLog = console.log
  console.error = () => {}
  console.log = () => {}

  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    console.error = originalError
    console.log = originalLog
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

// ── resolveErrorStatus ──────────────────────────────────────────────────────

test('resolveErrorStatus honours a declared 4xx or 5xx status', () => {
  assert.equal(resolveErrorStatus({ status: 404 }), 404)
  assert.equal(resolveErrorStatus({ status: 429 }), 429)
  assert.equal(resolveErrorStatus({ statusCode: 503 }), 503)
  assert.equal(resolveErrorStatus(new HttpError('nope', 403)), 403)
})

test('resolveErrorStatus falls back to 500 for statuses outside the error range', () => {
  assert.equal(resolveErrorStatus({ status: 200 }), 500)
  assert.equal(resolveErrorStatus({ status: 302 }), 500)
  assert.equal(resolveErrorStatus({ status: 600 }), 500)
  assert.equal(resolveErrorStatus({ status: 399 }), 500)
})

test('resolveErrorStatus falls back to 500 for malformed or missing statuses', () => {
  assert.equal(resolveErrorStatus(new Error('boom')), 500)
  assert.equal(resolveErrorStatus({ status: '404' }), 500)
  assert.equal(resolveErrorStatus({ status: 404.5 }), 500)
  assert.equal(resolveErrorStatus({ status: Number.NaN }), 500)
  assert.equal(resolveErrorStatus(undefined), 500)
  assert.equal(resolveErrorStatus(null), 500)
})

test('resolveErrorStatus maps body-parser failure types to their HTTP statuses', () => {
  assert.equal(resolveErrorStatus({ type: 'entity.parse.failed' }), 400)
  assert.equal(resolveErrorStatus({ type: 'entity.too.large' }), 413)
})

// ── resolveErrorMessage ─────────────────────────────────────────────────────

test('resolveErrorMessage passes a deliberate 4xx message through unchanged', () => {
  assert.equal(
    resolveErrorMessage(new HttpError('Workspace not found.', 404), 404),
    'Workspace not found.',
  )
})

test('resolveErrorMessage substitutes a blank 4xx message', () => {
  assert.equal(resolveErrorMessage(new Error('   '), 400), 'The request could not be processed.')
  assert.equal(resolveErrorMessage({}, 400), 'The request could not be processed.')
})

test('resolveErrorMessage hides 5xx detail in production but keeps it in development', () => {
  const original = process.env.NODE_ENV
  const leaky = new Error('redis://user:hunter2@10.0.0.4:6379 refused the connection')
  try {
    process.env.NODE_ENV = 'production'
    const masked = resolveErrorMessage(leaky, 500)
    assert.equal(masked, 'An unexpected server error occurred.')
    assert.ok(!masked.includes('hunter2'))

    process.env.NODE_ENV = 'development'
    assert.ok(resolveErrorMessage(leaky, 500).includes('10.0.0.4'))
  } finally {
    process.env.NODE_ENV = original
  }
})

test('resolveErrorMessage uses friendly text for body-parser failures', () => {
  assert.equal(
    resolveErrorMessage({ type: 'entity.parse.failed', message: 'Unexpected token }' }, 400),
    'The request body is not valid JSON.',
  )
  assert.equal(
    resolveErrorMessage({ type: 'entity.too.large', message: 'request entity too large' }, 413),
    'The request body is too large.',
  )
})

// ── notFoundHandler ─────────────────────────────────────────────────────────

test('an unmatched route returns JSON rather than Express HTML', async () => {
  await withApp(
    (app) => app.get('/api/known', (_request, response) => response.json({ ok: true })),
    async (base) => {
      const response = await fetch(`${base}/api/does-not-exist`)
      assert.equal(response.status, 404)
      assert.match(response.headers.get('content-type') ?? '', /application\/json/)

      const body = await response.json()
      assert.equal(body.error, 'This endpoint does not exist.')
      assert.equal(body.path, '/api/does-not-exist')
      assert.equal(typeof body.requestId, 'string')
      assert.ok(body.requestId.length > 0)
    },
  )
})

test('a matched route still responds normally with the 404 handler mounted', async () => {
  await withApp(
    (app) => app.get('/api/known', (_request, response) => response.json({ ok: true })),
    async (base) => {
      const response = await fetch(`${base}/api/known`)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { ok: true })
    },
  )
})

// ── errorHandler, end to end ────────────────────────────────────────────────

test('a thrown HttpError becomes a JSON response with its declared status', async () => {
  await withApp(
    (app) =>
      app.get('/boom', () => {
        throw new HttpError('You do not have access to this workspace.', 403, {
          code: 'FORBIDDEN',
        })
      }),
    async (base) => {
      const response = await fetch(`${base}/boom`)
      assert.equal(response.status, 403)

      const body = await response.json()
      assert.equal(body.error, 'You do not have access to this workspace.')
      assert.equal(body.code, 'FORBIDDEN')
      assert.equal(typeof body.requestId, 'string')
    },
  )
})

test('a rejected async route handler is forwarded to the error handler', async () => {
  await withApp(
    (app) =>
      app.get('/async-boom', async () => {
        await Promise.resolve()
        throw new HttpError('Commit not found.', 404)
      }),
    async (base) => {
      const response = await fetch(`${base}/async-boom`)
      assert.equal(response.status, 404)
      assert.equal((await response.json()).error, 'Commit not found.')
    },
  )
})

test('an unexpected throw returns 500 and masks the message in production', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    await withApp(
      (app) =>
        app.get('/crash', () => {
          throw new Error('ECONNREFUSED redis://10.0.0.4:6379')
        }),
      async (base) => {
        const response = await fetch(`${base}/crash`)
        assert.equal(response.status, 500)

        const body = await response.json()
        assert.equal(body.error, 'An unexpected server error occurred.')
        assert.ok(!JSON.stringify(body).includes('10.0.0.4'))
        assert.equal(body.stack, undefined)
      },
    )
  } finally {
    process.env.NODE_ENV = original
  }
})

test('an unexpected throw includes the stack outside production', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    await withApp(
      (app) =>
        app.get('/crash', () => {
          throw new Error('kaboom')
        }),
      async (base) => {
        const body = await (await fetch(`${base}/crash`)).json()
        assert.equal(body.error, 'kaboom')
        assert.ok(typeof body.stack === 'string' && body.stack.includes('kaboom'))
      },
    )
  } finally {
    process.env.NODE_ENV = original
  }
})

test('malformed JSON in a request body returns 400 instead of 500', async () => {
  await withApp(
    (app) => app.post('/echo', (request, response) => response.json(request.body)),
    async (base) => {
      const response = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"name": ',
      })
      assert.equal(response.status, 400)
      assert.equal((await response.json()).error, 'The request body is not valid JSON.')
    },
  )
})

test('an oversized request body returns 413', async () => {
  await withApp(
    (app) => app.post('/echo', (request, response) => response.json(request.body)),
    async (base) => {
      const response = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blob: 'x'.repeat(4096) }),
      })
      assert.equal(response.status, 413)
      assert.equal((await response.json()).error, 'The request body is too large.')
    },
  )
})

test('every response carries an X-Request-Id matching the body requestId', async () => {
  await withApp(
    (app) =>
      app.get('/boom', () => {
        throw new HttpError('Nope.', 400)
      }),
    async (base) => {
      const response = await fetch(`${base}/boom`)
      const header = response.headers.get('x-request-id')
      assert.ok(header, 'expected an X-Request-Id header')
      assert.equal((await response.json()).requestId, header)
    },
  )
})

// ── HttpError ───────────────────────────────────────────────────────────────

test('HttpError defaults to 500 and retains message, code, and cause', () => {
  const bare = new HttpError('something broke')
  assert.equal(bare.status, 500)
  assert.equal(bare.name, 'HttpError')
  assert.ok(bare instanceof Error)

  const cause = new Error('underlying')
  const detailed = new HttpError('wrapped', 502, { code: 'UPSTREAM', cause })
  assert.equal(detailed.status, 502)
  assert.equal(detailed.code, 'UPSTREAM')
  assert.equal(detailed.cause, cause)
})

test('errorHandler delegates to Express once headers have been sent', () => {
  let delegated
  const response = { headersSent: true, status: () => response, json: () => response }
  const error = new Error('too late')
  errorHandler(error, { id: 'abc123', method: 'GET', path: '/x' }, response, (forwarded) => {
    delegated = forwarded
  })
  assert.equal(delegated, error)
})
