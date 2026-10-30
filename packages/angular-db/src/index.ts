import {
  DestroyRef,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core'
import {
  BaseQueryBuilder,
  configPool,
  createLiveQueryObserver,
  getLiveQueryStatusFlags,
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
  LiveQueryHookConfig,
  LiveQuerySnapshot,
  LiveQueryStatusFlags,
  NonSingleResult,
  PooledLiveQueries,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'
import type { Signal } from '@angular/core'

const DEFAULT_GC_TIME_MS = 1

export * from '@tanstack/db'

/**
 * The result of calling `injectLiveQuery`.
 * Contains reactive signals for the query state and data.
 */
/** The status and flag signals every `injectLiveQuery` result has. */
export type InjectLiveQueryFlags = {
  /** A signal containing the current status of the collection */
  status: Signal<CollectionStatus | `disabled`>
} & {
  [K in keyof LiveQueryStatusFlags]: Signal<LiveQueryStatusFlags[K]>
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
  /** Pass `pooledLiveQueries` to share one partition among equal-shape queries. */
  pool?: PooledLiveQueries
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
  /** Pass `pooledLiveQueries` to share one partition among equal-shape queries. */
  pool?: PooledLiveQueries
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
  config: LiveQueryHookConfig<TContext>,
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

  let pendingWindow: (() => void) | undefined
  let previousCollection: ReturnType<typeof resolveLiveQueryValue> = null
  const resolveNext = (value: unknown, pool?: PooledLiveQueries) =>
    (previousCollection = resolveLiveQueryValue(value, {
      gcTime: DEFAULT_GC_TIME_MS,
      pool,
      previousCollection,
      windowOwner: resolveNext,
      onWindowChange: (move) => {
        pendingWindow = move
      },
    }))
  const resolveInput = () => {
    // Check if it's an existing collection
    if (isCollection(opts)) {
      previousCollection = null
      return opts
    }

    if (typeof opts === `function`) {
      return resolveNext(opts)
    }

    // Check if it's reactive query options
    const isReactiveQueryOptions =
      opts &&
      typeof opts === `object` &&
      typeof opts.query === `function` &&
      typeof opts.params === `function`

    if (isReactiveQueryOptions) {
      // The pool is checked first, so a disabled query rejects it too.
      const pool = configPool(opts)
      // A query function returning null or undefined disables the query.
      const result = opts.query({
        params: opts.params(),
        q: new BaseQueryBuilder() as InitialQueryBuilder,
      })
      return resolveNext(result, pool)
    }

    // Handle LiveQueryCollectionConfig objects. Default startSync/gcTime to
    // match the query-fn and reactive-options paths, but let an explicit value
    // in the config win — otherwise a bare `{ query }` never syncs.
    if (opts && typeof opts === `object` && typeof opts.query === `function`) {
      return resolveNext(opts)
    }

    throw new Error(`Invalid options provided to injectLiveQuery`)
  }
  const resolved = computed<{
    collection: ReturnType<typeof resolveLiveQueryValue>
    move: (() => void) | undefined
  }>(() => {
    pendingWindow = undefined
    const collection = resolveInput()
    return { collection, move: pendingWindow }
  })
  const collection = computed(() => resolved().collection)
  effect(() => {
    const { move } = resolved()
    untracked(() => move?.())
  })

  // The shared observer already captures one coherent view per publication.
  // Signals project that snapshot instead of copying its rows and health again.
  const snapshot = signal<LiveQuerySnapshot<any, string | number> | null>(null)
  const state = computed(
    () => (snapshot()?.state ?? new Map()) as Map<string | number, any>,
  )
  const status = computed(() => {
    const value = snapshot()?.status ?? `idle`
    return value === `idle` && !collection() ? `disabled` : value
  })
  const health = computed(() => snapshot()?.health)
  // Every status flag comes from the shared rule; a disabled query is ready.
  const flags = computed(() =>
    getLiveQueryStatusFlags(status() as CollectionStatus, health()),
  )

  // The snapshot already applies findOne's single-result projection. Before
  // the observer attaches, preserve Angular's empty array/undefined defaults.
  const data = computed(() => {
    // Read the current input even when a snapshot exists: a compile rejection
    // must propagate instead of exposing the previous query's rows.
    const currentCollection = collection()
    return (
      snapshot()?.data ??
      (currentCollection && isSingleResultCollection(currentCollection)
        ? undefined
        : [])
    )
  })

  let unsub: (() => void) | null = null
  const cleanup = () => {
    unsub?.()
    unsub = null
  }

  effect((onCleanup) => {
    const currentCollection = collection()

    // Handle null collection (disabled query)
    if (!currentCollection) {
      snapshot.set(null)
      cleanup()
      return
    }

    cleanup()

    // Wholesale mode preserves Angular's loading policy: attaching requests no
    // initial-state snapshot from the source.
    const observer = createLiveQueryObserver(currentCollection, {
      mode: `wholesale`,
    })

    const syncSnapshot = () => snapshot.set(observer.getSnapshot())
    observer.subscribe(syncSnapshot)
    // Wholesale attach suppresses listener calls raised by synchronous sync
    // startup. Read once after subscribe returns to capture that final state.
    syncSnapshot()
    unsub = () => observer.dispose()

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
    isLoading: computed(() => flags().isLoading),
    isReady: computed(() => flags().isReady || status() === `disabled`),
    isIdle: computed(() => flags().isIdle),
    isLoadingError: computed(() => flags().isLoadingError),
    isCrashed: computed(() => flags().isCrashed),
    isCleanedUp: computed(() => flags().isCleanedUp),
    isSyncError: computed(() => flags().isSyncError),
    health,
  }
}
