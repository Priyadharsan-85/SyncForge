import { useEffect } from 'react'

export interface ShortcutHandlers {
  onNewFile?: () => void
  onToggleAi?: () => void
  onToggleBranch?: () => void
  onCopyInvite?: () => void
  onLeave?: () => void
}

/**
 * Register keyboard shortcuts for the workspace.
 * All shortcuts use the platform modifier key (Cmd on Mac, Ctrl elsewhere).
 *
 * Ctrl/Cmd + Shift + N — new file
 * Ctrl/Cmd + Shift + A — toggle AI assistant
 * Ctrl/Cmd + Shift + B — toggle branch manager
 * Ctrl/Cmd + Shift + I — copy invite link
 * Escape — no-op (modals handle their own escape)
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey

      if (mod && event.shiftKey) {
        switch (event.key.toUpperCase()) {
          case 'N':
            event.preventDefault()
            handlers.onNewFile?.()
            break
          case 'A':
            event.preventDefault()
            handlers.onToggleAi?.()
            break
          case 'B':
            event.preventDefault()
            handlers.onToggleBranch?.()
            break
          case 'I':
            event.preventDefault()
            handlers.onCopyInvite?.()
            break
          default:
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handlers])
}
