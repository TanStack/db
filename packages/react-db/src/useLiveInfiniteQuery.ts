'use client'

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
  CollectionStatus,
  Context,
  DbClient,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryPersistedStatus,
  LiveQueryWindowController,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'

// Live queries created here are cleaned up immediately (0 disables GC).
const DEFAULT_GC_TIME_MS = 1
const unpreparedQueryValue = Symbol(`unpreparedQueryValue`)

// Keep the generic parameter for existing typed config wrappers.
export type UseLiveInfiniteQueryConfig<_TContext extends Context> = {
  /**
   * Explicit identity for queries that contain opaque functional variants or
   * are hot enough that deriving identity from structured IR is too expensive.
   * Structured queries should omit this so DB can derive identity directly.
   */
  queryKey?: LiveQueryKey
  /** Override the nearest DbProvider for this query. */
  client?: DbClient
  pageSize?: number
  /** First result-page label, not a server cursor or remote offset. */
  initialPageParam?: number
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

export type UseLiveInfiniteQueryReturnWithCollection<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> = {
  data: Array<TResult>
  state: Map<TKey, TResult>
  collection: Collection<TResult, TKey, TUtils> & NonSingleResult
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: true
  pages: Array<Array<TResult>>
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
 * @param config - Configuration including pageSize and an optional initial page label
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
): UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils>

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
  if (`getNextPageParam` in config) {
    throw new Error(
      `getNextPageParam is not supported by useLiveInfiniteQuery. Use an on-demand collection and fulfill meta.loadSubsetOptions in queryFn for server pagination.`,
    )
  }
  const pageSize = normalizeLiveQueryWindowPageSize(config.pageSize)
  const initialPageParam = config.initialPageParam ?? 0
  const contextDbClient = useOptionalDbClient()
  const dbClient = config.client ?? contextDbClient

  const inputIsCollection =
    getLiveQueryWindowInputKind(queryFnOrCollection) === `collection`

  const committedRef = useRef<InfiniteQueryRenderState | null>(null)
  const committed = committedRef.current
  // The previous render's state. A second pre-commit render (React StrictMode,
  // a discarded concurrent render, or a Suspense retry) reuses the collection
  // it already built instead of starting a duplicate sync. Unlike
  // `committedRef`, an abandoned render may update this; it only ever gates a
  // same-identity reuse, never page preservation.
  const renderedRef = useRef<InfiniteQueryRenderState | null>(null)
  const rendered = renderedRef.current
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

  // Reuse the previous render's collection when every identity input matches,
  // so a same-identity duplicate render shares its collection rather than
  // starting a second sync of the source. An uncommitted collection has no
  // subscriber, so GC can clean it up before a suspended update retries; a
  // cleaned-up collection must be rebuilt, not reused.
  const renderedComparison = compareLiveQueryWindowDependencies(
    rendered?.dependencies,
    identityDeps,
  )
  const canReuseRendered =
    rendered !== null &&
    rendered.collection.status !== `cleaned-up` &&
    rendered.inputKind === inputKind &&
    rendered.client === dbClient &&
    rendered.pageSize === pageSize &&
    rendered.initialPageParam === initialPageParam &&
    (inputIsCollection
      ? rendered.inputCollection === queryFnOrCollection
      : usesLegacyDeps
        ? !renderedComparison.changed
        : renderedComparison.structurallyEqual)

  let renderState = committed
  if (needsNewController && canReuseRendered) {
    // Built earlier this pre-commit render but not yet committed; reuse it.
    renderState = rendered
  } else if (needsNewController) {
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
          // Match useLiveQuery: start sync during render so a synchronously
          // loaded source is already published on the first commit, rather than
          // flashing an empty idle commit. Renders that never commit are
          // reclaimed by GC (gcTime), exactly as useLiveQuery relies on.
          startSync: true,
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
  // Record this render's state so a same-identity duplicate render reuses it.
  // Committed state is recorded separately, at subscribe, so an abandoned
  // render cannot overwrite the pages a committed render must preserve.
  renderedRef.current = currentRenderState

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
    persistedStatus: snapshot.persistedStatus,
    isPersistedReady: snapshot.isPersistedReady,
    persistedError: snapshot.persistedError,
    isIdle: snapshot.isIdle,
    isError: snapshot.isError,
    isCleanedUp: snapshot.isCleanedUp,
    collection:
      snapshot.collection as EnabledLiveQueryReturn<TContext>[`collection`],
    isEnabled: snapshot.isEnabled,
    pages: snapshot.pages as Array<Array<InferResultType<TContext>[number]>>,
    pageParams: snapshot.pageParams as Array<number>,
    fetchNextPage,
    hasNextPage: snapshot.hasNextPage,
    isFetchingNextPage: snapshot.isFetchingNextPage,
    error: snapshot.error,
  }
}
