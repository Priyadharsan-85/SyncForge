import { useEffect, useRef, useState, type FormEvent } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
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
  FileCode2,
  Github,
  LogOut,
  Plus,
  Radio,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import './App.css'
import { bindYTextToMonaco } from './editorBinding'

type Member = { id: string; name: string }
type WorkspaceFile = { id: string; name: string; content: Y.Text }
type ConnectionState = 'connecting' | 'connected' | 'offline'
type JoinResponse = {
  ok: boolean
  state?: Uint8Array
  members?: Member[]
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
const rememberedName = window.localStorage.getItem('syncforge:name') ?? ''

function createRoomId() {
  return crypto.randomUUID().slice(0, 8)
}

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

function languageForFile(name: string) {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'ts' || extension === 'tsx') return 'typescript'
  if (extension === 'json') return 'json'
  if (extension === 'css') return 'css'
  if (extension === 'html') return 'html'
  if (extension === 'md') return 'markdown'
  return 'javascript'
}

function App() {
  const [name, setName] = useState(rememberedName)
  const [roomInput, setRoomInput] = useState(roomFromUrl ?? '')
  const [roomId, setRoomId] = useState(rememberedName ? roomFromUrl ?? '' : '')
  const [members, setMembers] = useState<Member[]>([])
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [activeFileId, setActiveFileId] = useState('')
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [localReady, setLocalReady] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [fileNameError, setFileNameError] = useState('')
  const textRef = useRef<Y.Text | null>(null)
  const filesRef = useRef<Y.Map<Y.Map<unknown>> | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const bindingRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!roomId || !name.trim()) return

    const doc = new Y.Doc()
    const legacyText = doc.getText('code')
    const files = doc.getMap<Y.Map<unknown>>('files')
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] })
    const persistence = new IndexeddbPersistence(`syncforge:${roomId}`, doc)
    let joined = false
    let disposed = false

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

    const sendDocument = () => {
      if (joined && socket.connected) {
        socket.emit('document:update', {
          roomId,
          update: Y.encodeStateAsUpdate(doc),
        })
      }
    }

    const onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== socket && joined && socket.connected) {
        socket.emit('document:update', { roomId, update })
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
      socket.emit('room:join', { roomId, name: name.trim() }, (response: JoinResponse) => {
        if (!response.ok || !response.state) {
          setError(response.error ?? 'Could not join this room.')
          setConnection('offline')
          return
        }
        Y.applyUpdate(doc, response.state, socket)
        joined = true
        ensureInitialFile()
        setConnection('connected')
        setMembers(response.members ?? [])
        sendDocument()
      })
    })

    socket.on('connect_error', () => setConnection('offline'))
    socket.on('disconnect', () => {
      joined = false
      setConnection('offline')
    })
    socket.on('document:update', (update: Uint8Array) => {
      Y.applyUpdate(doc, update, socket)
      ensureInitialFile()
    })
    socket.on('presence:update', (nextMembers: Member[]) => setMembers(nextMembers))
    socket.on('room:error', (message: string) => setError(message))

    return () => {
      disposed = true
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
  }, [roomId, name])

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
    if (!text) return
    bindingRef.current?.()
    bindingRef.current = bindYTextToMonaco(text, editor)
  }

  function enterRoom(id: string) {
    const cleanName = name.trim().slice(0, 32)
    const cleanRoom = id.trim()
    if (!cleanName) {
      setError('Add your name before opening a workspace.')
      return
    }
    if (!/^[a-zA-Z0-9_-]{3,48}$/.test(cleanRoom)) {
      setError('Room IDs must be 3–48 letters, numbers, dashes or underscores.')
      return
    }
    window.localStorage.setItem('syncforge:name', cleanName)
    setName(cleanName)
    setLocalReady(false)
    setConnection('connecting')
    setError('')
    setRoomInput(cleanRoom)
    setWorkspaceFiles([])
    setActiveFileId('')
    setRoomId(cleanRoom)
    setError('')
    window.history.replaceState(null, '', `?room=${encodeURIComponent(cleanRoom)}`)
  }

  function leaveRoom() {
    setLocalReady(false)
    setRoomId('')
    setMembers([])
    setWorkspaceFiles([])
    setActiveFileId('')
    setShowNewFile(false)
    window.history.replaceState(null, '', window.location.pathname)
  }

  function openNewFileDialog() {
    setFileNameError('')
    setNewFileName('')
    setShowNewFile(true)
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

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`,
      )
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy the invite link. You can copy the room ID instead.')
    }
  }

  if (!roomId) {
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
        </header>

        <section className="welcome-content">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR TEAM'S SHARED WORKSPACE</div>
          <h1>Good ideas get<br /><span>better together.</span></h1>
          <p className="welcome-copy">
            A calm, real-time code space for thinking out loud, making changes, and building as a team.
          </p>

          <form
            className="join-card"
            onSubmit={(event) => {
              event.preventDefault()
              enterRoom(roomInput || createRoomId())
            }}
          >
            <label htmlFor="display-name">YOUR NAME</label>
            <input
              id="display-name"
              autoComplete="name"
              maxLength={32}
              placeholder="e.g. Alex Morgan"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="room-input-label">
              <label htmlFor="room-id">ROOM CODE</label>
              <span>Have an invite? Enter its code</span>
            </div>
            <input
              id="room-id"
              autoComplete="off"
              maxLength={48}
              placeholder="e.g. team-project"
              value={roomInput}
              onChange={(event) => setRoomInput(event.target.value)}
            />
            <button className="primary-button" type="submit">
              {roomInput ? 'Join workspace' : 'Create a workspace'}
              <ArrowUpRight size={17} />
            </button>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="join-footnote">
              <Wifi size={14} /> Changes sync live. Your work is saved on this device.
            </div>
          </form>

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
          <span className="workspace-title-name">Shared project</span>
          <span className="workspace-room">ROOM / {roomId}</span>
        </div>
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
        <button className="share-button" onClick={copyInvite}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Invite'}
        </button>
        <button className="icon-button leave-button" onClick={leaveRoom} aria-label="Leave workspace" title="Leave workspace">
          <LogOut size={17} />
        </button>
      </header>

      <div className="workspace-body">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>EXPLORER</span>
            <button
              className="subtle-icon"
              aria-label="Add file"
              title="Create a file"
              onClick={openNewFileDialog}
              disabled={!localReady}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="folder-row"><ChevronDown size={14} /><span>SYNCFORGE</span></div>
          <div className="file-list">
            {workspaceFiles.map((file) => (
              <button
                className={`file-row${file.id === activeFileId ? ' active' : ''}`}
                key={file.id}
                onClick={() => setActiveFileId(file.id)}
                title={file.name}
              >
                <FileCode2 size={15} />
                <span>{file.name}</span>
              </button>
            ))}
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-bottom-icon"><CircleHelp size={16} /></div>
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
          </div>
          {error && <div className="workspace-alert" role="status">{error}</div>}
          <footer className="editor-status">
            <span><span className={`status-dot ${connection}`} />{connection === 'connected' ? 'All changes synced' : 'Editing locally'}</span>
            <span>UTF-8</span>
            <span>{activeFile ? languageForFile(activeFile.name) : 'JavaScript'}</span>
          </footer>
        </section>

        <aside className="activity-panel">
          <div className="activity-heading"><span>IN THIS ROOM</span><span className="activity-live"><i /> LIVE</span></div>
          <div className="profile-card">
            <span className="profile-avatar">{initials(name) || 'Y'}</span>
            <div><b>{name || 'You'}</b><small>You · editing</small></div>
            <span className="profile-status" />
          </div>
          <div className="activity-separator" />
          <div className="room-details">
            <div className="detail-label">ROOM LINK</div>
            <button className="room-link" onClick={copyInvite}><span>{roomId}</span>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
            <p>Share this room code with a teammate to start building together.</p>
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
      <footer className="bottom-bar">
        <span><span className={`status-dot ${connection}`} />{connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting' : 'Offline mode'}</span>
        <span>{localReady ? 'Local workspace ready' : 'Restoring local edits…'}</span>
        <button onClick={leaveRoom}>Leave room</button>
      </footer>
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
    </main>
  )
}

export default App
