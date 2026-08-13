import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  BaseQueryBuilder,
  CollectionImpl,
  createLiveQueryCollection,
  createLiveQueryWindowController,
  deepEquals,
} from '@tanstack/db'
import { useOptionalDbClient } from './DbProvider'
import {
  prepareDerivedQuery,
  prepareQueryValue,
  warnDeprecatedDepsArray,
  warnUnhashableDerivedIdentity,
} from './useLiveQuery'
import type {
  DerivedIdentityProfiler,
  LiveQueryKey,
  useLiveQuery,
} from './useLiveQuery'
import type {
  Collection,
  CollectionImpl as CollectionImplType,
  Context,
  DbClient,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryWindowController,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'

// Live queries created here are cleaned up immediately (0 disables GC).
const DEFAULT_GC_TIME_MS = 1
const unpreparedQueryValue = Symbol(`unpreparedQueryValue`)

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
  /**
   * Explicit identity for queries that contain opaque functional variants or
   * are hot enough that deriving identity from structured IR is too expensive.
   * Structured queries should omit this so DB can derive identity directly.
   */
  queryKey?: LiveQueryKey
  /** Override the nearest DbProvider for this query. */
  client?: DbClient
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
 * Create an infinite query using a query function with live updates.
 *
 * Uses `utils.setWindow()` to dynamically adjust the limit/offset window
 * without recreating the live query collection on each page change.
 *
 * @param queryFn - Query function that defines what data to fetch. Must include `.orderBy()` for setWindow to work.
 * @param config - Configuration including pageSize and getNextPageParam
 * @param deps - Deprecated array of dependencies that trigger query re-execution when changed
 * @returns Object with pages, data, and pagination controls
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
  deps?: Array<unknown>,
): UseLiveInfiniteQueryReturn<TContext> {
  const pageSize = config.pageSize || 20
  const initialPageParam = config.initialPageParam ?? 0
  const contextDbClient = useOptionalDbClient()
  const dbClient = config.client ?? contextDbClient

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
  const clientRef = useRef(dbClient)
  const pageSizeRef = useRef(pageSize)
  const initialPageParamRef = useRef(initialPageParam)
  const validatedCollectionRef = useRef<unknown>(null)
  const inputKind = isCollection ? `collection` : `query`
  const inputKindRef = useRef<typeof inputKind | null>(null)
  const previousInputKind = inputKindRef.current
  const derivedIdentityProfilerRef = useRef<DerivedIdentityProfiler>({
    renderCount: 0,
    totalMs: 0,
    maxMs: 0,
    warned: false,
  })
  const deferredCollectionsRef = useRef(
    new Set<CollectionImplType<any, string | number, any, any, any>>(),
  )
  const legacyUnhashableIdentityRef = useRef<Array<unknown>>([
    `legacy-unhashable`,
  ])

  let preparedQueryValue: unknown | typeof unpreparedQueryValue =
    unpreparedQueryValue
  let identityDeps: ReadonlyArray<unknown> = []

  if (!isCollection) {
    if (config.queryKey) {
      identityDeps = config.queryKey
    } else if (deps !== undefined) {
      identityDeps = deps
      warnDeprecatedDepsArray(`useLiveInfiniteQuery`)
    } else {
      const preparation = prepareDerivedQuery(
        queryFnOrCollection,
        dbClient,
        derivedIdentityProfilerRef.current,
        deferredCollectionsRef.current,
      )
      preparedQueryValue = preparation.value
      if (preparation.status === `hashable`) {
        identityDeps = preparation.identityDeps
      } else {
        warnUnhashableDerivedIdentity(preparation.error)
        identityDeps = legacyUnhashableIdentityRef.current
      }
    }
  }

  const usesLegacyDeps =
    !isCollection && config.queryKey === undefined && deps !== undefined
  const dependenciesChanged =
    !isCollection &&
    (clientRef.current !== dbClient ||
      depsRef.current === null ||
      (usesLegacyDeps
        ? depsRef.current.length !== identityDeps.length ||
          depsRef.current.some((dep, index) => dep !== identityDeps[index])
        : !deepEquals(depsRef.current, identityDeps)))
  const dependenciesStructurallyEqual =
    usesLegacyDeps &&
    clientRef.current === dbClient &&
    depsRef.current !== null &&
    deepEquals(depsRef.current, identityDeps)
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
      if (preparedQueryValue === unpreparedQueryValue) {
        preparedQueryValue = prepareQueryValue(
          queryFnOrCollection,
          dbClient,
          deferredCollectionsRef.current,
        )
      }
      if (!(preparedQueryValue instanceof BaseQueryBuilder)) {
        throw new Error(
          `useLiveInfiniteQuery: Query function must return a QueryBuilder.`,
        )
      }

      collectionRef.current = createLiveQueryCollection({
        query: preparedQueryValue.limit(pageSize + 1).offset(0),
        // Construction happens during render. Synchronization starts only when
        // useSyncExternalStore commits the controller subscription.
        startSync: false,
        gcTime: DEFAULT_GC_TIME_MS,
      })
      depsRef.current = [...identityDeps]
    }
    clientRef.current = dbClient
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
    (onStoreChange: () => void) => {
      const unsubscribe = controller.subscribe(onStoreChange)
      for (const collection of deferredCollectionsRef.current) {
        collection._resumeSyncStart()
      }
      deferredCollectionsRef.current.clear()
      return unsubscribe
    },
    [controller],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

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
