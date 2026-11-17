import * as Y from 'yjs'

const REDIS_OPERATION_TIMEOUT_MS = 3_000

export async function withRedisTimeout(operation, message) {
  let timeout
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(message)),
          REDIS_OPERATION_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function snapshotKey(roomId) {
  return `syncforge:room:${roomId}`
}

function updatesKey(roomId) {
  return `syncforge:room:${roomId}:updates`
}

export async function restoreRoomDocument(client, roomId) {
  const doc = new Y.Doc()
  try {
    const snapshot = await withRedisTimeout(
      client.get(snapshotKey(roomId)),
      'Redis snapshot read timed out',
    )
    if (snapshot) Y.applyUpdate(doc, Buffer.from(snapshot, 'base64'))

    const updates = await withRedisTimeout(
      client.xRange(updatesKey(roomId), '-', '+'),
      'Redis update replay timed out',
    )
    for (const entry of updates) {
      const encodedUpdate = entry.message.update
      if (typeof encodedUpdate !== 'string') {
        throw new Error(`Invalid persisted update for room ${roomId}`)
      }
      Y.applyUpdate(doc, Buffer.from(encodedUpdate, 'base64'))
    }
    return doc
  } catch (error) {
    doc.destroy()
    throw error
  }
}

export async function appendRoomUpdate(client, roomId, update) {
  await withRedisTimeout(
    client.xAdd(updatesKey(roomId), '*', {
      update: Buffer.from(update).toString('base64'),
    }),
    'Redis update write timed out',
  )
}
