import assert from 'node:assert/strict'
import test from 'node:test'
import {
  importPublicGitHubRepository,
  parsePublicRepositoryUrl,
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
