import {
  computed,
  getCurrentInstance,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  toValue,
  watchEffect,
} from 'vue'
import {
  createLiveQueryObserver,
  getLiveQueryStatusFlags,
  getPublicCollection,
  isCollection,
  isSingleResultCollection,
  resolveLiveQueryValue,
} from '@tanstack/db'
import type {
  ChangeMessage,
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  HealthNode,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryHookConfig,
  LiveQueryObserver,
  LiveQueryStatusFlags,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from '@tanstack/db'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

const DEFAULT_GC_TIME_MS = 1

/** Copy a snapshot's ordered rows; a single-result query's `data` is one row. */
function snapshotRows(data: unknown): Array<any> {
  if (Array.isArray(data)) return [...data]
  return data === undefined ? [] : [data]
}

/**
 * Return type for useLiveQuery hook
 * @property state - Reactive Map of query results (key → item)
 * @property data - Reactive array of query results in order, or single result for findOne queries
 * @property collection - The underlying query collection instance
 * @property status - Current query status
 * @property isLoading - True while initial query data is loading
 * @property isReady - True when query has received first data and is ready
 * @property isIdle - True when query hasn't started yet
 * @property isLoadingError - True when the first load failed
 * @property isCleanedUp - True when query has been cleaned up
 */
/** The status and flag refs every `useLiveQuery` result has. */
export type UseLiveQueryFlags = {
  status: ComputedRef<CollectionStatus>
} & {
  [K in keyof LiveQueryStatusFlags]: ComputedRef<LiveQueryStatusFlags[K]>
}

export interface UseLiveQueryReturn<
  TContext extends Context,
> extends UseLiveQueryFlags {
  state: ComputedRef<Map<string | number, GetResult<TContext>>>
  data: ComputedRef<InferResultType<TContext>>
  collection: ComputedRef<Collection<GetResult<TContext>, string | number, {}>>
}

type InferConditionalResultType<TContext extends Context> =
  TContext extends SingleResult
    ? InferResultType<TContext> | []
    : InferResultType<TContext>

export type ConditionalUseLiveQueryReturn<TContext extends Context> = Omit<
  UseLiveQueryReturn<TContext>,
  `data` | `collection` | `status`
> & {
  data: ComputedRef<InferConditionalResultType<TContext>>
  collection: ComputedRef<Collection<
    GetResult<TContext>,
    string | number,
    {}
  > | null>
  status: ComputedRef<CollectionStatus | `disabled`>
}

export interface UseLiveQueryReturnWithCollection<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> extends UseLiveQueryFlags {
  state: ComputedRef<Map<TKey, T>>
  data: ComputedRef<Array<T>>
  collection: ComputedRef<Collection<T, TKey, TUtils>>
}

export interface UseLiveQueryReturnWithSingleResultCollection<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> extends UseLiveQueryFlags {
  state: ComputedRef<Map<TKey, T>>
  data: ComputedRef<T | undefined>
  collection: ComputedRef<Collection<T, TKey, TUtils> & SingleResult>
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
 * const { data, isLoading, isLoadingError, status } = useLiveQuery((q) =>
 *   q.from({ todos: todoCollection })
 * )
 *
 * // In template:
 * // <div v-if="isLoading">Loading...</div>
 * // <div v-else-if="isLoadingError">Error: {{ status }}</div>
 * // <ul v-else>
 * //   <li v-for="todo in data" :key="todo.id">{{ todo.text }}</li>
 * // </ul>
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>,
): UseLiveQueryReturn<TContext>

// Overload 1b: Accept query function that can return undefined/null
export function useLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
  deps?: Array<MaybeRefOrGetter<unknown>>,
): ConditionalUseLiveQueryReturn<TContext>

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
 * const { data, isLoading, isReady, isLoadingError } = useLiveQuery({
 *   query: (q) => q.from({ items: itemCollection })
 * })
 *
 * // In template:
 * // <div v-if="isLoading">Loading...</div>
 * // <div v-else-if="isLoadingError">Something went wrong</div>
 * // <div v-else-if="!isReady">Preparing...</div>
 * // <div v-else>{{ data.length }} items loaded</div>
 */
// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: LiveQueryHookConfig<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>,
): UseLiveQueryReturn<TContext>

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
 * const { data, isLoading, isLoadingError } = useLiveQuery(sharedQuery)
 *
 * // In template:
 * // <div v-if="isLoading">Loading...</div>
 * // <div v-else-if="isLoadingError">Error loading data</div>
 * // <div v-else>
 * //   <Item v-for="item in data" :key="item.id" v-bind="item" />
 * // </div>
 */
// Overload 3: Accept pre-created live query collection (can be reactive) - non-single result
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeRefOrGetter<
    Collection<TResult, TKey, TUtils> & NonSingleResult
  >,
): UseLiveQueryReturnWithCollection<TResult, TKey, TUtils>

// Overload 4: Accept pre-created live query collection with singleResult: true
export function useLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeRefOrGetter<
    Collection<TResult, TKey, TUtils> & SingleResult
  >,
): UseLiveQueryReturnWithSingleResultCollection<TResult, TKey, TUtils>

// Implementation
export function useLiveQuery(
  configOrQueryOrCollection: any,
  deps: Array<MaybeRefOrGetter<unknown>> = [],
): UseLiveQueryReturn<any> | UseLiveQueryReturnWithCollection<any, any, any> {
  let previousCollection: ReturnType<typeof resolveLiveQueryValue> = null
  const resolveNext = (value: unknown) =>
    (previousCollection = resolveLiveQueryValue(value, {
      gcTime: DEFAULT_GC_TIME_MS,
      previousCollection,
      windowOwner: resolveNext,
    }))
  const resolveInput = () => {
    // First check if the original parameter might be a ref/getter
    // by seeing if toValue returns something different than the original
    // NOTE: Don't call toValue on functions - toValue treats functions as getters and calls them!
    let unwrappedParam = configOrQueryOrCollection
    if (typeof configOrQueryOrCollection !== `function`) {
      try {
        const potentiallyUnwrapped = toValue(configOrQueryOrCollection)
        if (potentiallyUnwrapped !== configOrQueryOrCollection) {
          unwrappedParam = potentiallyUnwrapped
        }
      } catch {
        // If toValue fails, use original parameter
        unwrappedParam = configOrQueryOrCollection
      }
    }

    // Check if it's already a collection
    const inputIsCollection = isCollection(unwrappedParam)

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
      // It's already a collection, ensure sync is started for Vue hooks
      // Only start sync if the collection is in idle state
      if (unwrappedParam.status === `idle`) {
        unwrappedParam.startSyncImmediate()
      }
      previousCollection = null
      return unwrappedParam
    }

    // Reference deps to make computed reactive to them
    deps.forEach((dep) => toValue(dep))

    // The shared resolver prepares query callbacks and disabled inputs.
    return resolveNext(unwrappedParam)
  }
  // The input's live-query Collection, or the error resolving it threw. A
  // Vue computed that throws serves its previous value on the next read, so
  // this one never throws; each reader rethrows the error.
  const resolved = computed(
    (): {
      collection?: ReturnType<typeof resolveInput>
      error?: unknown
    } => {
      try {
        return { collection: resolveInput() }
      } catch (error) {
        return { error }
      }
    },
  )
  const collection = computed(() => {
    const { collection: current, error } = resolved.value
    if (error !== undefined) throw error
    return current
  })

  // Reactive state that gets updated granularly through change events
  const state = reactive(new Map<string | number, any>())

  // Reactive data array that maintains sorted order
  const internalData = ref<Array<any>>([])

  // Returns single item for singleResult collections, array otherwise. The
  // effect below sets `singleResult`, so reading data never compiles a query.
  const singleResult = ref(false)
  const data = computed(() =>
    singleResult.value ? internalData.value[0] : internalData.value,
  )

  // Track collection status reactively
  const status = ref(
    collection.value ? collection.value.status : (`disabled` as const),
  )
  const health = shallowRef<HealthNode | undefined>(undefined)
  // Every status flag comes from the shared rule; a disabled query is ready.
  const flags = computed(() =>
    getLiveQueryStatusFlags(status.value as CollectionStatus, health.value),
  )

  // The shared observer owns subscription, the ready-race, and status; Vue
  // materializes into its own reactive map (granular) + ordered array.
  let currentObserver: LiveQueryObserver<any, any> | null = null

  const syncFromObserver = (observer: LiveQueryObserver<any, any>) => {
    const snapshot = observer.getSnapshot()
    status.value = snapshot.status as CollectionStatus
    health.value = snapshot.health
    internalData.value = snapshotRows(snapshot.data)
  }

  // Watch for collection changes and subscribe to updates
  watchEffect((onInvalidate) => {
    // Tear down any previous observer and its rows first: a query that fails
    // to compile throws below, and Vue's computed then serves the previous
    // collection, whose rows must not stay visible.
    currentObserver?.dispose()
    currentObserver = null
    state.clear()
    internalData.value = []

    const { collection: currentCollection, error } = resolved.value
    if (error !== undefined) throw error
    singleResult.value =
      !!currentCollection && isSingleResultCollection(currentCollection)

    // Handle null collection (disabled query)
    if (!currentCollection) {
      status.value = `disabled` as const
      health.value = undefined
      return
    }

    // Initial rows arrive as the observer's first delta (includeInitialState);
    // apply them and every subsequent delta granularly to the reactive map.
    const observer = createLiveQueryObserver(currentCollection)
    currentObserver = observer

    const unsubscribe = observer.subscribe(
      (changes: Array<ChangeMessage<any>> | undefined) => {
        if (changes) {
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
          // Cleanup and other status-only publications carry no row deltas.
          // Rebuild the keyed view so it cannot diverge from ordered data.
          state.clear()
          for (const [key, value] of observer.getSnapshot().state ?? []) {
            state.set(key, value)
          }
        }
        syncFromObserver(observer)
      },
    )
    syncFromObserver(observer)

    // Cleanup when effect is invalidated
    onInvalidate(() => {
      unsubscribe()
      observer.dispose()
      currentObserver = null
    })
  })

  // Cleanup on unmount (only if we're in a component context)
  const instance = getCurrentInstance()
  if (instance) {
    onUnmounted(() => currentObserver?.dispose())
  }

  return {
    state: computed(() => state),
    data,
    collection: computed(() => getPublicCollection(collection.value)),
    status: computed(() => status.value),
    isLoading: computed(() => flags.value.isLoading),
    isReady: computed(() => flags.value.isReady || status.value === `disabled`),
    isIdle: computed(() => flags.value.isIdle),
    isLoadingError: computed(() => flags.value.isLoadingError),
    isCrashed: computed(() => flags.value.isCrashed),
    isCleanedUp: computed(() => flags.value.isCleanedUp),
    isSyncError: computed(() => flags.value.isSyncError),
    health: computed(() => health.value),
  }
}
