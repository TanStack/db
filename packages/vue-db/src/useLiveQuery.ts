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
  Context,
  GetResult,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"
import type { ComputedRef, MaybeRefOrGetter } from "vue"

export interface UseLiveQueryReturn<T extends object> {
  state: ComputedRef<Map<string | number, T>>
  data: ComputedRef<Array<T>>
  collection: ComputedRef<Collection<T, string | number, {}>>
  isReady: ComputedRef<boolean>
}

export interface UseLiveQueryReturnWithCollection<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> {
  state: ComputedRef<Map<TKey, T>>
  data: ComputedRef<Array<T>>
  collection: ComputedRef<Collection<T, TKey, TUtils>>
  isReady: ComputedRef<boolean>
}

// Overload 1: Accept just the query function
export function useLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>
): UseLiveQueryReturn<GetResult<TContext>>

// Overload 2: Accept config object
export function useLiveQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>
): UseLiveQueryReturn<GetResult<TContext>>

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
    isReady: computed(
      () => status.value === `ready` || status.value === `initialCommit`
    ),
  }
}
