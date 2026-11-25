import { X, Keyboard } from 'lucide-react'

interface KeyboardShortcutsHelpProps {
  onClose: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'

const shortcuts = [
  { keys: `${mod}+K`, description: 'Open command palette' },
  { keys: `${mod}+Shift+N`, description: 'Create new file' },
  { keys: `${mod}+Shift+A`, description: 'Open AI Assistant' },
  { keys: `${mod}+Shift+B`, description: 'Open Branch Manager' },
  { keys: `${mod}+Shift+I`, description: 'Copy invite link' },
  { keys: 'Escape', description: 'Close dialogs' },
]

export function KeyboardShortcutsHelp({ onClose }: KeyboardShortcutsHelpProps) {
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="shortcuts-panel" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <header className="shortcuts-header">
          <div className="shortcuts-title-group">
            <Keyboard size={15} />
            <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="shortcuts-body">
          <table className="shortcuts-table">
            <tbody>
              {shortcuts.map((s) => (
                <tr key={s.keys}>
                  <td className="shortcuts-keys">
                    {s.keys.split('+').map((k, i, arr) => (
                      <span key={k}>
                        <kbd className="kbd">{k}</kbd>
                        {i < arr.length - 1 && <span className="kbd-plus">+</span>}
                      </span>
                    ))}
                  </td>
                  <td className="shortcuts-desc">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
