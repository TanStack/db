import {
  useLiveInfiniteQuery,
  useLiveQuery,
  and,
  eq,
  inArray,
} from '@tanstack/react-db'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useEffect, useMemo, useCallback } from 'react'
import { useSearch } from '@tanstack/react-router'
import IssueRow from './IssueRow'
import { useMode } from '@/lib/mode-context'
import { getFilterStateFromSearch } from '@/utils/filterState'
import { TopFilter } from './TopFilter'
import { getIssueCountQuery } from '@/lib/queries'

const PAGE_SIZE = 50

export function IssueList() {
  const { issuesCollection } = useMode()
  const parentRef = useRef<HTMLDivElement>(null)
  const search = useSearch({ strict: false })
  const filterState = useMemo(() => getFilterStateFromSearch(search), [search])

  const issueCountQuery = getIssueCountQuery({
    status: filterState.status,
    priority: filterState.priority,
  })

  const { data: countData } = useLiveQuery(() => issueCountQuery, [search])

  const totalCount = countData?.[0]?.count

  const {
    data: issues,
    status,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    pages,
  } = useLiveInfiniteQuery(
    (q) => {
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
      const orderField =
        filterState.orderBy === 'created_at' ? 'created_at' : 'modified'
      return query.orderBy(
        ({ issue }) => issue[orderField],
        filterState.orderDirection
      )
    },
    {
      pageSize: PAGE_SIZE,
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
      getNextPageParam: (lastPage, allPages) => {
        // Continue fetching as long as the last page was full
        // This is the standard infinite scroll pattern
        if (lastPage.length === PAGE_SIZE) {
          return allPages.length // Return next page index
        }
        // If we got fewer items than pageSize, we've reached the end
        return undefined
      },
    },
    [search]
  )

  console.log(`render`, { issues })

  // Memoize getScrollElement to avoid recreating virtualizer
  const getScrollElement = useCallback(() => parentRef.current, [])

  const virtualizer = useVirtualizer({
    count: totalCount ?? issues.length,
    getScrollElement,
    estimateSize: () => 36,
    overscan: 50,
  })

  // Reset virtualizer to top when filters change
  useEffect(() => {
    virtualizer.scrollToIndex(0, { align: 'start' })
  }, [
    filterState.status,
    filterState.priority,
    filterState.orderBy,
    filterState.orderDirection,
  ])

  // Detect when user scrolls near bottom and load more
  // Memoize virtual items to avoid unnecessary re-renders
  const virtualItems = virtualizer.getVirtualItems()
  const lastVirtualItem = virtualItems[virtualItems.length - 1]

  useEffect(() => {
    if (!lastVirtualItem) return

    const loadedCount = issues.length

    if (
      lastVirtualItem.index >= loadedCount - 5 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage()
    }
  }, [
    lastVirtualItem,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    issues.length,
    totalCount,
    pages.length,
  ])

  if (status === `loading`) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading issues...</div>
      </div>
    )
  }

  if (status !== `loading` && issues.length === 0) {
    return (
      <>
        <TopFilter issueCount={totalCount} />
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <p className="text-gray-500 mb-2">No issues found</p>
            <p className="text-sm text-gray-400">Try adjusting your filters</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <TopFilter issueCount={totalCount} />
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: `100%`,
            position: `relative`,
          }}
        >
          {virtualItems.map((virtualItem) => {
            const issue = issues[virtualItem.index]

            // If issue hasn't loaded yet, render a loading skeleton

            if (!issue) {
              return (
                <div
                  key={`skeleton-${virtualItem.index}`}
                  style={{
                    position: `absolute`,
                    top: 0,
                    left: 0,
                    width: `100%`,
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="flex items-center px-4 h-9 border-b border-gray-200 animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  </div>
                </div>
              )
            }

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
          {isFetchingNextPage && (
            <div
              style={{
                position: `absolute`,
                top: `${virtualizer.getTotalSize()}px`,
                width: `100%`,
                padding: `16px`,
                textAlign: `center`,
              }}
            >
              <div className="text-gray-500 text-sm">Loading more...</div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
