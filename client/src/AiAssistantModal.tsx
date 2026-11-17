import { useState, useEffect } from 'react'
import { Sparkles, X, Check, AlertTriangle, ArrowRight, RefreshCw, FileText } from 'lucide-react'
import { DiffViewer } from './DiffViewer'

export interface DraftPatch {
  draftId: string
  roomId: string
  fileName: string
  fileId: string
  baseContent: string
  baseChecksum: string
  prompt: string
  actionType: string
  proposedContent: string
  diff: string
  stats: { additions: number; deletions: number; hunksCount: number }
  status: string
}

interface AiAssistantModalProps {
  roomId: string
  activeFileName: string
  activeFileId: string
  currentFileContent: string
  onClose: () => void
  onAcceptPatch: (newContent: string) => void
}

export function AiAssistantModal({
  roomId,
  activeFileName,
  activeFileId,
  currentFileContent,
  onClose,
  onAcceptPatch,
}: AiAssistantModalProps) {
  const [prompt, setPrompt] = useState('')
  const [actionType, setActionType] = useState('doc')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<DraftPatch | null>(null)
  const [conflictWarning, setConflictWarning] = useState('')
  const [finalContent, setFinalContent] = useState('')

  // Check if live document diverged from the base content of the draft
  useEffect(() => {
    if (!draft) return
    if (currentFileContent === draft.baseContent) return

    let active = true
    fetch(`/api/workspaces/${roomId}/ai/rebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: draft.draftId,
        liveContent: currentFileContent,
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Rebase check failed')
        return res.json() as Promise<{
          hasConflict: boolean
          mergedText: string
          conflicts: Array<{ startLine: number }>
        }>
      })
      .then((rebase) => {
        if (!active) return
        if (rebase.hasConflict) {
          setConflictWarning(
            `Live document was modified concurrently by a collaborator! ${rebase.conflicts.length} semantic conflict(s) detected.`,
          )
          setFinalContent(rebase.mergedText)
        } else {
          setConflictWarning(
            'A collaborator made concurrent edits. Your draft was cleanly rebased with no semantic conflicts.',
          )
          setFinalContent(rebase.mergedText)
        }
      })
      .catch(() => {
        if (active) setConflictWarning('Note: The live document has changed since this draft was generated.')
      })

    return () => {
      active = false
    }
  }, [currentFileContent, draft, roomId])


  async function handleGenerateDraft() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/workspaces/${roomId}/ai/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: activeFileId,
          fileName: activeFileName,
          baseContent: currentFileContent,
          actionType,
          prompt,
        }),
      })
      const result = await res.json() as { error?: string } & DraftPatch
      if (!res.ok) throw new Error(result.error ?? 'Failed to generate AI draft patch.')
      setDraft(result)
      setFinalContent(result.proposedContent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate AI draft.')
    } finally {
      setLoading(false)
    }
  }

  function handleAccept() {
    if (!finalContent) return
    onAcceptPatch(finalContent)
    onClose()
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ai-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
        <header className="ai-modal-header">
          <div className="ai-modal-title-group">
            <span className="ai-badge">
              <Sparkles size={14} /> AI Assistant
            </span>
            <h2 id="ai-modal-title">
              {draft ? 'Review Private Draft Patch' : 'AI-Assisted Code Editing'}
            </h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </header>

        <div className="ai-modal-body">
          {!draft ? (
            <div className="ai-prompt-view">
              <div className="ai-file-banner">
                <FileText size={15} />
                <span>Target file: <b>{activeFileName}</b> ({currentFileContent.split(/\r?\n/).length} lines)</span>
              </div>

              <div className="ai-quick-actions">
                <label>QUICK ASSIST ACTIONS</label>
                <div className="ai-action-buttons">
                  <button
                    type="button"
                    className={`ai-chip ${actionType === 'doc' ? 'active' : ''}`}
                    onClick={() => setActionType('doc')}
                  >
                    Add JSDoc Comments
                  </button>
                  <button
                    type="button"
                    className={`ai-chip ${actionType === 'fix' ? 'active' : ''}`}
                    onClick={() => setActionType('fix')}
                  >
                    Defensive Error Checks
                  </button>
                  <button
                    type="button"
                    className={`ai-chip ${actionType === 'refactor' ? 'active' : ''}`}
                    onClick={() => setActionType('refactor')}
                  >
                    Modernize / Refactor
                  </button>
                  <button
                    type="button"
                    className={`ai-chip ${actionType === 'test' ? 'active' : ''}`}
                    onClick={() => setActionType('test')}
                  >
                    Generate Unit Tests
                  </button>
                  <button
                    type="button"
                    className={`ai-chip ${actionType === 'custom' ? 'active' : ''}`}
                    onClick={() => setActionType('custom')}
                  >
                    Custom Prompt
                  </button>
                </div>
              </div>

              <div className="ai-prompt-input-group">
                <label htmlFor="ai-custom-prompt">INSTRUCTIONS FOR AI</label>
                <textarea
                  id="ai-custom-prompt"
                  rows={3}
                  placeholder="e.g. Add TypeScript types, optimize performance, handle edge cases..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="ai-notice-box">
                <AlertTriangle size={15} />
                <p>
                  <b>Collaborative Guardrail:</b> The AI will produce a private draft patch just for you. It will <b>not</b> type directly into the shared workspace until you review and explicitly accept it.
                </p>
              </div>

              {error && <p className="form-error" role="alert">{error}</p>}

              <div className="ai-modal-footer">
                <button type="button" className="cancel-button" onClick={onClose} disabled={loading}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleGenerateDraft}
                  disabled={loading}
                >
                  {loading ? <RefreshCw size={14} className="spin" /> : <ArrowRight size={14} />}
                  {loading ? 'Generating draft…' : 'Generate Private Draft'}
                </button>
              </div>
            </div>
          ) : (
            <div className="ai-review-view">
              <div className="ai-draft-meta-bar">
                <div className="ai-draft-stats">
                  <span className="stat-add">+{draft.stats.additions}</span>
                  <span className="stat-del">-{draft.stats.deletions}</span>
                  <span className="stat-hunks">{draft.stats.hunksCount} hunk(s)</span>
                </div>
                <div className="ai-draft-scope-tag">Private Draft (Not yet shared)</div>
              </div>

              <div className="ai-diff-scroll">
                <DiffViewer diffText={draft.diff} conflictWarning={conflictWarning} />
              </div>

              <div className="ai-review-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDraft(null)}
                >
                  Back / Re-prompt
                </button>
                <div className="ai-review-right">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={() => {
                      fetch(`/api/workspaces/${roomId}/ai/drafts/${draft.draftId}`, { method: 'DELETE' }).catch(() => {})
                      onClose()
                    }}
                  >
                    Discard Draft
                  </button>
                  <button
                    type="button"
                    className="primary-button accept-button"
                    onClick={handleAccept}
                  >
                    <Check size={15} /> Accept & Apply to Workspace
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
