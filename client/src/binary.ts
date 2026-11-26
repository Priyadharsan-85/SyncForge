/**
 * Binary payloads from Socket.IO arrive in the browser as `ArrayBuffer`
 * (engine.io uses `binaryType = 'arraybuffer'`), while Node clients get a
 * `Buffer`. Yjs decoders read `.length` and index bytes directly, so an
 * `ArrayBuffer` decodes as empty and throws "Unexpected end of array".
 * Normalise every incoming binary field through this before handing it to Yjs.
 */
export type BinaryPayload = Uint8Array | ArrayBuffer | ArrayBufferView

export function toBytes(value: BinaryPayload): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}
