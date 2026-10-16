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
  ErrorTreeNode,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  LiveQueryObserver,
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
/** Status, persistence, and health signals every `injectLiveQuery` result has. */
export interface InjectLiveQueryFlags {
  /** A signal containing the current status of the collection */
  status: Signal<CollectionStatus | `disabled`>
  /** A signal indicating whether the collection is currently loading */
  isLoading: Signal<boolean>
  /** A signal indicating whether the collection is ready */
  isReady: Signal<boolean>
  /** A signal indicating whether the collection is idle */
  isIdle: Signal<boolean>
  /** The first load failed: there is nothing to show. */
  isLoadingError: Signal<boolean>
  /** Local storage or an invariant broke; recovery is a new Collection. */
  isCrashed: Signal<boolean>
  /** A signal indicating whether the collection has been cleaned up */
  isCleanedUp: Signal<boolean>
  /** The data is shown, and a sync problem or failed request is in `errors`. */
  isSyncError: Signal<boolean>
  /** A signal containing the error tree for the query and its dependencies */
  errors: Signal<ErrorTreeNode | undefined>
}

export interface InjectLiveQueryResult<
  TContext extends Context,
> extends InjectLiveQueryFlags {
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
> extends InjectLiveQueryFlags {
  state: Signal<Map<TKey, TResult>>
  data: Signal<Array<TResult>>
  collection: Signal<Collection<TResult, TKey, TUtils> | null>
}

export interface InjectLiveQueryResultWithSingleResultCollection<
  TResult extends object = any,
  TKey extends string | number = string | number,
  TUtils extends Record<string, any> = {},
> extends InjectLiveQueryFlags {
  state: Signal<Map<TKey, TResult>>
  data: Signal<TResult | undefined>
  collection: Signal<(Collection<TResult, TKey, TUtils> & SingleResult) | null>
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
  const errors = signal<ErrorTreeNode | undefined>(undefined)

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
    errors.set(snapshot.errors)
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
      errors.set(undefined)
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
    isIdle: computed(() => status() === `idle`),
    isLoadingError: computed(() => status() === `error`),
    isCrashed: computed(() => status() === `crashed`),
    isCleanedUp: computed(() => status() === `cleaned-up`),
    isSyncError: computed(
      () => status() === `ready` && errors()?.hasErrors === true,
    ),
    errors,
  }
}
