import type { ReactNode } from 'react'

export interface Command {
  /** Stable identity, used as the React key. */
  id: string
  label: string
  /** Muted text on the right of the row — a shortcut, a file extension. */
  hint?: string
  /** Group name shown as a badge, and matched against the query. */
  group: string
  icon: ReactNode
  /** Extra terms that should match this command but are not in the label. */
  keywords?: string
  run: () => void
}

/** Characters that start a new "word" for the purpose of boundary bonuses. */
const WORD_BOUNDARY = /[\s\-_/.:]/

/**
 * Score how well `text` matches `query` as a subsequence.
 *
 * Returns 0 for no match, so callers can filter on falsiness. A higher
 * score is a better match. The weighting rewards, in order: an exact
 * prefix, letters that begin a word, and runs of consecutive letters —
 * which is what makes "bm" find "Branch Manager" and "apptsx" find
 * "App.tsx" without either being a literal substring.
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()

  let score = 0
  let cursor = 0
  let previousIndex = -2

  for (const character of needle) {
    const index = haystack.indexOf(character, cursor)
    if (index < 0) return 0

    const startsWord = index === 0 || WORD_BOUNDARY.test(haystack[index - 1])
    const isConsecutive = index === previousIndex + 1

    score += 1
    if (startsWord) score += 6
    if (isConsecutive) score += 4
    // Distance skipped to reach this letter, capped so one long gap does
    // not sink an otherwise good match.
    score -= Math.min(index - cursor, 8) * 0.5

    previousIndex = index
    cursor = index + 1
  }

  if (haystack.startsWith(needle)) score += 12
  // Among equal-quality matches, prefer the shorter label.
  score += Math.max(0, 10 - haystack.length / 4)

  return Math.max(score, 0.01)
}

/**
 * Filter and order commands for a query. An empty query preserves the
 * caller's order, which is the curated one. Ties keep their original
 * relative order so the list never reshuffles arbitrarily.
 */
export function rankCommands(commands: Command[], query: string): Command[] {
  const trimmed = query.trim()
  if (!trimmed) return commands

  return commands
    .map((command, index) => {
      const haystacks = [command.label, command.group, command.keywords ?? '']
      const score = Math.max(...haystacks.map((text) => fuzzyScore(text, trimmed)))
      return { command, index, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command)
}
