import { lazy, Suspense, useEffect, useRef, useState, useMemo, type ChangeEvent, type FormEvent } from 'react'
import type { OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { io } from 'socket.io-client'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Copy,
  Download,
  FileArchive,
  FileCode2,
  GitBranch,
  Keyboard,
  Github,
  LogOut,
  Plus,
  Radio,
  Search,
  Sparkles,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import './App.css'
import { AiAssistantModal } from './AiAssistantModal'
import { BranchManagerModal } from './BranchManagerModal'
import { toBytes, type BinaryPayload } from './binary'
import { bindYTextToMonaco } from './editorBinding'
import {
  exportWorkspaceZip,
  readProjectFolder,
  readProjectZip,
  type ProjectFileReadResult,
} from './projectFiles'
import { WorkspaceCardSkeleton } from './LoadingSkeleton'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { ToastContainer } from './Toast'
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp'
import { CommandPalette } from './CommandPalette'
import type { Command } from './commandRanking'

// Monaco is several megabytes; load it only when a workspace is opened.
const Editor = lazy(() => import('./CodeEditor'))

type Member = { id: string; name: string }
type User = { id: string; login: string; name: string }
type Workspace = {
  roomId: string
  name: string
  ownerId: string
  source: { type: string; repository?: string }
  role: 'owner' | 'editor'
  createdAt: string
}
type WorkspaceFile = { id: string; name: string; content: Y.Text }
type ConnectionState = 'connecting' | 'connected' | 'offline'
type JoinResponse = {
  ok: boolean
  retryable?: boolean
  state?: BinaryPayload
  stateVector?: BinaryPayload
  role?: Workspace['role']
  members?: Member[]
  error?: string
}
type UpdateResponse = {
  ok: boolean
  retryable?: boolean
  error?: string
}

const starterCode = `// Welcome to SyncForge
// Open this room in another tab to collaborate in real time.

function greet(name) {
  return \`Hello, \${name}!\`
}

console.log(greet('world'))
`

const roomFromUrl = new URLSearchParams(window.location.search).get('room')
const inviteFromUrl = new URLSearchParams(window.location.search).get('invite')
const authResult = new URLSearchParams(window.location.search).get('auth')

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function createFileRecord(name: string, initialContent = '') {
  const record = new Y.Map<unknown>()
  const content = new Y.Text()
  if (initialContent) content.insert(0, initialContent)
  record.set('name', name)
  record.set('content', content)
  return record
}

function readWorkspaceFiles(fileMap: Y.Map<Y.Map<unknown>>): WorkspaceFile[] {
  return [...fileMap.entries()]
    .flatMap(([id, record]) => {
      const name = record.get('name')
      const content = record.get('content')
      return typeof name === 'string' && content instanceof Y.Text
        ? [{ id, name, content }]
        : []
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

function languageForFile(name: string): string {
  const lowerName = name.toLowerCase()
  if (lowerName === 'dockerfile') return 'dockerfile'
  const extension = lowerName.split('.').pop()
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
    case 'scss':
    case 'less':
      return 'css'
    case 'html':
    case 'htm':
      return 'html'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'py':
    case 'pyw':
      return 'python'
    case 'rs':
      return 'rust'
    case 'go':
      return 'go'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'sql':
      return 'sql'
    case 'xml':
    case 'svg':
      return 'xml'
    case 'java':
      return 'java'
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return 'cpp'
    case 'graphql':
    case 'gql':
      return 'graphql'
    default:
      return 'javascript'
  }
}

// navigator.platform is deprecated but is still the only reliable way to
// tell a Mac from everything else without UA-CH, and this is cosmetic.
const paletteShortcutLabel =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘K'
    : 'Ctrl+K'

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [roomId, setRoomId] = useState(roomFromUrl ?? '')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(false)
  const [workspaceRole, setWorkspaceRole] = useState<Workspace['role'] | ''>('')
  const [members, setMembers] = useState<Member[]>([])
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [activeFileId, setActiveFileId] = useState('')
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [localReady, setLocalReady] = useState(false)
  const [error, setError] = useState(
    authResult === 'unconfigured'
      ? 'GitHub sign-in is not configured on this server yet.'
      : authResult === 'failed'
        ? 'GitHub sign-in did not complete. Please try again.'
        : '',
  )
  const [copied, setCopied] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [githubUrl, setGithubUrl] = useState('')
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [fileNameError, setFileNameError] = useState('')
  const [fileFilter, setFileFilter] = useState('')
  const [showAiModal, setShowAiModal] = useState(false)
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [activeBranch, setActiveBranch] = useState('main')
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [charCount, setCharCount] = useState(0)
  const textRef = useRef<Y.Text | null>(null)
  const filesRef = useRef<Y.Map<Y.Map<unknown>> | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const bindingRef = useRef<(() => void) | null>(null)
  const inviteTokenRef = useRef(inviteFromUrl ?? '')
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let active = true
    fetch('/auth/me', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) return null
        if (!response.ok) throw new Error('Could not verify your SyncForge session.')
        return response.json() as Promise<User>
      })
      .then((session) => {
        if (active) setUser(session)
      })
      .catch(() => {
        if (active) setAuthError('Could not connect to SyncForge authentication. Check your connection and retry.')
      })
      .finally(() => {
        if (active) setAuthLoading(false)
      })
    return () => { active = false }
  }, [])

  // Loaded in a room too, not just on the dashboard: the top bar shows the
  // workspace's name, and a deep link (?room=…) never visits the dashboard.
  useEffect(() => {
    if (!user) return
    let active = true
    setWorkspacesLoading(true)
    fetch('/api/workspaces', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load your workspaces.')
        return response.json() as Promise<Workspace[]>
      })
      .then((nextWorkspaces) => {
        if (active) setWorkspaces(nextWorkspaces)
      })
      .catch(() => {
        if (active) setError('Could not load your workspaces. Check your connection and retry.')
      })
      .finally(() => {
        if (active) setWorkspacesLoading(false)
      })
    return () => { active = false }
  }, [roomId, user])

  useEffect(() => {
    if (!roomId || !user) return

    const doc = new Y.Doc()
    const legacyText = doc.getText('code')
    const files = doc.getMap<Y.Map<unknown>>('files')
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] })
    const persistence = new IndexeddbPersistence(`syncforge:${roomId}`, doc)
    let joined = false
    let disposed = false
    let joinRetryPending = false
    let joinRetryDelay = 500
    let joinRetryTimer: number | undefined
    let documentRevision = 0
    let serverStateVector: Uint8Array | undefined
    let retryDelay = 500
    let retryPending = false
    let retryInFlight = false
    let retryTimer: number | undefined

    filesRef.current = files
    const refreshFiles = () => {
      const nextFiles = readWorkspaceFiles(files)
      setWorkspaceFiles(nextFiles)
      setActiveFileId((current) =>
        nextFiles.some((file) => file.id === current) ? current : nextFiles[0]?.id ?? '',
      )
    }

    const ensureInitialFile = () => {
      if (files.size === 0) {
        files.set(
          'index.js',
          createFileRecord('index.js', legacyText.toString() || starterCode),
        )
        return
      }

      const legacyCode = legacyText.toString()
      if (!legacyCode) return
      const mainFile = files.get('index.js')
      const mainContent = mainFile?.get('content')
      if (mainContent instanceof Y.Text && mainContent.toString() === starterCode) {
        mainContent.delete(0, mainContent.length)
        mainContent.insert(0, legacyCode)
      } else if (!files.has('legacy-index.js') && legacyCode !== starterCode) {
        files.set('legacy-index.js', createFileRecord('legacy-index.js', legacyCode))
      }
    }

    files.observe(refreshFiles)
    legacyText.observe(ensureInitialFile)

    function scheduleRetry() {
      if (disposed || retryTimer !== undefined || !joined || !socket.connected) return
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined
        sendDocument(true)
      }, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 5_000)
    }

    function handleUpdateAcknowledgement(
      response: UpdateResponse,
      isRecovery: boolean,
      sentRevision: number,
    ) {
      if (disposed) return
      if (response.ok) {
        if (!retryPending) retryDelay = 500
        if (isRecovery) {
          retryInFlight = false
          if (documentRevision === sentRevision) {
            retryPending = false
            retryDelay = 500
            if (retryTimer !== undefined) {
              window.clearTimeout(retryTimer)
              retryTimer = undefined
            }
            setError('')
          } else {
            scheduleRetry()
          }
        }
        return
      }

      if (isRecovery) retryInFlight = false
      if (response.retryable) {
        retryPending = true
        setError('Temporary server issue. Your edits are saved in this browser and will retry automatically.')
        scheduleRetry()
      } else {
        if (isRecovery) retryPending = false
        setError(response.error ?? 'A document update could not be saved.')
      }
    }

    function sendDocument(isRecovery = retryPending) {
      if (joined && socket.connected) {
        const currentStateVector = Y.encodeStateVector(doc)
        if (serverStateVector && equalBytes(currentStateVector, serverStateVector)) return
        const sentRevision = documentRevision
        if (isRecovery) retryInFlight = true
        socket.emit('document:update', {
          roomId,
          update: serverStateVector
            ? Y.encodeStateAsUpdate(doc, serverStateVector)
            : Y.encodeStateAsUpdate(doc),
        }, (response: UpdateResponse) =>
          handleUpdateAcknowledgement(response, isRecovery, sentRevision))
      }
    }

    function scheduleJoinRetry() {
      if (disposed || joinRetryTimer !== undefined || !socket.connected) return
      joinRetryTimer = window.setTimeout(() => {
        joinRetryTimer = undefined
        joinRoom()
      }, joinRetryDelay)
      joinRetryDelay = Math.min(joinRetryDelay * 2, 5_000)
    }

    function joinRoom() {
      if (!socket.connected) return
      socket.emit('room:join', {
        roomId,
        inviteToken: inviteTokenRef.current || undefined,
      }, (response: JoinResponse) => {
        if (!response.ok || !response.state) {
          setError(response.error ?? 'Could not join this room.')
          setConnection('offline')
          if (response.retryable) {
            joinRetryPending = true
            scheduleJoinRetry()
          } else {
            joinRetryPending = false
          }
          return
        }
        if (joinRetryTimer !== undefined) {
          window.clearTimeout(joinRetryTimer)
          joinRetryTimer = undefined
        }
        joinRetryDelay = 500
        if (joinRetryPending) {
          joinRetryPending = false
          setError('')
        }
        Y.applyUpdate(doc, toBytes(response.state), socket)
        serverStateVector = response.stateVector ? toBytes(response.stateVector) : undefined
        joined = true
        setWorkspaceRole(response.role ?? '')
        if (inviteTokenRef.current) {
          inviteTokenRef.current = ''
          window.history.replaceState(null, '', `?room=${encodeURIComponent(roomId)}`)
        }
        ensureInitialFile()
        setConnection('connected')
        setMembers(response.members ?? [])
        sendDocument()
      })
    }

    const onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== socket && joined && socket.connected) {
        documentRevision += 1
        if (retryPending) {
          if (!retryInFlight && retryTimer === undefined) scheduleRetry()
          return
        }
        socket.emit('document:update', { roomId, update }, (response: UpdateResponse) =>
          handleUpdateAcknowledgement(response, false, documentRevision))
      }
    }

    doc.on('update', onDocumentUpdate)

    persistence.whenSynced.then(() => {
      if (disposed) return
      ensureInitialFile()
      setLocalReady(true)
      sendDocument()
    })

    socket.on('connect', () => {
      setConnection('connecting')
      joinRoom()
    })

    socket.on('connect_error', () => setConnection('offline'))
    socket.on('disconnect', () => {
      joined = false
      if (joinRetryTimer !== undefined) {
        window.clearTimeout(joinRetryTimer)
        joinRetryTimer = undefined
      }
      setConnection('offline')
    })
    socket.on('document:update', (update: BinaryPayload) => {
      Y.applyUpdate(doc, toBytes(update), socket)
      ensureInitialFile()
    })
    socket.on('presence:update', (nextMembers: Member[]) => setMembers(nextMembers))
    socket.on('room:error', (message: string) => setError(message))

    return () => {
      disposed = true
      if (joinRetryTimer !== undefined) window.clearTimeout(joinRetryTimer)
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      doc.off('update', onDocumentUpdate)
      files.unobserve(refreshFiles)
      legacyText.unobserve(ensureInitialFile)
      bindingRef.current?.()
      bindingRef.current = null
      socket.disconnect()
      persistence.destroy()
      doc.destroy()
      editorRef.current = null
      filesRef.current = null
      textRef.current = null
    }
  }, [roomId, user])

  const activeFile = workspaceFiles.find((file) => file.id === activeFileId)

  useEffect(() => {
    bindingRef.current?.()
    bindingRef.current = null
    textRef.current = activeFile?.content ?? null
    if (!activeFile || !editorRef.current) return

    bindingRef.current = bindYTextToMonaco(activeFile.content, editorRef.current)

    return () => {
      bindingRef.current?.()
      bindingRef.current = null
    }
  }, [activeFile])

  const onEditorMount: OnMount = (editor) => {
    const text = textRef.current
    editorRef.current = editor
    editor.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column })
    })
    editor.onDidChangeModelContent(() => {
      setCharCount(editor.getValue().length)
    })
    setCharCount(editor.getValue().length)
    if (!text) return
    bindingRef.current?.()
    bindingRef.current = bindYTextToMonaco(text, editor)
  }

  function openWorkspace(id: string, inviteToken = '') {
    inviteTokenRef.current = inviteToken
    setLocalReady(false)
    setConnection('connecting')
    setError('')
    setWorkspaceRole('')
    setWorkspaceFiles([])
    setActiveFileId('')
    setRoomId(id)
    const query = new URLSearchParams({ room: id })
    if (inviteToken) query.set('invite', inviteToken)
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
  }

  function beginSignIn() {
    const returnUrl = new URL(window.location.href)
    returnUrl.searchParams.delete('auth')
    const returnTo = `${returnUrl.pathname}${returnUrl.search}`
    window.location.assign(`/auth/github?returnTo=${encodeURIComponent(returnTo)}`)
  }

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json() as { error?: string } & T
    if (!response.ok) throw new Error(result.error ?? 'The request could not be completed.')
    return result
  }

  async function createBlankWorkspace() {
    setIsWorking(true)
    setError('')
    try {
      const workspace = await postJson<Workspace>('/api/workspaces', { name: 'Untitled workspace' })
      setWorkspaceNotice('')
      openWorkspace(workspace.roomId)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create the workspace.')
    } finally {
      setIsWorking(false)
    }
  }

  async function createLocalWorkspace(result: ProjectFileReadResult) {
    setIsWorking(true)
    setError('')
    try {
      const workspace = await postJson<Workspace>('/api/workspaces/import/local', {
        name: 'Imported project',
        files: result.files,
      })
      setWorkspaceNotice(
        `Imported ${result.files.length} text files${result.skipped ? `; skipped ${result.skipped} unsupported or oversized files` : ''}.`,
      )
      openWorkspace(workspace.roomId)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not import that project.')
    } finally {
      setIsWorking(false)
    }
  }

  async function handleFolderChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const selectedFiles = Array.from(input.files ?? [])
    input.value = ''
    if (selectedFiles.length === 0) return
    setIsWorking(true)
    setError('')
    try {
      const result = await readProjectFolder(selectedFiles)
      setIsWorking(false)
      await createLocalWorkspace(result)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Could not read that folder.')
      setIsWorking(false)
    }
  }

  async function handleZipChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const selectedFile = input.files?.[0]
    input.value = ''
    if (!selectedFile) return
    setIsWorking(true)
    setError('')
    try {
      const result = await readProjectZip(selectedFile)
      setIsWorking(false)
      await createLocalWorkspace(result)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Could not read that ZIP file.')
      setIsWorking(false)
    }
  }

  async function importGitHubRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsWorking(true)
    setError('')
    try {
      const workspace = await postJson<Workspace>('/api/workspaces/import/github', { url: githubUrl })
      setWorkspaceNotice('Imported the public repository. Existing GitHub contributors can open it from their workspace list.')
      setGithubUrl('')
      openWorkspace(workspace.roomId)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not import that repository.')
    } finally {
      setIsWorking(false)
    }
  }

  async function signOut() {
    try {
      const response = await fetch('/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('Sign-out request failed.')
      window.location.assign('/')
    } catch {
      setError('Could not sign out. Check your connection and try again.')
    }
  }

  function leaveRoom() {
    setLocalReady(false)
    setRoomId('')
    setWorkspaceRole('')
    setMembers([])
    setWorkspaceFiles([])
    setActiveFileId('')
    setShowNewFile(false)
    setShowAiModal(false)
    setShowBranchModal(false)
    setShowPalette(false)
    setActiveBranch('main')
    setFileFilter('')
    window.history.replaceState(null, '', window.location.pathname)
  }

  function downloadWorkspaceZip() {
    if (workspaceFiles.length === 0) return
    try {
      const zipData = exportWorkspaceZip(
        workspaceFiles.map((f) => ({ name: f.name, content: f.content.toString() }))
      )
      const blob = new Blob([zipData.buffer as ArrayBuffer], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const currentWorkspaceName = workspaces.find((w) => w.roomId === roomId)?.name ?? 'workspace'
      a.download = `${currentWorkspaceName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setWorkspaceNotice('Workspace exported as ZIP archive.')
    } catch {
      setError('Could not export workspace as ZIP.')
    }
  }

  function handleAcceptAiPatch(newContent: string) {
    if (!activeFile) return
    activeFile.content.delete(0, activeFile.content.length)
    activeFile.content.insert(0, newContent)
    setShowAiModal(false)
    setWorkspaceNotice(`Applied AI proposal to ${activeFile.name}.`)
  }

  function downloadWorkspaceSingleFile(file: WorkspaceFile, event: React.MouseEvent) {
    event.stopPropagation()
    const blob = new Blob([file.content.toString()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function duplicateWorkspaceFile(file: WorkspaceFile, event: React.MouseEvent) {
    event.stopPropagation()
    const fileMap = filesRef.current
    if (!fileMap) return
    const parts = file.name.split('.')
    let copyName = ''
    if (parts.length > 1) {
      const ext = parts.pop()
      copyName = `${parts.join('.')}-copy.${ext}`
    } else {
      copyName = `${file.name}-copy`
    }
    let counter = 1
    const existingNames = new Set(readWorkspaceFiles(fileMap).map((f) => f.name.toLowerCase()))
    while (existingNames.has(copyName.toLowerCase())) {
      counter++
      const ext = file.name.split('.').pop()
      const base = file.name.includes('.') ? file.name.slice(0, -(ext!.length + 1)) : file.name
      copyName = file.name.includes('.') ? `${base}-copy-${counter}.${ext}` : `${base}-copy-${counter}`
    }
    const newId = crypto.randomUUID()
    fileMap.set(newId, createFileRecord(copyName, file.content.toString()))
    setActiveFileId(newId)
    setWorkspaceNotice(`Duplicated ${file.name} as ${copyName}.`)
  }

  async function handleSyncLive(branchName: string) {
    try {
      const response = await fetch(
        `/api/workspaces/${roomId}/branches/${encodeURIComponent(branchName)}/sync-live`,
        { method: 'POST' },
      )
      const result = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Failed to sync branch to live workspace.')
      setWorkspaceNotice(`Successfully synced branch "${branchName}" to the live workspace.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync branch to live workspace.')
    }
  }

  function openNewFileDialog() {
    setFileNameError('')
    setNewFileName('')
    setShowNewFile(true)
  }

  function deleteWorkspaceFile(fileId: string, fileName: string, event: React.MouseEvent) {
    event.stopPropagation()
    const fileMap = filesRef.current
    if (!fileMap) return
    if (workspaceFiles.length <= 1) {
      setError('Cannot delete the last file in a workspace.')
      return
    }
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return
    fileMap.delete(fileId)
  }

  function startRenameFile(fileId: string, currentName: string, event: React.MouseEvent) {
    event.stopPropagation()
    const fileMap = filesRef.current
    if (!fileMap) return
    const nextName = window.prompt('Rename file to:', currentName)
    if (!nextName || nextName.trim() === currentName) return
    const name = nextName.trim()
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(name) || name === '.' || name === '..') {
      setError('Use 1–64 letters, numbers, dots, dashes or underscores.')
      return
    }
    if (readWorkspaceFiles(fileMap).some((f) => f.id !== fileId && f.name.toLowerCase() === name.toLowerCase())) {
      setError('A file with that name already exists.')
      return
    }
    const record = fileMap.get(fileId)
    if (record) record.set('name', name)
  }

  function createWorkspaceFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fileMap = filesRef.current
    const fileName = newFileName.trim()
    if (!fileMap) {
      setFileNameError('The workspace is still loading. Try again in a moment.')
      return
    }
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(fileName) || fileName === '.' || fileName === '..') {
      setFileNameError('Use 1–64 letters, numbers, dots, dashes or underscores.')
      return
    }
    if (readWorkspaceFiles(fileMap).some((file) => file.name.toLowerCase() === fileName.toLowerCase())) {
      setFileNameError('A file with that name already exists.')
      return
    }

    const id = crypto.randomUUID()
    fileMap.set(id, createFileRecord(fileName))
    setActiveFileId(id)
    setNewFileName('')
    setFileNameError('')
    setShowNewFile(false)
  }

  async function deleteWorkspaceById(workspace: Workspace, event: React.MouseEvent) {
    event.stopPropagation()
    if (!confirm(`Delete workspace "${workspace.name}"? This cannot be undone.`)) return
    try {
      const response = await fetch(`/api/workspaces/${workspace.roomId}`, { method: 'DELETE' })
      if (!response.ok) {
        const result = await response.json() as { error?: string }
        throw new Error(result.error ?? 'Could not delete the workspace.')
      }
      setWorkspaces((prev) => prev.filter((w) => w.roomId !== workspace.roomId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the workspace.')
    }
  }

  async function copyInvite() {
    try {
      const { inviteUrl } = await postJson<{ inviteUrl: string }>(
        `/api/workspaces/${roomId}/invites`,
        {},
      )
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not create or copy an invite link. Try again.')
    }
  }

  // Everything the palette can run: one entry per open file, then the
  // workspace-level actions. Owner-only actions are filtered out for
  // editors rather than shown and rejected.
  const paletteCommands = useMemo<Command[]>(() => {
    const fileCommands: Command[] = workspaceFiles.map((file) => ({
      id: `file:${file.id}`,
      label: file.name,
      group: 'File',
      hint: languageForFile(file.name),
      keywords: 'open switch jump tab',
      icon: <FileCode2 size={13} />,
      run: () => setActiveFileId(file.id),
    }))

    const actionCommands: Command[] = [
      {
        id: 'action:new-file',
        label: 'Create a new file',
        group: 'Action',
        hint: 'Ctrl+Shift+N',
        keywords: 'add create touch',
        icon: <Plus size={13} />,
        run: () => openNewFileDialog(),
      },
      {
        id: 'action:ai',
        label: 'Open the AI assistant',
        group: 'Action',
        hint: 'Ctrl+Shift+A',
        keywords: 'propose refactor jsdoc tests patch draft',
        icon: <Sparkles size={13} />,
        run: () => setShowAiModal(true),
      },
      {
        id: 'action:branches',
        label: 'Open branches and pull requests',
        group: 'Action',
        hint: 'Ctrl+Shift+B',
        keywords: 'branch commit merge pr diff history',
        icon: <GitBranch size={13} />,
        run: () => setShowBranchModal(true),
      },
      {
        id: 'action:export-zip',
        label: 'Export the workspace as a ZIP archive',
        group: 'Action',
        keywords: 'download save archive backup',
        icon: <FileArchive size={13} />,
        run: () => downloadWorkspaceZip(),
      },
      {
        id: 'action:shortcuts',
        label: 'Show keyboard shortcuts',
        group: 'Help',
        keywords: 'keys bindings hotkeys',
        icon: <Keyboard size={13} />,
        run: () => setShowShortcutsHelp(true),
      },
      {
        id: 'action:leave',
        label: 'Leave this workspace',
        group: 'Action',
        keywords: 'exit close back dashboard',
        icon: <LogOut size={13} />,
        run: () => leaveRoom(),
      },
    ]

    if (workspaceRole === 'owner') {
      actionCommands.splice(3, 0, {
        id: 'action:invite',
        label: 'Copy an invite link',
        group: 'Action',
        hint: 'Ctrl+Shift+I',
        keywords: 'share collaborator member link',
        icon: <Users size={13} />,
        run: () => void copyInvite(),
      })
    }

    return [...fileCommands, ...actionCommands]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFiles, workspaceRole, roomId])

  const shortcutHandlers = useMemo(() => ({
    onTogglePalette: () => { if (roomId) setShowPalette((v) => !v) },
    onNewFile: () => { if (roomId) openNewFileDialog() },
    onToggleAi: () => { if (roomId && activeFile) setShowAiModal((v) => !v) },
    onToggleBranch: () => { if (roomId) setShowBranchModal((v) => !v) },
    onCopyInvite: () => { if (roomId && workspaceRole === 'owner') void copyInvite() },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [roomId, activeFile, workspaceRole])

  useKeyboardShortcuts(shortcutHandlers, !!roomId && !!user)

  if (authLoading) {
    return <main className="auth-loading" role="status">Checking your SyncForge session…</main>
  }

  if (!roomId || !user) {
    return (
      <main className="welcome">
        <header className="welcome-nav">
          <a className="brand" href="/" aria-label="SyncForge home">
            <span className="brand-mark"><Code2 size={19} strokeWidth={2.5} /></span>
            <span>sync<span>forge</span></span>
          </a>
          <a className="github-link" href="https://github.com/Priyadharsan-85/SyncForge" target="_blank" rel="noreferrer">
            <Github size={16} /> Open source <ArrowUpRight size={14} />
          </a>
          {user && (
            <button className="github-link auth-nav-button" onClick={signOut}>
              <LogOut size={14} /> Sign out
            </button>
          )}
        </header>

        <section className="welcome-content">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR TEAM'S SHARED WORKSPACE</div>
          <h1>Good ideas get<br /><span>better together.</span></h1>
          <p className="welcome-copy">
            A calm, real-time code space for thinking out loud, making changes, and building as a team.
          </p>

          {user ? (
            <section className="workspace-home">
              <div className="home-actions">
                <button className="primary-button" onClick={createBlankWorkspace} disabled={isWorking}>
                  <Plus size={16} /> Create workspace
                </button>
                <button className="secondary-button" onClick={() => folderInputRef.current?.click()} disabled={isWorking}>
                  <FileCode2 size={16} /> Import folder
                </button>
                <button className="secondary-button" onClick={() => zipInputRef.current?.click()} disabled={isWorking}>
                  <ArrowUpRight size={16} /> Import ZIP
                </button>
              </div>
              <input
                ref={(input) => {
                  folderInputRef.current = input
                  input?.setAttribute('webkitdirectory', '')
                }}
                className="hidden-input"
                type="file"
                multiple
                onChange={handleFolderChange}
                aria-label="Choose a project folder"
              />
              <input
                ref={zipInputRef}
                className="hidden-input"
                type="file"
                accept=".zip,application/zip"
                onChange={handleZipChange}
                aria-label="Choose a project ZIP file"
              />
              <form className="github-import" onSubmit={importGitHubRepository}>
                <label htmlFor="github-repository">IMPORT A PUBLIC GITHUB REPOSITORY</label>
                <div className="github-import-row">
                  <input
                    id="github-repository"
                    type="url"
                    placeholder="https://github.com/owner/repository"
                    value={githubUrl}
                    onChange={(event) => setGithubUrl(event.target.value)}
                    disabled={isWorking}
                    required
                  />
                  <button className="secondary-button" type="submit" disabled={isWorking}>
                    Import
                  </button>
                </div>
                <small>Existing repository contributors get editor access automatically.</small>
              </form>
              {isWorking && <p className="home-status" role="status">Preparing your workspace…</p>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="workspace-list">
                <div className="workspace-list-heading">
                  <h2>Your workspaces</h2>
                  <span>{workspaces.length}</span>
                </div>
                {workspacesLoading ? (
                  <>
                    <WorkspaceCardSkeleton />
                    <WorkspaceCardSkeleton />
                    <WorkspaceCardSkeleton />
                  </>
                ) : workspaces.length === 0 ? (
                  <p className="empty-workspaces">Create or import a project to get started. Invited workspaces will appear here.</p>
                ) : workspaces.map((workspace) => (
                  <div
                    className="workspace-card-wrapper"
                    key={workspace.roomId}
                  >
                    <button
                      className="workspace-card"
                      onClick={() => openWorkspace(workspace.roomId)}
                    >
                      <span className="workspace-card-icon"><Code2 size={17} /></span>
                      <span className="workspace-card-copy">
                        <b>{workspace.name}</b>
                        <small>
                          {workspace.source.type === 'github'
                            ? `GitHub · ${workspace.source.repository}`
                            : workspace.source.type === 'local' ? 'Imported from this device' : 'SyncForge workspace'}
                        </small>
                      </span>
                      <span className="workspace-role">{workspace.role}</span>
                      <ArrowUpRight size={15} />
                    </button>
                    {workspace.role === 'owner' && (
                      <button
                        className="workspace-delete-btn"
                        onClick={(e) => deleteWorkspaceById(workspace, e)}
                        title="Delete workspace"
                        aria-label={`Delete workspace ${workspace.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <div className="join-card">
              <p className="sign-in-prompt">Sign in with GitHub to open an invite, create a workspace, or import a project.</p>
              <button className="primary-button" onClick={beginSignIn}>
                Continue with GitHub <ArrowUpRight size={17} />
              </button>
              {authError && <p className="form-error" role="alert">{authError} <button type="button" className="inline-retry" onClick={() => window.location.reload()}>Retry</button></p>}
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="join-footnote">
                <Wifi size={14} /> Invite links securely connect teammates to a workspace.
              </div>
            </div>
          )}

          <div className="value-points">
            <div><span className="point-icon"><Radio size={16} /></span><span><b>Live by default</b><small>See every change as it happens</small></span></div>
            <div><span className="point-icon"><WifiOff size={16} /></span><span><b>Ready to reconnect</b><small>Keep editing when your network drops</small></span></div>
            <div><span className="point-icon"><Users size={16} /></span><span><b>Made for teams</b><small>One room, one shared source of truth</small></span></div>
          </div>
        </section>
        <footer className="welcome-footer"><span>SYNCFORGE · EARLY ACCESS</span><span>Built for the way teams work.</span></footer>
      </main>
    )
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); leaveRoom() }}>
          <span className="brand-mark"><Code2 size={19} strokeWidth={2.5} /></span>
          <span>sync<span>forge</span></span>
        </a>
        <div className="topbar-divider" />
        <div className="workspace-title">
          <span className="workspace-title-name">
            {workspaces.find((w) => w.roomId === roomId)?.name ?? 'Workspace'}
          </span>
          <span className="workspace-room">ROOM / {roomId}</span>
        </div>
        <div className="topbar-divider" />
        <button
          type="button"
          className="branch-pill-button"
          onClick={() => setShowBranchModal(true)}
          title="Branch manager & snapshots"
        >
          <GitBranch size={13} />
          <span>{activeBranch}</span>
          <ChevronDown size={11} />
        </button>
        <button
          type="button"
          className="ai-trigger-button"
          onClick={() => setShowAiModal(true)}
          disabled={!activeFile}
          title={activeFile ? `Open AI Assistant for ${activeFile.name}` : 'Select a file to use AI Assistant'}
        >
          <Sparkles size={13} />
          <span>AI Assistant</span>
        </button>
        <div className="topbar-spacer" />
        <div className={`connection-pill ${connection}`} title={connection === 'connected' ? 'Connected. Changes sync live.' : 'Reconnecting. Local edits are saved on this device.'}>
          <span className="connection-dot" />
          {connection === 'connected' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Offline'}
        </div>
        <div className="members" aria-label={`${members.length} people in this room`}>
          {members.slice(0, 3).map((member, index) => (
            <span
              className={`member-avatar avatar-${index % 4}`}
              key={member.id}
              title={member.name}
            >
              {initials(member.name)}
            </span>
          ))}
          {members.length > 3 && <span className="member-overflow">+{members.length - 3}</span>}
          <span className="member-count"><Users size={14} /> {members.length}</span>
        </div>
        {workspaceRole === 'owner' && (
          <button className="share-button" onClick={copyInvite}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copied' : 'Invite'}
          </button>
        )}
        <button className="icon-button" onClick={signOut} aria-label="Sign out of GitHub" title="Sign out">
          <LogOut size={16} />
        </button>
        <button className="icon-button leave-button" onClick={leaveRoom} aria-label="Leave workspace" title="Leave workspace">
          <X size={17} />
        </button>
      </header>

      <div className="workspace-body">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>EXPLORER</span>
            <button
              type="button"
              className="subtle-icon"
              aria-label="Export workspace as ZIP"
              title="Download workspace ZIP"
              onClick={downloadWorkspaceZip}
              disabled={!localReady || workspaceFiles.length === 0}
            >
              <Download size={14} />
            </button>
            <button
              className="subtle-icon"
              aria-label="Add file"
              title="Create a file (Ctrl+Shift+N)"
              onClick={openNewFileDialog}
              disabled={!localReady}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="folder-row"><ChevronDown size={14} /><span>SYNCFORGE</span></div>
          <div className="sidebar-search">
            <input
              type="search"
              className="sidebar-search-input"
              placeholder="Filter files…"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              aria-label="Filter workspace files"
            />
          </div>
          <div className="file-list">
            {workspaceFiles
              .filter((file) => !fileFilter || file.name.toLowerCase().includes(fileFilter.toLowerCase()))
              .map((file) => (
              <div
                key={file.id}
                className={`file-row-wrapper${file.id === activeFileId ? ' active' : ''}`}
              >
                <button
                  className={`file-row${file.id === activeFileId ? ' active' : ''}`}
                  onClick={() => setActiveFileId(file.id)}
                  title={file.name}
                >
                  <FileCode2 size={15} />
                  <span>{file.name}</span>
                </button>
                <div className="file-row-actions">
                  <button
                    className="file-action-btn"
                    onClick={(e) => startRenameFile(file.id, file.name, e)}
                    title="Rename file"
                    aria-label={`Rename ${file.name}`}
                  >
                    <span style={{ fontSize: 10 }}>✎</span>
                  </button>
                  <button
                    type="button"
                    className="file-action-btn"
                    onClick={(e) => duplicateWorkspaceFile(file, e)}
                    title="Duplicate file"
                    aria-label={`Duplicate ${file.name}`}
                  >
                    <Copy size={11} />
                  </button>
                  <button
                    type="button"
                    className="file-action-btn"
                    onClick={(e) => downloadWorkspaceSingleFile(file, e)}
                    title="Download file"
                    aria-label={`Download ${file.name}`}
                  >
                    <Download size={11} />
                  </button>
                  <button
                    className="file-action-btn file-delete-btn"
                    onClick={(e) => deleteWorkspaceFile(file.id, file.name, e)}
                    title="Delete file"
                    aria-label={`Delete ${file.name}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="sidebar-bottom">
            <button
              type="button"
              className="sidebar-bottom-icon sidebar-help-btn"
              onClick={() => setShowShortcutsHelp(true)}
              title="Keyboard shortcuts"
              aria-label="Show keyboard shortcuts"
            >
              <CircleHelp size={16} />
            </button>
            <span><b>Split the work</b><small>Open separate files to collaborate.</small></span>
          </div>
        </aside>

        <section className="editor-area" aria-label="Collaborative code editor">
          <div className="tabbar">
            <div className="active-tab">
              <FileCode2 size={14} />
              <span>{activeFile?.name ?? 'Loading file…'}</span>
            </div>
            <div className="tabbar-spacer" />
            <button
              type="button"
              className="tabbar-palette-button"
              onClick={() => setShowPalette(true)}
              title="Open the command palette"
            >
              <Search size={12} />
              <span>Search</span>
              <kbd className="kbd tabbar-kbd">{paletteShortcutLabel}</kbd>
            </button>
            <button
              type="button"
              className="tabbar-ai-button"
              onClick={() => setShowAiModal(true)}
              disabled={!activeFile}
              title="Open AI proposal modal"
            >
              <Sparkles size={12} />
              <span>AI Propose</span>
            </button>
            <span className="editor-language">
              {activeFile ? languageForFile(activeFile.name) : 'JavaScript'}
            </span>
            <button
              className="subtle-icon tab-add-file"
              onClick={openNewFileDialog}
              disabled={!localReady}
              aria-label="Create a file"
              title="Create a file"
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="editor-container">
            {!localReady && <div className="editor-loading">Restoring your workspace…</div>}
            <Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
            <Editor
              height="100%"
              language={activeFile ? languageForFile(activeFile.name) : 'javascript'}
              theme="vs-dark"
              onMount={onEditorMount}
              options={{
                automaticLayout: true,
                minimap: { enabled: false },
                fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
                fontSize: 14,
                lineHeight: 24,
                padding: { top: 20, bottom: 24 },
                scrollBeyondLastLine: false,
                roundedSelection: true,
                cursorBlinking: 'smooth',
                smoothScrolling: true,
                tabSize: 2,
                wordWrap: 'on',
                readOnly: false,
              }}
            />
            </Suspense>
          </div>
          {error && (
            <div className="workspace-alert" role="status">
              {error}
              {connection === 'offline' && (
                <button onClick={leaveRoom}>Back to workspaces</button>
              )}
            </div>
          )}
          {workspaceNotice && (
            <ToastContainer
              message={workspaceNotice}
              onDismiss={() => setWorkspaceNotice('')}
            />
          )}
          <footer className="editor-status">
            <span><span className={`status-dot ${connection}`} />{connection === 'connected' ? 'All changes synced' : 'Editing locally'}</span>
            <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
            <span>{charCount} chars</span>
            <span>UTF-8</span>
            <span>{activeFile ? languageForFile(activeFile.name) : 'JavaScript'}</span>
          </footer>
        </section>

        <aside className="activity-panel">
          <div className="activity-heading"><span>IN THIS ROOM</span><span className="activity-live"><i /> LIVE</span></div>
          <div className="profile-card">
            <span className="profile-avatar">{initials(user.name) || 'Y'}</span>
            <div><b>{user.name}</b><small>You · editing</small></div>
            <span className="profile-status" />
          </div>
          <div className="activity-separator" />
          <div className="room-details">
            <div className="detail-label">{workspaceRole === 'owner' ? 'INVITE LINK' : 'WORKSPACE ACCESS'}</div>
            {workspaceRole === 'owner' ? (
              <>
                <button className="room-link" onClick={copyInvite}>
                  <span>{roomId}</span>{copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <p>Invite links grant editor access and expire after seven days.</p>
              </>
            ) : (
              <p>You have editor access to this workspace.</p>
            )}
          </div>
          <div className="activity-tip">
            <div className="tip-icon"><Radio size={15} /></div>
            <div><b>You're in sync</b><p>Changes are shared with everyone in this room as you type.</p></div>
          </div>
          <button className="help-link" onClick={() => setError('Offline edits are stored in this browser and sync when you reconnect.')}>
            <CircleHelp size={14} /> How does sync work?
          </button>
        </aside>
      </div>
      {showNewFile && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowNewFile(false)
          }}
        >
          <form
            className="new-file-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-file-title"
            onSubmit={createWorkspaceFile}
          >
            <div className="dialog-heading">
              <div>
                <span className="dialog-eyebrow">PROJECT FILES</span>
                <h2 id="new-file-title">Create a file</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowNewFile(false)}
                aria-label="Close dialog"
              >
                <X size={15} />
              </button>
            </div>
            <label htmlFor="new-file-name">FILE NAME</label>
            <input
              id="new-file-name"
              autoFocus
              maxLength={64}
              placeholder="e.g. utils.ts"
              value={newFileName}
              onChange={(event) => {
                setNewFileName(event.target.value)
                setFileNameError('')
              }}
            />
            {fileNameError && <p className="form-error" role="alert">{fileNameError}</p>}
            <p className="dialog-help">Files are shared with everyone in this room.</p>
            <div className="dialog-actions">
              <button type="button" className="cancel-button" onClick={() => setShowNewFile(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">Create file</button>
            </div>
          </form>
        </div>
      )}
      {showAiModal && activeFile && (
        <AiAssistantModal
          roomId={roomId}
          activeFileName={activeFile.name}
          activeFileId={activeFile.id}
          currentFileContent={activeFile.content.toString()}
          onClose={() => setShowAiModal(false)}
          onAcceptPatch={handleAcceptAiPatch}
        />
      )}
      {showBranchModal && (
        <BranchManagerModal
          roomId={roomId}
          activeBranch={activeBranch}
          workspaceFiles={workspaceFiles.map((file) => ({
            name: file.name,
            content: file.content.toString(),
          }))}
          onClose={() => setShowBranchModal(false)}
          onBranchSelect={(branch) => setActiveBranch(branch)}
          onSyncLive={handleSyncLive}
        />
      )}
      {showShortcutsHelp && (
        <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      )}
      {showPalette && (
        <CommandPalette commands={paletteCommands} onClose={() => setShowPalette(false)} />
      )}
    </main>
  )
}

export default App
