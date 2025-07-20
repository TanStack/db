import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watchEffect,
} from "vue"
import { CollectionImpl, createLiveQueryCollection } from "@tanstack/db"
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
import type { ComputedRef, MaybeRefOrGetter } from "vue"

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
  state: () => Map<string | number, T>
  data: () => Array<T>
  collection: () => Collection<T, string | number, {}>
  status: () => CollectionStatus
  isLoading: ComputedRef<boolean>
  isReady: ComputedRef<boolean>
  isIdle: ComputedRef<boolean>
  isError: ComputedRef<boolean>
  isCleanedUp: ComputedRef<boolean>
}

export interface UseLiveQueryReturnWithCollection<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> {
  state: () => Map<TKey, T>
  data: () => Array<T>
  collection: () => Collection<T, TKey, TUtils>
  status: () => CollectionStatus
  isLoading: ComputedRef<boolean>
  isReady: ComputedRef<boolean>
  isIdle: ComputedRef<boolean>
  isError: ComputedRef<boolean>
  isCleanedUp: ComputedRef<boolean>
}

/**
 * Create a live query using a query function
 * @param queryFn - Query function that defines what data to fetch
 * @param deps - Array of reactive dependencies that trigger query re-execution when changed
 * @returns Reactive object with query data, state, and status information
 * @example
 * // Basic query with object syntax
 * const { data, isLoading } = useLiveQuery((q) =>
 *   q.from({ todos: todosCollection })
 *    .where(({ todos }) => eq(todos.completed, false))
 *    .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 * )
 *
 * @example
 * // With reactive dependencies
 * const minPriority = ref(5)
 * const { data, state } = useLiveQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority.value)),
 *   [minPriority] // Re-run when minPriority changes
 * )
 *
 * @example
 * // Join pattern
 * const { data } = useLiveQuery((q) =>
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
 * const { data, isLoading, isError, status } = useLiveQuery((q) =>
 *   q.from({ todos: todoCollection })
 * )
 *
 * // In template:
 * // <div v-if="isLoading">Loading...</div>
 * // <div v-else-if="isError">Error: {{ status }}</div>
 * // <ul v-else>
 * //   <li v-for="todo in data" :key="todo.id">{{ todo.text }}</li>
 * // </ul>
 */
// Overload 1: Accept just the query function
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): UseLiveQueryReturn<GetResult<TContext>>

/**
 * Create a live query using configuration object
 * @param config - Configuration object with query and options
 * @param deps - Array of reactive dependencies that trigger query re-execution when changed
 * @returns Reactive object with query data, state, and status information
 * @example
 * // Basic config object usage
 * const { data, status } = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection }),
 *   gcTime: 60000
 * })
 *
 * @example
 * // With reactive dependencies
 * const filter = ref('active')
 * const { data, isReady } = useLiveQuery({
 *   query: (q) => q.from({ todos: todosCollection })
 *                  .where(({ todos }) => eq(todos.status, filter.value))
 * }, [filter])
 *
 * @example
 * // Handle all states uniformly
 * const { data, isLoading, isReady, isError } = useLiveQuery({
 *   query: (q) => q.from({ items: itemCollection })
 * })
 *
 * // In template:
 * // <div v-if="isLoading">Loading...</div>
 * // <div v-else-if="isError">Something went wrong</div>
 * // <div v-else-if="!isReady">Preparing...</div>
 * // <div v-else>{{ data.length }} items loaded</div>
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: MaybeRefOrGetter<LiveQueryCollectionConfig<TContext>>
): UseLiveQueryReturn<GetResult<TContext>>

/**
 * Subscribe to an existing query collection (can be reactive)
 * @param liveQueryCollection - Pre-created query collection to subscribe to (can be a ref)
 * @returns Reactive object with query data, state, and status information
 * @example
 * // Using pre-created query collection
 * const myLiveQuery = createLiveQueryCollection((q) =>
 *   q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.active, true))
 * )
 * const { data, collection } = useLiveQuery(myLiveQuery)
 *
 * @example
 * // Reactive query collection reference
 * const selectedQuery = ref(todosQuery)
 * const { data, collection } = useLiveQuery(selectedQuery)
 *
 * // Switch queries reactively
 * selectedQuery.value = archiveQuery
 *
 * @example
 * // Access query collection methods directly
 * const { data, collection, isReady } = useLiveQuery(existingQuery)
 *
 * // Use underlying collection for mutations
 * const handleToggle = (id) => {
 *   collection.value.update(id, draft => { draft.completed = !draft.completed })
 * }
 *
 * @example
 * // Handle states consistently
 * const { data, isLoading, isError } = useLiveQuery(sharedQuery)
 *
 * // In template:
 * // <div v-if="isLoading">Loading...</div>
 * // <div v-else-if="isError">Error loading data</div>
 * // <div v-else>
 * //   <Item v-for="item in data" :key="item.id" v-bind="item" />
 * // </div>
 */
// Overload 3: Accept pre-created live query collection (can be reactive)
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeRefOrGetter<Collection<TResult, TKey, TUtils>>
): UseLiveQueryReturnWithCollection<TResult, TKey, TUtils>

// Implementation
export function useLiveQuery(
  configOrQueryOrCollection: any
): UseLiveQueryReturn<any> | UseLiveQueryReturnWithCollection<any, any, any> {
  const collection = computed(() => {
    if (
      typeof configOrQueryOrCollection === `function` &&
      configOrQueryOrCollection.length === 1
    ) {
      return createLiveQueryCollection({
        query: configOrQueryOrCollection,
        startSync: true,
      })
    }

    const configOrQueryOrCollectionVal = toValue(configOrQueryOrCollection)

    if (configOrQueryOrCollectionVal instanceof CollectionImpl) {
      configOrQueryOrCollectionVal.startSyncImmediate()
      return configOrQueryOrCollectionVal
    }

    return createLiveQueryCollection({
      ...configOrQueryOrCollectionVal,
      startSync: true,
    })
  })

  // Reactive state that gets updated granularly through change events
  const state = ref(new Map<string | number, any>())

  // Reactive data array that maintains sorted order
  const internalData = shallowRef<Array<any>>([])

  // Track collection status reactively
  const status = shallowRef(collection.value.status)

  // Helper to sync data array from collection in correct order
  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>
  ) => {
    internalData.value = Array.from(currentCollection.values())
  }

  // Track current unsubscribe function
  let unsub: (() => void) | null = null
  const clean = () => {
    if (unsub) {
      unsub()
      unsub = null
    }
  }

  watchEffect(() => {
    clean()

    const collectionVal = collection.value

    // Update status ref whenever the effect runs
    status.value = collectionVal.status

    // Initialize state with current collection data
    state.value = new Map(collectionVal.entries())

    // Initialize data array in correct order
    syncDataFromCollection(collectionVal)

    // Subscribe to collection changes with granular updates
    unsub = collectionVal.subscribeChanges(
      (changes: Array<ChangeMessage<any>>) => {
        // Apply each change individually to the reactive state
        for (const change of changes) {
          switch (change.type) {
            case `insert`:
            case `update`:
              state.value.set(change.key, change.value)
              break
            case `delete`:
              state.value.delete(change.key)
              break
          }
        }

        // Update the data array to maintain sorted order
        syncDataFromCollection(collectionVal)
        // Update status ref on every change
        status.value = collectionVal.status
      }
    )

    // Preload collection data if not already started
    if (collectionVal.status === `idle`) {
      collectionVal.preload().catch(console.error)
    }
  })

  // Cleanup
  if (getCurrentScope()) {
    onScopeDispose(clean)
  }

  return {
    state: () => state.value,
    data: () => internalData.value,
    collection: () => collection.value,
    status: () => status.value,
    // TODO: () => val
    isLoading: computed(
      () => status.value === `loading` || status.value === `initialCommit`
    ),
    isReady: computed(() => status.value === `ready`),
    isIdle: computed(() => status.value === `idle`),
    isError: computed(() => status.value === `error`),
    isCleanedUp: computed(() => status.value === `cleaned-up`),
  }
}
