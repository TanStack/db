import { computed, shallowRef, toValue, watchEffect } from 'vue'
import {
  createLiveQueryCollection,
  createLiveQueryWindowController,
  isCollection,
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

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_GC_TIME_MS = 1
const MAX_PAGE_SIZE = Number.MAX_SAFE_INTEGER - 1

type InternalCollection = Collection<object, string | number, UtilsRecord>

type WindowedCollection = InternalCollection & {
  utils: {
    setWindow: (options: {
      offset: number
      limit: number
    }) => true | Promise<void>
    getWindow?: () => { offset: number; limit: number } | undefined
  }
}

type ResolvedInput<TContext extends Context> =
  | { kind: `collection`; collection: InternalCollection }
  | {
      kind: `query`
      query: (q: InitialQueryBuilder) => QueryBuilder<TContext>
    }

type InfiniteQueryOptions = {
  pageSize?: number
  initialPageParam?: number
}

function hasSetWindow(
  collection: InternalCollection,
): collection is WindowedCollection {
  return typeof collection.utils.setWindow === `function`
}

function normalizePageSize(pageSize: number | undefined): number {
  if (
    pageSize === undefined ||
    !Number.isSafeInteger(pageSize) ||
    pageSize > MAX_PAGE_SIZE ||
    pageSize <= 0
  ) {
    return DEFAULT_PAGE_SIZE
  }
  return pageSize
}

function resolveInput<TContext extends Context>(
  input: unknown,
): ResolvedInput<TContext> {
  if (typeof input !== `function`) {
    const value = toValue(input)
    if (isCollection(value)) {
      return { kind: `collection`, collection: value }
    }
  } else if (input.length === 0) {
    try {
      const value = (input as () => unknown)()
      if (isCollection(value)) {
        return { kind: `collection`, collection: value }
      }
    } catch {
      // Query callbacks that close over their builder can have arity 0.
    }
  }

  if (typeof input !== `function`) {
    throw new Error(
      `useLiveInfiniteQuery: First argument must be either a pre-created live query collection or a query function. ` +
        `Received: ${typeof input}`,
    )
  }

  return {
    kind: `query`,
    query: input as (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  }
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

export type UseLiveInfiniteQueryConfig<TContext extends Context> =
  LiveInfiniteQueryConfig<InferResultType<TContext>[number]>

export interface UseLiveInfiniteQueryReturn<TContext extends Context> {
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

export function useLiveInfiniteQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps?: Array<MaybeRefOrGetter<unknown>>,
): UseLiveInfiniteQueryReturn<TContext>

export function useLiveInfiniteQuery<TContext extends Context>(
  queryFnOrCollection: unknown,
  config: InfiniteQueryOptions,
  deps: Array<MaybeRefOrGetter<unknown>> = [],
): UseLiveInfiniteQueryReturn<TContext> {
  let validatedCollection: InternalCollection | null = null

  const controller = computed(() => {
    for (const dependency of deps) toValue(dependency)

    const pageSize = normalizePageSize(config.pageSize)
    const initialPageParam = config.initialPageParam ?? 0
    const input = resolveInput<TContext>(queryFnOrCollection)

    if (input.kind === `collection`) {
      const collection = input.collection
      if (!hasSetWindow(collection)) {
        throw new Error(
          `useLiveInfiniteQuery: Pre-created live query collection must have an orderBy clause for infinite pagination to work. ` +
            `Please add .orderBy() to your createLiveQueryCollection query.`,
        )
      }

      if (validatedCollection !== collection) {
        validatedCollection = collection
        const currentWindow = collection.utils.getWindow?.()
        const expectedLimit = pageSize + 1
        if (
          currentWindow &&
          (currentWindow.offset !== 0 || currentWindow.limit !== expectedLimit)
        ) {
          console.warn(
            `useLiveInfiniteQuery: Pre-created collection has window {offset: ${currentWindow.offset}, limit: ${currentWindow.limit}} ` +
              `but the hook expects {offset: 0, limit: ${expectedLimit}}. Adjusting window now.`,
          )
        }
      }

      return createLiveQueryWindowController(collection, {
        pageSize,
        initialPageParam,
      })
    }

    const collection = createLiveQueryCollection({
      query: (q: InitialQueryBuilder) =>
        input
          .query(q)
          .limit(pageSize + 1)
          .offset(0),
      startSync: false,
      gcTime: DEFAULT_GC_TIME_MS,
    })
    return createLiveQueryWindowController(collection, {
      pageSize,
      initialPageParam,
    })
  })

  const snapshot = shallowRef(controller.value.getSnapshot())

  watchEffect((onInvalidate) => {
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
  })

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
    fetchNextPage: () => controller.value.fetchNextPage(),
    hasNextPage: computed(() => snapshot.value.hasNextPage),
    isFetchingNextPage: computed(() => snapshot.value.isFetchingNextPage),
    error: computed(() => snapshot.value.error),
  }
}
