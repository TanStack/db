'use client'

import { useRef } from 'react'
import { useLiveQueryForSuspense } from './useLiveQuery'
import { getLiveQueryResultInfo } from './live-query-internals'
import type { UseLiveQueryConfig } from './useLiveQuery'
import type {
  Collection,
  Context,
  DbClient,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

// React can discard a render that suspends, including its refs. Keep the
// initial-render failure across retries, scoped by client because streamed
// preloads of the same collection can fail independently.
type InitialRenderError = {
  error: unknown
  failedClientQuery?: ReturnType<DbClient['_getLiveQuery']>
}

const initialRenderErrors = new WeakMap<
  Collection<any, any, any>,
  {
    byClient: WeakMap<DbClient, InitialRenderError>
    unscoped?: InitialRenderError
  }
>()

function clearInitialRenderError(
  collection: Collection<any, any, any>,
  client: DbClient | undefined,
) {
  const entry = initialRenderErrors.get(collection)
  if (!entry) return
  if (client) entry.byClient.delete(client)
  else delete entry.unscoped
}

function rememberInitialRenderError(
  collection: Collection<any, any, any>,
  client: DbClient | undefined,
  clientQuery: ReturnType<DbClient['_getLiveQuery']>,
  error: unknown,
) {
  if (collection.status === `cleaned-up`) return
  let entry = initialRenderErrors.get(collection)
  if (!entry) {
    entry = { byClient: new WeakMap() }
    collection.once(`status:cleaned-up`, () => {
      initialRenderErrors.delete(collection)
    })
    initialRenderErrors.set(collection, entry)
  }
  const failedClientQuery =
    clientQuery?.status === `error` ? clientQuery : undefined
  if (client) entry.byClient.set(client, { error, failedClientQuery })
  else entry.unscoped = { error }
}

/**
 * Create a live query with React Suspense support
 * @param queryFn - Query function that defines what data to fetch
 * @param deps - Deprecated array of dependencies that trigger query re-execution when changed
 * @returns Object with reactive data and state - data is guaranteed to be defined
 * @throws Promise when data is loading (caught by Suspense boundary)
 * @throws Error when collection fails (caught by Error boundary)
 * @example
 * // Basic usage with Suspense
 * function TodoList() {
 *   const { data } = useLiveSuspenseQuery({
 *     query: (q) =>
 *       q.from({ todos: todosCollection })
 *        .where(({ todos }) => eq(todos.completed, false))
 *        .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 *   })
 *
 *   return (
 *     <ul>
 *       {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
 *     </ul>
 *   )
 * }
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<div>Loading...</div>}>
 *       <TodoList />
 *     </Suspense>
 *   )
 * }
 *
 * @example
 * // Single result query
 * const { data } = useLiveSuspenseQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => eq(todos.id, 1))
 *          .findOne()
 * )
 * // data is guaranteed to be the single item (or undefined if not found)
 *
 * @example
 * // Structured captured values are included in derived query identity and trigger re-suspension
 * const { data } = useLiveSuspenseQuery({
 *   query: (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority)),
 * })
 *
 * @example
 * // With Error boundary
 * function App() {
 *   return (
 *     <ErrorBoundary fallback={<div>Error loading data</div>}>
 *       <Suspense fallback={<div>Loading...</div>}>
 *         <TodoList />
 *       </Suspense>
 *     </ErrorBoundary>
 *   )
 * }
 *
 * @remarks
 * **Important:** This hook does NOT support disabled queries (returning undefined/null).
 * Following TanStack Query's useSuspenseQuery design, the query callback must always
 * return a valid query, collection, or config object.
 *
 * ❌ **This will cause a type error:**
 * ```ts
 * useLiveSuspenseQuery(
 *   (q) => userId ? q.from({ users }) : undefined  // ❌ Error!
 * )
 * ```
 *
 * ✅ **Use conditional rendering instead:**
 * ```ts
 * function Profile({ userId }: { userId: string }) {
 *   const { data } = useLiveSuspenseQuery({
 *     query: (q) => q.from({ users }).where(({ users }) => eq(users.id, userId)),
 *   })
 *   return <div>{data.name}</div>
 * }
 *
 * // In parent component:
 * {userId ? <Profile userId={userId} /> : <div>No user</div>}
 * ```
 *
 * ✅ **For optional inputs, conditionally render a component with complete query inputs:**
 * ```ts
 * {userId ? <Profile userId={userId} /> : <div>No user</div>}
 * ```
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveSuspenseQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>,
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 2: Accept config object
export function useLiveSuspenseQuery<TContext extends Context>(
  config: UseLiveQueryConfig<TContext>,
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 3: Accept legacy config object
export function useLiveSuspenseQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<unknown>,
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 4: Accept pre-created live query collection
export function useLiveSuspenseQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult,
): {
  state: Map<TKey, TResult>
  data: Array<TResult>
  collection: Collection<TResult, TKey, TUtils>
}

// Overload 5: Accept pre-created live query collection with singleResult: true
export function useLiveSuspenseQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & SingleResult,
): {
  state: Map<TKey, TResult>
  data: TResult | undefined
  collection: Collection<TResult, TKey, TUtils> & SingleResult
}

// Implementation - uses useLiveQuery internally and adds Suspense logic
export function useLiveSuspenseQuery(
  configOrQueryOrCollection: any,
  deps?: Array<unknown>,
) {
  const promiseRef = useRef<Promise<void> | null>(null)
  const collectionRef = useRef<Collection<any, any, any> | null>(null)
  const hasBeenReadyRef = useRef(false)

  // Use useLiveQuery to handle collection management and reactivity
  const result =
    deps === undefined
      ? useLiveQueryForSuspense(configOrQueryOrCollection, undefined)
      : useLiveQueryForSuspense(configOrQueryOrCollection, deps)

  if (!result.isEnabled) {
    // Suspense queries cannot be disabled - this matches TanStack Query's useSuspenseQuery behavior
    throw new Error(
      `useLiveSuspenseQuery does not support disabled queries (callback returned undefined/null). ` +
        `The Suspense pattern requires data to always be defined (T, not T | undefined). ` +
        `Solutions: ` +
        `1) Use conditional rendering - don't render the component until the condition is met. ` +
        `2) Use useLiveQuery instead, which supports disabled queries with the 'isEnabled' flag.`,
    )
  }

  const queryInfo = getLiveQueryResultInfo(result)

  // Reset promise and ready state when query identity changes
  if (collectionRef.current !== result.collection) {
    promiseRef.current = null
    collectionRef.current = result.collection
    hasBeenReadyRef.current = false
  }

  // SUSPENSE LOGIC: Throw promise or error based on collection status

  const collectionStatus = result.collection.status

  // Track when we reach ready state
  if (result.isReady || queryInfo.observer.isInitialRenderReady()) {
    hasBeenReadyRef.current = true
    promiseRef.current = null
    clearInitialRenderError(result.collection, queryInfo.client)
  }

  const observerError = queryInfo.observer.getError()
  if (observerError !== undefined && !hasBeenReadyRef.current) {
    promiseRef.current = null
    throw observerError
  }

  const errorEntry = initialRenderErrors.get(result.collection)
  const initialRenderError = queryInfo.client
    ? errorEntry?.byClient.get(queryInfo.client)
    : errorEntry?.unscoped
  const currentClientQuery =
    initialRenderError?.failedClientQuery &&
    queryInfo.client &&
    queryInfo.queryHash
      ? queryInfo.client._getLiveQuery(queryInfo.queryHash)
      : undefined
  if (
    initialRenderError?.failedClientQuery &&
    initialRenderError.failedClientQuery !== currentClientQuery
  ) {
    clearInitialRenderError(result.collection, queryInfo.client)
  } else if (initialRenderError && !hasBeenReadyRef.current) {
    promiseRef.current = null
    throw initialRenderError.error
  }

  // Only throw errors during initial load (before first ready)
  // After success, errors surface as stale data (matches TanStack Query behavior)
  if (
    collectionStatus === `error` &&
    !hasBeenReadyRef.current &&
    (result.persistedStatus === `unavailable` ||
      result.persistedStatus === `error`)
  ) {
    promiseRef.current = null
    // TODO: Once collections hold a reference to their last error object (#671),
    // we should rethrow that actual error instead of creating a generic message
    throw new Error(`Collection "${result.collection.id}" failed to load`)
  }

  if (
    !hasBeenReadyRef.current &&
    (result.isLoading ||
      result.isIdle ||
      (collectionStatus === `error` &&
        result.persistedStatus !== `unavailable`))
  ) {
    if (queryInfo.client?._isSsrStreamingEnabled() && !queryInfo.queryHash) {
      const reason = queryInfo.identityError
        ? `${queryInfo.identityError.reason} at ${queryInfo.identityError.path}`
        : `the query has no stable identity`
      throw new Error(
        `Cannot stream this live query during SSR because ${reason}. Provide an explicit serializable queryKey.`,
      )
    }
    // Create or reuse promise for current collection
    if (!promiseRef.current) {
      const collection = result.collection
      const client = queryInfo.client
      const queryHash = queryInfo.queryHash
      let active = true
      const stopWatchingCleanup = collection.once(`status:cleaned-up`, () => {
        active = false
      })
      let preload: Promise<void>
      try {
        preload = queryInfo.observer.preloadForInitialRender()
      } catch (error) {
        stopWatchingCleanup()
        throw error
      }
      const clientQuery =
        client && queryHash ? client._getLiveQuery(queryHash) : undefined
      promiseRef.current = preload
        .catch((error: unknown) => {
          const latestClientQuery =
            client && queryHash ? client._getLiveQuery(queryHash) : undefined
          if (active && latestClientQuery === clientQuery)
            rememberInitialRenderError(collection, client, clientQuery, error)
          throw error
        })
        .finally(stopWatchingCleanup)
    }
    // React Suspense catches this promise and retries after preload settles.
    throw promiseRef.current
  }

  // Return data without status/loading flags (handled by Suspense/ErrorBoundary)
  // If error after success, return last known good state (stale data)
  return {
    state: result.state,
    data: result.data,
    collection: result.collection,
  }
}
