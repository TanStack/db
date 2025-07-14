import {
  computed,
  getCurrentInstance,
  onUnmounted,
  reactive,
  ref,
  toValue,
  watchEffect,
} from "vue"
import { createLiveQueryCollection } from "@tanstack/db"
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
  state: ComputedRef<Map<string | number, T>>
  data: ComputedRef<Array<T>>
  collection: ComputedRef<Collection<T, string | number, {}>>
  status: ComputedRef<CollectionStatus>
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
  state: ComputedRef<Map<TKey, T>>
  data: ComputedRef<Array<T>>
  collection: ComputedRef<Collection<T, TKey, TUtils>>
  status: ComputedRef<CollectionStatus>
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
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>
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
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>
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
  configOrQueryOrCollection: any,
  deps: Array<MaybeRefOrGetter<unknown>> = []
): UseLiveQueryReturn<any> | UseLiveQueryReturnWithCollection<any, any, any> {
  const collection = computed(() => {
    // First check if the original parameter might be a ref/getter
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
      // It's already a collection, ensure sync is started for Vue hooks
      unwrappedParam.startSyncImmediate()
      return unwrappedParam
    }

    // Reference deps to make computed reactive to them
    deps.forEach((dep) => toValue(dep))

    // Ensure we always start sync for Vue hooks
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
  const state = reactive(new Map<string | number, any>())

  // Reactive data array that maintains sorted order
  const internalData = reactive<Array<any>>([])

  // Computed wrapper for the data to match expected return type
  const data = computed(() => internalData)

  // Track collection status reactively
  const status = ref(collection.value.status)

  // Helper to sync data array from collection in correct order
  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>
  ) => {
    internalData.length = 0
    internalData.push(...Array.from(currentCollection.values()))
  }

  // Track current unsubscribe function
  let currentUnsubscribe: (() => void) | null = null

  // Watch for collection changes and subscribe to updates
  watchEffect((onInvalidate) => {
    const currentCollection = collection.value

    // Update status ref whenever the effect runs
    status.value = currentCollection.status

    // Clean up previous subscription
    if (currentUnsubscribe) {
      currentUnsubscribe()
    }

    // Initialize state with current collection data
    state.clear()
    for (const [key, value] of currentCollection.entries()) {
      state.set(key, value)
    }

    // Initialize data array in correct order
    syncDataFromCollection(currentCollection)

    // Subscribe to collection changes with granular updates
    currentUnsubscribe = currentCollection.subscribeChanges(
      (changes: Array<ChangeMessage<any>>) => {
        // Apply each change individually to the reactive state
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

        // Update the data array to maintain sorted order
        syncDataFromCollection(currentCollection)
        // Update status ref on every change
        status.value = currentCollection.status
      }
    )

    // Preload collection data if not already started
    if (currentCollection.status === `idle`) {
      currentCollection.preload().catch(console.error)
    }

    // Cleanup when effect is invalidated
    onInvalidate(() => {
      if (currentUnsubscribe) {
        currentUnsubscribe()
        currentUnsubscribe = null
      }
    })
  })

  // Cleanup on unmount (only if we're in a component context)
  const instance = getCurrentInstance()
  if (instance) {
    onUnmounted(() => {
      if (currentUnsubscribe) {
        currentUnsubscribe()
      }
    })
  }

  return {
    state: computed(() => state),
    data,
    collection: computed(() => collection.value),
    status: computed(() => status.value),
    isLoading: computed(
      () => status.value === `loading` || status.value === `initialCommit`
    ),
    isReady: computed(() => status.value === `ready`),
    isIdle: computed(() => status.value === `idle`),
    isError: computed(() => status.value === `error`),
    isCleanedUp: computed(() => status.value === `cleaned-up`),
  }
}
