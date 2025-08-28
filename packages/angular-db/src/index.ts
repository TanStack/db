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
  ChangeMessage,
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"
import type { Signal } from "@angular/core"

export function injectLiveQuery<
  TContext extends Context,
  TParams extends any,
>(options: {
  params: () => TParams
  query: (args: {
    params: TParams
    q: InitialQueryBuilder
  }) => QueryBuilder<TContext>
}): {
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
export function injectLiveQuery(opts: any) {
  assertInInjectionContext(injectLiveQuery)
  const destroyRef = inject(DestroyRef)

  const collection = computed(() => {
    // Check if it's an existing collection
    const isExistingCollection =
      opts &&
      typeof opts === `object` &&
      typeof opts.subscribeChanges === `function` &&
      typeof opts.startSyncImmediate === `function` &&
      typeof opts.id === `string`

    if (isExistingCollection) {
      return opts
    }

    if (typeof opts === `function`) {
      return createLiveQueryCollection({
        query: opts,
        startSync: true,
        gcTime: 0,
      })
    }

    // Check if it's reactive query options
    const isReactiveQueryOptions =
      opts &&
      typeof opts === `object` &&
      typeof opts.query === `function` &&
      typeof opts.params === `function`

    if (isReactiveQueryOptions) {
      const { params, query } = opts
      const currentParams = params()
      return createLiveQueryCollection({
        query: (q) => query({ params: currentParams, q }),
        startSync: true,
        gcTime: 0,
      })
    }

    // Handle LiveQueryCollectionConfig objects
    if (opts && typeof opts === `object` && typeof opts.query === `function`) {
      return createLiveQueryCollection(opts)
    }

    throw new Error(`Invalid options provided to injectLiveQuery`)
  })

  const state = signal(new Map<string | number, any>())
  const data = signal<Array<any>>([])
  const status = signal<CollectionStatus>(`idle`)

  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>
  ) => {
    const newState = new Map(currentCollection.entries())
    const newData = Array.from(currentCollection.values())

    state.set(newState)
    data.set(newData)
    status.set(currentCollection.status)
  }

  let unsub: (() => void) | null = null
  const cleanup = () => {
    unsub?.()
    unsub = null
  }

  effect((onCleanup) => {
    const currentCollection = collection()

    if (!currentCollection) {
      return
    }

    cleanup()

    // Initialize immediately with current state
    syncDataFromCollection(currentCollection)

    // Start sync if idle
    if (currentCollection.status === `idle`) {
      currentCollection.startSyncImmediate()
      // Update status after starting sync
      status.set(currentCollection.status)
    }

    // Subscribe to changes
    unsub = currentCollection.subscribeChanges(
      (_: Array<ChangeMessage<any>>) => {
        syncDataFromCollection(currentCollection)
      }
    )

    // Handle ready state
    currentCollection.onFirstReady(() => {
      status.set(currentCollection.status)
    })

    onCleanup(cleanup)
  })

  destroyRef.onDestroy(cleanup)

  return {
    state,
    data,
    collection,
    status,
    isLoading: computed(
      () => status() === `loading` || status() === `initialCommit`
    ),
    isReady: computed(() => status() === `ready`),
    isIdle: computed(() => status() === `idle`),
    isError: computed(() => status() === `error`),
    isCleanedUp: computed(() => status() === `cleaned-up`),
  }
}
