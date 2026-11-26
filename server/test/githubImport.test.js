import assert from 'node:assert/strict'
import test from 'node:test'
import {
  importPublicGitHubRepository,
  isRateLimited,
  parsePublicRepositoryUrl,
  rateLimitMessage,
  withGitHubAuth,
} from '../src/githubImport.js'

test('repository URL parsing only permits public github.com repository URLs', () => {
  assert.deepEqual(
    parsePublicRepositoryUrl('https://github.com/example/project.git'),
    { owner: 'example', repository: 'project' },
  )
  assert.throws(() => parsePublicRepositoryUrl('https://example.com/example/project'))
  assert.throws(() => parsePublicRepositoryUrl('https://github.com/example/project/tree/main'))
})

test('public GitHub import returns text files and contributor identities', async () => {
  const requests = []
  const fetchMock = async (url) => {
    const parsedUrl = new URL(url)
    requests.push(parsedUrl)
    if (parsedUrl.pathname === '/repos/example/project') {
      return Response.json({
        private: false,
        full_name: 'example/project',
        default_branch: 'main',
      })
    }
    if (parsedUrl.pathname.endsWith('/commits/main')) {
      return Response.json({ sha: 'a'.repeat(40) })
    }
    if (parsedUrl.pathname.endsWith('/git/trees/main')) {
      return Response.json({
        truncated: false,
        tree: [
          { type: 'blob', mode: '100644', path: 'src/index.js', size: 12 },
          { type: 'blob', mode: '100644', path: 'assets/logo.png', size: 10 },
        ],
      })
    }
    if (parsedUrl.pathname.endsWith('/contributors')) {
      return Response.json([{ id: 123, login: 'contributor', type: 'User' }])
    }
    if (parsedUrl.hostname === 'raw.githubusercontent.com') {
      return new Response('console.log(1)', { status: 200 })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const imported = await importPublicGitHubRepository(
    'https://github.com/example/project',
    fetchMock,
  )

  assert.equal(imported.name, 'example/project')
  assert.deepEqual(imported.files, [{ path: 'src/index.js', content: 'console.log(1)' }])
  assert.deepEqual(imported.contributors, [{
    id: '123',
    login: 'contributor',
    name: 'contributor',
  }])
  assert.ok(requests.some((url) => url.hostname === 'raw.githubusercontent.com'))
})

test('private GitHub repositories are rejected', async () => {
  await assert.rejects(
    importPublicGitHubRepository('https://github.com/example/private', async () =>
      Response.json({ private: true }),
    ),
    /Only public/,
  )
})

function limitedResponse(status, headers) {
  return new Response(JSON.stringify({ message: 'limited' }), { status, headers })
}

test('a 403 with an exhausted quota is reported as a rate limit with the reset time', async () => {
  const resetAt = Math.floor(Date.now() / 1000) + 25 * 60
  await assert.rejects(
    importPublicGitHubRepository('https://github.com/example/project', async () =>
      limitedResponse(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt) }),
    { token: '' }),
    (error) => {
      assert.equal(error.status, 429)
      assert.match(error.message, /used up\. Try again in about 2[56] minutes/)
      return true
    },
  )
})

test('secondary rate limits use retry-after', () => {
  const response = limitedResponse(403, { 'retry-after': '30' })
  assert.ok(isRateLimited(response))
  assert.match(rateLimitMessage(response), /about 1 minute\./)
})

test('a 403 without rate-limit headers is not called a rate limit', async () => {
  const response = limitedResponse(403, { 'x-ratelimit-remaining': '42' })
  assert.equal(isRateLimited(response), false)
  await assert.rejects(
    importPublicGitHubRepository('https://github.com/example/project', async () => response, { token: '' }),
    (error) => error.status === 502 && /HTTP 403/.test(error.message),
  )
})

test('the API token is sent to api.github.com only', async () => {
  const seen = []
  const authed = withGitHubAuth(async (url, init) => {
    seen.push([new URL(url).hostname, init?.headers?.Authorization])
    return new Response('ok')
  }, 'tok_123')
  await authed('https://api.github.com/repos/a/b', { headers: { Accept: 'x' } })
  await authed('https://raw.githubusercontent.com/a/b/sha/file.js')
  assert.deepEqual(seen, [
    ['api.github.com', 'Bearer tok_123'],
    ['raw.githubusercontent.com', undefined],
  ])
})

test('without a token, fetch is passed through untouched', () => {
  const base = async () => new Response('ok')
  assert.equal(withGitHubAuth(base, undefined), base)
})
