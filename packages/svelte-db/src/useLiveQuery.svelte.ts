// eslint-disable-next-line import/no-duplicates -- See https://github.com/un-ts/eslint-plugin-import-x/issues/308
import { untrack } from 'svelte'
// eslint-disable-next-line import/no-duplicates -- See https://github.com/un-ts/eslint-plugin-import-x/issues/308
import { SvelteMap } from 'svelte/reactivity'
import {
  UnhashableQueryIRError,
  createLiveQueryObserver,
  createLiveQuerySourceIdClaims,
  getLiveQueryHash,
  getPublicCollection,
  getStableValueHash,
  identifyLiveQuery,
  isCollection,
  isSingleResultCollection,
  prepareLiveQueryValue,
  rejectLiveQueryInput,
  releaseDeferredOnReclaim,
  resolveLiveQueryValue,
  resumeDeferredLiveQueryCollections,
} from '@tanstack/db'
import { useDbContext } from './db-context.js'
import type {
  ChangeMessage,
  Collection,
  CollectionStatus,
  Context,
  DbClient,
  DeferredLiveQueryCollections,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryHookConfig,
  LiveQueryKey,
  LiveQueryObserver,
  LiveQueryPersistedStatus,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

const DEFAULT_GC_TIME_MS = 1

/** Copy a snapshot's ordered rows; a single-result query's `data` is one row. */
function snapshotRows(data: unknown): Array<any> {
  if (Array.isArray(data)) return [...data]
  return data === undefined ? [] : [data]
}

/**
 * Return type for useLiveQuery hook
 * @property state - Reactive Map of query results (key → item)
 * @property data - Reactive array of query results in order, or single item when using findOne()
 * @property collection - The underlying query collection instance
 * @property status - Current query status
 * @property isLoading - True while initial query data is loading
 * @property isReady - True when query has received first data and is ready
 * @property isIdle - True when query hasn't started yet
 * @property isError - True when query encountered an error
 * @property isCleanedUp - True when query has been cleaned up
 */
export interface UseLiveQueryReturn<T extends object, TData = Array<T>> {
  state: Map<string | number, T>
  data: TData
  collection: Collection<T, string | number, {}>
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

type InferConditionalResultType<TContext extends Context> =
  TContext extends SingleResult
    ? InferResultType<TContext> | []
    : InferResultType<TContext>

export type ConditionalUseLiveQueryReturn<
  T extends object,
  TData = Array<T>,
> = Omit<UseLiveQueryReturn<T, TData>, `collection` | `status`> & {
  collection: Collection<T, string | number, {}> | null
  status: CollectionStatus | `disabled`
}

export interface UseLiveQueryReturnWithCollection<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
  TData = Array<T>,
> {
  state: Map<TKey, T>
  data: TData
  collection: Collection<T, TKey, TUtils>
  status: CollectionStatus
  isLoading: boolean
  isReady: boolean
  persistedStatus: LiveQueryPersistedStatus
  isPersistedReady: boolean
  persistedError: unknown | undefined
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

type MaybeGetter<T> = T | (() => T)

export type UseLiveQueryConfig<TContext extends Context> =
  LiveQueryHookConfig<TContext> & {
    queryKey?: MaybeGetter<LiveQueryKey>
    client?: DbClient
  }

function toValue<T>(value: MaybeGetter<T>): T {
  if (typeof value === `function`) {
    return (value as () => T)()
  }
  return value
}

/**
 * Create a live query using a query function
 * @param queryFn - Query function that defines what data to fetch
 * @param deps - Array of reactive dependencies that trigger query re-execution when changed
 * @returns Reactive object with query data, state, and status information
 *
 * @remarks
 * **IMPORTANT - Destructuring in Svelte 5:**
 * Direct destructuring breaks reactivity. To destructure, wrap with `$derived`:
 *
 * ❌ **Incorrect** - Loses reactivity:
 * ```ts
 * const { data, isLoading } = useLiveQuery(...)
 * ```
 *
 * ✅ **Correct** - Maintains reactivity:
 * ```ts
 * // Option 1: Use dot notation (recommended)
 * const query = useLiveQuery(...)
 * // Access: query.data, query.isLoading
 *
 * // Option 2: Wrap with $derived for destructuring
 * const query = useLiveQuery(...)
 * const { data, isLoading } = $derived(query)
 * ```
 *
 * This is a fundamental Svelte 5 limitation, not a library bug. See:
 * https://github.com/sveltejs/svelte/issues/11002
 *
 * @example
 * // Basic query with object syntax (recommended pattern)
 * const todosQuery = useLiveQuery((q) =>
 *   q.from({ todos: todosCollection })
 *    .where(({ todos }) => eq(todos.completed, false))
 *    .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 * )
 * // Access via: todosQuery.data, todosQuery.isLoading, etc.
 *
 * @example
 * // With reactive dependencies
 * let minPriority = $state(5)
 * const todosQuery = useLiveQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority)),
 *   [() => minPriority] // Re-run when minPriority changes
 * )
 *
 * @example
 * // Destructuring with $derived (if needed)
 * const query = useLiveQuery((q) =>
 *   q.from({ todos: todosCollection })
 * )
 * const { data, isLoading, isError } = $derived(query)
 * // Now data, isLoading, and isError maintain reactivity
 *
 * @example
 * // Join pattern
 * const issuesQuery = useLiveQuery((q) =>
 *   q.from({ issues: issueCollection })
 *    .join({ persons: personCollection }, ({ issues, persons }) =>
 *      eq(issues.userId, persons.id)
 *    )
 *    .select(({ issues, persons }) => ({
 *      id: issues.id,
 *      title: issues.title,
 *      userName: persons.name
 *    }))
 * )
 *
 * @example
 * // Handle loading and error states in template
 * const todosQuery = useLiveQuery((q) =>
 *   q.from({ todos: todoCollection })
 * )
 *
 * // In template:
 * // {#if todosQuery.isLoading}
 * //   <div>Loading...</div>
 * // {:else if todosQuery.isError}
 * //   <div>Error: {todosQuery.status}</div>
 * // {:else}
 * //   <ul>
 * //     {#each todosQuery.data as todo (todo.id)}
 * //       <li>{todo.text}</li>
 * //     {/each}
 * //   </ul>
 * // {/if}
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<() => unknown>,
): UseLiveQueryReturn<GetResult<TContext>, InferResultType<TContext>>

// Overload 1b: Accept query function that can return undefined/null
export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
  deps?: Array<() => unknown>,
): ConditionalUseLiveQueryReturn<
  GetResult<TContext>,
  InferConditionalResultType<TContext>
>

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @param deps - Array of reactive dependencies that trigger query re-execution when changed
 * @returns Reactive object with query data, state, and status information
 * @example
 * // Basic config object usage
 * const todosQuery = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60000
 * })
 *
 * @example
 * // With reactive dependencies
 * let filter = $state('active')
 * const todosQuery = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection })
 *                  .where(({ todos }) => eq(todos.status, filter))
 * }, [() => filter])
 *
 * @example
 * // Handle all states uniformly
 * const itemsQuery = useLiveQuery({
 *   query: (q) => q.from({ items: itemCollection })
 * })
 *
 * // In template:
 * // {#if itemsQuery.isLoading}
 * //   <div>Loading...</div>
 * // {:else if itemsQuery.isError}
 * //   <div>Something went wrong</div>
 * // {:else if !itemsQuery.isReady}
 * //   <div>Preparing...</div>
 * // {:else}
 * //   <div>{itemsQuery.data.length} items loaded</div>
 * // {/if}
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: UseLiveQueryConfig<TContext>,
  deps?: Array<() => unknown>,
): UseLiveQueryReturn<GetResult<TContext>, InferResultType<TContext>>

/**
 * Subscribe to an existing query collection (can be reactive)
 * @param liveQueryCollection - Pre-created query collection to subscribe to (can be a getter)
 * @returns Reactive object with query data, state, and status information
 * @example
 * // Using pre-created query collection
 * const myLiveQuery = createLiveQueryCollection((q) =>
 *   q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
 * )
 * const queryResult = useLiveQuery(myLiveQuery)
 *
 * @example
 * // Reactive query collection reference
 * let selectedQuery = $state(todosQuery)
 * const queryResult = useLiveQuery(() => selectedQuery)
 *
 * // Switch queries reactively
 * selectedQuery = archiveQuery
 *
 * @example
 * // Access query collection methods directly
 * const queryResult = useLiveQuery(existingQuery)
 *
 * // Use underlying collection for mutations
 * const handleToggle = (id) => {
 *   queryResult.collection.update(id, draft => { draft.completed = !draft.completed })
 * }
 *
 * @example
 * // Handle states consistently
 * const queryResult = useLiveQuery(sharedQuery)
 *
 * // In template:
 * // {#if queryResult.isLoading}
 * //   <div>Loading...</div>
 * // {:else if queryResult.isError}
 * //   <div>Error loading data</div>
 * // {:else}
 * //   {#each queryResult.data as item (item.id)}
 * //     <Item {...item} />
 * //   {/each}
 * // {/if}
 */
// Overload 3: Accept pre-created live query collection WITHOUT SingleResult (returns array)
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeGetter<
    Collection<TResult, TKey, TUtils> & NonSingleResult
  >,
): UseLiveQueryReturnWithCollection<TResult, TKey, TUtils, Array<TResult>>

// Overload 4: Accept pre-created live query collection WITH SingleResult (returns single item)
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeGetter<
    Collection<TResult, TKey, TUtils> & SingleResult
  >,
): UseLiveQueryReturnWithCollection<TResult, TKey, TUtils, TResult | undefined>

// Implementation
export function useLiveQuery(
  configOrQueryOrCollection: any,
  deps: Array<() => unknown> = [],
): UseLiveQueryReturn<any> | UseLiveQueryReturnWithCollection<any, any, any> {
  const context = useDbContext()
  const contextDbClient = context?.client
  // Source Collection IDs this hook's client-backed queries read, kept until
  // it unmounts.
  const sourceIdClaims = createLiveQuerySourceIdClaims()

  const resolved = $derived.by(() => {
    // First check if the original parameter might be a getter
    // by seeing if toValue returns something different than the original
    let unwrappedParam = configOrQueryOrCollection
    try {
      const potentiallyUnwrapped = toValue(configOrQueryOrCollection)
      if (potentiallyUnwrapped !== configOrQueryOrCollection) {
        unwrappedParam = potentiallyUnwrapped
      }
    } catch {
      // If toValue fails, use original parameter
      unwrappedParam = configOrQueryOrCollection
    }

    // Check if it's already a collection by checking for specific collection methods
    const inputIsCollection = isCollection(unwrappedParam)
    const dbClient = inputIsCollection
      ? contextDbClient
      : ((unwrappedParam as { client?: DbClient } | null)?.client ??
        contextDbClient)

    if (inputIsCollection) {
      // Warn when passing a collection directly with on-demand sync mode
      // In on-demand mode, data is only loaded when queries with predicates request it
      // Passing the collection directly doesn't provide any predicates, so no data loads
      const syncMode = (unwrappedParam as { config?: { syncMode?: string } })
        .config?.syncMode
      if (syncMode === `on-demand`) {
        console.warn(
          `[useLiveQuery] Warning: Passing a collection with syncMode "on-demand" directly to useLiveQuery ` +
            `will not load any data. In on-demand mode, data is only loaded when queries with predicates request it.\n\n` +
            `Instead, use a query builder function:\n` +
            `  const { data } = useLiveQuery((q) => q.from({ c: myCollection }).select(({ c }) => c))\n\n` +
            `Or switch to syncMode "eager" if you want all data to sync automatically.`,
        )
      }
      // It's already a collection, ensure sync is started for Svelte helpers
      // Only start sync if the collection is in idle state
      if (unwrappedParam.status === `idle`) {
        unwrappedParam.startSyncImmediate()
      }
      return {
        collection: unwrappedParam,
        client: dbClient,
        queryHash: getStableValueHash(
          [`collection`, unwrappedParam.id],
          `queryKey`,
        ),
        resumeDeferredCollections: () => {},
      }
    }

    // Reference deps to make computed reactive to them
    const dependencyValues = deps.map((dep) => toValue(dep))
    const deferredCollections: DeferredLiveQueryCollections = new Set()
    // The compile boundary: a query rejected anywhere after preparation
    // releases the sync starts it deferred, so a later reader can start them.
    try {
      const preparedValue = prepareLiveQueryValue(
        unwrappedParam,
        dbClient,
        deferredCollections,
      )
      const configuredQueryKey = (
        unwrappedParam as { queryKey?: MaybeGetter<LiveQueryKey> } | null
      )?.queryKey
      const queryKey = configuredQueryKey
        ? toValue(configuredQueryKey)
        : undefined

      // A DbClient matches preloaded and hydrated queries by identity hash, so
      // a client-backed query without queryKey needs a stable IR identity and
      // keeps each source Collection ID's object while the hook is mounted.
      const derivedHash =
        dbClient && !queryKey?.length
          ? identifyLiveQuery(
              preparedValue,
              {
                claims: sourceIdClaims,
                client: dbClient,
                bindingName: `useLiveQuery`,
              },
              getLiveQueryHash,
            )
          : undefined

      let queryHash: string | undefined
      try {
        queryHash =
          deps.length > 0 && !queryKey?.length
            ? getStableValueHash(
                [
                  `deps`,
                  dependencyValues,
                  derivedHash ?? getLiveQueryHash(preparedValue),
                ],
                `queryKey`,
              )
            : (derivedHash ?? getLiveQueryHash(preparedValue, queryKey))
      } catch (error) {
        // A dependency value or a client-free query that cannot be hashed
        // leaves hydration without a key; it does not reject the query. An
        // empty key counts as none; a nonempty one must hash.
        if (!(error instanceof UnhashableQueryIRError)) throw error
        if (queryKey?.length) throw error
      }

      let collection: Collection<any, any, any> | null
      if (preparedValue === undefined || preparedValue === null) {
        collection = null
      } else if (isCollection(preparedValue)) {
        collection = preparedValue
      } else {
        // Hydration keys the live-query Collection by identity, so it never
        // pools, even when the config passes a pool.
        collection = resolveLiveQueryValue(preparedValue, {
          gcTime: DEFAULT_GC_TIME_MS,
          pool: dbClient ? false : undefined,
        })
      }

      // A setup that never subscribes releases its deferred sync starts when
      // garbage collection reclaims the live query it built. A Collection
      // the input supplied is not this setup's to reclaim.
      const cancelReclaimRelease =
        collection && !isCollection(preparedValue)
          ? releaseDeferredOnReclaim(collection, deferredCollections)
          : undefined
      return {
        collection,
        client: dbClient,
        queryHash,
        // The subscribing effect releases the starts, so it drops the
        // reclaim release.
        resumeDeferredCollections: () => {
          cancelReclaimRelease?.()
          resumeDeferredLiveQueryCollections(deferredCollections)
        },
      }
    } catch (error) {
      return rejectLiveQueryInput(deferredCollections, error)
    }
  })

  let currentResolved = untrack(() => resolved)
  let currentObserver = createLiveQueryObserver(currentResolved.collection, {
    client: currentResolved.client,
    queryHash: currentResolved.queryHash,
    onPreload: currentResolved.resumeDeferredCollections,
  })
  const initialSnapshot =
    typeof window === `undefined` || context?.hydrating
      ? currentObserver.getServerSnapshot()
      : currentObserver.getSnapshot()

  // Reactive state that gets updated granularly through change events
  const state = new SvelteMap<string | number, any>(initialSnapshot.state ?? [])

  // Reactive data array that maintains sorted order
  let internalData = $state<Array<any>>(snapshotRows(initialSnapshot.data))

  // Track collection status reactively
  let status = $state(initialSnapshot.status)
  let persistedStatus = $state(initialSnapshot.persistedStatus)
  let persistedError = $state.raw<unknown>(initialSnapshot.persistedError)

  const syncFromObserver = (
    observer: LiveQueryObserver<any, any>,
    changes?: Array<ChangeMessage<any>>,
  ) => {
    const snapshot = observer.getSnapshot()
    status = snapshot.status as CollectionStatus
    persistedStatus = snapshot.persistedStatus
    persistedError = snapshot.persistedError
    untrack(() => {
      if (changes && changes.length > 0) {
        for (const change of changes) {
          switch (change.type) {
            case `insert`:
            case `update`:
              state.set(change.key, change.value)
              break
            case `delete`:
              state.delete(change.key)
              break
          }
        }
      } else {
        state.clear()
        for (const [key, value] of snapshot.state ?? []) {
          state.set(key, value)
        }
      }
      internalData = snapshotRows(snapshot.data)
    })
  }

  // Watch for collection changes and subscribe to updates
  $effect(() => {
    const nextResolved = resolved

    if (nextResolved !== currentResolved) {
      currentObserver.dispose()
      currentResolved = nextResolved
      currentObserver = createLiveQueryObserver(nextResolved.collection, {
        client: nextResolved.client,
        queryHash: nextResolved.queryHash,
        onPreload: nextResolved.resumeDeferredCollections,
      })
      syncFromObserver(currentObserver)
    }

    const observer = currentObserver

    const unsubscribe = observer.subscribe(
      (changes: Array<ChangeMessage<any>> | undefined) => {
        syncFromObserver(observer, changes)
      },
    )
    try {
      currentResolved.resumeDeferredCollections()
      syncFromObserver(observer)
    } catch (error) {
      unsubscribe()
      observer.dispose()
      throw error
    }

    // Cleanup when effect is invalidated
    return () => {
      unsubscribe()
      if (observer === currentObserver) observer.dispose()
    }
  })

  // Every read goes through the compiled query, so a query the hook rejected
  // throws on each read instead of serving the previous query's state.
  const readResolved = () => resolved

  return {
    get state() {
      readResolved()
      return state
    },
    get data() {
      const currentCollection = resolved.collection
      if (currentCollection && isSingleResultCollection(currentCollection)) {
        return internalData[0]
      }
      return internalData
    },
    get collection() {
      return getPublicCollection(resolved.collection)
    },
    get status() {
      readResolved()
      return status as CollectionStatus
    },
    get isLoading() {
      readResolved()
      return status === `loading`
    },
    get isReady() {
      readResolved()
      return status === `ready` || status === `disabled`
    },
    get persistedStatus() {
      readResolved()
      return persistedStatus
    },
    get isPersistedReady() {
      readResolved()
      return persistedStatus === `ready`
    },
    get persistedError() {
      readResolved()
      return persistedError
    },
    get isIdle() {
      readResolved()
      return status === `idle`
    },
    get isError() {
      readResolved()
      return status === `error`
    },
    get isCleanedUp() {
      readResolved()
      return status === `cleaned-up`
    },
  }
}
