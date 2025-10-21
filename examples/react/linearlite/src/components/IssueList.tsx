import { useLiveQuery } from '@tanstack/react-db'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { IssueRow } from './IssueRow'
import { useMode } from '@/lib/mode-context'

export function IssueList() {
  const { issuesCollection } = useMode()
  const parentRef = useRef<HTMLDivElement>(null)

  const { data: issues, status } = useLiveQuery((q) =>
    q
      .from({ issue: issuesCollection })
      .orderBy(({ issue }) => issue.created_at, `desc`)
  )

  const virtualizer = useVirtualizer({
    count: issues?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
  })

  if (status === `loading`) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading issues...</div>
      </div>
    )
  }

  if (!issues || issues.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-gray-500 mb-2">No issues yet</p>
          <p className="text-sm text-gray-400">
            Create your first issue to get started
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: `100%`,
          position: `relative`,
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const issue = issues[virtualItem.index]
          return (
            <div
              key={issue.id}
              style={{
                position: `absolute`,
                top: 0,
                left: 0,
                width: `100%`,
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <IssueRow issue={issue} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
