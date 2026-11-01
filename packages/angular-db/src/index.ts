import {
  assertInInjectionContext,
  computed,
  effect,
  signal,
  untracked,
} from '@angular/core'
import {
  BaseQueryBuilder,
  configPool,
  createLiveQueryObserver,
  isCollection,
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

      return resolveLiveQueryValue(result, { gcTime: DEFAULT_GC_TIME_MS })
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
      return resolveLiveQueryValue(result, {
        gcTime: DEFAULT_GC_TIME_MS,
        pool,
      })
    }

    // Handle LiveQueryCollectionConfig objects. Default startSync/gcTime to
    // match the query-fn and reactive-options paths, but let an explicit value
    // in the config win — otherwise a bare `{ query }` never syncs.
    if (opts && typeof opts === `object` && typeof opts.query === `function`) {
      return resolveLiveQueryValue(opts, { gcTime: DEFAULT_GC_TIME_MS })
    }

    throw new Error(`Invalid options provided to injectLiveQuery`)
  })

  // Observers are inert until subscribed. A read can therefore follow the
  // current query synchronously without acquiring an Angular-owned connection.
  const observer = computed(() =>
    createLiveQueryObserver(collection(), { mode: `wholesale` }),
  )
  const revision = signal(0)
  const invalidate = () => revision.update((value) => value + 1)
  const snapshot = computed(() => {
    revision()
    return observer().getSnapshot()
  })
  const rowState = computed(() => snapshot().state)

  effect((onCleanup) => {
    const current = observer()
    untracked(() => {
      const unsubscribe = current.subscribe(invalidate)
      onCleanup(() => {
        unsubscribe()
        current.dispose()
      })
      // Close the gap after an early snapshot read. Wholesale attach also
      // suppresses notifications raised by synchronous sync startup.
      invalidate()
    })
  })

  return {
    state: computed(() => new Map(rowState())),
    // Angular keeps empty containers for disabled queries, including findOne.
    data: computed(() =>
      snapshot().status === `disabled` ? [] : snapshot().data,
    ),
    // Loosely typed so the impl return stays compatible with every overload
    // (the shared `isCollection` guard narrows the computed to `Collection | null`).
    collection: computed(() => snapshot().collection ?? null) as Signal<any>,
    status: computed(() => snapshot().status),
    isLoading: computed(() => snapshot().isLoading),
    isReady: computed(() => snapshot().isReady),
    isIdle: computed(() => snapshot().isIdle),
    isLoadingError: computed(() => snapshot().isLoadingError),
    isCrashed: computed(() => snapshot().isCrashed),
    isCleanedUp: computed(() => snapshot().isCleanedUp),
    isSyncError: computed(() => snapshot().isSyncError),
    health: computed(() => snapshot().health),
  }
}
