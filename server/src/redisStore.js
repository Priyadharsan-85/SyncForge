import * as Y from 'yjs'

function snapshotKey(roomId) {
  return `syncforge:room:${roomId}`
}

function updatesKey(roomId) {
  return `syncforge:room:${roomId}:updates`
}

export async function restoreRoomDocument(client, roomId) {
  const doc = new Y.Doc()
  const snapshot = await client.get(snapshotKey(roomId))
  if (snapshot) Y.applyUpdate(doc, Buffer.from(snapshot, 'base64'))

  const updates = await client.xRange(updatesKey(roomId), '-', '+')
  for (const entry of updates) {
    const encodedUpdate = entry.message.update
    if (typeof encodedUpdate !== 'string') {
      throw new Error(`Invalid persisted update for room ${roomId}`)
    }
    Y.applyUpdate(doc, Buffer.from(encodedUpdate, 'base64'))
  }
  return doc
}

export async function appendRoomUpdate(client, roomId, update) {
  await client.xAdd(updatesKey(roomId), '*', {
    update: Buffer.from(update).toString('base64'),
  })
}
