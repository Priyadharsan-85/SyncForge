import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import {
  appendRoomUpdate,
  compactRoomIfNeeded,
  restoreRoomDocument,
} from '../src/redisStore.js'

function createMemoryRedis() {
  const snapshots = new Map()
  const checkpoints = new Map()
  const streams = new Map()
  let nextId = 0
  return {
    snapshots,
    checkpoints,
    streams,
    async eval(script, { keys, arguments: args }) {
      if (script.includes('XADD')) {
        const entries = streams.get(keys[0]) ?? []
        const id = `${++nextId}-0`
        entries.push({ id, update: args[0] })
        streams.set(keys[0], entries)
        return [id, entries.length]
      }

      if (script.includes('XTRIM')) {
        const checkpoint = checkpoints.get(keys[1]) ?? '0-0'
        if (checkpoint !== args[0] || args[0] === args[1]) return 0
        snapshots.set(keys[0], args[2])
        checkpoints.set(keys[1], args[1])
        streams.set(
          keys[2],
          (streams.get(keys[2]) ?? []).filter((entry) =>
            Number(entry.id.split('-')[0]) > Number(args[1].split('-')[0]),
          ),
        )
        return 1
      }

      const checkpoint = checkpoints.get(keys[1]) ?? '0-0'
      const entries = (streams.get(keys[2]) ?? []).filter((entry) =>
        Number(entry.id.split('-')[0]) > Number(checkpoint.split('-')[0]),
      )
      return [
        snapshots.get(keys[0]) ?? '',
        checkpoint,
        ...entries.flatMap((entry) => [entry.id, entry.update]),
      ]
    },
    async xLen(key) {
      return streams.get(key)?.length ?? 0
    },
  }
}

test('persisted updates restore a document after a server restart', async () => {
  const redis = createMemoryRedis()
  const original = new Y.Doc()
  original.getText('code').insert(0, 'durable edit')

  await appendRoomUpdate(redis, 'team-room', Y.encodeStateAsUpdate(original), 500)
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
  await appendRoomUpdate(redis, 'team-room', Y.encodeStateAsUpdate(laterDoc), 500)

  const restored = await restoreRoomDocument(redis, 'team-room')
  assert.equal(restored.getText('code').toString(), 'before restart')
  snapshotDoc.destroy()
  laterDoc.destroy()
  restored.destroy()
})

test('compaction replaces log history with a recoverable snapshot', async () => {
  const redis = createMemoryRedis()
  const original = new Y.Doc()
  original.getText('code').insert(0, 'snapshot checkpoint')
  await appendRoomUpdate(redis, 'team-room', Y.encodeStateAsUpdate(original), 1)

  assert.equal(await compactRoomIfNeeded(redis, 'team-room', 1), true)
  assert.equal(redis.streams.get('syncforge:room:team-room:updates').length, 0)
  assert.equal(
    redis.checkpoints.get('syncforge:room:team-room:checkpoint'),
    '1-0',
  )

  const laterDoc = new Y.Doc()
  Y.applyUpdate(laterDoc, Y.encodeStateAsUpdate(original))
  laterDoc.getText('code').insert(19, ' safely')
  await appendRoomUpdate(redis, 'team-room', Y.encodeStateAsUpdate(laterDoc), 1)
  const restored = await restoreRoomDocument(redis, 'team-room')
  assert.equal(restored.getText('code').toString(), 'snapshot checkpoint safely')
  original.destroy()
  laterDoc.destroy()
  restored.destroy()
})
