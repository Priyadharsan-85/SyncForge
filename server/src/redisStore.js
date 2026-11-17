import * as Y from 'yjs'

const REDIS_OPERATION_TIMEOUT_MS = 3_000
const READ_ROOM_SCRIPT = `
local snapshot = redis.call('GET', KEYS[1]) or ''
local checkpoint = redis.call('GET', KEYS[2]) or '0-0'
local entries = redis.call('XRANGE', KEYS[3], '(' .. checkpoint, '+')
local result = { snapshot, checkpoint }
for _, entry in ipairs(entries) do
  local update = ''
  for index = 1, #entry[2], 2 do
    if entry[2][index] == 'update' then
      update = entry[2][index + 1]
      break
    end
  end
  table.insert(result, entry[1])
  table.insert(result, update)
end
return result
`
const APPEND_UPDATE_SCRIPT = `
local id = redis.call('XADD', KEYS[1], '*', 'update', ARGV[1])
return { id, redis.call('XLEN', KEYS[1]) }
`
const COMPACT_ROOM_SCRIPT = `
local checkpoint = redis.call('GET', KEYS[2]) or '0-0'
if checkpoint ~= ARGV[1] or ARGV[1] == ARGV[2] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[3])
redis.call('SET', KEYS[2], ARGV[2])
redis.call('XTRIM', KEYS[3], 'MINID', ARGV[2])
redis.call('XDEL', KEYS[3], ARGV[2])
return 1
`
const INITIALIZE_ROOM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) ~= 0 or redis.call('EXISTS', KEYS[2]) ~= 0 or redis.call('XLEN', KEYS[3]) ~= 0 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], '0-0')
return 1
`

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

function checkpointKey(roomId) {
  return `syncforge:room:${roomId}:checkpoint`
}

async function readRoomState(client, roomId) {
  const result = await withRedisTimeout(
    client.eval(READ_ROOM_SCRIPT, {
      keys: [snapshotKey(roomId), checkpointKey(roomId), updatesKey(roomId)],
      arguments: [],
    }),
    'Redis update replay timed out',
  )
  if (!Array.isArray(result) || result.length < 2 || result.length % 2 !== 0) {
    throw new Error(`Invalid persisted state for room ${roomId}`)
  }

  const doc = new Y.Doc()
  try {
    const [snapshot, checkpoint] = result
    if (typeof snapshot !== 'string' || typeof checkpoint !== 'string') {
      throw new Error(`Invalid persisted state for room ${roomId}`)
    }
    if (snapshot) Y.applyUpdate(doc, Buffer.from(snapshot, 'base64'))

    let lastUpdateId
    for (let index = 2; index < result.length; index += 2) {
      const id = result[index]
      const encodedUpdate = result[index + 1]
      if (typeof id !== 'string' || typeof encodedUpdate !== 'string' || !encodedUpdate) {
        throw new Error(`Invalid persisted update for room ${roomId}`)
      }
      Y.applyUpdate(doc, Buffer.from(encodedUpdate, 'base64'))
      lastUpdateId = id
    }
    return { doc, checkpoint, lastUpdateId }
  } catch (error) {
    doc.destroy()
    throw error
  }
}

export async function restoreRoomDocument(client, roomId) {
  const { doc } = await readRoomState(client, roomId)
  return doc
}

export async function storeInitialRoomDocument(client, roomId, doc) {
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  const stored = await withRedisTimeout(
    client.eval(INITIALIZE_ROOM_SCRIPT, {
      keys: [snapshotKey(roomId), checkpointKey(roomId), updatesKey(roomId)],
      arguments: [snapshot],
    }),
    'Initial workspace persistence timed out',
  )
  if (Number(stored) !== 1) throw new Error(`Workspace document already exists for ${roomId}`)
}

export async function deleteRoomDocument(client, roomId) {
  await withRedisTimeout(
    client.del([snapshotKey(roomId), checkpointKey(roomId), updatesKey(roomId)]),
    'Workspace document cleanup timed out',
  )
}

export async function appendRoomUpdate(client, roomId, update, compactionThreshold) {
  const result = await withRedisTimeout(
    client.eval(APPEND_UPDATE_SCRIPT, {
      keys: [updatesKey(roomId)],
      arguments: [Buffer.from(update).toString('base64')],
    }),
    'Redis update write timed out',
  )
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error(`Redis did not confirm the update for room ${roomId}`)
  }
  return Number(result[1]) >= compactionThreshold
}

export async function compactRoomIfNeeded(client, roomId, threshold) {
  let compacted = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const streamLength = await withRedisTimeout(
      client.xLen(updatesKey(roomId)),
      'Redis update count timed out',
    )
    if (streamLength < threshold) return compacted

    const { doc, checkpoint, lastUpdateId } = await readRoomState(client, roomId)
    if (!lastUpdateId) {
      doc.destroy()
      return compacted
    }

    const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
    try {
      const result = await withRedisTimeout(
        client.eval(COMPACT_ROOM_SCRIPT, {
          keys: [snapshotKey(roomId), checkpointKey(roomId), updatesKey(roomId)],
          arguments: [checkpoint, lastUpdateId, snapshot],
        }),
        'Redis room compaction timed out',
      )
      compacted ||= Number(result) === 1
    } finally {
      doc.destroy()
    }
  }
  return compacted
}
