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
  liveQueryWindowMatches,
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

type RenderedWindowCollection = {
  client: DbClient | undefined
  dependencies: Array<unknown>
  collection: Collection<any, any, any>
  deferredCollections: Set<
    CollectionImplType<any, string | number, any, any, any>
  >
}

/**
 * Whether a recorded query identity matches the current one. Legacy deps
 * compare by reference. Derived identities and query keys compare by structure.
 */
function queryIdentityMatches(
  comparison: { changed: boolean; structurallyEqual: boolean },
  sameClient: boolean,
  usesLegacyDeps: boolean,
): boolean {
  return (
    sameClient &&
    (usesLegacyDeps ? !comparison.changed : comparison.structurallyEqual)
  )
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
  // Like useLiveQuery's instance memo, keep the window collection built by the
  // latest render. A second render before commit, such as a StrictMode double
  // render, reuses it instead of starting another one. Only the collection is
  // kept. Each render still builds its own controller and page count from the
  // committed state, which an uncommitted render never changes.
  const renderedCollectionRef = useRef<RenderedWindowCollection | null>(null)
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
    !queryIdentityMatches(dependencyComparison, sameClient, usesLegacyDeps)
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
    let startInRender = false
    let suppliedCollection = false

    const canPreservePageCount = shouldPreserveLiveQueryWindowPageCount({
      hasPreviousController: committed !== null,
      previousInputKind: committed?.inputKind,
      inputKind,
      sameCollection:
        inputIsCollection && committed?.inputCollection === queryFnOrCollection,
      dependenciesChanged,
      dependenciesStructurallyEqual,
      pageShapeChanged,
    })
    const previousPageCount = committed
      ? Math.max(1, committed.controller.getSnapshot().pages.length)
      : 1
    const initialPageCount = canPreservePageCount ? previousPageCount : 1
    // The peek-ahead window for every retained page.
    const requiredLimit = initialPageCount * pageSize + 1

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
      const rendered = renderedCollectionRef.current
      if (
        !inputIsCollection &&
        rendered !== null &&
        queryIdentityMatches(
          compareLiveQueryWindowDependencies(
            rendered.dependencies,
            identityDeps,
          ),
          rendered.client === dbClient,
          usesLegacyDeps,
        ) &&
        rendered.collection.status !== `cleaned-up` &&
        liveQueryWindowMatches(rendered.collection, requiredLimit)
      ) {
        // An earlier render built this collection and nothing has committed
        // since. Its window is exactly the retained pages, so its first
        // rows are correct. Sources it deferred still resume at commit.
        collection = rendered.collection
        for (const deferred of rendered.deferredCollections) {
          deferredCollections.add(deferred)
        }
      } else {
        const input = resolveLiveQueryWindowInput<TContext>(inputValue)
        if (input.kind === `collection`) {
          collection = input.collection
          suppliedCollection = true
          // A supplied collection is never reused, so release the last one.
          renderedCollectionRef.current = null
        } else {
          // Wrap the query with the peek-ahead window for every retained page,
          // so a collection that starts syncing now never publishes fewer rows
          // than the controller's pages. The controller grows the limit via
          // setWindow.
          collection = createLiveQueryCollection({
            query: input.query.limit(requiredLimit).offset(0),
            gcTime: DEFAULT_GC_TIME_MS,
          })
          startInRender = true
          renderedCollectionRef.current = {
            client: dbClient,
            dependencies: [...identityDeps],
            collection,
            deferredCollections,
          }
        }
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
    // Like useLiveQuery, start sync during render once the input is valid, so
    // a synchronously loaded source is published on the first commit instead
    // of an empty idle commit. GC reclaims a render that never commits. A
    // supplied window that the controller must still adjust waits for the
    // subscription.
    if (suppliedCollection) {
      startInRender = liveQueryWindowMatches(collection, requiredLimit)
    }
    if (startInRender) collection.startSyncImmediate()

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
    get state() {
      return snapshot.state as EnabledLiveQueryReturn<TContext>[`state`]
    },
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
