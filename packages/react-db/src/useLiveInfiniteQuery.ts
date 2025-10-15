import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLiveQuery } from "./useLiveQuery"
import type {
  Context,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionUtils,
  QueryBuilder,
} from "@tanstack/db"

/**
 * Type guard to check if utils object has setWindow method (LiveQueryCollectionUtils)
 */
function isLiveQueryCollectionUtils(
  utils: unknown
): utils is LiveQueryCollectionUtils {
  return typeof (utils as any).setWindow === `function`
}

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

export type UseLiveInfiniteQueryReturn<TContext extends Context> = Omit<
  ReturnType<typeof useLiveQuery<TContext>>,
  `data`
> & {
  data: InferResultType<TContext>
  pages: Array<Array<InferResultType<TContext>[number]>>
  pageParams: Array<number>
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
}

/**
 * Create an infinite query using a query function with live updates
 *
 * Uses `utils.setWindow()` to dynamically adjust the limit/offset window
 * without recreating the live query collection on each page change.
 *
 * @param queryFn - Query function that defines what data to fetch. Must include `.orderBy()` for setWindow to work.
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

  // Create a live query with initial limit and offset
  // The query function is wrapped to add limit/offset to the query
  const queryResult = useLiveQuery(
    (q) => queryFn(q).limit(pageSize).offset(0),
    deps
  )

  // Update the window when loadedPageCount changes
  // We fetch one extra item to peek if there's a next page
  useEffect(() => {
    const newLimit = loadedPageCount * pageSize + 1 // +1 to peek ahead
    const utils = queryResult.collection.utils
    // setWindow is available on live query collections with orderBy
    if (isLiveQueryCollectionUtils(utils)) {
      utils.setWindow({ offset: 0, limit: newLimit })
    }
  }, [loadedPageCount, pageSize, queryResult.collection])

  // Split the data array into pages and determine if there's a next page
  const { pages, pageParams, hasNextPage, flatData } = useMemo(() => {
    const dataArray = queryResult.data as InferResultType<TContext>
    const totalItemsRequested = loadedPageCount * pageSize

    // Check if we have more data than requested (the peek ahead item)
    const hasMore = dataArray.length > totalItemsRequested

    // Build pages array (without the peek ahead item)
    const pagesResult: Array<Array<InferResultType<TContext>[number]>> = []
    const pageParamsResult: Array<number> = []

    for (let i = 0; i < loadedPageCount; i++) {
      const pageData = dataArray.slice(i * pageSize, (i + 1) * pageSize)
      pagesResult.push(pageData)
      pageParamsResult.push(initialPageParam + i)
    }

    // Flatten the pages for the data return (without peek ahead item)
    const flatDataResult = dataArray.slice(
      0,
      totalItemsRequested
    ) as InferResultType<TContext>

    return {
      pages: pagesResult,
      pageParams: pageParamsResult,
      hasNextPage: hasMore,
      flatData: flatDataResult,
    }
  }, [queryResult.data, loadedPageCount, pageSize, initialPageParam])

  // Fetch next page
  // TODO: this should use the `collection.isLoadingSubset` flag in combination with
  // isFetchingRef to track if it is fetching from subset for this. This needs adding
  // once https://github.com/TanStack/db/pull/669 is merged
  const fetchNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingRef.current) return

    isFetchingRef.current = true
    setLoadedPageCount((prev) => prev + 1)

    // Reset fetching state synchronously
    Promise.resolve().then(() => {
      isFetchingRef.current = false
    })
  }, [hasNextPage])

  return {
    ...queryResult,
    data: flatData,
    pages,
    pageParams,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: isFetchingRef.current,
  }
}
