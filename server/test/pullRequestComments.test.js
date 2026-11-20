import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  createBranch,
  initWorkspaceBranches,
} from '../src/branchManager.js'
import {
  addPullRequestComment,
  createPullRequest,
  listPullRequestComments,
  PullRequestError,
} from '../src/pullRequestManager.js'

function newRoom() {
  return randomUUID().replace(/-/g, '')
}

const author1 = { id: 'u1', login: 'alice', name: 'Alice' }
const author2 = { id: 'u2', login: 'bob', name: 'Bob' }

async function setupPr(roomId) {
  await initWorkspaceBranches(null, roomId, author1)
  await createBranch(null, { roomId, branchName: 'feature', fromBranch: 'main', user: author1 })
  return createPullRequest(null, {
    roomId,
    title: 'Test PR',
    sourceBranch: 'feature',
    targetBranch: 'main',
    author: author1,
  })
}

test('addPullRequestComment attaches a comment with generated id, timestamp, and author', async () => {
  const roomId = newRoom()
  const pr = await setupPr(roomId)

  const comment = await addPullRequestComment(null, {
    roomId,
    prNumber: pr.number,
    author: author1,
    body: 'LGTM! Great work.',
  })

  assert.ok(comment.commentId)
  assert.equal(comment.prNumber, pr.number)
  assert.equal(comment.roomId, roomId)
  assert.equal(comment.author.id, author1.id)
  assert.equal(comment.author.name, 'Alice')
  assert.equal(comment.body, 'LGTM! Great work.')
  assert.ok(typeof comment.createdAt === 'string')
})

test('listPullRequestComments returns comments in chronological order', async () => {
  const roomId = newRoom()
  const pr = await setupPr(roomId)

  await addPullRequestComment(null, {
    roomId,
    prNumber: pr.number,
    author: author1,
    body: 'First comment',
  })
  await addPullRequestComment(null, {
    roomId,
    prNumber: pr.number,
    author: author2,
    body: 'Second comment replying to first',
  })

  const comments = await listPullRequestComments(null, roomId, pr.number)
  assert.equal(comments.length, 2)
  assert.equal(comments[0].body, 'First comment')
  assert.equal(comments[0].author.name, 'Alice')
  assert.equal(comments[1].body, 'Second comment replying to first')
  assert.equal(comments[1].author.name, 'Bob')
})

test('addPullRequestComment rejects non-existent PR with 404', async () => {
  const roomId = newRoom()
  await assert.rejects(
    () =>
      addPullRequestComment(null, {
        roomId,
        prNumber: 999,
        author: author1,
        body: 'Comment on nothing',
      }),
    (err) => {
      assert.ok(err instanceof PullRequestError)
      assert.equal(err.status, 404)
      return true
    },
  )
})

test('addPullRequestComment rejects empty or whitespace-only comment body with 400', async () => {
  const roomId = newRoom()
  const pr = await setupPr(roomId)

  for (const invalidBody of ['', '   ', '\n\t  ']) {
    await assert.rejects(
      () =>
        addPullRequestComment(null, {
          roomId,
          prNumber: pr.number,
          author: author1,
          body: invalidBody,
        }),
      (err) => {
        assert.ok(err instanceof PullRequestError)
        assert.equal(err.status, 400)
        return true
      },
    )
  }
})

test('addPullRequestComment rejects comment exceeding 2,000 characters with 400', async () => {
  const roomId = newRoom()
  const pr = await setupPr(roomId)

  await assert.rejects(
    () =>
      addPullRequestComment(null, {
        roomId,
        prNumber: pr.number,
        author: author1,
        body: 'a'.repeat(2001),
      }),
    (err) => {
      assert.ok(err instanceof PullRequestError)
      assert.equal(err.status, 400)
      return true
    },
  )
})

test('comments on different PRs remain strictly isolated', async () => {
  const roomId = newRoom()
  await initWorkspaceBranches(null, roomId, author1)
  await createBranch(null, { roomId, branchName: 'feat-1', fromBranch: 'main', user: author1 })
  await createBranch(null, { roomId, branchName: 'feat-2', fromBranch: 'main', user: author1 })

  const pr1 = await createPullRequest(null, {
    roomId,
    title: 'PR 1',
    sourceBranch: 'feat-1',
    targetBranch: 'main',
    author: author1,
  })
  const pr2 = await createPullRequest(null, {
    roomId,
    title: 'PR 2',
    sourceBranch: 'feat-2',
    targetBranch: 'main',
    author: author1,
  })

  await addPullRequestComment(null, { roomId, prNumber: pr1.number, author: author1, body: 'Note on PR1' })
  await addPullRequestComment(null, { roomId, prNumber: pr2.number, author: author2, body: 'Note on PR2' })

  const comments1 = await listPullRequestComments(null, roomId, pr1.number)
  const comments2 = await listPullRequestComments(null, roomId, pr2.number)

  assert.equal(comments1.length, 1)
  assert.equal(comments1[0].body, 'Note on PR1')
  assert.equal(comments2.length, 1)
  assert.equal(comments2[0].body, 'Note on PR2')
})
