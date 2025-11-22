import { useLiveInfiniteQuery, useLiveQuery } from '@tanstack/react-db'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearch } from '@tanstack/react-router'
import IssueRow from './IssueRow'
import { TopFilter } from './TopFilter'
import PriorityMenu from './contextmenu/PriorityMenu'
import StatusMenu from './contextmenu/StatusMenu'
import { useMode } from '@/lib/mode-context'
import { getFilterStateFromSearch } from '@/utils/filterState'
import {
  ISSUES_PAGE_SIZE,
  getIssueCountQuery,
  getIssuesListQuery,
} from '@/lib/queries'

export function IssueList() {
  const { issuesCollection, mode } = useMode()
  const parentRef = useRef<HTMLDivElement>(null)
  const search = useSearch({ strict: false })
  const filterState = useMemo(() => getFilterStateFromSearch(search), [search])
  const issuesQuery = useMemo(
    () => getIssuesListQuery(filterState, mode),
    [filterState, mode]
  )
  const issueCountQuery = useMemo(
    () => getIssueCountQuery(filterState),
    [filterState]
  )
  const { data: countData } = useLiveQuery(issueCountQuery)
  const totalCount = countData[0]?.count

  const {
    data: issues,
    status,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useLiveInfiniteQuery(issuesQuery, {
    pageSize: ISSUES_PAGE_SIZE,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length === ISSUES_PAGE_SIZE) {
        return allPages.length
      }
      return undefined
    },
  })

  // Memoize getScrollElement to avoid recreating virtualizer
  const getScrollElement = useCallback(() => parentRef.current, [])

  const virtualizer = useVirtualizer({
    count: totalCount ?? issues.length,
    getScrollElement,
    estimateSize: () => 36,
    overscan: 25,
  })

  // Reset virtualizer to top when filters change
  useEffect(() => {
    virtualizer.scrollToIndex(0, { align: `start` })
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
    if (virtualItems.length === 0) return

    const loadedCount = issues.length

    if (
      lastVirtualItem.index >= loadedCount - 5 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage()
    }
  }, [
    virtualItems.length,
    lastVirtualItem,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    issues.length,
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
      {/* Shared context menus (render once instead of per row to avoid portal bloat) */}
      <PriorityMenu issuesCollection={issuesCollection} />
      <StatusMenu issuesCollection={issuesCollection} />
    </>
  )
}
