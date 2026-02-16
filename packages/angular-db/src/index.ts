import {
  DestroyRef,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core'
import { BaseQueryBuilder, createLiveQueryCollection } from '@tanstack/db'
import type {
  ChangeMessage,
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from '@tanstack/db'
import type { Signal } from '@angular/core'

/**
 * The result of calling `injectLiveQuery`.
 * Contains reactive signals for the query state and data.
 */
export interface InjectLiveQueryResult<
  TResult extends object = any,
  TKey extends string | number = string | number,
  TUtils extends Record<string, any> = {},
> {
  /** A signal containing the complete state map of results keyed by their ID */
  state: Signal<Map<TKey, TResult>>
  /** A signal containing the results as an array */
  data: Signal<Array<TResult>>
  /** A signal containing the underlying collection instance (null for disabled queries) */
  collection: Signal<Collection<TResult, TKey, TUtils> | null>
  /** A signal containing the current status of the collection */
  status: Signal<CollectionStatus | `disabled`>
  /** A signal indicating whether the collection is currently loading */
  isLoading: Signal<boolean>
  /** A signal indicating whether the collection is ready */
  isReady: Signal<boolean>
  /** A signal indicating whether the collection is idle */
  isIdle: Signal<boolean>
  /** A signal indicating whether the collection has an error */
  isError: Signal<boolean>
  /** A signal indicating whether the collection has been cleaned up */
  isCleanedUp: Signal<boolean>
}

export function injectLiveQuery<
  TContext extends Context,
  TParams extends any,
>(options: {
  params: () => TParams
  query: (args: {
    params: TParams
    q: InitialQueryBuilder
  }) => QueryBuilder<TContext>
}): InjectLiveQueryResult<GetResult<TContext>>
export function injectLiveQuery<
  TContext extends Context,
  TParams extends any,
>(options: {
  params: () => TParams
  query: (args: {
    params: TParams
    q: InitialQueryBuilder
  }) => QueryBuilder<TContext> | undefined | null
}): InjectLiveQueryResult<GetResult<TContext>>
export function injectLiveQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): InjectLiveQueryResult<GetResult<TContext>>
export function injectLiveQuery<TContext extends Context>(
  queryFn: (
    q: InitialQueryBuilder,
  ) => QueryBuilder<TContext> | undefined | null,
): InjectLiveQueryResult<GetResult<TContext>>
export function injectLiveQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
): InjectLiveQueryResult<GetResult<TContext>>
export function injectLiveQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils>,
): InjectLiveQueryResult<TResult, TKey, TUtils>
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
      // Check if query function returns null/undefined (disabled query)
      const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
      const result = opts(queryBuilder)

      if (result === undefined || result === null) {
        // Disabled query - return null
        return null
      }

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

      // Check if query function returns null/undefined (disabled query)
      const queryBuilder = new BaseQueryBuilder() as InitialQueryBuilder
      const result = query({ params: currentParams, q: queryBuilder })

      if (result === undefined || result === null) {
        // Disabled query - return null
        return null
      }

      return createLiveQueryCollection({
        query: () => result,
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
  const status = signal<CollectionStatus | `disabled`>(
    collection() ? `idle` : `disabled`,
  )

  const syncDataFromCollection = (
    currentCollection: Collection<any, any, any>,
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

    // Handle null collection (disabled query)
    if (!currentCollection) {
      status.set(`disabled` as const)
      state.set(new Map())
      data.set([])
      cleanup()
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
    const subscription = currentCollection.subscribeChanges(
      (_: Array<ChangeMessage<any>>) => {
        syncDataFromCollection(currentCollection)
      },
    )
    unsub = subscription.unsubscribe.bind(subscription)

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
    isLoading: computed(() => status() === `loading`),
    isReady: computed(() => status() === `ready` || status() === `disabled`),
    isIdle: computed(() => status() === `idle`),
    isError: computed(() => status() === `error`),
    isCleanedUp: computed(() => status() === `cleaned-up`),
  }
}
