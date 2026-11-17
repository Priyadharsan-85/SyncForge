type DiffLine = {
  type: 'equal' | 'insert' | 'delete'
  text: string
  oldLineNumber?: number
  newLineNumber?: number
}

interface DiffViewerProps {
  diffText?: string
  oldContent?: string
  newContent?: string
  conflictWarning?: string
}

function parseUnifiedDiffLines(diffText: string): DiffLine[] {
  if (!diffText) return []
  const lines = diffText.split(/\r?\n/)
  const result: DiffLine[] = []
  let oldLine = 1
  let newLine = 1

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) continue
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      continue
    }

    if (line.startsWith('+')) {
      result.push({
        type: 'insert',
        text: line.slice(1),
        newLineNumber: newLine++,
      })
    } else if (line.startsWith('-')) {
      result.push({
        type: 'delete',
        text: line.slice(1),
        oldLineNumber: oldLine++,
      })
    } else if (line.startsWith(' ')) {
      result.push({
        type: 'equal',
        text: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      })
    }
  }

  return result
}

export function DiffViewer({ diffText, conflictWarning }: DiffViewerProps) {
  const lines = diffText ? parseUnifiedDiffLines(diffText) : []

  if (lines.length === 0) {
    return (
      <div className="diff-empty">
        <p>No textual differences detected.</p>
      </div>
    )
  }

  return (
    <div className="diff-viewer-container">
      {conflictWarning && (
        <div className="diff-conflict-banner" role="alert">
          <span className="diff-conflict-badge">Semantic Conflict</span>
          <span>{conflictWarning}</span>
        </div>
      )}
      <div className="diff-table">
        {lines.map((line, idx) => (
          <div key={idx} className={`diff-row diff-row-${line.type}`}>
            <span className="diff-num old-num">{line.oldLineNumber ?? ''}</span>
            <span className="diff-num new-num">{line.newLineNumber ?? ''}</span>
            <span className="diff-sign">
              {line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' '}
            </span>
            <span className="diff-code">{line.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
