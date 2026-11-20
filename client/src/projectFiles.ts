import { unzipSync, zipSync, strToU8 } from 'fflate'

export type ImportedProjectFile = { path: string; content: string }
export type ProjectFileReadResult = { files: ImportedProjectFile[]; skipped: number }

/**
 * Export workspace files as a ZIP archive binary.
 */
export function exportWorkspaceZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const archiveEntries: Record<string, Uint8Array> = {}
  for (const file of files) {
    archiveEntries[file.name] = strToU8(file.content)
  }
  return zipSync(archiveEntries)
}

const MAX_FILE_COUNT = 300
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MAX_ZIP_BYTES = 20 * 1024 * 1024
const MAX_ZIP_EXPANDED_BYTES = 16 * 1024 * 1024
const MAX_ZIP_ENTRIES = 2_000
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '__MACOSX',
])
const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bmp',
  '.class',
  '.db',
  '.dll',
  '.dylib',
  '.eot',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.otf',
  '.pdf',
  '.png',
  '.so',
  '.sqlite',
  '.tar',
  '.tif',
  '.tiff',
  '.ttf',
  '.wasm',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.zip',
])

function isIgnoredPath(path: string) {
  return path.split('/').some((segment) => IGNORED_DIRECTORIES.has(segment))
}

function isBinaryPath(path: string) {
  const extension = path.match(/\.[^./]+$/)?.[0].toLowerCase()
  return Boolean(extension && BINARY_EXTENSIONS.has(extension))
}

function hasControlCharacters(value: string, allowWhitespace = false) {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 && (!allowWhitespace || (code !== 9 && code !== 10 && code !== 13))) {
      return true
    }
  }
  return false
}

function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    hasControlCharacters(normalized) ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) return null
  return normalized
}

function decodeText(bytes: Uint8Array) {
  if (bytes.includes(0)) return null
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (hasControlCharacters(text, true)) return null
    return text
  } catch {
    return null
  }
}

function addImportedFile(
  files: ImportedProjectFile[],
  paths: Set<string>,
  path: string,
  bytes: Uint8Array,
  totalBytes: number,
) {
  if (bytes.length > MAX_FILE_BYTES) return { added: false, totalBytes }
  const content = decodeText(bytes)
  if (content === null) return { added: false, totalBytes }
  const key = path.toLocaleLowerCase('en-US')
  if (paths.has(key)) throw new Error(`The project contains duplicate file paths: ${path}`)
  if (files.length >= MAX_FILE_COUNT) {
    throw new Error(`A project can contain at most ${MAX_FILE_COUNT} imported text files.`)
  }
  const nextTotal = totalBytes + bytes.length
  if (nextTotal > MAX_TOTAL_BYTES) {
    throw new Error('Imported text files must total 6 MiB or less.')
  }
  paths.add(key)
  files.push({ path, content })
  return { added: true, totalBytes: nextTotal }
}

export async function readProjectFolder(fileList: File[]): Promise<ProjectFileReadResult> {
  const files: ImportedProjectFile[] = []
  const paths = new Set<string>()
  let totalBytes = 0
  let skipped = 0

  for (const file of fileList) {
    const relativePath = file.webkitRelativePath || file.name
    const path = normalizePath(relativePath.split('/').slice(1).join('/') || file.name)
    if (!path || isIgnoredPath(path) || isBinaryPath(path) || file.size > MAX_FILE_BYTES) {
      skipped += 1
      continue
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = addImportedFile(files, paths, path, bytes, totalBytes)
    totalBytes = result.totalBytes
    if (!result.added) skipped += 1
  }

  if (files.length === 0) throw new Error('No supported text files were found in that folder.')
  return { files, skipped }
}

function inspectZip(bytes: Uint8Array) {
  if (bytes.length > MAX_ZIP_BYTES) throw new Error('ZIP files must be 20 MiB or smaller.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const firstPossibleEnd = Math.max(0, bytes.length - 22 - 65_535)
  let endOffset = -1
  for (let offset = bytes.length - 22; offset >= firstPossibleEnd; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new Error('This is not a supported ZIP archive.')

  const entries = view.getUint16(endOffset + 10, true)
  const directorySize = view.getUint32(endOffset + 12, true)
  const directoryOffset = view.getUint32(endOffset + 16, true)
  const commentLength = view.getUint16(endOffset + 20, true)
  if (
    entries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    entries > MAX_ZIP_ENTRIES ||
    endOffset + 22 + commentLength > bytes.length ||
    directoryOffset + directorySize > endOffset
  ) {
    throw new Error('This ZIP archive uses unsupported or oversized features.')
  }

  let offset = directoryOffset
  let expandedBytes = 0
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > directoryOffset + directorySize || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('This ZIP archive has an invalid directory.')
    }
    const flags = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const fileCommentLength = view.getUint16(offset + 32, true)
    if (
      flags & 1 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      offset + 46 + nameLength + extraLength + fileCommentLength > directoryOffset + directorySize
    ) {
      throw new Error('Encrypted and ZIP64 archives are not supported.')
    }
    expandedBytes += uncompressedSize
    if (expandedBytes > MAX_ZIP_EXPANDED_BYTES) {
      throw new Error('ZIP files must expand to 16 MiB or less.')
    }
    offset += 46 + nameLength + extraLength + fileCommentLength
  }
}

export async function readProjectZip(file: File): Promise<ProjectFileReadResult> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('ZIP files must be 20 MiB or smaller.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  inspectZip(bytes)
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(bytes)
  } catch {
    throw new Error('Could not extract that ZIP file.')
  }

  const files: ImportedProjectFile[] = []
  const paths = new Set<string>()
  let totalBytes = 0
  let skipped = 0
  for (const [archivePath, contents] of Object.entries(archive)) {
    if (archivePath.endsWith('/')) continue
    const path = normalizePath(archivePath)
    if (!path || isIgnoredPath(path) || isBinaryPath(path)) {
      skipped += 1
      continue
    }
    const result = addImportedFile(files, paths, path, contents, totalBytes)
    totalBytes = result.totalBytes
    if (!result.added) skipped += 1
  }

  if (files.length === 0) throw new Error('No supported text files were found in that ZIP.')
  return { files, skipped }
}
