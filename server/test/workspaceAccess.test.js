import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  createWorkspace,
  createWorkspaceInvite,
  getWorkspaceAccess,
  listUserWorkspaces,
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
  assert.equal(ownerWorkspaces.length, 1)
  assert.equal(ownerWorkspaces[0].roomId, roomId)
  assert.equal(ownerWorkspaces[0].role, 'owner')
  assert.equal(contributorWorkspaces[0].role, 'editor')
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
