import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLiveQuery } from "./useLiveQuery"
import type {
  Context,
  InferResultType,
  InitialQueryBuilder,
  QueryBuilder,
} from "@tanstack/db"

export type UseLiveInfiniteQueryConfig<TContext extends Context> = {
  pageSize?: number
  initialPageParam?: number
  getNextPageParam: (
    lastPage: Array<InferResultType<TContext>[number]>,
    allPages: Array<Array<InferResultType<TContext>[number]>>,
    lastPageParam: number,
    allPageParams: Array<number>
  ) => number | undefined
}

export type UseLiveInfiniteQueryReturn<TContext extends Context> = {
  data: InferResultType<TContext>
  pages: Array<Array<InferResultType<TContext>[number]>>
  pageParams: Array<number>
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  // From useLiveQuery
  state: ReturnType<typeof useLiveQuery<TContext>>[`state`]
  collection: ReturnType<typeof useLiveQuery<TContext>>[`collection`]
  status: ReturnType<typeof useLiveQuery<TContext>>[`status`]
  isLoading: ReturnType<typeof useLiveQuery<TContext>>[`isLoading`]
  isReady: ReturnType<typeof useLiveQuery<TContext>>[`isReady`]
  isIdle: ReturnType<typeof useLiveQuery<TContext>>[`isIdle`]
  isError: ReturnType<typeof useLiveQuery<TContext>>[`isError`]
  isCleanedUp: ReturnType<typeof useLiveQuery<TContext>>[`isCleanedUp`]
  isEnabled: ReturnType<typeof useLiveQuery<TContext>>[`isEnabled`]
}

/**
 * Create an infinite query using a query function with live updates
 *
 * Phase 1 implementation: Operates within the collection's current dataset.
 * Fetching "next page" loads more data from the collection, not from a backend.
 *
 * @param queryFn - Query function that defines what data to fetch
 * @param config - Configuration including pageSize and getNextPageParam
 * @param deps - Array of dependencies that trigger query re-execution when changed
 * @returns Object with pages, data, and pagination controls
 *
 * @example
 * // Basic infinite query
 * const { data, pages, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
 *   (q) => q
 *     .from({ posts: postsCollection })
 *     .orderBy(({ posts }) => posts.createdAt, 'desc')
 *     .select(({ posts }) => ({
 *       id: posts.id,
 *       title: posts.title
 *     })),
 *   {
 *     pageSize: 20,
 *     getNextPageParam: (lastPage, allPages) =>
 *       lastPage.length === 20 ? allPages.length : undefined
 *   }
 * )
 *
 * @example
 * // With dependencies
 * const { pages, fetchNextPage } = useLiveInfiniteQuery(
 *   (q) => q
 *     .from({ posts: postsCollection })
 *     .where(({ posts }) => eq(posts.category, category))
 *     .orderBy(({ posts }) => posts.createdAt, 'desc'),
 *   {
 *     pageSize: 10,
 *     getNextPageParam: (lastPage) =>
 *       lastPage.length === 10 ? lastPage.length : undefined
 *   },
 *   [category]
 * )
 */
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps: Array<unknown> = []
): UseLiveInfiniteQueryReturn<TContext> {
  const pageSize = config.pageSize || 20
  const initialPageParam = config.initialPageParam ?? 0

  // Track how many pages have been loaded
  const [loadedPageCount, setLoadedPageCount] = useState(1)
  const isFetchingRef = useRef(false)

  // Stringify deps for comparison
  const depsKey = JSON.stringify(deps)
  const prevDepsKeyRef = useRef(depsKey)

  // Reset page count when dependencies change
  useEffect(() => {
    if (prevDepsKeyRef.current !== depsKey) {
      setLoadedPageCount(1)
      prevDepsKeyRef.current = depsKey
    }
  }, [depsKey])

  // Create a live query without limit - fetch all matching data
  // Phase 1: Client-side slicing is acceptable
  // Phase 2: Will add limit optimization with dynamic adjustment
  const queryResult = useLiveQuery((q) => queryFn(q), deps)

  // Split the flat data array into pages
  const pages = useMemo(() => {
    const result: Array<Array<InferResultType<TContext>[number]>> = []
    const dataArray = queryResult.data as InferResultType<TContext>

    for (let i = 0; i < loadedPageCount; i++) {
      const pageData = dataArray.slice(i * pageSize, (i + 1) * pageSize)
      result.push(pageData)
    }

    return result
  }, [queryResult.data, loadedPageCount, pageSize])

  // Track page params used (for TanStack Query API compatibility)
  const pageParams = useMemo(() => {
    const params: Array<number> = []
    for (let i = 0; i < pages.length; i++) {
      params.push(initialPageParam + i)
    }
    return params
  }, [pages.length, initialPageParam])

  // Determine if there are more pages available
  const hasNextPage = useMemo(() => {
    if (pages.length === 0) return false

    const lastPage = pages[pages.length - 1]
    const lastPageParam = pageParams[pageParams.length - 1]

    // Ensure lastPage and lastPageParam are defined before calling getNextPageParam
    if (!lastPage || lastPageParam === undefined) return false

    // Call user's getNextPageParam to determine if there's more
    const nextParam = config.getNextPageParam(
      lastPage,
      pages,
      lastPageParam,
      pageParams
    )

    return nextParam !== undefined
  }, [pages, pageParams, config])

  // Fetch next page
  const fetchNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingRef.current) return

    isFetchingRef.current = true
    setLoadedPageCount((prev) => prev + 1)

    // Reset fetching state synchronously
    Promise.resolve().then(() => {
      isFetchingRef.current = false
    })
  }, [hasNextPage])

  // Calculate flattened data from pages
  const flatData = useMemo(() => {
    const result: Array<InferResultType<TContext>[number]> = []
    for (const page of pages) {
      result.push(...page)
    }
    return result as InferResultType<TContext>
  }, [pages])

  return {
    data: flatData,
    pages,
    pageParams,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: isFetchingRef.current,
    // Pass through useLiveQuery properties
    state: queryResult.state,
    collection: queryResult.collection,
    status: queryResult.status,
    isLoading: queryResult.isLoading,
    isReady: queryResult.isReady,
    isIdle: queryResult.isIdle,
    isError: queryResult.isError,
    isCleanedUp: queryResult.isCleanedUp,
    isEnabled: queryResult.isEnabled,
  }
}
