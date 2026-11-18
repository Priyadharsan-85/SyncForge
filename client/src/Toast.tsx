import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'

interface ToastProps {
  message: string
  onDismiss: () => void
  durationMs?: number
}

export function Toast({ message, onDismiss, durationMs = 4000 }: ToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Trigger enter animation on next frame
    const enterTimer = window.setTimeout(() => setVisible(true), 10)
    const exitTimer = window.setTimeout(() => {
      setVisible(false)
      window.setTimeout(onDismiss, 300)
    }, durationMs)

    return () => {
      window.clearTimeout(enterTimer)
      window.clearTimeout(exitTimer)
    }
  }, [durationMs, onDismiss])

  return (
    <div className={`toast ${visible ? 'toast-visible' : ''}`} role="status" aria-live="polite">
      <Check size={13} className="toast-icon" />
      <span className="toast-message">{message}</span>
      <button
        type="button"
        className="toast-dismiss"
        onClick={() => { setVisible(false); window.setTimeout(onDismiss, 300) }}
        aria-label="Dismiss notification"
      >
        <X size={12} />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  message: string
  onDismiss: () => void
}

export function ToastContainer({ message, onDismiss }: ToastContainerProps) {
  if (!message) return null
  return (
    <div className="toast-container">
      <Toast message={message} onDismiss={onDismiss} />
    </div>
  )
}
