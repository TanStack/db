import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import {
  createLiveQueryObserver,
  createLiveQuerySourceIdClaims,
  getLiveQueryHash,
  getLiveQueryKey,
  identifyLiveQuery,
  isCollection,
  prepareLiveQueryValue,
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
  LiveQueryKey,
  LiveQueryObserver,
  LiveQueryPersistedStatus,
  LiveQuerySourceIdClaims,
  NonSingleResult,
  PooledLiveQueries,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

// A live query this hook creates from a callback or config retires 1 ms after
// its last subscriber leaves. A supplied Collection, or a config with an
// explicit `gcTime`, keeps the caller's retention policy.
const DEFAULT_GC_TIME_MS = 1

export type UseLiveQueryStatus = CollectionStatus | `disabled`

type ConfiguredQueryBuilder<TContext extends Context> = Extract<
  LiveQueryCollectionConfig<TContext>[`query`],
  QueryBuilder<TContext>
>

type UseLiveQueryConfigOptions<TContext extends Context> = Omit<
  LiveQueryCollectionConfig<TContext>,
  `query`
> & {
  /**
   * Explicit identity for a query whose IR cannot derive one, such as a query
   * with functional variants. Structured queries should omit it.
   */
  queryKey?: LiveQueryKey
  /**
   * Pass `pooledLiveQueries` to share one partition among equality-filtered
   * queries of one shape.
   */
  pool?: PooledLiveQueries
}

export type UseLiveQueryConfig<TContext extends Context> =
  UseLiveQueryConfigOptions<TContext> &
    Pick<LiveQueryCollectionConfig<TContext>, `query`>

export type ConditionalUseLiveQueryConfig<TContext extends Context> =
  UseLiveQueryConfigOptions<TContext> & {
    query:
      | ConfiguredQueryBuilder<TContext>
      | ((
          q: InitialQueryBuilder,
        ) => ConfiguredQueryBuilder<TContext> | undefined | null)
  }

interface LiveQueryResultFlags {
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

/** The result of a live query that is always enabled. */
export interface UseLiveQueryResult<
  TResult extends object,
  TKey extends string | number,
  TData,
  TCollection,
> extends LiveQueryResultFlags {
  state: ReadonlyMap<TKey, TResult>
  data: TData
  collection: TCollection
  status: CollectionStatus
  isEnabled: true
}

/** The result of a live query whose callback can disable it. */
export interface UseConditionalLiveQueryResult<
  TResult extends object,
  TKey extends string | number,
  TData,
  TCollection,
> extends LiveQueryResultFlags {
  state: ReadonlyMap<TKey, TResult> | undefined
  data: TData | undefined
  collection: TCollection | undefined
  status: UseLiveQueryStatus
  isEnabled: boolean
}

type QueryResult<TContext extends Context> = UseLiveQueryResult<
  GetResult<TContext>,
  string | number,
  InferResultType<TContext>,
  Collection<GetResult<TContext>, string | number, {}>
>

type ConditionalQueryResult<TContext extends Context> =
  UseConditionalLiveQueryResult<
    GetResult<TContext>,
    string | number,
    InferResultType<TContext>,
    Collection<GetResult<TContext>, string | number, {}>
  >

/**
 * Subscribe a Preact component to a live query.
 *
 * The hook derives the query's identity from its structured IR on each render,
 * so values captured by the callback recompile the query when they change. A
 * query whose IR cannot be hashed, such as one using `fn.where`, throws
 * `UnhashableQueryIRError` unless its config supplies `queryKey`. While the
 * hook is mounted, each Collection ID its queries read must keep naming one
 * source object, or it throws `SourceCollectionIdReuseError`.
 * Return `undefined` or `null` from the callback to disable the query.
 *
 * @example
 * const { data, isLoading } = useLiveQuery((q) =>
 *   q
 *     .from({ todos: todosCollection })
 *     .where(({ todos }) => eq(todos.completed, false)),
 * )
 *
 * @example
 * // Disable the query until its input exists
 * const { data, isEnabled } = useLiveQuery((q) =>
 *   userId
 *     ? q
 *         .from({ todos: todosCollection })
 *         .where(({ todos }) => eq(todos.userId, userId))
 *     : undefined,
 * )
 */
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): QueryResult<TContext>

export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
): ConditionalQueryResult<TContext>

export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => LiveQueryCollectionConfig<TContext> | undefined | null,
): ConditionalQueryResult<TContext>

export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => Collection<TResult, TKey, TUtils> | undefined | null,
): UseConditionalLiveQueryResult<
  TResult,
  TKey,
  Array<TResult>,
  Collection<TResult, TKey, TUtils>
>

/**
 * Subscribe to a live query described by a config object.
 *
 * @example
 * const { data } = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60_000,
 * })
 */
export function useLiveQuery<TContext extends Context>(
  config: UseLiveQueryConfig<TContext>,
): QueryResult<TContext>

export function useLiveQuery<TContext extends Context>(
  config: ConditionalUseLiveQueryConfig<TContext>,
): ConditionalQueryResult<TContext>

/**
 * Subscribe to an existing live-query Collection. The hook starts its sync and
 * leaves its retention policy to the caller.
 *
 * @example
 * const activeTodos = createLiveQueryCollection((q) =>
 *   q.from({ todos: todosCollection }).where(({ todos }) => todos.active),
 * )
 * const { data, collection } = useLiveQuery(activeTodos)
 */
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult,
): UseLiveQueryResult<
  TResult,
  TKey,
  Array<TResult>,
  Collection<TResult, TKey, TUtils>
>

export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & SingleResult,
): UseLiveQueryResult<
  TResult,
  TKey,
  TResult | undefined,
  Collection<TResult, TKey, TUtils> & SingleResult
>

export function useLiveQuery(
  input: unknown,
): UseConditionalLiveQueryResult<
  object,
  string | number,
  unknown,
  Collection<object, string | number, any>
> {
  const claimsRef = useRef<LiveQuerySourceIdClaims | null>(null)
  const preparedValue = prepareLiveQueryValue(input, undefined)
  const queryKey = getLiveQueryKey(input)
  // A supplied Collection is not compiled, so its object is its identity.
  const identity = isCollection(input)
    ? input
    : queryKey
      ? getLiveQueryHash(preparedValue, queryKey)
      : identifyLiveQuery(
          preparedValue,
          {
            claims: (claimsRef.current ??= createLiveQuerySourceIdClaims()),
            client: undefined,
            bindingName: `useLiveQuery`,
          },
          getLiveQueryHash,
        )

  const bindingRef = useRef<LiveQueryBinding | null>(null)
  let binding = bindingRef.current
  if (binding?.identity !== identity) {
    binding = bindingRef.current = {
      identity,
      // Wholesale mode publishes nothing during subscribe; the hook re-reads
      // the observer's snapshot on each notification.
      observer: createLiveQueryObserver(
        resolveLiveQueryValue(preparedValue, { gcTime: DEFAULT_GC_TIME_MS }),
        { mode: `wholesale` },
      ),
    }
  }

  const { observer } = binding
  const snapshot = observer.getSnapshot()
  const [, setRevision] = useState(0)

  useLayoutEffect(() => {
    const rerender = () => setRevision((revision) => revision + 1)
    observer.subscribe(rerender)
    // The query can publish between this render and its subscription.
    if (observer.getSnapshot() !== snapshot) rerender()
    // Each binding owns its observer, so disposal also detaches this
    // subscription and releases the live-query Collection.
    return () => observer.dispose()
  }, [observer])

  return snapshot
}

/** The live query one hook instance reads until its identity changes. */
interface LiveQueryBinding {
  identity: unknown
  observer: LiveQueryObserver<object, string | number>
}
