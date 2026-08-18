// eslint-disable-next-line import/no-duplicates -- See https://github.com/un-ts/eslint-plugin-import-x/issues/308
import { untrack } from 'svelte'
// eslint-disable-next-line import/no-duplicates -- See https://github.com/un-ts/eslint-plugin-import-x/issues/308
import { SvelteMap } from 'svelte/reactivity'
import {
  BaseQueryBuilder,
  UnhashableQueryIRError,
  createLiveQueryCollection,
  createLiveQueryObserver,
  getLiveQueryHash,
  getStableValueHash,
  isCollection,
  isSingleResultCollection,
  prepareLiveQueryValue,
} from '@tanstack/db'
import { useOptionalDbClient } from './db-context.js'
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
  LiveQueryCollectionConfig,
  LiveQueryKey,
  LiveQueryObserver,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'

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
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
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
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
}

type MaybeGetter<T> = T | (() => T)

export type UseLiveQueryConfig<TContext extends Context> =
  LiveQueryCollectionConfig<TContext> & {
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
): UseLiveQueryReturn<
  GetResult<TContext>,
  InferResultType<TContext> | undefined
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
  const contextDbClient = useOptionalDbClient()

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

    let queryHash: string | undefined
    try {
      queryHash =
        deps.length > 0 && !queryKey
          ? getStableValueHash(
              [`deps`, dependencyValues, getLiveQueryHash(preparedValue)],
              `queryKey`,
            )
          : getLiveQueryHash(preparedValue, queryKey)
    } catch (error) {
      if (!(error instanceof UnhashableQueryIRError)) throw error
      if (queryKey !== undefined) throw error
    }

    let collection: Collection<any, any, any> | null
    if (preparedValue === undefined || preparedValue === null) {
      collection = null
    } else if (isCollection(preparedValue)) {
      collection = preparedValue
    } else if (preparedValue instanceof BaseQueryBuilder) {
      collection = createLiveQueryCollection({
        query: preparedValue,
        startSync: true,
      })
    } else {
      collection = createLiveQueryCollection({
        ...(preparedValue as LiveQueryCollectionConfig<any>),
        startSync: true,
      })
    }

    return {
      collection,
      client: dbClient,
      queryHash,
      resumeDeferredCollections: () => {
        for (const deferredCollection of deferredCollections) {
          deferredCollection._resumeSyncStart()
        }
        deferredCollections.clear()
      },
    }
  })

  let currentResolved = untrack(() => resolved)
  let currentObserver = createLiveQueryObserver(currentResolved.collection, {
    client: currentResolved.client,
    queryHash: currentResolved.queryHash,
    onPreload: currentResolved.resumeDeferredCollections,
  })
  const initialSnapshot = currentObserver.getServerSnapshot()

  // Reactive state that gets updated granularly through change events
  const state = new SvelteMap<string | number, any>(initialSnapshot.state ?? [])

  // Reactive data array that maintains sorted order
  let internalData = $state<Array<any>>(
    Array.from(initialSnapshot.state?.values() ?? []),
  )

  // Track collection status reactively
  let status = $state(initialSnapshot.status)

  const syncFromObserver = (
    observer: LiveQueryObserver<any, any>,
    changes?: Array<ChangeMessage<any>>,
  ) => {
    const snapshot = observer.getSnapshot()
    status = snapshot.status as CollectionStatus
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
      internalData = Array.from(snapshot.state?.values() ?? [])
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
    currentResolved.resumeDeferredCollections()
    syncFromObserver(observer)

    // Cleanup when effect is invalidated
    return () => {
      unsubscribe()
      if (observer === currentObserver) observer.dispose()
    }
  })

  return {
    get state() {
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
      return resolved.collection
    },
    get status() {
      return status as CollectionStatus
    },
    get isLoading() {
      return status === `loading`
    },
    get isReady() {
      return status === `ready` || status === `disabled`
    },
    get isIdle() {
      return status === `idle`
    },
    get isError() {
      return status === `error`
    },
    get isCleanedUp() {
      return status === `cleaned-up`
    },
  }
}
