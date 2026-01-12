// eslint-disable-next-line import/no-duplicates -- See https://github.com/un-ts/eslint-plugin-import-x/issues/308
import { untrack } from 'svelte'
// eslint-disable-next-line import/no-duplicates -- See https://github.com/un-ts/eslint-plugin-import-x/issues/308
import { SvelteMap } from 'svelte/reactivity'
import { BaseQueryBuilder, createLiveQueryCollection } from '@tanstack/db'
import { getHydrationContext, useHydratedQuery } from './hydration.svelte'
import type {
  ChangeMessage,
  Collection,
  CollectionConfigSingleRowOption,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
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
  config: LiveQueryCollectionConfig<TContext>,
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
  // Extract query ID from config object (not from collections or functions)
  // Only config objects support id for SSR hydration matching
  const queryId =
    typeof configOrQueryOrCollection === `object` &&
    configOrQueryOrCollection !== null &&
    `id` in configOrQueryOrCollection &&
    typeof configOrQueryOrCollection.subscribeChanges !== `function` // Not a collection
      ? configOrQueryOrCollection.id
      : undefined

  // Get hydration context and hydrated data
  const hydrationState = getHydrationContext()
  const hydratedData = queryId ? useHydratedQuery(queryId) : undefined

  const collection = $derived.by(() => {
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
    const isCollection =
      unwrappedParam &&
      typeof unwrappedParam === `object` &&
      typeof unwrappedParam.subscribeChanges === `function` &&
      typeof unwrappedParam.startSyncImmediate === `function` &&
      typeof unwrappedParam.id === `string`

    if (isCollection) {
      // It's already a collection, ensure sync is started for Svelte helpers
      // Only start sync if the collection is in idle state
      if (unwrappedParam.status === `idle`) {
        unwrappedParam.startSyncImmediate()
      }
      return unwrappedParam
    }

    // Reference deps to make computed reactive to them
    deps.forEach((dep) => toValue(dep))

    // Ensure we always start sync for Svelte helpers
    if (typeof unwrappedParam === `function`) {
      // Check if query function returns null/undefined (disabled query)
      const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
      const result = unwrappedParam(queryBuilder)

      if (result === undefined || result === null) {
        // Disabled query - return null
        return null
      }

      return createLiveQueryCollection({
        query: unwrappedParam,
        startSync: true,
      })
    } else {
      // Config object case - check if query returns null/undefined
      const queryFn = unwrappedParam.query
      if (typeof queryFn === `function`) {
        const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
        const result = queryFn(queryBuilder)
        if (result === undefined || result === null) {
          // Disabled query - return null
          return null
        }
      }

      return createLiveQueryCollection({
        ...unwrappedParam,
        startSync: true,
      })
    }
  })

  // Reactive state that gets updated granularly through change events
  const state = new SvelteMap<string | number, any>()

  // Reactive data array that maintains sorted order
  let internalData = $state<Array<any>>([])

  // Track collection status reactively
  let status = $state(collection ? collection.status : (`disabled` as const))

  // Helper to sync data array from collection in correct order
  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>,
  ) => {
    untrack(() => {
      internalData = []
      internalData.push(...Array.from(currentCollection.values()))
    })
  }

  // Track current unsubscribe function
  let currentUnsubscribe: (() => void) | null = null

  // Watch for collection changes and subscribe to updates
  $effect(() => {
    const currentCollection = collection

    // Handle null collection (disabled query)
    if (!currentCollection) {
      status = `disabled` as const
      untrack(() => {
        state.clear()
        internalData = []
      })
      if (currentUnsubscribe) {
        currentUnsubscribe()
        currentUnsubscribe = null
      }
      return
    }

    // Update status state whenever the effect runs
    status = currentCollection.status

    // Clean up previous subscription
    if (currentUnsubscribe) {
      currentUnsubscribe()
    }

    // Initialize state with current collection data
    untrack(() => {
      state.clear()
      for (const [key, value] of currentCollection.entries()) {
        state.set(key, value)
      }
    })

    // Initialize data array in correct order
    syncDataFromCollection(currentCollection)

    // Listen for the first ready event to catch status transitions
    // that might not trigger change events (fixes async status transition bug)
    currentCollection.onFirstReady(() => {
      // Update status directly - Svelte's reactivity system handles the update automatically
      // Note: We cannot use flushSync here as it's disallowed inside effects in async mode
      status = currentCollection.status
    })

    // Subscribe to collection changes with granular updates
    const subscription = currentCollection.subscribeChanges(
      (changes: Array<ChangeMessage<any>>) => {
        // Apply each change individually to the reactive state
        untrack(() => {
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
        })

        // Update the data array to maintain sorted order
        syncDataFromCollection(currentCollection)
        // Update status state on every change
        status = currentCollection.status
      },
      {
        includeInitialState: true,
      },
    )

    currentUnsubscribe = subscription.unsubscribe.bind(subscription)

    // Preload collection data if not already started
    if (currentCollection.status === `idle`) {
      currentCollection.preload().catch(console.error)
    }

    // Cleanup when effect is invalidated
    return () => {
      if (currentUnsubscribe) {
        currentUnsubscribe()
        currentUnsubscribe = null
      }
    }
  })

  // Check if we should use hydrated data
  // Use hydrated data if:
  // 1. We have hydrated data
  // 2. The collection is empty (no data loaded yet)
  const shouldUseHydratedData = () =>
    hydratedData !== undefined && internalData.length === 0

  // Dev-mode hint: warn if hydrationState exists (SSR setup) but query has id and no matching data
  // This catches the case where HydrationBoundary is present but this specific query wasn't prefetched
  if (
    process.env.NODE_ENV !== `production` &&
    hydrationState && // Only warn if we're in an SSR environment with HydrationBoundary
    queryId &&
    hydratedData === undefined
  ) {
    console.warn(
      `TanStack DB: no hydrated data found for id "${queryId}" — did you prefetch this query on the server with prefetchLiveQuery()?`,
    )
  }

  return {
    get state() {
      // If using hydrated data, convert to Map
      if (shouldUseHydratedData()) {
        const currentCollection = collection
        const config = currentCollection?.config as
          | CollectionConfigSingleRowOption<any, any, any>
          | undefined
        const hydrated = Array.isArray(hydratedData)
          ? hydratedData
          : [hydratedData]
        return new Map(
          hydrated.map((item, index) => {
            // Try to use getKey if available, otherwise use index
            const key =
              config && typeof config.getKey === `function`
                ? config.getKey(item)
                : index
            return [key, item]
          }),
        )
      }
      return state
    },
    get data() {
      // If using hydrated data, return it directly
      if (shouldUseHydratedData()) {
        const currentCollection = collection
        if (currentCollection) {
          const config =
            currentCollection.config as CollectionConfigSingleRowOption<
              any,
              any,
              any
            >
          if (config.singleResult) {
            return Array.isArray(hydratedData) ? hydratedData[0] : hydratedData
          }
        }
        // Ensure array when singleResult is false
        return Array.isArray(hydratedData) ? hydratedData : [hydratedData]
      }

      // Normal case: use collection data
      const currentCollection = collection
      if (currentCollection) {
        const config =
          currentCollection.config as CollectionConfigSingleRowOption<
            any,
            any,
            any
          >
        if (config.singleResult) {
          return internalData[0]
        }
      }
      return internalData
    },
    get collection() {
      return collection
    },
    get status() {
      return status
    },
    get isLoading() {
      return status === `loading`
    },
    get isReady() {
      // Consider hydrated data as "ready enough" for UI
      return (
        status === `ready` || status === `disabled` || shouldUseHydratedData()
      )
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
