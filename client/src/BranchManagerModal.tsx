import { useState, useEffect } from 'react'
import {
  GitBranch,
  GitPullRequest,
  GitCommit,
  X,
  Plus,
  RefreshCw,
  Check,
  AlertTriangle,
  Download,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react'
import { DiffViewer } from './DiffViewer'

export interface Branch {
  name: string
  headCommitId: string
  createdAt: string
  creator: { id: string; name: string }
}

export interface PullRequest {
  prId: string
  number: number
  title: string
  description: string
  sourceBranch: string
  targetBranch: string
  author: { id: string; name: string }
  status: 'open' | 'merged' | 'closed'
  createdAt: string
}

interface BranchManagerModalProps {
  roomId: string
  activeBranch: string
  workspaceFiles: Array<{ name: string; content: string }>
  onClose: () => void
  onBranchSelect: (branchName: string) => void
  onSyncLive: (branchName: string) => Promise<void>
}

export function BranchManagerModal({
  roomId,
  activeBranch,
  workspaceFiles,
  onClose,
  onBranchSelect,
  onSyncLive,
}: BranchManagerModalProps) {
  const [tab, setTab] = useState<'branches' | 'commit' | 'pulls' | 'github'>('branches')
  const [branches, setBranches] = useState<Branch[]>([])
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // New branch state
  const [newBranchName, setNewBranchName] = useState('')
  const [fromBranch, setFromBranch] = useState('main')

  // Commit snapshot state
  const [commitMessage, setCommitMessage] = useState('')
  const [targetCommitBranch, setTargetCommitBranch] = useState(activeBranch || 'main')

  // Create PR state
  const [showCreatePr, setShowCreatePr] = useState(false)
  const [prTitle, setPrTitle] = useState('')
  const [prDesc, setPrDesc] = useState('')
  const [prSource, setPrSource] = useState(activeBranch !== 'main' ? activeBranch : '')
  const [prTarget, setPrTarget] = useState('main')

  // Selected PR detail
  const [selectedPr, setSelectedPr] = useState<PullRequest | null>(null)
  const [prDiff, setPrDiff] = useState<string>('')
  const [canMerge, setCanMerge] = useState(true)

  // GitHub status
  const [ghStatus, setGhStatus] = useState<{
    hasWritePermission: boolean
    status: string
    message: string
  } | null>(null)

  useEffect(() => {
    let active = true

    async function init() {
      try {
        const [bRes, pRes, gRes] = await Promise.all([
          fetch(`/api/workspaces/${roomId}/branches`),
          fetch(`/api/workspaces/${roomId}/pulls`),
          fetch(`/api/workspaces/${roomId}/github/status`),
        ])
        if (active && bRes.ok) setBranches(await bRes.json())
        if (active && pRes.ok) setPullRequests(await pRes.json())
        if (active && gRes.ok) setGhStatus(await gRes.json())
      } catch {
        // ignore
      }
    }

    init()
    return () => { active = false }
  }, [roomId])


  async function loadBranches() {
    try {
      const res = await fetch(`/api/workspaces/${roomId}/branches`)
      if (res.ok) {
        const data = await res.json() as Branch[]
        setBranches(data)
      }
    } catch {
      // ignore
    }
  }

  async function loadPulls() {
    try {
      const res = await fetch(`/api/workspaces/${roomId}/pulls`)
      if (res.ok) {
        const data = await res.json() as PullRequest[]
        setPullRequests(data)
      }
    } catch {
      // ignore
    }
  }

  async function handleCreateBranch(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/workspaces/${roomId}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchName: newBranchName.trim(),
          fromBranch,
        }),
      })
      const result = await res.json() as { error?: string } & Branch
      if (!res.ok) throw new Error(result.error || 'Failed to create branch.')
      setNotice(`Branch "${result.name}" created successfully.`)
      setNewBranchName('')
      await loadBranches()
      onBranchSelect(result.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create branch.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCommitSnapshot(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const tree: Record<string, string> = {}
      for (const file of workspaceFiles) {
        tree[file.name] = file.content
      }

      const branchObj = branches.find((b) => b.name === targetCommitBranch)
      const res = await fetch(
        `/api/workspaces/${roomId}/branches/${encodeURIComponent(targetCommitBranch)}/commits`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: commitMessage.trim(),
            tree,
            expectedParentCommitId: branchObj?.headCommitId,
          }),
        },
      )
      const result = await res.json() as { error?: string }
      if (!res.ok) throw new Error(result.error || 'Failed to commit snapshot.')

      setNotice(
        `Snapshot committed to branch "${targetCommitBranch}". Live workspace is unchanged until synced back.`,
      )
      setCommitMessage('')
      await loadBranches()
      setTab('branches')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not commit snapshot.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreatePr(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/workspaces/${roomId}/pulls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: prTitle.trim(),
          description: prDesc.trim(),
          sourceBranch: prSource,
          targetBranch: prTarget,
        }),
      })
      const result = await res.json() as { error?: string } & PullRequest
      if (!res.ok) throw new Error(result.error || 'Failed to create PR.')

      setNotice(`Pull Request #${result.number} opened.`)
      setShowCreatePr(false)
      setPrTitle('')
      setPrDesc('')
      await loadPulls()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open PR.')
    } finally {
      setLoading(false)
    }
  }

  async function openPrDetails(pr: PullRequest) {
    setSelectedPr(pr)
    setPrDiff('')
    setCanMerge(true)
    try {
      const res = await fetch(`/api/workspaces/${roomId}/pulls/${pr.number}/diff`)
      if (res.ok) {
        const diffData = await res.json() as {
          files: Array<{ diff: string }>
          canMergeCleanly: boolean
        }
        setPrDiff(diffData.files.map((f) => f.diff).join('\n'))
        setCanMerge(diffData.canMergeCleanly)
      }
    } catch {
      // ignore
    }
  }

  async function handleMergePr(prNumber: number) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/workspaces/${roomId}/pulls/${prNumber}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const result = await res.json() as { error?: string }
      if (!res.ok) throw new Error(result.error || 'Failed to merge PR.')

      setNotice(`PR #${prNumber} successfully merged into target branch!`)
      setSelectedPr(null)
      await loadBranches()
      await loadPulls()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge PR.')
    } finally {
      setLoading(false)
    }
  }

  async function handleExportPatch(branchName: string) {
    try {
      const res = await fetch(
        `/api/workspaces/${roomId}/branches/${encodeURIComponent(branchName)}/export-patch`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error('Patch export failed')
      const data = await res.json() as { patch: string }
      const blob = new Blob([data.patch], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${branchName.replace(/\//g, '-')}.patch`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not export branch patch.')
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="branch-modal-panel" role="dialog" aria-modal="true" aria-labelledby="branch-modal-title">
        <header className="branch-modal-header">
          <div className="branch-nav-tabs">
            <button
              type="button"
              className={`branch-tab-btn ${tab === 'branches' ? 'active' : ''}`}
              onClick={() => { setTab('branches'); setSelectedPr(null) }}
            >
              <GitBranch size={15} /> Branches ({branches.length})
            </button>
            <button
              type="button"
              className={`branch-tab-btn ${tab === 'commit' ? 'active' : ''}`}
              onClick={() => { setTab('commit'); setSelectedPr(null) }}
            >
              <GitCommit size={15} /> Commit Snapshot
            </button>
            <button
              type="button"
              className={`branch-tab-btn ${tab === 'pulls' ? 'active' : ''}`}
              onClick={() => setTab('pulls')}
            >
              <GitPullRequest size={15} /> Pull Requests ({pullRequests.length})
            </button>
            <button
              type="button"
              className={`branch-tab-btn ${tab === 'github' ? 'active' : ''}`}
              onClick={() => { setTab('github'); setSelectedPr(null) }}
            >
              <ShieldAlert size={15} /> GitHub Workflow
            </button>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </button>
        </header>

        {notice && (
          <div className="branch-notice-bar" role="status">
            <Check size={14} /> <span>{notice}</span>
          </div>
        )}
        {error && <p className="form-error branch-error-bar" role="alert">{error}</p>}

        <div className="branch-modal-body">
          {tab === 'branches' && (
            <div className="branches-view">
              <div className="create-branch-row">
                <form className="create-branch-form" onSubmit={handleCreateBranch}>
                  <input
                    type="text"
                    placeholder="New branch name (e.g. feature/navbar)"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    required
                  />
                  <select value={fromBranch} onChange={(e) => setFromBranch(e.target.value)}>
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>From: {b.name}</option>
                    ))}
                  </select>
                  <button type="submit" className="primary-button" disabled={loading}>
                    <Plus size={14} /> Create branch
                  </button>
                </form>
              </div>

              <div className="branches-list">
                {branches.map((b) => (
                  <div key={b.name} className={`branch-item-row ${b.name === activeBranch ? 'current-active' : ''}`}>
                    <div className="branch-info">
                      <div className="branch-name-title">
                        <GitBranch size={15} />
                        <b>{b.name}</b>
                        {b.name === activeBranch && <span className="branch-current-pill">Current</span>}
                      </div>
                      <small>Commit: {b.headCommitId?.slice(0, 7)} · Created by {b.creator?.name}</small>
                    </div>

                    <div className="branch-actions">
                      <button
                        type="button"
                        className="subtle-button"
                        onClick={() => handleExportPatch(b.name)}
                        title="Download standard Git .patch file"
                      >
                        <Download size={13} /> Patch
                      </button>
                      <button
                        type="button"
                        className="subtle-button sync-live-button"
                        onClick={() => onSyncLive(b.name)}
                        title="Sync this branch snapshot into the live collaborative workspace"
                      >
                        <RefreshCw size={13} /> Sync to Live
                      </button>
                      {b.name !== activeBranch && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            onBranchSelect(b.name)
                            onClose()
                          }}
                        >
                          Checkout
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'commit' && (
            <div className="commit-view">
              <div className="commit-guidelines">
                <AlertTriangle size={15} />
                <p>
                  <b>Isolated Task Snapshots:</b> Committing captures a snapshot of current files to the selected branch.
                  <b> It will not alter the live collaborative workspace</b> until someone explicitly syncs changes back.
                </p>
              </div>

              <form className="commit-form" onSubmit={handleCommitSnapshot}>
                <label>TARGET BRANCH</label>
                <select
                  value={targetCommitBranch}
                  onChange={(e) => setTargetCommitBranch(e.target.value)}
                >
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>

                <label>COMMIT MESSAGE</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Implement user profile sidebar and responsive layout"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  required
                />

                <div className="commit-meta-summary">
                  <span>Files included in snapshot: <b>{workspaceFiles.length}</b></span>
                </div>

                <div className="ai-modal-footer">
                  <button type="button" className="cancel-button" onClick={onClose}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-button" disabled={loading}>
                    <GitCommit size={15} /> Commit Snapshot
                  </button>
                </div>
              </form>
            </div>
          )}

          {tab === 'pulls' && (
            <div className="pulls-view">
              {!selectedPr && (
                <>
                  <div className="pulls-top-bar">
                    <span className="pulls-heading-text">Workspace Pull Requests</span>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => setShowCreatePr(!showCreatePr)}
                    >
                      <Plus size={14} /> New Pull Request
                    </button>
                  </div>

                  {showCreatePr && (
                    <form className="create-pr-card" onSubmit={handleCreatePr}>
                      <h3>Open a Pull Request</h3>
                      <div className="pr-branch-selectors">
                        <div>
                          <label>SOURCE (COMPARE)</label>
                          <select value={prSource} onChange={(e) => setPrSource(e.target.value)} required>
                            <option value="">Select source branch</option>
                            {branches.map((b) => (
                              <option key={b.name} value={b.name}>{b.name}</option>
                            ))}
                          </select>
                        </div>
                        <ArrowRight size={16} className="pr-arrow-icon" />
                        <div>
                          <label>TARGET (BASE)</label>
                          <select value={prTarget} onChange={(e) => setPrTarget(e.target.value)} required>
                            {branches.map((b) => (
                              <option key={b.name} value={b.name}>{b.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <label>PR TITLE</label>
                      <input
                        type="text"
                        placeholder="e.g. Feature: Dark mode support"
                        value={prTitle}
                        onChange={(e) => setPrTitle(e.target.value)}
                        required
                      />

                      <label>DESCRIPTION</label>
                      <textarea
                        rows={2}
                        placeholder="Summary of changes in this branch snapshot..."
                        value={prDesc}
                        onChange={(e) => setPrDesc(e.target.value)}
                      />

                      <div className="ai-modal-footer">
                        <button type="button" className="cancel-button" onClick={() => setShowCreatePr(false)}>
                          Cancel
                        </button>
                        <button type="submit" className="primary-button" disabled={loading}>
                          Create Pull Request
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="pulls-list">
                    {pullRequests.length === 0 ? (
                      <p className="empty-pulls">No pull requests created yet.</p>
                    ) : (
                      pullRequests.map((pr) => (
                        <div key={pr.number} className="pr-list-card" onClick={() => openPrDetails(pr)}>
                          <div className="pr-card-main">
                            <span className={`pr-status-badge ${pr.status}`}>
                              <GitPullRequest size={13} /> {pr.status}
                            </span>
                            <div className="pr-card-text">
                              <b>#{pr.number} {pr.title}</b>
                              <small>{pr.sourceBranch} → {pr.targetBranch} · by {pr.author?.name}</small>
                            </div>
                          </div>
                          <span className="subtle-link">Review & Diff <ArrowRight size={13} /></span>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              {selectedPr && (
                <div className="pr-detail-view">
                  <div className="pr-detail-header">
                    <button type="button" className="subtle-button" onClick={() => setSelectedPr(null)}>
                      ← Back to PR list
                    </button>
                    <div className="pr-detail-title-group">
                      <h3>#{selectedPr.number} {selectedPr.title}</h3>
                      <span className="pr-branch-flow">{selectedPr.sourceBranch} → {selectedPr.targetBranch}</span>
                    </div>
                  </div>

                  {!canMerge && (
                    <div className="pr-conflict-alert">
                      <AlertTriangle size={15} />
                      <span><b>Merge Conflict Detected:</b> Concurrent changes exist between these branches. Rebase source branch before merging.</span>
                    </div>
                  )}

                  <div className="pr-diff-wrapper">
                    <DiffViewer diffText={prDiff} />
                  </div>

                  <div className="pr-detail-footer">
                    {selectedPr.status === 'open' && (
                      <button
                        type="button"
                        className="primary-button accept-button"
                        disabled={!canMerge || loading}
                        onClick={() => handleMergePr(selectedPr.number)}
                      >
                        <Check size={15} /> Merge Pull Request
                      </button>
                    )}
                    {selectedPr.status === 'merged' && (
                      <span className="pr-merged-indicator">✓ Merged into {selectedPr.targetBranch}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'github' && (
            <div className="github-view">
              <div className="github-status-card">
                <div className="github-status-header">
                  <ShieldAlert size={20} className="gh-icon-warn" />
                  <div>
                    <h4>GitHub Remote Write Permissions: Unapproved</h4>
                    <p>{ghStatus?.message}</p>
                  </div>
                </div>

                <div className="github-guidelines-box">
                  <p>
                    <b>Security Architecture:</b> SyncForge currently imports public repositories using read permissions.
                    Direct remote pushes to GitHub repositories remain future work awaiting administrator approval.
                  </p>
                  <p>
                    <b>Offline Workflow Available:</b> You can create branches, commit snapshots, review pull requests, and export standardized Git patches (.patch) to apply locally using <code>git apply</code> or <code>gh pr create</code>.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
