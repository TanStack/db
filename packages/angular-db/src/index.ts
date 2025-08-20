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
import type { Signal, WritableSignal } from "@angular/core"

type LiveQuerySignals = {
  state: Signal<Map<any, any>>
  data: Signal<Array<any>>
  collection: Signal<Collection<any, any, any>>
  status: Signal<CollectionStatus>
  isLoading: Signal<boolean>
  isReady: Signal<boolean>
  isIdle: Signal<boolean>
  isError: Signal<boolean>
  isCleanedUp: Signal<boolean>
}

export function injectLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
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
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<unknown>
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
export function injectLiveQuery(
  configOrQueryOrCollection: any,
  deps: Array<unknown> = []
): LiveQuerySignals {
  assertInInjectionContext(injectLiveQuery)
  const destroyRef = inject(DestroyRef)

  const collectionSig: WritableSignal<Collection<any, any, any> | null> =
    signal(null)
  const state: WritableSignal<Map<any, any>> = signal(new Map())
  const data: WritableSignal<Array<any>> = signal([])

  const lastDepsSig: WritableSignal<Array<unknown> | null> = signal(null)
  const lastConfigSig: WritableSignal<any> = signal(undefined)

  const isExistingCollection =
    configOrQueryOrCollection &&
    typeof configOrQueryOrCollection === `object` &&
    typeof configOrQueryOrCollection.subscribeChanges === `function` &&
    typeof configOrQueryOrCollection.startSyncImmediate === `function` &&
    typeof configOrQueryOrCollection.id === `string`

  const needNew = (() => {
    const current = collectionSig()
    if (!current) return true
    if (isExistingCollection)
      return lastConfigSig() !== configOrQueryOrCollection
    const prevDeps = lastDepsSig()
    if (!prevDeps) return true
    if (prevDeps.length !== deps.length) return true
    for (let i = 0; i < deps.length; i++) {
      if (prevDeps[i] !== deps[i]) return true
    }
    return false
  })()

  if (needNew) {
    if (isExistingCollection) {
      const col = configOrQueryOrCollection as Collection<any, any, any>
      col.startSyncImmediate()
      collectionSig.set(col)
      lastConfigSig.set(configOrQueryOrCollection)
    } else {
      const col =
        typeof configOrQueryOrCollection === `function`
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
      collectionSig.set(col)
      lastDepsSig.set([...deps])
      lastConfigSig.set(undefined)
    }
  }

  let unsub: (() => void) | null = null

  const setupEffect = effect((onCleanup) => {
    const col = collectionSig()
    if (!col) return

    // initialize snapshot
    state.set(new Map(col.entries()))
    data.set(Array.from(col.values()))

    // subscribe to changes
    unsub?.()
    unsub = col.subscribeChanges(() => {
      state.set(new Map(col.entries()))
      data.set(Array.from(col.values()))
    })

    // ensure sync started (idempotent)
    col.startSyncImmediate()

    onCleanup(() => {
      unsub?.()
      unsub = null
    })
  })

  destroyRef.onDestroy(() => {
    setupEffect.destroy()
    unsub?.()
    unsub = null
  })

  const collection = computed(() => {
    const c = collectionSig()
    if (!c) throw new Error(`injectLiveQuery: collection not initialized`)
    return c
  })

  const status = computed<CollectionStatus>(() => collection().status)
  const isLoading = computed(
    () => status() === `loading` || status() === `initialCommit`
  )
  const isReady = computed(() => status() === `ready`)
  const isIdle = computed(() => status() === `idle`)
  const isError = computed(() => status() === `error`)
  const isCleanedUp = computed(() => status() === `cleaned-up`)

  return {
    state: computed(() => state()),
    data: computed(() => data()),
    collection,
    status,
    isLoading,
    isReady,
    isIdle,
    isError,
    isCleanedUp,
  }
}
