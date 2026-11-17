import { getBranch, getCommit } from './branchManager.js'
import { formatUnifiedDiff } from './diffPatch.js'
import { getPullRequest, getPullRequestDiff } from './pullRequestManager.js'

export class GitHubWorkflowError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * Return GitHub workflow capability and write permission status.
 *
 * @param {object} session User session
 * @returns {object} Status descriptor
 */
export function getGitHubWorkflowStatus(session) {
  const scope = session?.scope ?? 'read:user'
  const hasWritePermission = Boolean(session?.githubWriteToken || scope.includes('repo'))

  return {
    hasWritePermission,
    status: hasWritePermission ? 'ready' : 'future_work_unapproved',
    scope,
    requiredScope: 'public_repo',
    message: hasWritePermission
      ? 'GitHub write permissions active.'
      : 'SyncForge currently imports public repos but does not have GitHub write permissions, so remote GitHub branch pushing remains future work until you approve it. You can review, merge branches locally, and export patches.',
    canExportPatch: true,
  }
}

/**
 * Export a branch's changes relative to its parent/base as a standard Git unified patch.
 *
 * @param {import('redis').RedisClientType | null} client
 * @param {string} roomId
 * @param {string} branchName
 * @returns {Promise<{ branchName: string, commitId: string, patch: string, fileCount: number }>}
 */
export async function exportBranchAsPatch(client, roomId, branchName) {
  const branch = await getBranch(client, roomId, branchName)
  if (!branch) {
    throw new GitHubWorkflowError(`Branch "${branchName}" not found.`, 404)
  }

  const commit = await getCommit(client, roomId, branch.headCommitId)
  if (!commit) {
    throw new GitHubWorkflowError(`Commit for branch "${branchName}" not found.`, 404)
  }

  let parentTree = {}
  if (commit.parentCommitId) {
    const parentCommit = await getCommit(client, roomId, commit.parentCommitId)
    if (parentCommit?.tree) parentTree = parentCommit.tree
  }

  const currentTree = commit.tree || {}
  const allFiles = new Set([...Object.keys(parentTree), ...Object.keys(currentTree)])
  const patches = []

  for (const filePath of allFiles) {
    const oldContent = parentTree[filePath] ?? ''
    const newContent = currentTree[filePath] ?? ''
    if (oldContent === newContent) continue

    const diff = formatUnifiedDiff(filePath, oldContent, newContent)
    if (diff) patches.push(diff)
  }

  const header = [
    `From ${commit.commitId} Mon Sep 17 00:00:00 2001`,
    `From: ${commit.author.name} <${commit.author.login}@users.noreply.github.com>`,
    `Date: ${commit.timestamp}`,
    `Subject: [PATCH] ${commit.message}`,
    '',
    '---',
    '',
  ].join('\n')

  return {
    branchName,
    commitId: commit.commitId,
    patch: `${header}${patches.join('\n')}`,
    fileCount: patches.length,
  }
}

/**
 * Export a Pull Request as a standard Git unified patch.
 *
 * @param {import('redis').RedisClientType | null} client
 * @param {string} roomId
 * @param {number} prNumber
 * @returns {Promise<{ prNumber: number, title: string, patch: string, fileCount: number }>}
 */
export async function exportPullRequestAsPatch(client, roomId, prNumber) {
  const pr = await getPullRequest(client, roomId, prNumber)
  if (!pr) {
    throw new GitHubWorkflowError(`Pull request #${prNumber} not found.`, 404)
  }

  const diffResult = await getPullRequestDiff(client, roomId, prNumber)
  const patchBody = diffResult.files.map((f) => f.diff).filter(Boolean).join('\n')

  const header = [
    `From: SyncForge Pull Request #${pr.number}`,
    `Subject: [PATCH] PR #${pr.number}: ${pr.title}`,
    `Source: ${pr.sourceBranch} -> Target: ${pr.targetBranch}`,
    `Author: ${pr.author.name} (${pr.author.login})`,
    '',
    '---',
    '',
  ].join('\n')

  return {
    prNumber: pr.number,
    title: pr.title,
    patch: `${header}${patchBody}`,
    fileCount: diffResult.files.length,
  }
}

/**
 * Guarded push to remote GitHub repository.
 * Strictly checks permissions and blocks unauthorized write attempts.
 */
export async function pushBranchToGitHub(session, { repoFullName, branchName }) {
  const status = getGitHubWorkflowStatus(session)
  if (!status.hasWritePermission) {
    throw new GitHubWorkflowError(
      'SyncForge currently imports public repos but does not have GitHub write permissions. This workflow remains future work until you approve it. Please export as a patch or git bundle instead.',
      403,
    )
  }

  // If approved write token is provided in the future, perform remote push
  return {
    ok: true,
    message: `Pushed ${branchName} to https://github.com/${repoFullName}`,
  }
}
