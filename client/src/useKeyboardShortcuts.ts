import { useEffect } from 'react'

export interface ShortcutHandlers {
  onTogglePalette?: () => void
  onNewFile?: () => void
  onToggleAi?: () => void
  onToggleBranch?: () => void
  onCopyInvite?: () => void
  onLeave?: () => void
  onEscape?: () => void
}

/**
 * Register keyboard shortcuts for the workspace.
 * All shortcuts use the platform modifier key (Cmd on Mac, Ctrl elsewhere).
 *
 * Ctrl/Cmd + K — command palette
 * Ctrl/Cmd + Shift + N — new file
 * Ctrl/Cmd + Shift + A — toggle AI assistant
 * Ctrl/Cmd + Shift + B — toggle branch manager
 * Ctrl/Cmd + Shift + I — copy invite link
 * Escape — close the open dialog
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey

      if (event.key === 'Escape' && !mod && !event.shiftKey && !event.altKey) {
        handlers.onEscape?.()
        return
      }

      // Ctrl/Cmd+K has no Shift, so it is checked before the Shift block.
      // Browsers bind it to the address bar, hence the preventDefault.
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        handlers.onTogglePalette?.()
        return
      }

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
