import { computed, ref, toValue, unref, watch, watchEffect } from 'vue'
import { BaseQueryBuilder, CollectionImpl } from '@tanstack/db'
import { useLiveQuery } from './useLiveQuery'
import type {
  Collection,
  Context,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionUtils,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { UseLiveQueryReturn } from './useLiveQuery'

/**
 * Type guard to check if utils object has setWindow method (LiveQueryCollectionUtils)
 */
function isLiveQueryCollectionUtils(
  utils: unknown,
): utils is LiveQueryCollectionUtils {
  return typeof (utils as any).setWindow === `function`
}

export type UseLiveInfiniteQueryConfig<TContext extends Context> = {
  pageSize?: number
  initialPageParam?: number
  getNextPageParam: (
    lastPage: Array<InferResultType<TContext>[number]>,
    allPages: Array<Array<InferResultType<TContext>[number]>>,
    lastPageParam: number,
    allPageParams: Array<number>,
  ) => number | undefined
}

export type UseLiveInfiniteQueryReturn<TContext extends Context> = Omit<
  UseLiveQueryReturn<InferResultType<TContext>[number]>,
  `data`
> & {
  data: ComputedRef<InferResultType<TContext>>
  pages: ComputedRef<Array<Array<InferResultType<TContext>[number]>>>
  pageParams: ComputedRef<Array<number>>
  fetchNextPage: () => void
  hasNextPage: ComputedRef<boolean>
  isFetchingNextPage: ComputedRef<boolean>
}

// Overload for pre-created collection (non-single result)
export function useLiveInfiniteQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection:
    | (Collection<TResult, TKey, TUtils> & NonSingleResult)
    | MaybeRefOrGetter<Collection<TResult, TKey, TUtils> & NonSingleResult>,
  config: UseLiveInfiniteQueryConfig<any>,
): UseLiveInfiniteQueryReturn<any>

// Overload for query function
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>,
): UseLiveInfiniteQueryReturn<TContext>

// Implementation
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFnOrCollection: any,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps: Array<MaybeRefOrGetter<unknown>> = [],
): UseLiveInfiniteQueryReturn<TContext> {
  const pageSize = config.pageSize || 20
  const initialPageParam = config.initialPageParam ?? 0

  // Track how many pages have been loaded
  const loadedPageCount = ref(1)
  const isFetchingNextPage = ref(false)

  // Detect if input is a collection or query function (reactive check)
  const isCollectionCheck = (val: any) =>
    val instanceof CollectionImpl ||
    (val &&
      typeof val === `object` &&
      typeof val.subscribeChanges === `function`)

  // Safely resolve the input to useLiveQuery
  const queryInput = computed(() => {
    const raw = unref(queryFnOrCollection)

    // Check if it's already a collection
    if (isCollectionCheck(raw)) {
      return raw
    }

    // Handle function case
    if (typeof raw === `function`) {
      // Check if it's a getter that returns a collection
      // (Heuristic: length 0 implies getter, though strictly not guaranteed)
      if (raw.length === 0) {
        try {
          // Probe the function
          const res = raw()
          if (isCollectionCheck(res)) {
            return res
          }
           // If not a collection, fall through to treat as query function (or getter for query function)
        } catch {
           // Ignore errors, assume it requires args (e.g. strict checks)
        }
      }

      // Try to probe with a dummy builder to see if it returns a Collection directly
      // This handles (q) => Collection case which useLiveQuery doesn't support natively in Vue
      try {
        const dummyBuilder = new BaseQueryBuilder() as InitialQueryBuilder
        const res = raw(dummyBuilder)
        if (isCollectionCheck(res)) {
          return res
        }
      } catch {
        // Ignore errors, assume it returns a builder that needs real execution
      }

      // It's a query function (or assumed one). Wrap it to apply limit/offset.
      return (q: InitialQueryBuilder) => {
        const res = raw(q)

        // Handle case where function returns a Collection directly
        if (isCollectionCheck(res)) {
          return res
        }

        // Apply limit/offset to QueryBuilder
        if (res && typeof res.limit === `function`) {
          return res.limit(pageSize).offset(0)
        }

        return res
      }
    }

    return raw
  })


  // Reset pagination when inputs change
  watch(
    [
      () => unref(queryFnOrCollection),
      ...deps.map((d) => () => toValue(d)),
    ],
    ([newVal], [oldVal]) => {
      // If collection instance changed
      if (isCollectionCheck(newVal) && newVal !== oldVal) {
        loadedPageCount.value = 1
        return
      }

      // If it's a query function, any dependency change should reset
      // (The watch source includes deps, so this callback fires on dep changes)
      if (!isCollectionCheck(newVal)) {
        loadedPageCount.value = 1
      }
    },
  )

  // Create a live query with initial limit and offset
  const queryResult = useLiveQuery(queryInput as any, deps)

  // Adjust window when pagination changes
  watchEffect(async () => {
    const utils = queryResult.collection.value.utils
    const currentLoadedCount = loadedPageCount.value
    const expectedOffset = 0
    const expectedLimit = currentLoadedCount * pageSize + 1 // +1 for peek ahead

    // Check if collection has orderBy (required for setWindow)
    if (!isLiveQueryCollectionUtils(utils)) {
      // For pre-created collections, we should warn or error.
      const unwrapped = unref(queryFnOrCollection)
      // Check unwrapped or queryInput value
      if (isCollectionCheck(unwrapped) || isCollectionCheck(queryInput.value)) {
         // Only throw if we are sure it is a collection and not a query function being set up
        throw new Error(
          `useLiveInfiniteQuery: Pre-created live query collection must have an orderBy clause for infinite pagination to work. ` +
            `Please add .orderBy() to your createLiveQueryCollection query.`,
        )
      }
      return
    }

    // Checking if window needs adjustment
    const currentWindow = utils.getWindow()
    if (
      currentWindow &&
      currentWindow.offset === expectedOffset &&
      currentWindow.limit === expectedLimit
    ) {
      return
    }

    // Adjust the window
    let result: true | Promise<void>
    try {
      result = utils.setWindow({
        offset: expectedOffset,
        limit: expectedLimit,
      })
    } catch (err) {
      // If setWindow fails (e.g. missing orderBy), we should probably rethrow or match React behavior
      // React throws "Pre-created live query collection must have an orderBy..."
      // We can throw the friendlier error here if it's the specific error
      throw new Error(
        `useLiveInfiniteQuery: Pre-created live query collection must have an orderBy clause for infinite pagination to work. ` +
          `Please add .orderBy() to your createLiveQueryCollection query. Original error: ${err}`,
      )
    }

    if (result !== true) {
      isFetchingNextPage.value = true
      try {
        await result
      } finally {
        isFetchingNextPage.value = false
      }
    } else {
      isFetchingNextPage.value = false
    }
  })

  // Split the data array into pages and determine if there's a next page
  const computedData = computed(() => {
    const dataArray = (
      Array.isArray(queryResult.data.value) ? queryResult.data.value : []
    ) as InferResultType<TContext>
    const totalItemsRequested = loadedPageCount.value * pageSize

    // Check if we have more data than requested (the peek ahead item)
    const hasMore = dataArray.length > totalItemsRequested

    // Build pages array (without the peek ahead item)
    const pagesResult: Array<Array<InferResultType<TContext>[number]>> = []
    const pageParamsResult: Array<number> = []

    for (let i = 0; i < loadedPageCount.value; i++) {
      const pageData = dataArray.slice(i * pageSize, (i + 1) * pageSize)
      // Only push if there is data (handle case where data might be less than expected due to deletion/filter)
      // Actually strictly following React impl:
      pagesResult.push(pageData)
      pageParamsResult.push(initialPageParam + i)
    }

    // Flatten the pages for the data return (without peek ahead item)
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

  const pages = computed(() => computedData.value.pages)
  const pageParams = computed(() => computedData.value.pageParams)
  const hasNextPage = computed(() => computedData.value.hasNextPage)
  const data = computed(() => computedData.value.flatData)

  // Fetch next page
  const fetchNextPage = () => {
    if (!hasNextPage.value || isFetchingNextPage.value) return

    loadedPageCount.value += 1
  }

  return {
    ...queryResult,
    data,
    pages,
    pageParams,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: computed(() => isFetchingNextPage.value),
  } as UseLiveInfiniteQueryReturn<TContext>
}
