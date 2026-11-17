import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBranch,
  createCommit,
  initWorkspaceBranches,
} from '../src/branchManager.js'
import {
  exportBranchAsPatch,
  exportPullRequestAsPatch,
  getGitHubWorkflowStatus,
  pushBranchToGitHub,
} from '../src/githubWorkflow.js'
import { createPullRequest } from '../src/pullRequestManager.js'

const testUser = {
  id: 'usr-gh-tester',
  name: 'GitHub Tester',
  login: 'ghtester',
}

test('getGitHubWorkflowStatus flags unapproved future work when lacking write scope', () => {
  const readOnlySession = { id: '123', scope: 'read:user' }
  const status = getGitHubWorkflowStatus(readOnlySession)

  assert.equal(status.hasWritePermission, false)
  assert.equal(status.status, 'future_work_unapproved')
  assert.ok(status.message.includes('future work until you approve it'))
  assert.equal(status.canExportPatch, true)
})

test('pushBranchToGitHub blocks write attempt when permissions are unapproved', async () => {
  const session = { id: '123', scope: 'read:user' }

  await assert.rejects(
    async () => {
      await pushBranchToGitHub(session, {
        repoFullName: 'owner/repo',
        branchName: 'feature/patch-1',
      })
    },
    (err) => {
      assert.equal(err.status, 403)
      assert.ok(err.message.includes('future work until you approve it'))
      return true
    },
  )
})

test('exportBranchAsPatch formats unified patch of branch changes', async () => {
  const roomId = 'room-gh-export-1'
  const main = await initWorkspaceBranches(null, roomId, testUser, { 'math.js': 'const x = 10' })
  await createBranch(null, {
    roomId,
    branchName: 'feature/math-update',
    fromBranch: 'main',
    user: testUser,
  })

  await createCommit(null, {
    roomId,
    branchName: 'feature/math-update',
    message: 'Add y constant',
    author: testUser,
    tree: { 'math.js': 'const x = 10\nconst y = 20' },
    expectedParentCommitId: main.headCommitId,
  })

  const exportResult = await exportBranchAsPatch(null, roomId, 'feature/math-update')
  assert.equal(exportResult.branchName, 'feature/math-update')
  assert.equal(exportResult.fileCount, 1)
  assert.ok(exportResult.patch.includes('[PATCH] Add y constant'))
  assert.ok(exportResult.patch.includes('+const y = 20'))
})

test('exportPullRequestAsPatch formats patch file for PR changes', async () => {
  const roomId = 'room-gh-export-2'
  const main = await initWorkspaceBranches(null, roomId, testUser, { 'readme.md': '# SyncForge' })
  await createBranch(null, {
    roomId,
    branchName: 'docs/readme-fix',
    fromBranch: 'main',
    user: testUser,
  })

  await createCommit(null, {
    roomId,
    branchName: 'docs/readme-fix',
    message: 'Add description',
    author: testUser,
    tree: { 'readme.md': '# SyncForge\nA collaborative editor.' },
    expectedParentCommitId: main.headCommitId,
  })

  const pr = await createPullRequest(null, {
    roomId,
    title: 'Improve documentation',
    sourceBranch: 'docs/readme-fix',
    targetBranch: 'main',
    author: testUser,
  })

  const exportResult = await exportPullRequestAsPatch(null, roomId, pr.number)
  assert.equal(exportResult.prNumber, pr.number)
  assert.ok(exportResult.patch.includes('Subject: [PATCH] PR #1: Improve documentation'))
  assert.ok(exportResult.patch.includes('+A collaborative editor.'))
})
