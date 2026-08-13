import {
  createLiveQueryCollection,
  createLiveQueryWindowController,
  isCollection,
} from '@tanstack/db'
import { untrack } from 'svelte'
// Type-only: used in `ReturnType<typeof useLiveQuery>` below.
import type {
  UseLiveQueryReturnWithCollection,
  useLiveQuery,
} from './useLiveQuery.svelte.js'
import type {
  Collection,
  Context,
  InferResultType,
  InitialQueryBuilder,
  NonSingleResult,
  QueryBuilder,
  UtilsRecord,
} from '@tanstack/db'

const DEFAULT_PAGE_SIZE = 20
const DEFAULT_GC_TIME_MS = 1

type MaybeGetter<T> = T | (() => T)

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
    pageSize <= 0
  ) {
    return DEFAULT_PAGE_SIZE
  }
  return pageSize
}

function resolveInput<TContext extends Context>(
  input: unknown,
): ResolvedInput<TContext> {
  if (isCollection(input)) {
    return { kind: `collection`, collection: input }
  }

  if (typeof input !== `function`) {
    throw new Error(
      `useLiveInfiniteQuery: First argument must be either a pre-created live query collection or a query function. ` +
        `Received: ${typeof input}`,
    )
  }

  // A zero-argument function can be a reactive collection getter. Query
  // callbacks conventionally accept the builder, so avoid probing those.
  if (input.length === 0) {
    try {
      const collection = (input as () => unknown)()
      if (isCollection(collection)) {
        return { kind: `collection`, collection }
      }
    } catch {
      // Query callbacks that close over their builder can still have arity 0.
    }
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

export type UseLiveInfiniteQueryReturn<TContext extends Context> = Omit<
  ReturnType<typeof useLiveQuery<TContext>>,
  `data`
> & {
  data: InferResultType<TContext>
  pages: Array<Array<InferResultType<TContext>[number]>>
  pageParams: Array<number>
  fetchNextPage: () => Promise<void>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  error: unknown
}

export type UseLiveInfiniteQueryReturnWithCollection<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
> = Omit<
  UseLiveQueryReturnWithCollection<TResult, TKey, TUtils, Array<TResult>>,
  `data`
> & {
  data: Array<TResult>
  pages: Array<Array<TResult>>
  pageParams: Array<number>
  fetchNextPage: () => Promise<void>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  error: unknown
}

type EnabledLiveQueryReturn<TContext extends Context> = ReturnType<
  typeof useLiveQuery<TContext>
>

/**
 * Create a Svelte-native reactive view over the shared live-query window
 * controller. The query must include an `orderBy` clause.
 */
export function useLiveInfiniteQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: MaybeGetter<
    Collection<TResult, TKey, TUtils> & NonSingleResult
  >,
  config: LiveInfiniteQueryConfig<TResult>,
): UseLiveInfiniteQueryReturnWithCollection<TResult, TKey, TUtils>

export function useLiveInfiniteQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps?: Array<() => unknown>,
): UseLiveInfiniteQueryReturn<TContext>

export function useLiveInfiniteQuery<TContext extends Context>(
  queryFnOrCollection: unknown,
  config: InfiniteQueryOptions,
  deps: Array<() => unknown> = [],
): UseLiveInfiniteQueryReturn<TContext> {
  let validatedCollection: InternalCollection | null = null

  const pageSize = $derived(normalizePageSize(config.pageSize))
  const initialPageParam = $derived(config.initialPageParam ?? 0)

  const controller = $derived.by(() => {
    for (const dependency of deps) dependency()

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

  let snapshot = $state.raw(untrack(() => controller.getSnapshot()))

  $effect(() => {
    const currentController = controller
    snapshot = currentController.getSnapshot()
    const unsubscribe = currentController.subscribe(() => {
      snapshot = currentController.getSnapshot()
    })
    snapshot = currentController.getSnapshot()

    return () => {
      unsubscribe()
      currentController.dispose()
    }
  })

  const fetchNextPage = () => controller.fetchNextPage()

  return {
    get state() {
      return snapshot.state as EnabledLiveQueryReturn<TContext>[`state`]
    },
    get data() {
      return snapshot.data as InferResultType<TContext>
    },
    get collection() {
      return snapshot.collection as EnabledLiveQueryReturn<TContext>[`collection`]
    },
    get status() {
      return snapshot.status as EnabledLiveQueryReturn<TContext>[`status`]
    },
    get isLoading() {
      return snapshot.isLoading
    },
    get isReady() {
      return snapshot.isReady
    },
    get isIdle() {
      return snapshot.isIdle
    },
    get isError() {
      return snapshot.isError
    },
    get isCleanedUp() {
      return snapshot.isCleanedUp
    },
    get pages() {
      return snapshot.pages as Array<Array<InferResultType<TContext>[number]>>
    },
    get pageParams() {
      return snapshot.pageParams as Array<number>
    },
    get hasNextPage() {
      return snapshot.hasNextPage
    },
    get isFetchingNextPage() {
      return snapshot.isFetchingNextPage
    },
    get error() {
      return snapshot.error
    },
    fetchNextPage,
  }
}
