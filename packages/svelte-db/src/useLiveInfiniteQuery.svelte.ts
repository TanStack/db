import { CollectionImpl } from '@tanstack/db'
import { untrack } from 'svelte'
import { useLiveQuery } from './useLiveQuery.svelte.js'
import type { MaybeGetter } from './useLiveQuery.svelte.js'
import type {
  Collection,
  Context,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionUtils,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'

/**
 * Type guard to check if utils object has setWindow method (LiveQueryCollectionUtils)
 */
function isLiveQueryCollectionUtils(
  utils: unknown,
): utils is LiveQueryCollectionUtils {
  return typeof (utils as any).setWindow === `function`
}

/**
 * Normalizes the input into a stable value and type flag.
 * Handles: Collection, () => Collection (getter), or (q) => Query (fn).
 */
function resolveInput(input: any) {
  let unwrapped = input
  let isCollection = unwrapped instanceof CollectionImpl

  if (!isCollection && typeof unwrapped === `function`) {
    try {
      // Try to see if it's a getter for a collection
      const potentiallyColl = unwrapped()
      if (potentiallyColl instanceof CollectionImpl) {
        unwrapped = potentiallyColl
        isCollection = true
      }
    } catch {
      // It's likely a query function that expects arguments
    }
  }

  if (!isCollection && typeof unwrapped !== `function`) {
    throw new Error(
      `useLiveInfiniteQuery: First argument must be either a pre-created live query collection (CollectionImpl) ` +
        `or a query function. Received: ${typeof unwrapped}`,
    )
  }

  return { unwrapped, isCollection }
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

export type UseLiveInfiniteQueryReturn<TContext extends Context> = Omit<
  ReturnType<typeof useLiveQuery<TContext>>,
  `data`
> & {
  data: InferResultType<TContext>
  pages: Array<Array<InferResultType<TContext>[number]>>
  pageParams: Array<number>
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
}

/**
 * Pure utility to slice data into pages based on count and size
 */
function paginate<T>(
  data: Array<T>,
  pageSize: number,
  pageCount: number,
  initialParam: number,
) {
  const pages: Array<Array<T>> = []
  const pageParams: Array<number> = []

  for (let i = 0; i < pageCount; i++) {
    const start = i * pageSize
    const end = (i + 1) * pageSize
    pages.push(data.slice(start, end))
    pageParams.push(initialParam + i)
  }

  return { pages, pageParams }
}

/**
 * Create an infinite query using a query function with live updates
 *
 * Uses `utils.setWindow()` to dynamically adjust the limit/offset window
 * without recreating the live query collection on each page change.
 *
 * @param queryFnOrCollection - Query function or pre-created collection
 * @param config - Configuration including pageSize and getNextPageParam
 * @param deps - Array of reactive dependencies that trigger query re-execution when changed
 * @returns Object with pages, data, and pagination controls
 *
 * @remarks
 * **IMPORTANT - Destructuring in Svelte 5:**
 * Direct destructuring breaks reactivity. To destructure, wrap with `$derived`:
 *
 * ❌ **Incorrect** - Loses reactivity:
 * ```ts
 * const { data, pages, fetchNextPage } = useLiveInfiniteQuery(...)
 * ```
 *
 * ✅ **Correct** - Maintains reactivity:
 * ```ts
 * // Option 1: Use dot notation (recommended)
 * const query = useLiveInfiniteQuery(...)
 * // Access: query.data, query.pages, query.fetchNextPage()
 *
 * // Option 2: Wrap with $derived for destructuring
 * const query = useLiveInfiniteQuery(...)
 * const { data, pages, fetchNextPage } = $derived(query)
 * ```
 *
 * This is a fundamental Svelte 5 limitation, not a library bug.
 */

// Overload for pre-created collection (non-single result)
export function useLiveInfiniteQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeGetter<
    Collection<TResult, TKey, TUtils> & NonSingleResult
  >,
  config: UseLiveInfiniteQueryConfig<any>,
): UseLiveInfiniteQueryReturn<any>

// Overload for query function
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps?: Array<() => unknown>,
): UseLiveInfiniteQueryReturn<TContext>

// Implementation
export function useLiveInfiniteQuery<TContext extends Context>(
  queryFnOrCollection: any,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps: Array<() => unknown> = [],
): UseLiveInfiniteQueryReturn<TContext> {
  const pageSize = $derived(config.pageSize ?? 20)
  const initialPageParam = $derived(config.initialPageParam ?? 0)

  // 1. Resolve input reactively
  const input = $derived(resolveInput(queryFnOrCollection))

  // 2. Local pagination state
  let loadedPageCount = $state(1)
  let isFetchingNextPage = $state(false)
  let currentCollectionInstance: any = null
  let hasValidatedCollection = false

  // 3. Underlying live query
  const query = useLiveQuery(() => {
    const { isCollection: isColl, unwrapped } = input
    if (isColl) return unwrapped

    return (q: InitialQueryBuilder) =>
      unwrapped(q)
        .limit(pageSize + 1)
        .offset(0)
  }, deps)

  // 4. Reset pagination on collection change
  $effect(() => {
    if (query.collection !== currentCollectionInstance) {
      untrack(() => {
        currentCollectionInstance = query.collection
        hasValidatedCollection = false
        loadedPageCount = 1
      })
    }
  })

  // 5. Window adjustment effect
  $effect(() => {
    const { collection, isReady } = query
    if (!isReady) return

    const utils = collection.utils
    const expectedOffset = 0
    const expectedLimit = loadedPageCount * (pageSize + 1) // +1 per page for peek ahead consistency

    // Check if collection has orderBy (required for setWindow)
    if (!isLiveQueryCollectionUtils(utils)) {
      // For pre-created collections, throw an error if no orderBy
      if (input.isCollection) {
        throw new Error(
          `useLiveInfiniteQuery: Pre-created live query collection must have an orderBy clause for infinite pagination to work.` +
            `Please add .orderBy() to your createLiveQueryCollection query.`,
        )
      }
      return
    }

    // Validation warning for pre-created collections
    if (input.isCollection && !hasValidatedCollection) {
      const win = utils.getWindow()
      if (
        win &&
        (win.offset !== expectedOffset || win.limit !== expectedLimit)
      ) {
        console.warn(
          `useLiveInfiniteQuery: Pre-created collection has window {offset: ${win.offset}, limit: ${win.limit}} ` +
            `but hook expects {offset: 0, limit: ${expectedLimit}}. Adjusting now.`,
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
      isFetchingNextPage = true
      result
        .catch((err: unknown) => {
          if (!cancelled) console.error(`useLiveInfiniteQuery failed:`, err)
        })
        .finally(() => {
          if (!cancelled) isFetchingNextPage = false
        })
    } else {
      isFetchingNextPage = false
    }

    return () => {
      cancelled = true
    }
  })

  // 6. Data derivation
  const result = $derived.by(() => {
    const dataArray = (Array.isArray(query.data) ? query.data : []) as Array<
      InferResultType<TContext>[number]
    >

    const requestedCount = loadedPageCount * pageSize
    const { pages, pageParams } = paginate(
      dataArray,
      pageSize,
      loadedPageCount,
      initialPageParam,
    )

    return {
      pages,
      pageParams,
      data: dataArray.slice(0, requestedCount) as InferResultType<TContext>,
      hasNextPage: dataArray.length > requestedCount,
    }
  })

  const fetchNextPage = () => {
    if (result.hasNextPage && !isFetchingNextPage) {
      loadedPageCount++
    }
  }

  // 7. Public API with concise delegation
  return {
    get state() {
      return query.state as Map<string | number, any>
    },
    get collection() {
      return query.collection as any
    },
    get status() {
      return query.status
    },
    get isLoading() {
      return query.isLoading
    },
    get isReady() {
      return query.isReady
    },
    get isIdle() {
      return query.isIdle
    },
    get isError() {
      return query.isError
    },
    get isCleanedUp() {
      return query.isCleanedUp
    },
    get data() {
      return result.data
    },
    get pages() {
      return result.pages
    },
    get pageParams() {
      return result.pageParams
    },
    get hasNextPage() {
      return result.hasNextPage
    },
    get isFetchingNextPage() {
      return isFetchingNextPage
    },
    fetchNextPage,
  } as UseLiveInfiniteQueryReturn<TContext>
}
