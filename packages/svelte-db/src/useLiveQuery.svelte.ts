import { untrack } from "svelte"
import { createLiveQueryCollection } from "@tanstack/db"
import { SvelteMap } from "svelte/reactivity"
import type {
  ChangeMessage,
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"

/**
 * Return type for useLiveQuery hook
 * @property state - Reactive Map of query results (key → item)
 * @property data - Reactive array of query results in order
 * @property collection - The underlying query collection instance
 * @property status - Current query status
 * @property isLoading - True while initial query data is loading
 * @property isReady - True when query has received first data and is ready
 * @property isIdle - True when query hasn't started yet
 * @property isError - True when query encountered an error
 * @property isCleanedUp - True when query has been cleaned up
 */
export interface UseLiveQueryReturn<T extends object> {
  state: Map<string | number, T>
  data: Array<T>
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
> {
  state: Map<TKey, T>
  data: Array<T>
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
 * @example
 * // Basic query with object syntax
 * const todosQuery = useLiveQuery((q) =>
 *   q.from({ todos: todosCollection })
 *    .where(({ todos }) => eq(todos.completed, false))
 *    .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 * )
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
// Overload 1: Accept just the query function
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<() => unknown>
): UseLiveQueryReturn<GetResult<TContext>>

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
  deps?: Array<() => unknown>
): UseLiveQueryReturn<GetResult<TContext>>

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
// Overload 3: Accept pre-created live query collection (can be reactive)
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeGetter<Collection<TResult, TKey, TUtils>>
): UseLiveQueryReturnWithCollection<TResult, TKey, TUtils>

// Implementation
export function useLiveQuery(
  configOrQueryOrCollection: any,
  deps: Array<() => unknown> = []
): UseLiveQueryReturn<any> | UseLiveQueryReturnWithCollection<any, any, any> {
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
      unwrappedParam.startSyncImmediate()
      return unwrappedParam
    }

    // Reference deps to make computed reactive to them
    deps.forEach((dep) => toValue(dep))

    // Ensure we always start sync for Svelte helpers
    if (typeof unwrappedParam === `function`) {
      return createLiveQueryCollection({
        query: unwrappedParam,
        startSync: true,
      })
    } else {
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
  let status = $state(collection.status)

  // Helper to sync data array from collection in correct order
  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>
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

    // Subscribe to collection changes with granular updates
    currentUnsubscribe = currentCollection.subscribeChanges(
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
      }
    )

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

  return {
    get state() {
      return state
    },
    get data() {
      return internalData
    },
    get collection() {
      return collection
    },
    get status() {
      return status
    },
    get isLoading() {
      return status === `loading` || status === `initialCommit`
    },
    get isReady() {
      return status === `ready`
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
