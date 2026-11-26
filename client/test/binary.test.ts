import assert from 'node:assert/strict'
import test from 'node:test'
import { toBytes } from '../src/binary.ts'

test('toBytes returns a Uint8Array unchanged', () => {
  const bytes = new Uint8Array([1, 2, 3])
  assert.equal(toBytes(bytes), bytes)
})

test('toBytes wraps an ArrayBuffer (what Socket.IO delivers in browsers)', () => {
  const buffer = new Uint8Array([4, 5, 6]).buffer
  const bytes = toBytes(buffer)
  assert.ok(bytes instanceof Uint8Array)
  assert.deepEqual([...bytes], [4, 5, 6])
})

test('toBytes respects the offset and length of other views', () => {
  const backing = new Uint8Array([0, 0, 7, 8, 9, 0])
  const view = new DataView(backing.buffer, 2, 3)
  assert.deepEqual([...toBytes(view)], [7, 8, 9])
})
