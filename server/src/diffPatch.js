/**
 * Line-level diff and patch utility for code documents.
 * Produces structured diffs, hunks with context, and unified diff strings.
 */

/**
 * Split text into lines, preserving newline boundaries if desired or normalizing to array of lines.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  if (typeof text !== 'string') return []
  if (text.length === 0) return []
  const lines = text.split(/\r?\n/)
  return lines
}

/**
 * Compute the Longest Common Subsequence (LCS) matrix for two arrays of lines.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number[][]}
 */
function computeLcsTable(a, b) {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (a[i] === b[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }
  return dp
}

/**
 * Compute line-level diff operations between two strings.
 * @param {string} oldText
 * @param {string} newText
 * @returns {Array<{ type: 'equal' | 'insert' | 'delete', text: string, oldLine?: number, newLine?: number }>}
 */
export function computeLineOperations(oldText, newText) {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const dp = computeLcsTable(oldLines, newLines)

  let i = oldLines.length
  let j = newLines.length
  const operations = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      operations.push({
        type: 'equal',
        text: oldLines[i - 1],
        oldLine: i,
        newLine: j,
      })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      operations.push({
        type: 'insert',
        text: newLines[j - 1],
        newLine: j,
      })
      j--
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      operations.push({
        type: 'delete',
        text: oldLines[i - 1],
        oldLine: i,
      })
      i--
    }
  }

  operations.reverse()
  return operations
}

/**
 * Group line operations into hunks with a given number of context lines.
 * @param {Array<{ type: 'equal' | 'insert' | 'delete', text: string, oldLine?: number, newLine?: number }>} operations
 * @param {number} [contextLines=3]
 * @returns {Array<{ oldStart: number, oldCount: number, newStart: number, newCount: number, lines: Array<{ type: 'equal' | 'insert' | 'delete', text: string }> }>}
 */
export function groupIntoHunks(operations, contextLines = 3) {
  if (operations.length === 0) return []

  // Check if there are any changes
  const hasChanges = operations.some((op) => op.type !== 'equal')
  if (!hasChanges) return []

  const hunks = []
  const changeIndices = []
  for (let idx = 0; idx < operations.length; idx++) {
    if (operations[idx].type !== 'equal') {
      changeIndices.push(idx)
    }
  }

  // Group change indices that are within 2 * contextLines of each other
  const groups = []
  let currentGroup = [changeIndices[0]]

  for (let k = 1; k < changeIndices.length; k++) {
    const prevIdx = currentGroup[currentGroup.length - 1]
    const curIdx = changeIndices[k]
    if (curIdx - prevIdx <= 2 * contextLines + 1) {
      currentGroup.push(curIdx)
    } else {
      groups.push(currentGroup)
      currentGroup = [curIdx]
    }
  }
  groups.push(currentGroup)

  for (const group of groups) {
    const firstChange = group[0]
    const lastChange = group[group.length - 1]

    const startIdx = Math.max(0, firstChange - contextLines)
    const endIdx = Math.min(operations.length - 1, lastChange + contextLines)

    const slice = operations.slice(startIdx, endIdx + 1)

    let oldStart = 1
    let newStart = 1
    let oldCount = 0
    let newCount = 0

    let foundFirstOld = false
    let foundFirstNew = false

    for (const op of slice) {
      if (op.type === 'equal') {
        if (!foundFirstOld && op.oldLine !== undefined) {
          oldStart = op.oldLine
          foundFirstOld = true
        }
        if (!foundFirstNew && op.newLine !== undefined) {
          newStart = op.newLine
          foundFirstNew = true
        }
        oldCount++
        newCount++
      } else if (op.type === 'delete') {
        if (!foundFirstOld && op.oldLine !== undefined) {
          oldStart = op.oldLine
          foundFirstOld = true
        }
        oldCount++
      } else if (op.type === 'insert') {
        if (!foundFirstNew && op.newLine !== undefined) {
          newStart = op.newLine
          foundFirstNew = true
        }
        newCount++
      }
    }

    if (!foundFirstOld) {
      // Insertion at start or end
      const firstOp = slice[0]
      oldStart = firstOp.oldLine ?? 1
    }
    if (!foundFirstNew) {
      const firstOp = slice[0]
      newStart = firstOp.newLine ?? 1
    }

    hunks.push({
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: slice.map((op) => ({ type: op.type, text: op.text })),
    })
  }

  return hunks
}

/**
 * Format line operations and hunks into standard Unified Diff format.
 * @param {string} filePath
 * @param {string} oldText
 * @param {string} newText
 * @param {number} [contextLines=3]
 * @returns {string}
 */
export function formatUnifiedDiff(filePath, oldText, newText, contextLines = 3) {
  const ops = computeLineOperations(oldText, newText)
  const hunks = groupIntoHunks(ops, contextLines)
  if (hunks.length === 0) return ''

  const header = `--- a/${filePath}\n+++ b/${filePath}\n`
  const hunkStrings = hunks.map((hunk) => {
    const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    const body = hunk.lines
      .map((line) => {
        const prefix = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' '
        return `${prefix}${line.text}`
      })
      .join('\n')
    return `${hunkHeader}\n${body}`
  })

  return `${header}${hunkStrings.join('\n')}\n`
}
