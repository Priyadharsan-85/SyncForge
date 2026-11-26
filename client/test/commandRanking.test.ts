import assert from 'node:assert/strict'
import test from 'node:test'
import { fuzzyScore, rankCommands, type Command } from '../src/commandRanking.ts'

const command = (id: string, label: string, group = 'Action', keywords?: string): Command => ({
  id,
  label,
  group,
  keywords,
  icon: null,
  run: () => {},
})

test('fuzzyScore matches subsequences and rejects non-matches', () => {
  assert.ok(fuzzyScore('Branch Manager', 'bm') > 0)
  assert.ok(fuzzyScore('App.tsx', 'apptsx') > 0)
  assert.equal(fuzzyScore('App.tsx', 'xyz'), 0)
  assert.equal(fuzzyScore('anything', ''), 1)
})

test('fuzzyScore prefers prefixes and word starts', () => {
  assert.ok(fuzzyScore('Invite people', 'inv') > fuzzyScore('Download invoice', 'inv'))
})

test('rankCommands keeps curated order for an empty query', () => {
  const commands = [command('a', 'Zeta'), command('b', 'Alpha')]
  assert.deepEqual(rankCommands(commands, '   '), commands)
})

test('rankCommands filters and orders by score, matching groups and keywords', () => {
  const commands = [
    command('ai', 'AI Assistant', 'Action', 'draft refactor'),
    command('file', 'index.js', 'File'),
    command('branches', 'Branch Manager'),
  ]
  assert.deepEqual(rankCommands(commands, 'bm').map((c) => c.id), ['branches'])
  assert.deepEqual(rankCommands(commands, 'refactor').map((c) => c.id), ['ai'])
  assert.equal(rankCommands(commands, 'file')[0].id, 'file')
})
