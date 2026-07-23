import { computed, ref, toValue, watch, watchEffect } from 'vue'
import { CollectionImpl } from '@tanstack/db'
import { useLiveQuery } from './useLiveQuery'
import type {
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionUtils,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'

/**
 * Type guard to check if utils object has setWindow method (LiveQueryCollectionUtils)
 */
const isLiveQueryCollectionUtils = (
  utils: unknown,
): utils is LiveQueryCollectionUtils => {
  return typeof (utils as any).setWindow === `function`
}

export type UseLiveInfiniteQueryConfig<TContext extends Context> = {
  pageSize?: number
  initialPageParam?: number
  /**
   * @deprecated This callback is not used by the current implementation.
   * Pagination is determined internally via a peek-ahead strategy.
   * Provided for API compatibility with TanStack Query conventions.
   */
  getNextPageParam?: (
    lastPage: Array<InferResultType<TContext>[number]>,
    allPages: Array<Array<InferResultType<TContext>[number]>>,
    lastPageParam: number,
    allPageParams: Array<number>,
  ) => number | undefined
}

export interface UseLiveInfiniteQueryReturn<TContext extends Context> {
  state: ComputedRef<Map<string | number, GetResult<TContext>>>
  data: ComputedRef<InferResultType<TContext>>
  collection: ComputedRef<Collection<GetResult<TContext>, string | number, {}> | null>
  status: ComputedRef<CollectionStatus>
  isLoading: ComputedRef<boolean>
  isReady: ComputedRef<boolean>
  isIdle: ComputedRef<boolean>
  isError: ComputedRef<boolean>
  isCleanedUp: ComputedRef<boolean>
  pages: ComputedRef<Array<Array<InferResultType<TContext>[number]>>>
  pageParams: ComputedRef<Array<number>>
  fetchNextPage: () => void
  hasNextPage: ComputedRef<boolean>
  isFetchingNextPage: ComputedRef<boolean>
}

// Overload for query function
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>,
): UseLiveInfiniteQueryReturn<TContext>

// Overload for pre-created collection (non-single result)
export function useLiveInfiniteQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeRefOrGetter<
    Collection<TResult, TKey, TUtils> & NonSingleResult
  >,
  config: UseLiveInfiniteQueryConfig<any>,
): UseLiveInfiniteQueryReturn<any>

// Implementation
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFnOrCollection: any,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps: Array<MaybeRefOrGetter<unknown>> = [],
): UseLiveInfiniteQueryReturn<TContext> {
  const pageSize = config.pageSize || 20
  const initialPageParam = config.initialPageParam ?? 0

  // Detect if input is a collection (or ref to collection) vs query function
  // NOTE: Don't call toValue on functions - toValue treats functions as getters
  const isCollectionInput =
    typeof queryFnOrCollection !== `function` &&
    toValue(queryFnOrCollection) instanceof CollectionImpl

  if (!isCollectionInput && typeof queryFnOrCollection !== `function`) {
    throw new Error(
      `useLiveInfiniteQuery: First argument must be either a pre-created live query collection (CollectionImpl) ` +
        `or a query function. Received: ${typeof queryFnOrCollection}`,
    )
  }

  const loadedPageCount = ref(1)
  const isFetchingNextPage = ref(false)
  let hasValidatedCollection = false

  // Delegate to useLiveQuery for the underlying subscription
  // For query functions, add peek-ahead limit (+1) for hasNextPage detection
  const queryResult = isCollectionInput
    ? useLiveQuery(queryFnOrCollection)
    : useLiveQuery(
        (q: any) =>
          queryFnOrCollection(q)
            .limit(pageSize + 1)
            .offset(0),
        deps,
      )

  // Reset pagination when collection instance changes (deps change, collection swap, etc.)
  watch(queryResult.collection, () => {
    loadedPageCount.value = 1
    hasValidatedCollection = false
  })

  // Adjust window when pagination state changes
  watchEffect((onInvalidate) => {
    const currentCollection = queryResult.collection.value
    if (!currentCollection) return

    if (!isCollectionInput && !queryResult.isReady.value) return

    const utils = (currentCollection as any).utils
    const expectedOffset = 0
    const expectedLimit = loadedPageCount.value * pageSize + 1 // +1 for peek ahead

    if (!isLiveQueryCollectionUtils(utils)) {
      if (isCollectionInput) {
        throw new Error(
          `useLiveInfiniteQuery: Pre-created live query collection must have an orderBy clause for infinite pagination to work. ` +
            `Please add .orderBy() to your createLiveQueryCollection query.`,
        )
      }
      return
    }

    // For pre-created collections, validate window on first check
    if (isCollectionInput && !hasValidatedCollection) {
      const currentWindow = utils.getWindow()
      if (
        currentWindow &&
        (currentWindow.offset !== expectedOffset ||
          currentWindow.limit !== expectedLimit)
      ) {
        console.warn(
          `useLiveInfiniteQuery: Pre-created collection has window {offset: ${currentWindow.offset}, limit: ${currentWindow.limit}} ` +
            `but hook expects {offset: ${expectedOffset}, limit: ${expectedLimit}}. Adjusting window now.`,
        )
      }
      hasValidatedCollection = true
    }

    let cancelled = false
    const result = utils.setWindow({
      offset: expectedOffset,
      limit: expectedLimit,
    })

    if (result !== true) {
      isFetchingNextPage.value = true
      result
        .catch((error: unknown) => {
          if (!cancelled)
            console.error(`useLiveInfiniteQuery: setWindow failed:`, error)
        })
        .finally(() => {
          if (!cancelled) isFetchingNextPage.value = false
        })
    } else {
      isFetchingNextPage.value = false
    }

    onInvalidate(() => {
      cancelled = true
    })
  })

  // Derive pages, pageParams, hasNextPage, and flat data from query results
  const paginatedData = computed(() => {
    const rawData = queryResult.data.value
    const dataArray = (
      Array.isArray(rawData) ? rawData : []
    ) as InferResultType<TContext>
    const totalItemsRequested = loadedPageCount.value * pageSize

    const hasMore = dataArray.length > totalItemsRequested

    const pagesResult: Array<Array<InferResultType<TContext>[number]>> = []
    const pageParamsResult: Array<number> = []

    for (let i = 0; i < loadedPageCount.value; i++) {
      const pageData = dataArray.slice(i * pageSize, (i + 1) * pageSize)
      pagesResult.push(pageData)
      pageParamsResult.push(initialPageParam + i)
    }

    const flatDataResult = dataArray.slice(
      0,
      totalItemsRequested,
    ) as InferResultType<TContext>

    return {
      pages: pagesResult,
      pageParams: pageParamsResult,
      hasNextPage: hasMore,
      flatData: flatDataResult,
    }
  })

  const fetchNextPage = () => {
    if (!paginatedData.value.hasNextPage || isFetchingNextPage.value) return
    loadedPageCount.value++
  }

  return {
    state: queryResult.state,
    data: computed(() => paginatedData.value.flatData),
    collection: queryResult.collection,
    status: queryResult.status,
    isLoading: queryResult.isLoading,
    isReady: queryResult.isReady,
    isIdle: queryResult.isIdle,
    isError: queryResult.isError,
    isCleanedUp: queryResult.isCleanedUp,
    pages: computed(() => paginatedData.value.pages),
    pageParams: computed(() => paginatedData.value.pageParams),
    fetchNextPage,
    hasNextPage: computed(() => paginatedData.value.hasNextPage),
    isFetchingNextPage: computed(() => isFetchingNextPage.value),
  } as unknown as UseLiveInfiniteQueryReturn<TContext>
}
