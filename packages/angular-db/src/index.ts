import {
  DestroyRef,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core'
import {
  BaseQueryBuilder,
  createLiveQueryCollection,
  createLiveQueryObserver,
  getPublicCollection,
  isCollection,
  isSingleResultCollection,
  resolveLiveQueryValue,
} from '@tanstack/db'
import type {
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  LiveQueryObserver,
  LiveQueryPersistedStatus,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'
import type { Signal } from '@angular/core'

export * from '@tanstack/db'

/**
 * The result of calling `injectLiveQuery`.
 * Contains reactive signals for the query state and data.
 */
export interface InjectLiveQueryResult<TContext extends Context> {
  /** A signal containing the complete state map of results keyed by their ID */
  state: Signal<Map<string | number, GetResult<TContext>>>
  /** A signal containing the results as an array, or single result for findOne queries */
  data: Signal<InferResultType<TContext>>
  /** A signal containing the underlying collection instance (null for disabled queries) */
  collection: Signal<Collection<
    GetResult<TContext>,
    string | number,
    {}
  > | null>
  /** A signal containing the current status of the collection */
  status: Signal<CollectionStatus | `disabled`>
  /** A signal indicating whether the collection is currently loading */
  isLoading: Signal<boolean>
  /** A signal indicating whether the collection is ready */
  isReady: Signal<boolean>
  persistedStatus: Signal<LiveQueryPersistedStatus>
  isPersistedReady: Signal<boolean>
  persistedError: Signal<unknown | undefined>
  /** A signal indicating whether the collection is idle */
  isIdle: Signal<boolean>
  /** A signal indicating whether the collection has an error */
  isError: Signal<boolean>
  /** A signal indicating whether the collection has been cleaned up */
  isCleanedUp: Signal<boolean>
}

type InferConditionalResultType<TContext extends Context> =
  TContext extends SingleResult
    ? InferResultType<TContext> | []
    : InferResultType<TContext>

export type InjectConditionalLiveQueryResult<TContext extends Context> = Omit<
  InjectLiveQueryResult<TContext>,
  `data`
> & {
  data: Signal<InferConditionalResultType<TContext>>
}

export interface InjectLiveQueryResultWithCollection<
  TResult extends object = any,
  TKey extends string | number = string | number,
  TUtils extends Record<string, any> = {},
> {
  state: Signal<Map<TKey, TResult>>
  data: Signal<Array<TResult>>
  collection: Signal<Collection<TResult, TKey, TUtils> | null>
  status: Signal<CollectionStatus | `disabled`>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  persistedStatus: Signal<LiveQueryPersistedStatus>
  isPersistedReady: Signal<boolean>
  persistedError: Signal<unknown | undefined>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
}

export interface InjectLiveQueryResultWithSingleResultCollection<
  TResult extends object = any,
  TKey extends string | number = string | number,
  TUtils extends Record<string, any> = {},
> {
  state: Signal<Map<TKey, TResult>>
  data: Signal<TResult | undefined>
  collection: Signal<(Collection<TResult, TKey, TUtils> & SingleResult) | null>
  status: Signal<CollectionStatus | `disabled`>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  persistedStatus: Signal<LiveQueryPersistedStatus>
  isPersistedReady: Signal<boolean>
  persistedError: Signal<unknown | undefined>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
}

export function injectLiveQuery<
  TContext extends Context,
  TParams extends any,
>(options: {
  params: () => TParams
  query: (args: {
    params: TParams
    q: InitialQueryBuilder
  }) => QueryBuilder<TContext>
}): InjectLiveQueryResult<TContext>
export function injectLiveQuery<
  TContext extends Context,
  TParams extends any,
>(options: {
  params: () => TParams
  query: (args: {
    params: TParams
    q: InitialQueryBuilder
  }) => QueryBuilder<TContext> | undefined | null
}): InjectConditionalLiveQueryResult<TContext>
export function injectLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): InjectLiveQueryResult<TContext>
export function injectLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
): InjectConditionalLiveQueryResult<TContext>
export function injectLiveQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
): InjectLiveQueryResult<TContext>
// Pre-created collection without singleResult
export function injectLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult,
): InjectLiveQueryResultWithCollection<TResult, TKey, TUtils>
// Pre-created collection with singleResult
export function injectLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & SingleResult,
): InjectLiveQueryResultWithSingleResultCollection<TResult, TKey, TUtils>
export function injectLiveQuery(opts: any) {
  assertInInjectionContext(injectLiveQuery)
  const destroyRef = inject(DestroyRef)

  const collection = computed(() => {
    // Check if it's an existing collection
    if (isCollection(opts)) {
      return opts
    }

    if (typeof opts === `function`) {
      // Check if query function returns null/undefined (disabled query)
      const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
      const result = opts(queryBuilder)

      if (result === undefined || result === null) {
        // Disabled query - return null
        return null
      }

      return resolveLiveQueryValue(result, { gcTime: 0 })
    }

    // Check if it's reactive query options
    const isReactiveQueryOptions =
      opts &&
      typeof opts === `object` &&
      typeof opts.query === `function` &&
      typeof opts.params === `function`

    if (isReactiveQueryOptions) {
      const { params, query } = opts
      const currentParams = params()

      // Check if query function returns null/undefined (disabled query)
      const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
      const result = query({ params: currentParams, q: queryBuilder })

      if (result === undefined || result === null) {
        // Disabled query - return null
        return null
      }

      return resolveLiveQueryValue(result, { gcTime: 0 })
    }

    // Handle LiveQueryCollectionConfig objects. Default startSync/gcTime to
    // match the query-fn and reactive-options paths, but let an explicit value
    // in the config win — otherwise a bare `{ query }` never syncs.
    if (opts && typeof opts === `object` && typeof opts.query === `function`) {
      return createLiveQueryCollection({ startSync: true, gcTime: 0, ...opts })
    }

    throw new Error(`Invalid options provided to injectLiveQuery`)
  })

  const state = signal(new Map<string | number, any>())
  const internalData = signal<Array<any>>([])
  const statusValue = signal<CollectionStatus | `disabled`>(`idle`)
  const status = computed(() => {
    const value = statusValue()
    return value === `idle` && !collection() ? `disabled` : value
  })
  const persistedStatus = signal<LiveQueryPersistedStatus>(`unavailable`)
  const persistedError = signal<unknown>(undefined)

  // Returns single item for singleResult collections, array otherwise
  const data = computed(() => {
    const currentCollection = collection()
    if (!currentCollection) {
      return internalData()
    }
    return isSingleResultCollection(currentCollection)
      ? internalData()[0]
      : internalData()
  })

  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>,
    observer: LiveQueryObserver<any, any>,
  ) => {
    const newState = new Map(currentCollection.entries())
    const newData = Array.from(newState.values())

    state.set(newState)
    internalData.set(newData)
    const snapshot = observer.getSnapshot()
    statusValue.set(snapshot.status)
    persistedStatus.set(snapshot.persistedStatus)
    persistedError.set(snapshot.persistedError)
  }

  let unsub: (() => void) | null = null
  const cleanup = () => {
    unsub?.()
    unsub = null
  }

  effect((onCleanup) => {
    const currentCollection = collection()

    // Handle null collection (disabled query)
    if (!currentCollection) {
      statusValue.set(`disabled` as const)
      persistedStatus.set(`unavailable`)
      persistedError.set(undefined)
      state.set(new Map())
      internalData.set([])
      cleanup()
      return
    }

    cleanup()

    // The shared observer owns sync start, subscription, the ready-race, and
    // status transitions; Angular re-reads the whole collection on each notify
    // (wholesale) into its signals.
    // Angular re-reads the collection on notify; wholesale mode preserves its
    // pre-observer loading policy (no initial-state snapshot request).
    const observer = createLiveQueryObserver(currentCollection, {
      mode: `wholesale`,
    })

    const unsubscribe = observer.subscribe(() => {
      syncDataFromCollection(currentCollection, observer)
    })
    // Wholesale attach suppresses listener calls raised by synchronous sync
    // startup. Read once after subscribe returns to capture that final state.
    syncDataFromCollection(currentCollection, observer)
    unsub = () => {
      unsubscribe()
      observer.dispose()
    }

    onCleanup(cleanup)
  })

  destroyRef.onDestroy(cleanup)

  return {
    state,
    data,
    // Loosely typed so the impl return stays compatible with every overload
    // (the shared `isCollection` guard narrows the computed to `Collection | null`).
    collection: computed(() =>
      getPublicCollection(collection()),
    ) as Signal<any>,
    status,
    isLoading: computed(() => status() === `loading`),
    isReady: computed(() => status() === `ready` || status() === `disabled`),
    persistedStatus,
    isPersistedReady: computed(() => persistedStatus() === `ready`),
    persistedError,
    isIdle: computed(() => status() === `idle`),
    isError: computed(() => status() === `error`),
    isCleanedUp: computed(() => status() === `cleaned-up`),
  }
}
