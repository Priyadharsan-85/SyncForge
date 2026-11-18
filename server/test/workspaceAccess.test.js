import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  createWorkspace,
  createWorkspaceInvite,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceAccess,
  getWorkspaceMember,
  listUserWorkspaces,
  renameWorkspace,
} from '../src/workspaceAccess.js'

const owner = { id: 'owner-id', login: 'owner', name: 'Owner' }
const contributor = { id: 'contributor-id', login: 'contributor', name: 'Contributor' }

test('workspace ownership and GitHub contributor memberships appear in each dashboard', async () => {
  const roomId = randomUUID().replace(/-/g, '')
  await createWorkspace(null, {
    roomId,
    owner,
    name: 'Example project',
    source: { type: 'github', repository: 'owner/example' },
    contributors: [contributor, owner],
  })

  const ownerWorkspaces = await listUserWorkspaces(null, owner.id)
  const contributorWorkspaces = await listUserWorkspaces(null, contributor.id)
  assert.equal(ownerWorkspaces.length >= 1, true)
  const ownerEntry = ownerWorkspaces.find((w) => w.roomId === roomId)
  assert.ok(ownerEntry)
  assert.equal(ownerEntry.role, 'owner')
  const contribEntry = contributorWorkspaces.find((w) => w.roomId === roomId)
  assert.ok(contribEntry)
  assert.equal(contribEntry.role, 'editor')
})

test('room codes do not grant access; a valid invite grants editor membership', async () => {
  const roomId = randomUUID().replace(/-/g, '')
  await createWorkspace(null, { roomId, owner, name: 'Private project', source: { type: 'local' } })
  const invited = { id: 'invited-id', login: 'invited', name: 'Invited User' }

  assert.equal(await getWorkspaceAccess(null, roomId, invited), null)
  const token = await createWorkspaceInvite(null, roomId)
  assert.equal((await getWorkspaceAccess(null, roomId, invited, `${token}x`)), null)
  assert.equal((await getWorkspaceAccess(null, roomId, invited, token)).role, 'editor')
  assert.equal((await getWorkspaceAccess(null, roomId, invited)).role, 'editor')
})

test('renameWorkspace updates the workspace name', async () => {
  const roomId = randomUUID().replace(/-/g, '')
  const renameOwner = { id: 'rename-owner', login: 'renameowner', name: 'Rename Owner' }
  await createWorkspace(null, {
    roomId,
    owner: renameOwner,
    name: 'Original Name',
    source: { type: 'blank' },
  })

  await renameWorkspace(null, roomId, 'Updated Name')

  const workspaces = await listUserWorkspaces(null, renameOwner.id)
  const ws = workspaces.find((w) => w.roomId === roomId)
  assert.ok(ws)
  assert.equal(ws.name, 'Updated Name')
})

test('deleteWorkspace removes workspace and clears member access', async () => {
  const roomId = randomUUID().replace(/-/g, '')
  const deleteOwner = { id: 'delete-owner', login: 'deleteowner', name: 'Delete Owner' }
  const deleteCollab = { id: 'delete-collab', login: 'deletecollab', name: 'Delete Collab' }

  await createWorkspace(null, {
    roomId,
    owner: deleteOwner,
    name: 'To Be Deleted',
    source: { type: 'blank' },
    contributors: [deleteCollab],
  })

  const beforeOwner = await getWorkspaceMember(null, roomId, deleteOwner.id)
  assert.ok(beforeOwner)

  await deleteWorkspace(null, roomId)

  const afterMeta = await getWorkspace(null, roomId)
  assert.equal(afterMeta, null)

  const workspacesAfter = await listUserWorkspaces(null, deleteOwner.id)
  const still = workspacesAfter.find((w) => w.roomId === roomId)
  assert.equal(still, undefined)
})
