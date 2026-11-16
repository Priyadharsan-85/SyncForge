import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
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
} from 'lucide-react'
import './App.css'
import { bindYTextToMonaco } from './editorBinding'

type Member = { id: string; name: string }
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

function App() {
  const [name, setName] = useState(rememberedName)
  const [roomInput, setRoomInput] = useState(roomFromUrl ?? '')
  const [roomId, setRoomId] = useState(rememberedName ? roomFromUrl ?? '' : '')
  const [members, setMembers] = useState<Member[]>([])
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [localReady, setLocalReady] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const docRef = useRef<Y.Doc | null>(null)
  const textRef = useRef<Y.Text | null>(null)
  const bindingRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!roomId || !name.trim()) return

    const doc = new Y.Doc()
    const text = doc.getText('code')
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] })
    const persistence = new IndexeddbPersistence(`syncforge:${roomId}`, doc)
    let joined = false

    docRef.current = doc
    textRef.current = text
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
      if (text.length === 0) text.insert(0, starterCode)
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
    })
    socket.on('presence:update', (nextMembers: Member[]) => setMembers(nextMembers))
    socket.on('room:error', (message: string) => setError(message))

    return () => {
      doc.off('update', onDocumentUpdate)
      bindingRef.current?.()
      bindingRef.current = null
      socket.disconnect()
      persistence.destroy()
      doc.destroy()
      docRef.current = null
      textRef.current = null
    }
  }, [roomId, name])

  const onEditorMount: OnMount = (editor) => {
    const doc = docRef.current
    const text = textRef.current
    const model = editor.getModel()
    if (!doc || !text || !model) return
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
    setRoomId(cleanRoom)
    setError('')
    window.history.replaceState(null, '', `?room=${encodeURIComponent(cleanRoom)}`)
  }

  function leaveRoom() {
    setLocalReady(false)
    setRoomId('')
    setMembers([])
    window.history.replaceState(null, '', window.location.pathname)
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
          <span className="workspace-title-name">Untitled workspace</span>
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
              title="Multi-file workspaces are coming soon"
              disabled
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="folder-row"><ChevronDown size={14} /><span>SYNCFORGE</span></div>
          <div className="file-row active"><FileCode2 size={15} /><span>index.js</span></div>
          <div className="sidebar-bottom">
            <div className="sidebar-bottom-icon"><CircleHelp size={16} /></div>
            <span><b>Need a hand?</b><small>Collaboration is always on.</small></span>
          </div>
        </aside>

        <section className="editor-area" aria-label="Collaborative code editor">
          <div className="tabbar">
            <div className="active-tab"><FileCode2 size={14} /><span>index.js</span></div>
            <div className="tabbar-spacer" />
            <span className="editor-language">JavaScript</span>
          </div>
          <div className="editor-container">
            {!localReady && <div className="editor-loading">Restoring your workspace…</div>}
            <Editor
              height="100%"
              defaultLanguage="javascript"
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
            <span>JavaScript</span>
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
    </main>
  )
}

export default App
