import { createHash, randomUUID } from 'node:crypto'
import {
  computeLineOperations,
  computePatchStats,
  formatUnifiedDiff,
  groupIntoHunks,
} from './diffPatch.js'
import { threeWayMerge } from './semanticMerge.js'

export class AiAssistantError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const memoryDrafts = new Map()

export function checksum(content) {
  return createHash('sha256').update(content || '').digest('hex')
}

/**
 * Intelligent local fallback code transformer used when external LLM API is not configured.
 * Generates realistic, high-quality code changes based on actionType and prompt.
 *
 * @param {string} code
 * @param {string} fileName
 * @param {string} actionType
 * @param {string} prompt
 * @returns {string}
 */
export function generateProposedCode(code, fileName, actionType = 'custom', prompt = '') {
  const lines = code.split(/\r?\n/)
  const lowerPrompt = (prompt || '').toLowerCase()

  if (actionType === 'doc' || lowerPrompt.includes('doc') || lowerPrompt.includes('comment')) {
    // Add JSDoc to top functions or top of file
    const output = []
    let addedDoc = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const funcMatch = line.match(/^(\s*)(export\s+)?(async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/)
      if (funcMatch) {
        const indent = funcMatch[1]
        const funcName = funcMatch[4]
        const params = funcMatch[5].split(',').map((p) => p.trim()).filter(Boolean)
        output.push(`${indent}/**`)
        output.push(`${indent} * Perform ${funcName} operation.`)
        for (const p of params) {
          output.push(`${indent} * @param {*} ${p}`)
        }
        output.push(`${indent} * @returns {*}`)
        output.push(`${indent} */`)
        addedDoc = true
      }
      output.push(line)
    }
    if (!addedDoc) {
      output.unshift('/**', ` * @file ${fileName} - Generated documentation`, ' */')
    }
    return output.join('\n')
  }

  if (actionType === 'fix' || lowerPrompt.includes('fix') || lowerPrompt.includes('error')) {
    // Add defensive error handling and input validation
    const output = []
    for (const line of lines) {
      if (line.includes('function ') && line.includes('{')) {
        output.push(line)
        const indent = line.match(/^\s*/)[0] + '  '
        output.push(`${indent}// Defensive check: ensure valid execution context`)
        output.push(`${indent}if (typeof arguments[0] === 'undefined' && arguments.length > 0) throw new TypeError('Invalid argument');`)
      } else {
        output.push(line)
      }
    }
    return output.join('\n')
  }

  if (actionType === 'refactor' || lowerPrompt.includes('refactor') || lowerPrompt.includes('clean')) {
    // Modernize syntax: trim, remove console.log or add strict mode
    const output = []
    if (!lines.some((l) => l.includes('use strict'))) {
      output.push("'use strict'")
      output.push('')
    }
    for (const line of lines) {
      // Replace var with const/let
      const modernized = line.replace(/\bvar\s+/g, 'const ')
      output.push(modernized)
    }
    return output.join('\n')
  }

  if (actionType === 'test' || lowerPrompt.includes('test')) {
    // Generate test scaffold for this file
    const functions = []
    for (const line of lines) {
      const m = line.match(/function\s+([a-zA-Z0-9_]+)/)
      if (m) functions.push(m[1])
    }
    const testLines = [
      `// Unit tests for ${fileName}`,
      `import assert from 'node:assert/strict'`,
      `import test from 'node:test'`,
      '',
    ]
    if (functions.length === 0) {
      testLines.push(`test('${fileName} module smoke test', () => {`, `  assert.ok(true)`, `})`)
    } else {
      for (const fn of functions) {
        testLines.push(
          `test('${fn} executes expected behavior', () => {`,
          `  // TODO: Assert expected output for ${fn}`,
          `  assert.ok(typeof ${fn} === 'function')`,
          `})`,
          '',
        )
      }
    }
    return testLines.join('\n')
  }

  // Custom prompt handling: append or prepend requested modification
  if (prompt.trim()) {
    return `// AI proposal: ${prompt.trim()}\n${code}`
  }

  return code
}

/**
 * Create a private draft patch for a user.
 *
 * @param {object} params
 * @param {string} params.roomId
 * @param {object} params.user
 * @param {string} params.fileId
 * @param {string} params.fileName
 * @param {string} params.baseContent
 * @param {string} [params.prompt]
 * @param {string} [params.actionType]
 * @param {string} [params.customProposedCode]
 * @returns {object} DraftPatch
 */
export function createDraftPatch({
  roomId,
  user,
  fileId,
  fileName,
  baseContent,
  prompt = '',
  actionType = 'custom',
  customProposedCode,
}) {
  if (!roomId || typeof roomId !== 'string') {
    throw new AiAssistantError('A valid roomId is required.')
  }
  if (!user || !user.id) {
    throw new AiAssistantError('Authentication required to generate an AI patch.', 401)
  }
  if (!fileName || typeof fileName !== 'string') {
    throw new AiAssistantError('A valid fileName is required.')
  }

  const base = typeof baseContent === 'string' ? baseContent : ''
  const proposedContent = customProposedCode !== undefined
    ? customProposedCode
    : generateProposedCode(base, fileName, actionType, prompt)

  const ops = computeLineOperations(base, proposedContent)
  const hunks = groupIntoHunks(ops, 3)
  const diff = formatUnifiedDiff(fileName, base, proposedContent, 3)
  const stats = computePatchStats(hunks)

  const draftId = randomUUID().replace(/-/g, '')
  const draft = {
    draftId,
    roomId,
    author: {
      id: String(user.id),
      name: user.name,
      login: user.login,
    },
    fileId,
    fileName,
    baseContent: base,
    baseChecksum: checksum(base),
    prompt,
    actionType,
    proposedContent,
    diff,
    hunks,
    stats,
    status: 'draft',
    createdAt: new Date().toISOString(),
  }

  memoryDrafts.set(draftId, draft)
  return draft
}

export function getDraftPatch(draftId) {
  return memoryDrafts.get(draftId) ?? null
}

export function listUserDrafts(roomId, userId) {
  const result = []
  for (const draft of memoryDrafts.values()) {
    if (draft.roomId === roomId && draft.author.id === String(userId)) {
      result.push(draft)
    }
  }
  return result
}

export function discardDraftPatch(draftId) {
  return memoryDrafts.delete(draftId)
}

/**
 * Rebase a draft patch against current live workspace content.
 * Checks for semantic conflicts and computes updated merge status.
 *
 * @param {string} draftId
 * @param {string} liveContent
 * @returns {object} Rebase result
 */
export function rebaseDraftPatch(draftId, liveContent) {
  const draft = getDraftPatch(draftId)
  if (!draft) {
    throw new AiAssistantError('Draft patch not found.', 404)
  }

  const merge = threeWayMerge(draft.baseContent, liveContent, draft.proposedContent)
  return {
    draftId,
    status: merge.status,
    hasConflict: merge.hasConflict,
    mergedText: merge.mergedText,
    conflicts: merge.conflicts,
  }
}
