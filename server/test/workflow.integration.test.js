import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth.js'

const serverDirectory = fileURLToPath(new URL('../', import.meta.url))
const clientOrigin = 'http://localhost:5173'
const sessionSecret = 'syncforge-workflow-integration-test-secret-1234'

async function findOpenPort() {
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const { port } = probe.address()
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Server process exited prematurely.')
    }
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('Server did not become ready in time.')
}

function sessionCookie(name, id = 'user-1') {
  const token = createSessionToken(
    { id, login: name.toLowerCase().replace(/\s+/g, '-'), name },
    sessionSecret,
  )
  return `${SESSION_COOKIE_NAME}=${token}`
}

test('end-to-end AI patch review and GitHub branch workflow integration', { timeout: 25_000 }, async (t) => {
  const port = await findOpenPort()
  const url = `http://127.0.0.1:${port}`

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      REDIS_URL: '',
      CLIENT_ORIGIN: clientOrigin,
      SESSION_SECRET: sessionSecret,
      GITHUB_CLIENT_ID: 'test-client',
      GITHUB_CLIENT_SECRET: 'test-secret',
    },
    stdio: 'ignore',
  })

  t.after(() => {
    child.kill()
  })

  await waitForServer(child, url)

  const cookie = sessionCookie('Dana Architect', 'dana-101')
  const headers = {
    Origin: clientOrigin,
    Cookie: cookie,
    'Content-Type': 'application/json',
  }

  // 1. Create a workspace
  const createWsRes = await fetch(`${url}/api/workspaces`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Architecture Workspace' }),
  })
  assert.equal(createWsRes.status, 201)
  const workspace = await createWsRes.json()
  const roomId = workspace.roomId
  assert.ok(roomId)

  // 2. Request AI draft patch
  const baseCode = 'function calculateTotal(items) {\n  return items.reduce((a, b) => a + b, 0)\n}'
  const aiDraftRes = await fetch(`${url}/api/workspaces/${roomId}/ai/draft`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileId: 'file-calc',
      fileName: 'calculate.js',
      baseContent: baseCode,
      actionType: 'doc',
      prompt: 'Add JSDoc documentation',
    }),
  })
  assert.equal(aiDraftRes.status, 201)
  const draft = await aiDraftRes.json()
  assert.ok(draft.draftId)
  assert.ok(draft.proposedContent.includes('/**'))
  assert.ok(draft.diff.length > 0)

  // 3. Test rebase against concurrent live edits (clean & conflict)
  const rebaseCleanRes = await fetch(`${url}/api/workspaces/${roomId}/ai/rebase`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      draftId: draft.draftId,
      liveContent: baseCode, // Unchanged live
    }),
  })
  assert.equal(rebaseCleanRes.status, 200)
  const cleanRebase = await rebaseCleanRes.json()
  assert.equal(cleanRebase.hasConflict, false)
  assert.equal(cleanRebase.status, 'clean')

  // 4. Test branches: list and create feature branch
  const branchesRes = await fetch(`${url}/api/workspaces/${roomId}/branches`, { headers })
  assert.equal(branchesRes.status, 200)
  const initialBranches = await branchesRes.json()
  assert.ok(initialBranches.some((b) => b.name === 'main'))
  const mainHead = initialBranches.find((b) => b.name === 'main').headCommitId

  const createBranchRes = await fetch(`${url}/api/workspaces/${roomId}/branches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      branchName: 'feature/ai-patch-1',
      fromBranch: 'main',
    }),
  })
  assert.equal(createBranchRes.status, 201)
  const featureBranch = await createBranchRes.json()
  assert.equal(featureBranch.name, 'feature/ai-patch-1')

  // 5. Commit snapshot to feature branch
  const commitRes = await fetch(`${url}/api/workspaces/${roomId}/branches/feature%2Fai-patch-1/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: 'Apply AI documented calculator',
      tree: {
        'calculate.js': draft.proposedContent,
      },
      expectedParentCommitId: mainHead,
    }),
  })
  assert.equal(commitRes.status, 201)
  const commit = await commitRes.json()
  assert.ok(commit.commitId)

  // 6. Create Pull Request from feature to main
  const prRes = await fetch(`${url}/api/workspaces/${roomId}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Document calculator function',
      description: 'Reviews and merges AI draft patch into main branch snapshot.',
      sourceBranch: 'feature/ai-patch-1',
      targetBranch: 'main',
    }),
  })
  assert.equal(prRes.status, 201)
  const pr = await prRes.json()
  assert.equal(pr.number, 1)
  assert.equal(pr.status, 'open')

  // 7. Check PR diff
  const prDiffRes = await fetch(`${url}/api/workspaces/${roomId}/pulls/1/diff`, { headers })
  assert.equal(prDiffRes.status, 200)
  const prDiff = await prDiffRes.json()
  assert.equal(prDiff.canMergeCleanly, true)
  assert.ok(prDiff.files.some((f) => f.filePath === 'calculate.js'))

  // 8. Merge Pull Request
  const mergeRes = await fetch(`${url}/api/workspaces/${roomId}/pulls/1/merge`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commitMessage: 'Merge PR #1: Document calculator function',
    }),
  })
  assert.equal(mergeRes.status, 200)
  const mergeResult = await mergeRes.json()
  assert.equal(mergeResult.ok, true)
  assert.equal(mergeResult.pr.status, 'merged')

  // 9. Sync main branch back to live workspace
  const syncRes = await fetch(`${url}/api/workspaces/${roomId}/branches/main/sync-live`, {
    method: 'POST',
    headers,
  })
  assert.equal(syncRes.status, 200)
  const syncResult = await syncRes.json()
  assert.equal(syncResult.ok, true)
  assert.ok(syncResult.sync.added.includes('calculate.js') || syncResult.sync.updated.includes('calculate.js'))

  // 10. Check GitHub status & export PR patch
  const ghStatusRes = await fetch(`${url}/api/workspaces/${roomId}/github/status`, { headers })
  assert.equal(ghStatusRes.status, 200)
  const ghStatus = await ghStatusRes.json()
  assert.equal(ghStatus.hasWritePermission, false)
  assert.equal(ghStatus.status, 'future_work_unapproved')

  const exportPrRes = await fetch(`${url}/api/workspaces/${roomId}/pulls/1/export-patch`, {
    method: 'POST',
    headers,
  })
  assert.equal(exportPrRes.status, 200)
  const exportPr = await exportPrRes.json()
  assert.ok(exportPr.patch.includes('[PATCH] PR #1: Document calculator function'))
})
