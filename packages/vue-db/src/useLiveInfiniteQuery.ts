import { computed, shallowRef, toValue, watchEffect } from 'vue'
import {
  bindLiveQueryWindow,
  fetchNextLiveQueryWindowPage,
  readLiveQueryWindowPageShape,
} from '@tanstack/db'
import type {
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryPersistedStatus,
  LiveQueryWindowBinding,
  NonSingleResult,
  QueryBuilder,
  UtilsRecord,
} from '@tanstack/db'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

type InfiniteQueryOptions = {
  pageSize?: number
  /** First result-page label, not a server cursor or remote offset. */
  initialPageParam?: number
}

// Keep the generic parameter for existing typed config wrappers.
export type LiveInfiniteQueryConfig<_TRow> = InfiniteQueryOptions

export type UseLiveInfiniteQueryConfig<
  TContext extends Context & NonSingleResult,
> = LiveInfiniteQueryConfig<InferResultType<TContext>[number]>

export interface UseLiveInfiniteQueryReturn<
  TContext extends Context & NonSingleResult,
> {
  state: ComputedRef<Map<string | number, GetResult<TContext>>>
  data: ComputedRef<InferResultType<TContext>>
  collection: ComputedRef<
    Collection<GetResult<TContext>, string | number, UtilsRecord>
  >
  status: ComputedRef<CollectionStatus>
  isLoading: ComputedRef<boolean>
  isReady: ComputedRef<boolean>
  persistedStatus: ComputedRef<LiveQueryPersistedStatus>
  isPersistedReady: ComputedRef<boolean>
  persistedError: ComputedRef<unknown | undefined>
  isIdle: ComputedRef<boolean>
  isError: ComputedRef<boolean>
  isCleanedUp: ComputedRef<boolean>
  pages: ComputedRef<Array<Array<InferResultType<TContext>[number]>>>
  pageParams: ComputedRef<Array<number>>
  fetchNextPage: () => Promise<void>
  hasNextPage: ComputedRef<boolean>
  isFetchingNextPage: ComputedRef<boolean>
  error: ComputedRef<unknown>
}

export interface UseLiveInfiniteQueryReturnWithCollection<
  TResult extends object,
  TKey extends string | number,
  TUtils extends UtilsRecord,
> {
  state: ComputedRef<Map<TKey, TResult>>
  data: ComputedRef<Array<TResult>>
  collection: ComputedRef<Collection<TResult, TKey, TUtils>>
  status: ComputedRef<CollectionStatus>
  isLoading: ComputedRef<boolean>
  isReady: ComputedRef<boolean>
  persistedStatus: ComputedRef<LiveQueryPersistedStatus>
  isPersistedReady: ComputedRef<boolean>
  persistedError: ComputedRef<unknown | undefined>
  isIdle: ComputedRef<boolean>
  isError: ComputedRef<boolean>
  isCleanedUp: ComputedRef<boolean>
  pages: ComputedRef<Array<Array<TResult>>>
  pageParams: ComputedRef<Array<number>>
  fetchNextPage: () => Promise<void>
  hasNextPage: ComputedRef<boolean>
  isFetchingNextPage: ComputedRef<boolean>
  error: ComputedRef<unknown>
}

/**
 * Create a Vue-native reactive view over the shared live-query window
 * controller. The query must include an `orderBy` clause.
 */
export function useLiveInfiniteQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends UtilsRecord,
>(
  liveQueryCollection: MaybeRefOrGetter<
    Collection<TResult, TKey, TUtils> & NonSingleResult
  >,
  config: LiveInfiniteQueryConfig<TResult>,
): UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils>

export function useLiveInfiniteQuery<
  TContext extends Context & NonSingleResult,
>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>,
): UseLiveInfiniteQueryReturn<TContext>

export function useLiveInfiniteQuery<
  TContext extends Context & NonSingleResult,
>(
  queryFnOrCollection: unknown,
  config: InfiniteQueryOptions,
  deps: Array<MaybeRefOrGetter<unknown>> = [],
): UseLiveInfiniteQueryReturn<TContext> {
  let binding: LiveQueryWindowBinding | null = null

  // Vue reruns this only when something it reads changed: the input, a
  // dependency, the page shape, or a ref the query callback reads.
  const controller = computed(() => {
    const previous = binding
    binding = bindLiveQueryWindow(previous, {
      ...readLiveQueryWindowPageShape(config),
      input:
        typeof queryFnOrCollection === `function`
          ? queryFnOrCollection
          : toValue(queryFnOrCollection),
      dependencies: deps.map((dependency) => toValue(dependency)),
      recompile: `always`,
    })
    if (binding !== previous && binding.warning) console.warn(binding.warning)
    return binding.controller
  })

  const snapshot = shallowRef(controller.value.getSnapshot())

  watchEffect(
    (onInvalidate) => {
      const currentController = controller.value
      const updateSnapshot = () => {
        snapshot.value = currentController.getSnapshot()
      }

      updateSnapshot()
      const unsubscribe = currentController.subscribe(updateSnapshot)
      updateSnapshot()

      onInvalidate(() => {
        unsubscribe()
        currentController.dispose()
      })
    },
    { flush: `sync` },
  )

  return {
    state: computed(
      () => snapshot.value.state as Map<string | number, GetResult<TContext>>,
    ),
    data: computed(() => snapshot.value.data as InferResultType<TContext>),
    collection: computed(
      () =>
        snapshot.value.collection as Collection<
          GetResult<TContext>,
          string | number,
          UtilsRecord
        >,
    ),
    status: computed(() => snapshot.value.status as CollectionStatus),
    isLoading: computed(() => snapshot.value.isLoading),
    isReady: computed(() => snapshot.value.isReady),
    persistedStatus: computed(() => snapshot.value.persistedStatus),
    isPersistedReady: computed(() => snapshot.value.isPersistedReady),
    persistedError: computed(() => snapshot.value.persistedError),
    isIdle: computed(() => snapshot.value.isIdle),
    isError: computed(() => snapshot.value.isError),
    isCleanedUp: computed(() => snapshot.value.isCleanedUp),
    pages: computed(
      () =>
        snapshot.value.pages as Array<Array<InferResultType<TContext>[number]>>,
    ),
    pageParams: computed(() => snapshot.value.pageParams as Array<number>),
    fetchNextPage: () => fetchNextLiveQueryWindowPage(controller.value),
    hasNextPage: computed(() => snapshot.value.hasNextPage),
    isFetchingNextPage: computed(() => snapshot.value.isFetchingNextPage),
    error: computed(() => snapshot.value.error),
  }
}
