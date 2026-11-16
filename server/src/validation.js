export function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^[a-zA-Z0-9_-]{3,48}$/.test(roomId)
}

export function cleanDisplayName(name) {
  return typeof name === 'string' ? name.trim().slice(0, 32) : ''
}
