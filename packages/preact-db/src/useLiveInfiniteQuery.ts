import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks'
import {
  bindLiveQueryWindow,
  createLiveQuerySourceIdClaims,
  fetchNextLiveQueryWindowPage,
  getLiveQueryHash,
  getLiveQueryKey,
  identifyLiveQuery,
  prepareLiveQueryValue,
  readLiveQueryWindowPageShape,
} from '@tanstack/db'
import type {
  Collection,
  CollectionStatus,
  Context,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryKey,
  LiveQuerySourceIdClaims,
  LiveQueryWindowBinding,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'
import type { UseLiveQueryResult } from './useLiveQuery'

// Keep the generic parameter for typed config wrappers.
export type UseLiveInfiniteQueryConfig<_TContext extends Context> = {
  /**
   * Explicit identity for a query whose IR cannot derive one, such as a query
   * with functional variants. Structured queries should omit it.
   */
  queryKey?: LiveQueryKey
  pageSize?: number
  /** First result-page label, not a server cursor or remote offset. */
  initialPageParam?: number
}

interface InfiniteQueryPagination<TRow> {
  pages: Array<Array<TRow>>
  pageParams: Array<number>
  fetchNextPage: () => Promise<void>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  error: unknown
}

export type UseLiveInfiniteQueryReturn<TContext extends Context> =
  UseLiveQueryResult<
    InferResultType<TContext>[number],
    string | number,
    InferResultType<TContext>,
    Collection<InferResultType<TContext>[number], string | number, {}>
  > &
    InfiniteQueryPagination<InferResultType<TContext>[number]>

export type UseLiveInfiniteQueryReturnWithCollection<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> = UseLiveQueryResult<
  TResult,
  TKey,
  Array<TResult>,
  Collection<TResult, TKey, TUtils> & NonSingleResult
> &
  InfiniteQueryPagination<TResult>

/** What one hook instance renders until its input or page shape changes. */
/**
 * Page through an ordered live query, growing one live-query Collection's
 * window with `utils.setWindow()` instead of recreating it per page.
 *
 * The query must include `.orderBy()`. Its identity follows `useLiveQuery`:
 * derived from the query IR, or named by `queryKey`. A query whose IR cannot be
 * hashed throws `UnhashableQueryIRError` unless `queryKey` is supplied.
 *
 * @example
 * const { pages, fetchNextPage, hasNextPage } = useLiveInfiniteQuery(
 *   (q) =>
 *     q
 *       .from({ posts: postsCollection })
 *       .orderBy(({ posts }) => posts.createdAt, `desc`),
 *   { pageSize: 20 },
 * )
 */
export function useLiveInfiniteQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult,
  config: UseLiveInfiniteQueryConfig<any>,
): UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils>

export function useLiveInfiniteQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
): UseLiveInfiniteQueryReturn<TContext>

export function useLiveInfiniteQuery(
  queryFnOrCollection: unknown,
  config: UseLiveInfiniteQueryConfig<any>,
): UseLiveInfiniteQueryReturn<any> {
  const pageShape = readLiveQueryWindowPageShape(config)
  const claimsRef = useRef<LiveQuerySourceIdClaims | null>(null)
  const bindingRef = useRef<LiveQueryWindowBinding | null>(null)

  // A query input's identity is a hash, so a structurally equal query keeps
  // its loaded pages and a changed one compiles again.
  let preparedValue: unknown
  let identity: string | undefined
  if (typeof queryFnOrCollection === `function`) {
    const queryKey = getLiveQueryKey(config)
    if (queryKey) {
      identity = getLiveQueryHash(undefined, queryKey)
    } else {
      preparedValue = prepareLiveQueryValue(queryFnOrCollection, undefined)
      identity = identifyLiveQuery(
        preparedValue,
        {
          claims: (claimsRef.current ??= createLiveQuerySourceIdClaims()),
          client: undefined,
          bindingName: `useLiveInfiniteQuery`,
        },
        getLiveQueryHash,
      )
    }
  }

  const binding = (bindingRef.current = bindLiveQueryWindow(
    bindingRef.current,
    {
      ...pageShape,
      // Compile what this render prepared, so the callback runs once.
      input:
        preparedValue === undefined ? queryFnOrCollection : () => preparedValue,
      dependencies: identity === undefined ? undefined : [identity],
      recompile: `identity`,
    },
  ))

  const { controller } = binding
  const snapshot = controller.getSnapshot()
  const [, setRevision] = useState(0)

  useLayoutEffect(() => {
    const rerender = () => setRevision((revision) => revision + 1)
    controller.subscribe(rerender)
    // The query can publish between this render and its subscription.
    if (controller.getSnapshot() !== snapshot) rerender()
    if (binding.warning) console.warn(binding.warning)
    // Each binding owns its controller, so disposal also detaches this
    // subscription and releases its window lease.
    return () => controller.dispose()
  }, [controller])

  const fetchNextPage = useCallback(
    () => fetchNextLiveQueryWindowPage(controller),
    [controller],
  )

  return {
    data: snapshot.data,
    get state() {
      return snapshot.state
    },
    status: snapshot.status as CollectionStatus,
    isLoading: snapshot.isLoading,
    isReady: snapshot.isReady,
    persistedStatus: snapshot.persistedStatus,
    isPersistedReady: snapshot.isPersistedReady,
    persistedError: snapshot.persistedError,
    isIdle: snapshot.isIdle,
    isError: snapshot.isError,
    isCleanedUp: snapshot.isCleanedUp,
    collection: snapshot.collection,
    isEnabled: true,
    pages: snapshot.pages,
    pageParams: snapshot.pageParams,
    fetchNextPage,
    hasNextPage: snapshot.hasNextPage,
    isFetchingNextPage: snapshot.isFetchingNextPage,
    error: snapshot.error,
  } as UseLiveInfiniteQueryReturn<any>
}
