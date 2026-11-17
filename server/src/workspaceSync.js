import * as Y from 'yjs'
import { getBranch, getCommit } from './branchManager.js'

export class WorkspaceSyncError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * Apply a branch snapshot's file tree to a live Yjs workspace document.
 * This explicitly syncs snapshot changes back to the live CRDT workspace.
 *
 * @param {Y.Doc} doc
 * @param {Record<string, string>} tree
 * @param {object} [origin]
 * @returns {{ added: string[], updated: string[], removed: string[] }}
 */
export function applyTreeToLiveDocument(doc, tree, origin = null) {
  if (!doc || !(doc instanceof Y.Doc)) {
    throw new WorkspaceSyncError('A valid Y.Doc is required.')
  }
  if (!tree || typeof tree !== 'object') {
    throw new WorkspaceSyncError('A valid snapshot tree is required.')
  }

  const filesMap = doc.getMap('files')
  const added = []
  const updated = []
  const removed = []

  doc.transact(() => {
    // 1. Process files in the snapshot tree
    for (const [filePath, content] of Object.entries(tree)) {
      if (filesMap.has(filePath)) {
        const fileRecord = filesMap.get(filePath)
        const ytext = fileRecord instanceof Y.Map ? fileRecord.get('content') : null
        if (ytext instanceof Y.Text) {
          const currentContent = ytext.toString()
          if (currentContent !== content) {
            ytext.delete(0, currentContent.length)
            ytext.insert(0, content)
            updated.push(filePath)
          }
        }
      } else {
        const fileRecord = new Y.Map()
        const ytext = new Y.Text()
        if (content) ytext.insert(0, content)
        fileRecord.set('name', filePath)
        fileRecord.set('content', ytext)
        filesMap.set(filePath, fileRecord)
        added.push(filePath)
      }
    }

    // 2. Remove files no longer in the snapshot tree
    for (const existingKey of Array.from(filesMap.keys())) {
      if (!(existingKey in tree)) {
        filesMap.delete(existingKey)
        removed.push(existingKey)
      }
    }
  }, origin)

  return { added, updated, removed }
}

/**
 * Sync a branch HEAD snapshot into a live workspace Yjs document.
 *
 * @param {import('redis').RedisClientType | null} client
 * @param {object} params
 * @param {string} params.roomId
 * @param {string} params.branchName
 * @param {Y.Doc} params.doc
 * @param {object} [params.origin]
 * @returns {Promise<{ branchName: string, commitId: string, added: string[], updated: string[], removed: string[] }>}
 */
export async function syncBranchToLiveWorkspace(client, { roomId, branchName, doc, origin = null }) {
  const branch = await getBranch(client, roomId, branchName)
  if (!branch) {
    throw new WorkspaceSyncError(`Branch "${branchName}" not found.`, 404)
  }

  const commit = await getCommit(client, roomId, branch.headCommitId)
  if (!commit) {
    throw new WorkspaceSyncError(`HEAD commit for branch "${branchName}" not found.`, 404)
  }

  const syncStats = applyTreeToLiveDocument(doc, commit.tree || {}, origin)

  return {
    branchName,
    commitId: commit.commitId,
    ...syncStats,
  }
}
