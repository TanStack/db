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
  inputQuery: unknown
  client: DbClient | undefined
  identityMode: `collection` | `queryKey` | `legacyDeps` | `derived`
  dependencies: Array<unknown> | null
  pageSize: number
  initialPageParam: number
  collection: Collection<any, any, any>
  controller: LiveQueryWindowController<any, any>
  warning: string | null
  warned: boolean
  deferredCollections: Set<
    CollectionImplType<any, string | number, any, any, any>
  >
}

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
  const pageSize = normalizeLiveQueryWindowPageSize(config.pageSize)
  const initialPageParam = config.initialPageParam ?? 0
  const contextDbClient = useOptionalDbClient()
  const dbClient = config.client ?? contextDbClient

  const inputIsCollection =
    getLiveQueryWindowInputKind(queryFnOrCollection) === `collection`

  const committedRef = useRef<InfiniteQueryRenderState | null>(null)
  const committed = committedRef.current
  const inputKind = inputIsCollection ? `collection` : `query`
  const derivedIdentityProfilerRef = useRef<DerivedIdentityProfiler>({
    renderCount: 0,
    totalMs: 0,
    maxMs: 0,
    warned: false,
  })
  const legacyUnhashableIdentityRef = useRef<Array<unknown>>([
    `legacy-unhashable`,
  ])
  const deferredCollections = new Set<
    CollectionImplType<any, string | number, any, any, any>
  >()

  let preparedQueryValue: unknown | typeof unpreparedQueryValue =
    unpreparedQueryValue
  let identityDeps: ReadonlyArray<unknown> = []
  let identityMode: InfiniteQueryRenderState[`identityMode`] = `collection`

  if (!inputIsCollection) {
    if (config.queryKey !== undefined) {
      identityMode = `queryKey`
      identityDeps = config.queryKey
    } else if (deps !== undefined) {
      identityMode = `legacyDeps`
      identityDeps = deps
      warnDeprecatedDepsArray(`useLiveInfiniteQuery`)
    } else if (
      committed?.identityMode === `derived` &&
      committed.inputQuery === queryFnOrCollection &&
      committed.client === dbClient
    ) {
      identityMode = `derived`
      identityDeps = committed.dependencies ?? []
    } else {
      identityMode = `derived`
      const preparation = prepareDerivedQuery(
        queryFnOrCollection,
        dbClient,
        derivedIdentityProfilerRef.current,
        deferredCollections,
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
    !inputIsCollection && config.queryKey === undefined && deps !== undefined
  const dependencyComparison = compareLiveQueryWindowDependencies(
    committed?.dependencies,
    identityDeps,
  )
  const sameClient = committed?.client === dbClient
  const dependenciesChanged =
    !inputIsCollection &&
    (!sameClient ||
      (usesLegacyDeps
        ? dependencyComparison.changed
        : !dependencyComparison.structurallyEqual))
  const dependenciesStructurallyEqual =
    usesLegacyDeps && sameClient && dependencyComparison.structurallyEqual
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
      let inputValue = queryFnOrCollection
      if (!inputIsCollection) {
        if (preparedQueryValue === unpreparedQueryValue) {
          preparedQueryValue = prepareQueryValue(
            queryFnOrCollection,
            dbClient,
            deferredCollections,
          )
        }
        inputValue = () => preparedQueryValue
      }
      const input = resolveLiveQueryWindowInput<TContext>(inputValue)
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
      inputQuery: inputIsCollection ? null : queryFnOrCollection,
      client: dbClient,
      identityMode,
      dependencies: inputIsCollection ? null : [...identityDeps],
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
      deferredCollections,
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
      for (const collection of currentRenderState.deferredCollections) {
        collection._resumeSyncStart()
      }
      currentRenderState.deferredCollections.clear()
      return unsubscribe
    },
    [controller, currentRenderState],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

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
