import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  CollectionImpl,
  createLiveQueryCollection,
  createLiveQueryWindowController,
} from '@tanstack/db'
import type {
  Collection,
  Context,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryWindowController,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'

// Live queries created here are cleaned up immediately (0 disables GC).
const DEFAULT_GC_TIME_MS = 1

/** Type guard: does this collection expose `setWindow` (i.e. has an orderBy)? */
function hasSetWindow(collection: Collection<any, any, any>): boolean {
  return typeof (collection.utils)?.setWindow === `function`
}

export type UseLiveInfiniteQueryConfig<TContext extends Context> = {
  pageSize?: number
  initialPageParam?: number
  /**
   * @deprecated This callback is not used by the current implementation.
   * Pagination is determined internally via a peek-ahead strategy.
   * Provided for API compatibility with TanStack Query conventions.
   */
  getNextPageParam?: (
    lastPage: Array<InferResultType<TContext>[number]>,
    allPages: Array<Array<InferResultType<TContext>[number]>>,
    lastPageParam: number,
    allPageParams: Array<number>,
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
 *
 * @example
 * // Router loader pattern with pre-created collection
 * // In loader:
 * const postsQuery = createLiveQueryCollection({
 *   query: (q) => q
 *     .from({ posts: postsCollection })
 *     .orderBy(({ posts }) => posts.createdAt, 'desc')
 *     .limit(20)
 * })
 * await postsQuery.preload()
 * return { postsQuery }
 *
 * // In component:
 * const { postsQuery } = useLoaderData()
 * const { data, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
 *   postsQuery,
 *   {
 *     pageSize: 20,
 *     getNextPageParam: (lastPage) => lastPage.length === 20 ? lastPage.length : undefined
 *   }
 * )
 */

// Overload for pre-created collection (non-single result)
export function useLiveInfiniteQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult,
  config: UseLiveInfiniteQueryConfig<any>,
): UseLiveInfiniteQueryReturn<any>

// Overload for query function
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps?: Array<unknown>,
): UseLiveInfiniteQueryReturn<TContext>

// Implementation
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFnOrCollection: any,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps: Array<unknown> = [],
): UseLiveInfiniteQueryReturn<TContext> {
  const pageSize = config.pageSize || 20
  const initialPageParam = config.initialPageParam ?? 0

  // Detect if input is a collection or query function
  const isCollection = queryFnOrCollection instanceof CollectionImpl

  // Validate input type
  if (!isCollection && typeof queryFnOrCollection !== `function`) {
    throw new Error(
      `useLiveInfiniteQuery: First argument must be either a pre-created live query collection (CollectionImpl) ` +
        `or a query function. Received: ${typeof queryFnOrCollection}`,
    )
  }

  // Track deps for query functions (stringify for comparison)
  let depsKey: string
  try {
    depsKey = JSON.stringify(deps)
  } catch {
    throw new Error(
      `useLiveInfiniteQuery: dependency array contains values that cannot be serialized (e.g. circular references). ` +
        `Ensure all dependency values are JSON-serializable.`,
    )
  }

  const collectionRef = useRef<Collection<any, any, any> | null>(null)
  const controllerRef = useRef<LiveQueryWindowController<any, any> | null>(null)
  const configRef = useRef<unknown>(null)
  const depsRef = useRef<string | null>(null)

  // Recreate the underlying collection + controller when the input identity
  // (pre-created collection) or the deps (query function) change. A fresh
  // controller starts back at page 1, which is the desired reset behaviour.
  const needsNew =
    !controllerRef.current ||
    (isCollection && configRef.current !== queryFnOrCollection) ||
    (!isCollection && depsRef.current !== depsKey)

  if (needsNew) {
    if (isCollection) {
      const collection = queryFnOrCollection as Collection<any, any, any>
      if (!hasSetWindow(collection)) {
        throw new Error(
          `useLiveInfiniteQuery: Pre-created live query collection must have an orderBy clause for infinite pagination to work. ` +
            `Please add .orderBy() to your createLiveQueryCollection query.`,
        )
      }
      collection.startSyncImmediate()
      collectionRef.current = collection
      configRef.current = queryFnOrCollection
    } else {
      // Wrap the query with the first page's peek-ahead window; the controller
      // grows the limit from here via setWindow.
      collectionRef.current = createLiveQueryCollection({
        query: (q: InitialQueryBuilder) =>
          queryFnOrCollection(q)
            .limit(pageSize + 1)
            .offset(0),
        startSync: true,
        gcTime: DEFAULT_GC_TIME_MS,
      })
      depsRef.current = depsKey
    }
    controllerRef.current = createLiveQueryWindowController(
      collectionRef.current,
      {
        pageSize,
        initialPageParam,
        // useSyncExternalStore must not be notified synchronously on subscribe.
        deferInitialNotify: true,
        // A query-function collection already carries page 1's window in its
        // query, so defer the (redundant) first apply until it is ready; a
        // pre-created collection needs its window established up front.
        waitForReady: !isCollection,
      },
    )
  }
  const controller = controllerRef.current!

  // Stable subscribe bound to the current controller.
  const subscribeRef = useRef<((onStoreChange: () => void) => () => void) | null>(
    null,
  )
  if (!subscribeRef.current || needsNew) {
    subscribeRef.current = (onStoreChange) => controller.subscribe(onStoreChange)
  }

  const snapshot = useSyncExternalStore(subscribeRef.current, () =>
    controller.getSnapshot(),
  )

  const fetchNextPage = useCallback(() => {
    controllerRef.current?.fetchNextPage()
  }, [])

  return {
    data: snapshot.data as InferResultType<TContext>,
    state: snapshot.state,
    status: snapshot.status,
    isLoading: snapshot.isLoading,
    isReady: snapshot.isReady,
    isIdle: snapshot.isIdle,
    isError: snapshot.isError,
    isCleanedUp: snapshot.isCleanedUp,
    collection: snapshot.collection,
    isEnabled: snapshot.isEnabled,
    pages: snapshot.pages as Array<Array<InferResultType<TContext>[number]>>,
    pageParams: snapshot.pageParams as Array<number>,
    fetchNextPage,
    hasNextPage: snapshot.hasNextPage,
    isFetchingNextPage: snapshot.isFetchingNextPage,
  } as UseLiveInfiniteQueryReturn<TContext>
}
