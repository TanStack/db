import {
  computed,
  getCurrentInstance,
  onUnmounted,
  ref,
  toValue,
  watchEffect,
} from "vue"
import { BaseQueryBuilder, createLiveQueryCollection } from "@tanstack/db"
import type {
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
}

export interface UseLiveQueryReturnWithCollection<
  T extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> {
  state: ComputedRef<Map<TKey, T>>
  data: ComputedRef<Array<T>>
  collection: ComputedRef<Collection<T, TKey, TUtils>>
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

// Overload 4: Accept a predefined QueryBuilder (can be reactive)
export function useLiveQuery<TContext extends Context>(
  queryBuilder: MaybeRefOrGetter<QueryBuilder<TContext>>,
  deps?: Array<MaybeRefOrGetter<unknown>>
): UseLiveQueryReturn<GetResult<TContext>>

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

    // Check if it's a QueryBuilder instance
    const isQueryBuilder = unwrappedParam instanceof BaseQueryBuilder

    if (isQueryBuilder) {
      // It's a predefined QueryBuilder, create a live query collection from it
      const queryBuilderCollection = createLiveQueryCollection(
        unwrappedParam as QueryBuilder<any>
      )
      queryBuilderCollection.startSyncImmediate()
      return queryBuilderCollection
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

  // Reactive state that updates when collection changes
  const state = ref<Map<string | number, any>>(new Map())
  const data = ref<Array<any>>([])

  // Track current unsubscribe function
  let currentUnsubscribe: (() => void) | null = null

  // Watch for collection changes and subscribe to updates
  watchEffect((onInvalidate) => {
    const currentCollection = collection.value

    // Clean up previous subscription
    if (currentUnsubscribe) {
      currentUnsubscribe()
    }

    // Update initial state function
    const updateState = () => {
      const newEntries = new Map<string | number, any>(
        currentCollection.entries()
      )
      const newData = Array.from(currentCollection.values())

      // Force Vue reactivity by creating new references
      state.value = newEntries
      data.value = newData
    }

    // Set initial state
    updateState()

    // Subscribe to collection changes
    currentUnsubscribe = currentCollection.subscribeChanges(() => {
      updateState()
    })

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
    state: computed(() => state.value),
    data: computed(() => data.value),
    collection: computed(() => collection.value),
  }
}
