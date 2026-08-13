import { computed, shallowRef, toValue, watchEffect } from 'vue'
import {
  assertLiveQueryWindowManyResult,
  compareLiveQueryWindowDependencies,
  createLiveQueryCollection,
  createLiveQueryWindowController,
  fetchNextLiveQueryWindowPage,
  getLiveQueryWindowCollectionWarning,
  normalizeLiveQueryWindowPageSize,
  resolveLiveQueryWindowInput,
  shouldPreserveLiveQueryWindowPageCount,
} from '@tanstack/db'
import type {
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  NonSingleResult,
  QueryBuilder,
  UtilsRecord,
} from '@tanstack/db'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

const DEFAULT_GC_TIME_MS = 1

type InternalCollection = Collection<object, string | number, UtilsRecord>

type PreviousController = {
  getSnapshot: () => { pages: ReadonlyArray<ReadonlyArray<unknown>> }
}

type InfiniteQueryOptions = {
  pageSize?: number
  initialPageParam?: number
}

export type LiveInfiniteQueryConfig<TRow> = InfiniteQueryOptions & {
  /**
   * @deprecated Pagination uses the shared controller's peek-ahead strategy.
   * This remains for compatibility with TanStack Query conventions.
   */
  getNextPageParam?: (
    lastPage: Array<TRow>,
    allPages: Array<Array<TRow>>,
    lastPageParam: number,
    allPageParams: Array<number>,
  ) => number | undefined
}

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
  let validatedCollection: InternalCollection | null = null
  let previousController: PreviousController | null = null
  let previousInput: ReturnType<
    typeof resolveLiveQueryWindowInput<TContext>
  > | null = null
  let previousDependencies: Array<unknown> | null = null
  let previousPageSize: number | null = null
  let previousInitialPageParam: number | null = null

  const controller = computed(() => {
    const dependencies = deps.map((dependency) => toValue(dependency))

    const pageSize = normalizeLiveQueryWindowPageSize(config.pageSize)
    const initialPageParam = config.initialPageParam ?? 0
    const unwrappedInput =
      typeof queryFnOrCollection === `function`
        ? queryFnOrCollection
        : toValue(queryFnOrCollection)
    const input = resolveLiveQueryWindowInput<TContext>(unwrappedInput)
    const dependencyComparison = compareLiveQueryWindowDependencies(
      previousDependencies,
      dependencies,
    )
    const dependenciesChanged = dependencyComparison.changed
    const dependenciesStructurallyEqual = dependencyComparison.structurallyEqual
    const pageShapeChanged =
      previousPageSize !== pageSize ||
      previousInitialPageParam !== initialPageParam
    const sameCollection =
      input.kind === `collection` &&
      previousInput?.kind === `collection` &&
      previousInput.collection === input.collection
    const canPreservePageCount = shouldPreserveLiveQueryWindowPageCount({
      hasPreviousController: previousController !== null,
      previousInputKind: previousInput?.kind,
      inputKind: input.kind,
      sameCollection,
      dependenciesChanged,
      dependenciesStructurallyEqual,
      pageShapeChanged,
    })
    const previousPageCount = previousController
      ? Math.max(1, previousController.getSnapshot().pages.length)
      : 1
    const initialPageCount = canPreservePageCount ? previousPageCount : 1

    previousInput = input
    previousDependencies = [...dependencies]
    previousPageSize = pageSize
    previousInitialPageParam = initialPageParam

    if (input.kind === `collection`) {
      const collection = input.collection
      const warning = getLiveQueryWindowCollectionWarning(
        collection,
        pageSize + 1,
      )

      if (validatedCollection !== collection) {
        validatedCollection = collection
        if (warning) console.warn(warning)
      }

      const currentController = createLiveQueryWindowController(collection, {
        pageSize,
        initialPageParam,
        initialPageCount,
      })
      previousController = currentController
      return currentController
    }

    const collection = createLiveQueryCollection({
      query: input.query.limit(pageSize + 1).offset(0),
      startSync: false,
      gcTime: DEFAULT_GC_TIME_MS,
    })
    assertLiveQueryWindowManyResult(collection)
    const currentController = createLiveQueryWindowController(collection, {
      pageSize,
      initialPageParam,
      initialPageCount,
    })
    previousController = currentController
    return currentController
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
