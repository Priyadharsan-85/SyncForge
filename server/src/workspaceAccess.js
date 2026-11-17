import { createHash, randomBytes } from 'node:crypto'
import { withRedisTimeout } from './redisStore.js'

export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60

const CREATE_WORKSPACE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) ~= 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
local index = 3
for argument = 3, #ARGV, 2 do
  redis.call('HSET', KEYS[2], ARGV[argument], ARGV[argument + 1])
  redis.call('SADD', KEYS[index], ARGV[1])
  index = index + 1
end
return 1
`
const CREATE_INVITE_SCRIPT = `
local result = redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX')
if result then return 1 end
return 0
`
const REDEEM_INVITE_SCRIPT = `
local role = redis.call('GET', KEYS[1])
if not role then return '' end
local member = cjson.decode(ARGV[2])
member.role = role
redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(member))
redis.call('SADD', KEYS[3], ARGV[3])
return role
`

const memoryWorkspaces = new Map()
const memoryUserWorkspaces = new Map()
const memoryInvites = new Map()

function workspaceMetaKey(roomId) {
  return `syncforge:workspace:${roomId}:meta`
}

function workspaceMembersKey(roomId) {
  return `syncforge:workspace:${roomId}:members`
}

function workspaceInvitesKey(roomId, token) {
  const hash = createHash('sha256').update(token).digest('hex')
  return `syncforge:workspace:${roomId}:invite:${hash}`
}

function userWorkspacesKey(userId) {
  return `syncforge:user:${userId}:workspaces`
}

function normalizeMember(user, role) {
  return {
    id: String(user.id),
    login: user.login,
    name: user.name,
    role,
  }
}

function parseJson(value, description) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Could not read ${description}: ${error.message}`)
  }
}

function uniqueMembers(owner, contributors) {
  const members = new Map()
  members.set(String(owner.id), normalizeMember(owner, 'owner'))
  for (const contributor of contributors) {
    const id = String(contributor.id)
    if (!members.has(id)) members.set(id, normalizeMember(contributor, 'editor'))
  }
  return [...members.values()]
}

export async function createWorkspace(client, {
  roomId,
  owner,
  name,
  source,
  contributors = [],
}) {
  const metadata = {
    roomId,
    ownerId: String(owner.id),
    name,
    source,
    createdAt: new Date().toISOString(),
  }
  const members = uniqueMembers(owner, contributors)

  if (!client) {
    if (memoryWorkspaces.has(roomId)) throw new Error('Workspace ID already exists.')
    const record = {
      metadata,
      members: new Map(members.map((member) => [member.id, member])),
    }
    memoryWorkspaces.set(roomId, record)
    for (const member of members) {
      if (!memoryUserWorkspaces.has(member.id)) memoryUserWorkspaces.set(member.id, new Set())
      memoryUserWorkspaces.get(member.id).add(roomId)
    }
    return { ...metadata, role: 'owner' }
  }

  const keys = [
    workspaceMetaKey(roomId),
    workspaceMembersKey(roomId),
    ...members.map((member) => userWorkspacesKey(member.id)),
  ]
  const argumentsList = [
    roomId,
    JSON.stringify(metadata),
    ...members.flatMap((member) => [member.id, JSON.stringify(member)]),
  ]
  const created = await withRedisTimeout(
    client.eval(CREATE_WORKSPACE_SCRIPT, { keys, arguments: argumentsList }),
    'Workspace creation timed out',
  )
  if (Number(created) !== 1) throw new Error('Workspace ID already exists.')
  return { ...metadata, role: 'owner' }
}

export async function getWorkspace(client, roomId) {
  if (!client) return memoryWorkspaces.get(roomId)?.metadata ?? null
  const value = await withRedisTimeout(
    client.get(workspaceMetaKey(roomId)),
    'Workspace lookup timed out',
  )
  return value ? parseJson(value, `workspace ${roomId}`) : null
}

export async function getWorkspaceMember(client, roomId, userId) {
  const id = String(userId)
  if (!client) return memoryWorkspaces.get(roomId)?.members.get(id) ?? null
  const value = await withRedisTimeout(
    client.hGet(workspaceMembersKey(roomId), id),
    'Workspace membership lookup timed out',
  )
  return value ? parseJson(value, `membership for workspace ${roomId}`) : null
}

export async function listUserWorkspaces(client, userId) {
  const id = String(userId)
  const roomIds = client
    ? await withRedisTimeout(
      client.sMembers(userWorkspacesKey(id)),
      'Workspace list lookup timed out',
    )
    : [...(memoryUserWorkspaces.get(id) ?? [])]

  const workspaces = await Promise.all(roomIds.map(async (roomId) => {
    const [metadata, member] = await Promise.all([
      getWorkspace(client, roomId),
      getWorkspaceMember(client, roomId, id),
    ])
    return metadata && member ? { ...metadata, role: member.role } : null
  }))
  return workspaces.filter(Boolean).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )
}

export async function createWorkspaceInvite(client, roomId, role = 'editor') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString('base64url')
    if (!client) {
      memoryInvites.set(workspaceInvitesKey(roomId, token), {
        role,
        expiresAt: Date.now() + INVITE_TTL_SECONDS * 1000,
      })
      return token
    }
    const created = await withRedisTimeout(
      client.eval(CREATE_INVITE_SCRIPT, {
        keys: [workspaceInvitesKey(roomId, token)],
        arguments: [role, String(INVITE_TTL_SECONDS)],
      }),
      'Workspace invite creation timed out',
    )
    if (Number(created) === 1) return token
  }
  throw new Error('Could not generate a unique workspace invite.')
}

export async function redeemWorkspaceInvite(client, roomId, user, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const member = normalizeMember(user, 'editor')

  if (!client) {
    const inviteKey = workspaceInvitesKey(roomId, token)
    const invite = memoryInvites.get(inviteKey)
    if (!invite || invite.expiresAt <= Date.now()) return null
    member.role = invite.role
    memoryWorkspaces.get(roomId)?.members.set(member.id, member)
    if (!memoryWorkspaces.has(roomId)) return null
    if (!memoryUserWorkspaces.has(member.id)) memoryUserWorkspaces.set(member.id, new Set())
    memoryUserWorkspaces.get(member.id).add(roomId)
    return member
  }

  const role = await withRedisTimeout(
    client.eval(REDEEM_INVITE_SCRIPT, {
      keys: [
        workspaceInvitesKey(roomId, token),
        workspaceMembersKey(roomId),
        userWorkspacesKey(member.id),
      ],
      arguments: [member.id, JSON.stringify(member), roomId],
    }),
    'Workspace invite redemption timed out',
  )
  if (typeof role !== 'string' || !role) return null
  return { ...member, role }
}

export async function getWorkspaceAccess(client, roomId, user, inviteToken) {
  if (!await getWorkspace(client, roomId)) return null
  const existing = await getWorkspaceMember(client, roomId, user.id)
  if (existing) return existing
  if (!inviteToken) return null
  return redeemWorkspaceInvite(client, roomId, user, inviteToken)
}

export async function deleteWorkspace(client, roomId) {
  if (!client) {
    const workspace = memoryWorkspaces.get(roomId)
    if (!workspace) return
    for (const memberId of workspace.members.keys()) {
      memoryUserWorkspaces.get(memberId)?.delete(roomId)
      if (memoryUserWorkspaces.get(memberId)?.size === 0) memoryUserWorkspaces.delete(memberId)
    }
    memoryWorkspaces.delete(roomId)
    return
  }

  const memberIds = await withRedisTimeout(
    client.hKeys(workspaceMembersKey(roomId)),
    'Workspace cleanup timed out',
  )
  const cleanup = client.multi()
  for (const memberId of memberIds) cleanup.sRem(userWorkspacesKey(memberId), roomId)
  cleanup.del(workspaceMembersKey(roomId))
  cleanup.del(workspaceMetaKey(roomId))
  await withRedisTimeout(cleanup.exec(), 'Workspace cleanup timed out')
}
