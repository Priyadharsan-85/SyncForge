import * as Y from 'yjs'

export const MAX_IMPORTED_FILES = 300
export const MAX_IMPORTED_FILE_BYTES = 512 * 1024
export const MAX_IMPORTED_TOTAL_BYTES = 6 * 1024 * 1024

export class ProjectImportError extends Error {
  constructor(message) {
    super(message)
    this.status = 400
  }
}

export function validateImportedFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_IMPORTED_FILES) {
    throw new ProjectImportError(`Choose between 1 and ${MAX_IMPORTED_FILES} text files to import.`)
  }

  const paths = new Set()
  let totalBytes = 0
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.content !== 'string' ||
      file.path.length > 512 ||
      file.path.startsWith('/') ||
      /[\\\u0000-\u001f]/.test(file.path) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(file.content)
    ) {
      throw new ProjectImportError('The project contains an invalid file path or content.')
    }

    const segments = file.path.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new ProjectImportError('The project contains an unsafe file path.')
    }
    const pathKey = file.path.toLocaleLowerCase('en-US')
    if (paths.has(pathKey)) {
      throw new ProjectImportError(`The project contains duplicate file paths: ${file.path}`)
    }
    paths.add(pathKey)

    const bytes = Buffer.byteLength(file.content, 'utf8')
    if (bytes > MAX_IMPORTED_FILE_BYTES) {
      throw new ProjectImportError(`${file.path} exceeds the 512 KiB per-file import limit.`)
    }
    totalBytes += bytes
    if (totalBytes > MAX_IMPORTED_TOTAL_BYTES) {
      throw new ProjectImportError('The project exceeds the 6 MiB total import limit.')
    }
  }
  return files
}

export function createImportedDocument(files) {
  const validatedFiles = validateImportedFiles(files)
  const doc = new Y.Doc()
  const workspaceFiles = doc.getMap('files')
  for (const file of validatedFiles) {
    const record = new Y.Map()
    const content = new Y.Text()
    if (file.content) content.insert(0, file.content)
    record.set('name', file.path)
    record.set('content', content)
    workspaceFiles.set(file.path, record)
  }
  return doc
}
