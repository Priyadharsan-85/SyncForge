interface SkeletonProps {
  width?: string
  height?: string
  borderRadius?: string
  className?: string
}

export function Skeleton({ width = '100%', height = '14px', borderRadius = '4px', className = '' }: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius, display: 'block' }}
      aria-hidden="true"
    />
  )
}

export function WorkspaceCardSkeleton() {
  return (
    <div className="workspace-card skeleton-card" aria-hidden="true">
      <span className="workspace-card-icon skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
      <span className="workspace-card-copy" style={{ flex: 1, gap: 6, display: 'flex', flexDirection: 'column' }}>
        <Skeleton width="55%" height="12px" />
        <Skeleton width="80%" height="10px" />
      </span>
    </div>
  )
}

export function FileSidebarSkeleton() {
  return (
    <div className="file-list" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="file-item skeleton-file">
          <Skeleton width={`${45 + (i % 3) * 20}%`} height="11px" borderRadius="3px" />
        </div>
      ))}
    </div>
  )
}
