'use client'

import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  bindLiveQueryWindow,
  createLiveQuerySourceIdClaims,
  fetchNextLiveQueryWindowPage,
  getLiveQueryKey,
  identifyLiveQuery,
  isCollection,
  readLiveQueryWindowPageShape,
  rejectLiveQueryInput,
  releaseDeferredOnReclaim,
  resumeDeferredLiveQueryCollections,
} from '@tanstack/db'
import { useOptionalDbClient } from './DbProvider'
import {
  getIdentityScope,
  prepareDerivedQuery,
  prepareQueryValue,
  warnDeprecatedDepsArray,
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
  LiveQuerySourceIdClaims,
  LiveQueryWindowBinding,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'

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

/** One render's window binding and what its commit still owes. */
type InfiniteQueryRender = {
  binding: LiveQueryWindowBinding
  /** The query callback whose identity this render derived, if any. */
  derivedQuery: unknown
  deferredCollections: Set<
    CollectionImplType<any, string | number, any, any, any>
  >
  /** Drops the reclaim release when this render commits. */
  cancelReclaimRelease: (() => void) | undefined
  warned: boolean
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
  const pageShape = readLiveQueryWindowPageShape(config)
  const contextDbClient = useOptionalDbClient()
  const dbClient = config.client ?? contextDbClient
  const inputIsCollection = isCollection(queryFnOrCollection)

  const committedRef = useRef<InfiniteQueryRender | null>(null)
  const committed = committedRef.current
  // Like useLiveQuery's instance memo, keep the latest render whose binding
  // built a window collection. A second render before commit, such as a
  // StrictMode double render, reuses that collection instead of starting
  // another. Each render still builds its own controller and page count from
  // the committed binding, which an uncommitted render never changes.
  const renderedRef = useRef<InfiniteQueryRender | null>(null)
  const sourceIdsRef = useRef<LiveQuerySourceIdClaims | null>(null)
  const derivedIdentityProfilerRef = useRef<DerivedIdentityProfiler>({
    renderCount: 0,
    totalMs: 0,
    maxMs: 0,
    warned: false,
  })
  const deferredCollections = new Set<
    CollectionImplType<any, string | number, any, any, any>
  >()
  const identityScope = () =>
    getIdentityScope(
      (sourceIdsRef.current ??= createLiveQuerySourceIdClaims()),
      dbClient,
      `useLiveInfiniteQuery`,
    )

  const queryKey = getLiveQueryKey(config)
  const usesLegacyDeps =
    !inputIsCollection && queryKey === undefined && deps !== undefined
  let preparedQueryValue: unknown | typeof unpreparedQueryValue =
    unpreparedQueryValue
  let dependencies: ReadonlyArray<unknown> | undefined
  let derivedQuery: unknown = undefined

  const rendered = renderedRef.current
  let binding: LiveQueryWindowBinding
  // The render boundary: a render that throws anywhere after preparation,
  // such as an unhashable, single-result, or uncompilable query, never
  // commits, so it releases the sync starts it deferred here.
  try {
    if (!inputIsCollection) {
      if (queryKey !== undefined) {
        dependencies = queryKey
      } else if (usesLegacyDeps) {
        dependencies = deps
        warnDeprecatedDepsArray(`useLiveInfiniteQuery`)
      } else if (
        committed !== null &&
        committed.derivedQuery === queryFnOrCollection &&
        committed.binding.scope === dbClient
      ) {
        // The same callback in the same client scope keeps its identity.
        derivedQuery = queryFnOrCollection
        dependencies = committed.binding.dependencies
      } else {
        const preparation = prepareDerivedQuery(
          queryFnOrCollection,
          derivedIdentityProfilerRef.current,
          identityScope(),
          deferredCollections,
        )
        preparedQueryValue = preparation.value
        derivedQuery = queryFnOrCollection
        dependencies = preparation.identityDeps
      }
    }

    // The binding calls this only when it compiles a new window collection.
    const compileQuery = () => {
      if (preparedQueryValue === unpreparedQueryValue) {
        preparedQueryValue = prepareQueryValue(
          queryFnOrCollection,
          dbClient,
          deferredCollections,
        )
        if (usesLegacyDeps) {
          // A dependency list decides reuse, so check the query when it
          // compiles: it needs a stable identity and keeps its sources' IDs.
          identifyLiveQuery(preparedQueryValue, identityScope())
        }
      }
      return preparedQueryValue
    }

    binding = bindLiveQueryWindow(
      committed?.binding ?? null,
      {
        ...pageShape,
        input:
          typeof queryFnOrCollection === `function`
            ? compileQuery
            : queryFnOrCollection,
        dependencies,
        scope: dbClient,
        client: dbClient,
        queryKey,
        recompile: usesLegacyDeps ? `dependencies` : `identity`,
      },
      rendered?.binding,
    )
  } catch (error) {
    rejectLiveQueryInput(deferredCollections, error)
  }

  let currentRenderState = committed
  if (binding !== committed?.binding) {
    const newCollection = binding.collection !== committed?.binding.collection
    if (newCollection && binding.collection === rendered?.binding.collection) {
      // Sources the earlier render deferred still resume at this commit.
      for (const deferred of rendered.deferredCollections) {
        deferredCollections.add(deferred)
      }
    }
    const reusesRendered =
      newCollection && binding.collection === rendered?.binding.collection
    currentRenderState = {
      binding,
      derivedQuery,
      deferredCollections,
      // A render that never commits releases its deferred sync starts when
      // garbage collection reclaims the window collection it built. A reused
      // collection keeps the release its first render registered.
      cancelReclaimRelease: reusesRendered
        ? rendered.cancelReclaimRelease
        : newCollection && binding.ownsCollection
          ? releaseDeferredOnReclaim(binding.collection, deferredCollections)
          : undefined,
      warned: false,
    }
    // Keep a created collection for the next render only once it validated
    // and started, so a retry after a startup error builds a new one.
    if (binding.supplied) renderedRef.current = null
    else if (newCollection && binding.ownsCollection) {
      renderedRef.current = currentRenderState
    }
  }
  const renderState = currentRenderState!
  const controller = renderState.binding.controller

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = controller.subscribe(onStoreChange)
      committedRef.current = renderState
      if (renderState.binding.warning && !renderState.warned) {
        renderState.warned = true
        console.warn(renderState.binding.warning)
      }
      // A commit releases the starts itself, so it drops the reclaim release.
      renderState.cancelReclaimRelease?.()
      resumeDeferredLiveQueryCollections(renderState.deferredCollections)
      return unsubscribe
    },
    [controller, renderState],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () =>
    controller.getServerSnapshot(),
  )

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
