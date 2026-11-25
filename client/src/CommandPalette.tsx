import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { rankCommands, type Command } from './commandRanking'

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

/**
 * A single-keystroke launcher for everything in the workspace: jump to a
 * file, open a dialog, run an export. Opened with Ctrl/Cmd+K.
 */
export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => rankCommands(commands, query), [commands, query])

  // A list that shrinks under the cursor — because a file was deleted
  // live by a collaborator — would otherwise leave the cursor past the end.
  const selected = Math.min(activeIndex, Math.max(results.length - 1, 0))
  const activeCommand = results[selected]

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLLIElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected, results.length])

  function runCommand(command: Command | undefined) {
    if (!command) return
    onClose()
    command.run()
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex(results.length === 0 ? 0 : (selected + 1) % results.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex(
          results.length === 0 ? 0 : (selected - 1 + results.length) % results.length,
        )
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(Math.max(results.length - 1, 0))
        break
      case 'Enter':
        event.preventDefault()
        runCommand(activeCommand)
        break
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      default:
        break
    }
  }

  return (
    <div
      className="dialog-backdrop palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        <div className="palette-search">
          <Search size={14} className="palette-search-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            value={query}
            placeholder="Jump to a file or run a command…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Search commands"
            aria-controls="palette-results"
            aria-activedescendant={activeCommand ? `palette-option-${activeCommand.id}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value)
              // Re-ranking moves the best match to the top, so the cursor
              // belongs there too. Reset here rather than in an effect, so
              // there is no second render pass per keystroke.
              setActiveIndex(0)
            }}
          />
          <kbd className="kbd palette-esc">Esc</kbd>
        </div>

        {results.length === 0 ? (
          <p className="palette-empty">No commands match “{query.trim()}”.</p>
        ) : (
          <ul className="palette-results" id="palette-results" role="listbox" ref={listRef}>
            {results.map((command, index) => (
              <li
                key={command.id}
                id={`palette-option-${command.id}`}
                role="option"
                aria-selected={index === selected}
                data-active={index === selected}
                className="palette-option"
                onMouseMove={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  runCommand(command)
                }}
              >
                <span className="palette-option-icon">{command.icon}</span>
                <span className="palette-option-label">{command.label}</span>
                <span className="palette-option-group">{command.group}</span>
                {command.hint && <kbd className="kbd palette-option-hint">{command.hint}</kbd>}
              </li>
            ))}
          </ul>
        )}

        <footer className="palette-footer">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
          <span><kbd className="kbd">↵</kbd> run</span>
          <span>
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </span>
        </footer>
      </div>
    </div>
  )
}
