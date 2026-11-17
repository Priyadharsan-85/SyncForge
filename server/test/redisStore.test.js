import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { appendRoomUpdate, restoreRoomDocument } from '../src/redisStore.js'

function createMemoryRedis() {
  const snapshots = new Map()
  const streams = new Map()
  let nextId = 0
  return {
    snapshots,
    streams,
    async get(key) {
      return snapshots.get(key) ?? null
    },
    async xAdd(key, _id, message) {
      const entries = streams.get(key) ?? []
      entries.push({ id: String(++nextId), message })
      streams.set(key, entries)
    },
    async xRange(key) {
      return streams.get(key) ?? []
    },
  }
}

test('persisted updates restore a document after a server restart', async () => {
  const redis = createMemoryRedis()
  const original = new Y.Doc()
  original.getText('code').insert(0, 'durable edit')

  await appendRoomUpdate(redis, 'team-room', Y.encodeStateAsUpdate(original))
  const restored = await restoreRoomDocument(redis, 'team-room')

  assert.equal(restored.getText('code').toString(), 'durable edit')
  original.destroy()
  restored.destroy()
})

test('restoration merges legacy snapshots with updates written afterward', async () => {
  const redis = createMemoryRedis()
  const snapshotDoc = new Y.Doc()
  snapshotDoc.getText('code').insert(0, 'before ')
  redis.snapshots.set(
    'syncforge:room:team-room',
    Buffer.from(Y.encodeStateAsUpdate(snapshotDoc)).toString('base64'),
  )

  const laterDoc = new Y.Doc()
  Y.applyUpdate(laterDoc, Y.encodeStateAsUpdate(snapshotDoc))
  laterDoc.getText('code').insert(7, 'restart')
  await appendRoomUpdate(redis, 'team-room', Y.encodeStateAsUpdate(laterDoc))

  const restored = await restoreRoomDocument(redis, 'team-room')
  assert.equal(restored.getText('code').toString(), 'before restart')
  snapshotDoc.destroy()
  laterDoc.destroy()
  restored.destroy()
})
