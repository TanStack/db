import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  CollectionImpl,
  createLiveQueryCollection,
  createLiveQueryWindowController,
  deepEquals,
} from '@tanstack/db'
// Type-only: used in `ReturnType<typeof useLiveQuery>` in UseLiveInfiniteQueryReturn.
import type { useLiveQuery } from './useLiveQuery'
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

type WindowedCollection = Collection<any, any, any> & {
  utils: {
    setWindow: (options: {
      offset: number
      limit: number
    }) => true | Promise<void>
  }
}

/** Type guard: does this collection expose `setWindow` (i.e. has an orderBy)? */
function hasSetWindow(
  collection: Collection<any, any, any>,
): collection is WindowedCollection {
  return typeof collection.utils?.setWindow === `function`
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
  error: unknown
}

type EnabledLiveQueryReturn<TContext extends Context> = ReturnType<
  typeof useLiveQuery<TContext>
>

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

  const collectionRef = useRef<Collection<any, any, any> | null>(null)
  const controllerRef = useRef<LiveQueryWindowController<any, any> | null>(null)
  const configRef = useRef<unknown>(null)
  const depsRef = useRef<Array<unknown> | null>(null)
  const pageSizeRef = useRef(pageSize)
  const initialPageParamRef = useRef(initialPageParam)
  const validatedCollectionRef = useRef<unknown>(null)
  const inputKind = isCollection ? `collection` : `query`
  const inputKindRef = useRef<typeof inputKind | null>(null)
  const previousInputKind = inputKindRef.current

  const dependenciesChanged =
    !isCollection &&
    (depsRef.current === null ||
      depsRef.current.length !== deps.length ||
      depsRef.current.some((dep, index) => dep !== deps[index]))
  const dependenciesStructurallyEqual =
    !isCollection &&
    depsRef.current !== null &&
    deepEquals(depsRef.current, deps)
  const needsNewCollection =
    !collectionRef.current ||
    inputKindRef.current !== inputKind ||
    (isCollection && configRef.current !== queryFnOrCollection) ||
    dependenciesChanged
  const pageShapeChanged =
    pageSizeRef.current !== pageSize ||
    initialPageParamRef.current !== initialPageParam
  const needsNewController =
    !controllerRef.current || needsNewCollection || pageShapeChanged

  if (needsNewCollection) {
    inputKindRef.current = inputKind
    if (isCollection) {
      const collection = queryFnOrCollection as Collection<any, any, any>
      if (!hasSetWindow(collection)) {
        throw new Error(
          `useLiveInfiniteQuery: Pre-created live query collection must have an orderBy clause for infinite pagination to work. ` +
            `Please add .orderBy() to your createLiveQueryCollection query.`,
        )
      }
      // Warn once per collection instance if its current window doesn't match
      // the first page the hook is about to enforce.
      if (validatedCollectionRef.current !== collection) {
        validatedCollectionRef.current = collection
        const currentWindow = collection.utils.getWindow?.()
        if (
          currentWindow &&
          (currentWindow.offset !== 0 || currentWindow.limit !== pageSize + 1)
        ) {
          console.warn(
            `useLiveInfiniteQuery: Pre-created collection has window {offset: ${currentWindow.offset}, limit: ${currentWindow.limit}} ` +
              `but the hook expects {offset: 0, limit: ${pageSize + 1}}. Adjusting window now.`,
          )
        }
      }
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
        // Construction happens during render. Synchronization starts only when
        // useSyncExternalStore commits the controller subscription.
        startSync: false,
        gcTime: DEFAULT_GC_TIME_MS,
      })
      depsRef.current = [...deps]
    }
  }

  if (needsNewController) {
    const previousController = controllerRef.current
    const canPreservePageCount =
      previousController !== null &&
      (!needsNewCollection ||
        (previousInputKind === `query` && dependenciesStructurallyEqual))
    const initialPageCount = canPreservePageCount
      ? Math.max(1, previousController.getSnapshot().pages.length)
      : 1
    pageSizeRef.current = pageSize
    initialPageParamRef.current = initialPageParam
    controllerRef.current = createLiveQueryWindowController(
      collectionRef.current,
      {
        pageSize,
        initialPageParam,
        initialPageCount,
      },
    )
  }
  const controller = controllerRef.current!

  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.subscribe(onStoreChange),
    [controller],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const fetchNextPage = useCallback(() => {
    void controller.fetchNextPage().catch(() => {
      // Pagination errors are exposed through the controller snapshot. The
      // hook's void callback has no promise error channel, so consume it here.
    })
  }, [controller])

  return {
    data: snapshot.data as InferResultType<TContext>,
    state: snapshot.state as EnabledLiveQueryReturn<TContext>[`state`],
    status: snapshot.status as EnabledLiveQueryReturn<TContext>[`status`],
    isLoading: snapshot.isLoading,
    isReady: snapshot.isReady,
    isIdle: snapshot.isIdle,
    isError: snapshot.isError,
    isCleanedUp: snapshot.isCleanedUp,
    collection:
      snapshot.collection as EnabledLiveQueryReturn<TContext>[`collection`],
    isEnabled:
      snapshot.isEnabled as EnabledLiveQueryReturn<TContext>[`isEnabled`],
    pages: snapshot.pages as Array<Array<InferResultType<TContext>[number]>>,
    pageParams: snapshot.pageParams as Array<number>,
    fetchNextPage,
    hasNextPage: snapshot.hasNextPage,
    isFetchingNextPage: snapshot.isFetchingNextPage,
    error: snapshot.error,
  }
}
