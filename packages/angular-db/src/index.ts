import {
  DestroyRef,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core"
import { createLiveQueryCollection } from "@tanstack/db"
import type {
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"
import type { Signal } from "@angular/core"

export function injectLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>
): {
  state: Signal<Map<string | number, GetResult<TContext>>>
  data: Signal<Array<GetResult<TContext>>>
  collection: Signal<
    Collection<GetResult<TContext>, string | number, Record<string, never>>
  >
  status: Signal<CollectionStatus>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
}
export function injectLiveQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>
): {
  state: Signal<Map<string | number, GetResult<TContext>>>
  data: Signal<Array<GetResult<TContext>>>
  collection: Signal<
    Collection<GetResult<TContext>, string | number, Record<string, never>>
  >
  status: Signal<CollectionStatus>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
}
export function injectLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils>
): {
  state: Signal<Map<TKey, TResult>>
  data: Signal<Array<TResult>>
  collection: Signal<Collection<TResult, TKey, TUtils>>
  status: Signal<CollectionStatus>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
}
export function injectLiveQuery(configOrQueryOrCollection: any) {
  assertInInjectionContext(injectLiveQuery)
  const destroyRef = inject(DestroyRef)

  const state = signal<Map<any, any>>(new Map())
  const data = signal<Array<any>>([])

  // Check if it's an existing collection
  const isExistingCollection =
    configOrQueryOrCollection &&
    typeof configOrQueryOrCollection === `object` &&
    typeof configOrQueryOrCollection.subscribeChanges === `function` &&
    typeof configOrQueryOrCollection.startSyncImmediate === `function` &&
    typeof configOrQueryOrCollection.id === `string`

  // Create or use existing collection
  const collection = isExistingCollection
    ? configOrQueryOrCollection
    : typeof configOrQueryOrCollection === `function`
      ? createLiveQueryCollection({
          query: configOrQueryOrCollection,
          startSync: true,
          gcTime: 0,
        })
      : createLiveQueryCollection({
          startSync: true,
          gcTime: 0,
          ...configOrQueryOrCollection,
        })

  let unsub: (() => void) | null = null

  effect((onCleanup) => {
    // Initialize state
    state.set(new Map(collection.entries()))
    data.set(Array.from(collection.values()))

    // Subscribe to changes
    unsub?.()
    unsub = collection.subscribeChanges(() => {
      state.set(new Map(collection.entries()))
      data.set(Array.from(collection.values()))
    })

    // Ensure sync started
    collection.startSyncImmediate()

    onCleanup(() => {
      unsub?.()
      unsub = null
    })
  })

  destroyRef.onDestroy(() => {
    unsub?.()
  })

  const status = computed<CollectionStatus>(() => collection.status)
  const isLoading = computed(
    () => status() === `loading` || status() === `initialCommit`
  )
  const isReady = computed(() => status() === `ready`)
  const isIdle = computed(() => status() === `idle`)
  const isError = computed(() => status() === `error`)
  const isCleanedUp = computed(() => status() === `cleaned-up`)

  return {
    state,
    data,
    collection: signal(collection).asReadonly(),
    status,
    isLoading,
    isReady,
    isIdle,
    isError,
    isCleanedUp,
  }
}
