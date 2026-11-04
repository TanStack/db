import {
  assertInInjectionContext,
  computed,
  effect,
  signal,
  untracked,
} from '@angular/core'
import {
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

    // Handle LiveQueryCollectionConfig objects. Default startSync/gcTime to
    // match the query-fn and reactive-options paths, but let an explicit value
    // in the config win — otherwise a bare `{ query }` never syncs.
    if (opts && typeof opts === `object` && typeof opts.query === `function`) {
      if (typeof opts.params === `function`) {
        // The pool is checked first, so a disabled query rejects it too.
        const pool = configPool(opts)
        return resolveNext(
          (q: InitialQueryBuilder) => opts.query({ params: opts.params(), q }),
          pool,
        )
      }
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
