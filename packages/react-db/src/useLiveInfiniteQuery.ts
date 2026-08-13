import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  assertLiveQueryWindowManyResult,
  compareLiveQueryWindowDependencies,
  createLiveQueryCollection,
  createLiveQueryWindowController,
  fetchNextLiveQueryWindowPage,
  getLiveQueryWindowCollectionWarning,
  getLiveQueryWindowInputKind,
  normalizeLiveQueryWindowPageSize,
  resolveLiveQueryWindowInput,
  shouldPreserveLiveQueryWindowPageCount,
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
  fetchNextPage: () => Promise<void>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  error: unknown
}

type EnabledLiveQueryReturn<TContext extends Context> = ReturnType<
  typeof useLiveQuery<TContext>
>

type InfiniteQueryRenderState = {
  inputKind: `collection` | `query`
  inputCollection: Collection<any, any, any> | null
  dependencies: Array<unknown> | null
  pageSize: number
  initialPageParam: number
  collection: Collection<any, any, any>
  controller: LiveQueryWindowController<any, any>
  warning: string | null
  warned: boolean
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
  const pageSize = normalizeLiveQueryWindowPageSize(config.pageSize)
  const initialPageParam = config.initialPageParam ?? 0

  const inputIsCollection =
    getLiveQueryWindowInputKind(queryFnOrCollection) === `collection`

  const committedRef = useRef<InfiniteQueryRenderState | null>(null)
  const committed = committedRef.current
  const inputKind = inputIsCollection ? `collection` : `query`

  const dependencyComparison = compareLiveQueryWindowDependencies(
    committed?.dependencies,
    deps,
  )
  const dependenciesChanged = !inputIsCollection && dependencyComparison.changed
  const dependenciesStructurallyEqual =
    !inputIsCollection && dependencyComparison.structurallyEqual
  const needsNewCollection =
    committed === null ||
    committed.inputKind !== inputKind ||
    (inputIsCollection && committed.inputCollection !== queryFnOrCollection) ||
    dependenciesChanged
  const pageShapeChanged =
    committed === null ||
    committed.pageSize !== pageSize ||
    committed.initialPageParam !== initialPageParam
  const needsNewController =
    committed === null || needsNewCollection || pageShapeChanged

  let renderState = committed
  if (needsNewController) {
    let collection = committed?.collection
    let warning: string | null = null

    if (needsNewCollection) {
      const input = resolveLiveQueryWindowInput<TContext>(queryFnOrCollection)
      if (input.kind === `collection`) {
        collection = input.collection
      } else {
        // Wrap the query with the first page's peek-ahead window; the controller
        // grows the limit from here via setWindow.
        collection = createLiveQueryCollection({
          query: input.query.limit(pageSize + 1).offset(0),
          // Construction happens during render. Synchronization starts only when
          // useSyncExternalStore commits the controller subscription.
          startSync: false,
          gcTime: DEFAULT_GC_TIME_MS,
        })
      }
    }

    if (!collection) {
      throw new Error(`useLiveInfiniteQuery: Failed to create a collection.`)
    }

    if (inputIsCollection) {
      warning =
        getLiveQueryWindowCollectionWarning(collection, pageSize + 1) ?? null
    } else {
      assertLiveQueryWindowManyResult(collection)
    }

    const canPreservePageCount = shouldPreserveLiveQueryWindowPageCount({
      hasPreviousController: committed !== null,
      previousInputKind: committed?.inputKind,
      inputKind,
      sameCollection:
        inputIsCollection && committed?.inputCollection === collection,
      dependenciesChanged,
      dependenciesStructurallyEqual,
      pageShapeChanged,
    })
    const previousPageCount = committed
      ? Math.max(1, committed.controller.getSnapshot().pages.length)
      : 1
    const initialPageCount = canPreservePageCount ? previousPageCount : 1
    renderState = {
      inputKind,
      inputCollection: inputIsCollection ? collection : null,
      dependencies: inputIsCollection ? null : [...deps],
      pageSize,
      initialPageParam,
      collection,
      controller: createLiveQueryWindowController(collection, {
        pageSize,
        initialPageParam,
        initialPageCount,
      }),
      warning,
      warned: false,
    }
  }
  const currentRenderState = renderState!
  const controller = currentRenderState.controller

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = controller.subscribe(onStoreChange)
      committedRef.current = currentRenderState
      if (currentRenderState.warning && !currentRenderState.warned) {
        currentRenderState.warned = true
        console.warn(currentRenderState.warning)
      }
      return unsubscribe
    },
    [controller, currentRenderState],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const fetchNextPage = useCallback(
    () => fetchNextLiveQueryWindowPage(controller),
    [controller],
  )

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
