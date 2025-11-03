import { useLiveQuery, or, and, eq, inArray } from '@tanstack/react-db'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { useSearch } from '@tanstack/react-router'
import IssueRow from './IssueRow'
import { useMode } from '@/lib/mode-context'
import { getFilterStateFromSearch } from '@/utils/filterState'

export function IssueList() {
  const { issuesCollection } = useMode()
  const parentRef = useRef<HTMLDivElement>(null)
  const search = useSearch({ strict: false })
  const filterState = getFilterStateFromSearch(search)

  const { data: issues, status } = useLiveQuery((q) => {
    let query = q.from({ issue: issuesCollection })

    // Apply filters using declarative expressions
    if (filterState.status?.length || filterState.priority?.length) {
      query = query.where(({ issue }) => {
        const conditions = []

        if (filterState.status?.length) {
          // Use inArray for multiple values or eq for single value
          if (filterState.status.length === 1) {
            conditions.push(eq(issue.status, filterState.status[0]))
          } else {
            conditions.push(inArray(issue.status, filterState.status))
          }
        }

        if (filterState.priority?.length) {
          // Use inArray for multiple values or eq for single value
          if (filterState.priority.length === 1) {
            conditions.push(eq(issue.priority, filterState.priority[0]))
          } else {
            conditions.push(inArray(issue.priority, filterState.priority))
          }
        }

        return conditions.length === 1 ? conditions[0] : and(...conditions)
      })
    }

    // Apply ordering
    const orderField = filterState.orderBy === 'created_at' ? 'created_at' : 'modified'
    return query.orderBy(({ issue }) => issue[orderField], filterState.orderDirection)
  })

  const virtualizer = useVirtualizer({
    count: issues?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
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
            <IssueRow
              key={issue.id}
              issue={issue}
              style={{
                position: `absolute`,
                top: 0,
                left: 0,
                width: `100%`,
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
