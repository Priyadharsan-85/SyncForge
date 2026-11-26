import assert from 'node:assert/strict'
import test from 'node:test'
import { languageForFile } from '../src/languages.ts'

test('maps common extensions to Monaco languages', () => {
  const cases: Array<[string, string]> = [
    ['App.tsx', 'typescript'],
    ['index.mjs', 'javascript'],
    ['package.json', 'json'],
    ['styles.scss', 'css'],
    ['README.md', 'markdown'],
    ['main.py', 'python'],
    ['lib.rs', 'rust'],
    ['server.go', 'go'],
    ['deploy.sh', 'shell'],
    ['render.yaml', 'yaml'],
    ['schema.sql', 'sql'],
    ['Main.java', 'java'],
    ['vector.hpp', 'cpp'],
    ['query.graphql', 'graphql'],
  ]
  for (const [name, language] of cases) assert.equal(languageForFile(name), language, name)
})

test('is case-insensitive and recognises Dockerfile by name', () => {
  assert.equal(languageForFile('INDEX.HTML'), 'html')
  assert.equal(languageForFile('Dockerfile'), 'dockerfile')
})

test('falls back to javascript for unknown or missing extensions', () => {
  assert.equal(languageForFile('notes.unknownext'), 'javascript')
  assert.equal(languageForFile('Makefile'), 'javascript')
})
