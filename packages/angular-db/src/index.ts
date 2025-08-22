import {
  DestroyRef,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  linkedSignal,
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
      if (opts.status === `idle`) {
        opts.startSyncImmediate()
      }
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
  })

  const state = signal(new Map<string | number, any>())
  const data = signal<Array<any>>([])

  const status = linkedSignal(() => collection().status)

  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>
  ) => {
    data.set(Array.from(currentCollection.values()))
  }

  let currentUnsub: (() => void) | null = null

  effect((onCleanup) => {
    const currentCollection = collection()

    status.set(currentCollection.status)

    if (currentUnsub) {
      currentUnsub()
    }

    state.set(new Map(currentCollection.entries()))

    syncDataFromCollection(currentCollection)

    currentCollection.onFirstReady(() => {
      requestAnimationFrame(() => {
        status.set(currentCollection.status)
      })
    })

    currentUnsub = currentCollection.subscribeChanges(
      (changes: Array<ChangeMessage<any>>) => {
        for (const change of changes) {
          switch (change.type) {
            case `insert`:
            case `update`:
              state.update((state) => state.set(change.key, change.value))
              break
            case `delete`:
              state.update((state) => {
                state.delete(change.key)
                return state
              })
              break
          }
        }

        syncDataFromCollection(currentCollection)
        status.set(currentCollection.status)
      }
    )

    if (currentCollection.status === `idle`) {
      currentCollection.preload().catch(console.error)
    }

    onCleanup(() => {
      if (currentUnsub) {
        currentUnsub()
        currentUnsub = null
      }
    })
  })

  const instance = collection()
  if (instance) {
    destroyRef.onDestroy(() => {
      if (currentUnsub) {
        currentUnsub()
        currentUnsub = null
      }
    })
  }

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
