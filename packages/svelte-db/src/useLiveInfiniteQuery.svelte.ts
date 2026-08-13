import {
  BaseQueryBuilder,
  createLiveQueryCollection,
  createLiveQueryWindowController,
  deepEquals,
  hasLiveQueryWindowLeases,
  isCollection,
  isSingleResultCollection,
  normalizeLiveQueryWindowPageSize,
} from '@tanstack/db'
import { tick, untrack } from 'svelte'
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
      query: QueryBuilder<TContext>
    }

type PreviousController = {
  getSnapshot: () => { pages: ReadonlyArray<ReadonlyArray<unknown>> }
}

type InfiniteQueryOptions = {
  pageSize?: number
  initialPageParam?: number
}

function isWindowedCollection(
  collection: InternalCollection,
): collection is WindowedCollection {
  return (
    typeof collection.utils.setWindow === `function` &&
    collection.utils.getWindow?.() !== undefined
  )
}

function assertManyResult(collection: Collection<any, any, any>): void {
  if (isSingleResultCollection(collection)) {
    throw new Error(
      `useLiveInfiniteQuery: Infinite queries do not support single-result queries. Remove .findOne().`,
    )
  }
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

  const value = (
    input as (q: InitialQueryBuilder) => QueryBuilder<TContext> | unknown
  )(new BaseQueryBuilder() as InitialQueryBuilder)
  if (isCollection(value)) {
    return { kind: `collection`, collection: value }
  }

  return {
    kind: `query`,
    query: value as QueryBuilder<TContext>,
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

export type UseLiveInfiniteQueryConfig<
  TContext extends Context & NonSingleResult,
> = LiveInfiniteQueryConfig<InferResultType<TContext>[number]>

export type UseLiveInfiniteQueryReturn<
  TContext extends Context & NonSingleResult,
> = Omit<ReturnType<typeof useLiveQuery<TContext>>, `data`> & {
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

type EnabledLiveQueryReturn<TContext extends Context & NonSingleResult> =
  ReturnType<typeof useLiveQuery<TContext>>

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

export function useLiveInfiniteQuery<
  TContext extends Context & NonSingleResult,
>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  config: UseLiveInfiniteQueryConfig<TContext>,
  deps?: Array<() => unknown>,
): UseLiveInfiniteQueryReturn<TContext>

export function useLiveInfiniteQuery<
  TContext extends Context & NonSingleResult,
>(
  queryFnOrCollection: unknown,
  config: InfiniteQueryOptions,
  deps: Array<() => unknown> = [],
): UseLiveInfiniteQueryReturn<TContext> {
  let validatedCollection: InternalCollection | null = null
  let previousController: PreviousController | null = null
  let previousInput: ResolvedInput<TContext> | null = null
  let previousDependencies: Array<unknown> | null = null
  let previousPageSize: number | null = null
  let previousInitialPageParam: number | null = null

  const pageSize = $derived(normalizeLiveQueryWindowPageSize(config.pageSize))
  const initialPageParam = $derived(config.initialPageParam ?? 0)

  const controller = $derived.by(() => {
    const dependencies = deps.map((dependency) => dependency())

    const input = resolveInput<TContext>(queryFnOrCollection)
    const dependenciesChanged =
      previousDependencies === null ||
      previousDependencies.length !== dependencies.length ||
      previousDependencies.some(
        (dependency, index) => dependency !== dependencies[index],
      )
    const dependenciesStructurallyEqual =
      previousDependencies !== null &&
      deepEquals(previousDependencies, dependencies)
    const pageShapeChanged =
      previousPageSize !== pageSize ||
      previousInitialPageParam !== initialPageParam
    const sameCollection =
      input.kind === `collection` &&
      previousInput?.kind === `collection` &&
      previousInput.collection === input.collection
    const canPreservePageCount =
      previousController !== null &&
      previousInput?.kind === input.kind &&
      (input.kind === `collection`
        ? sameCollection
        : dependenciesChanged
          ? dependenciesStructurallyEqual
          : pageShapeChanged)
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
      assertManyResult(collection)
      if (!isWindowedCollection(collection)) {
        throw new Error(
          `useLiveInfiniteQuery: Pre-created live query collection must have an ORDER BY (orderBy) clause for infinite pagination to work. ` +
            `Please add .orderBy() to your createLiveQueryCollection query.`,
        )
      }

      if (validatedCollection !== collection) {
        validatedCollection = collection
        const currentWindow = collection.utils.getWindow?.()
        const expectedLimit = pageSize + 1
        if (
          currentWindow &&
          !hasLiveQueryWindowLeases(collection) &&
          (currentWindow.offset !== 0 || currentWindow.limit !== expectedLimit)
        ) {
          console.warn(
            `useLiveInfiniteQuery: Pre-created collection has window {offset: ${currentWindow.offset}, limit: ${currentWindow.limit}} ` +
              `but the hook expects {offset: 0, limit: ${expectedLimit}}. Adjusting window now.`,
          )
        }
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
    assertManyResult(collection)
    const currentController = createLiveQueryWindowController(collection, {
      pageSize,
      initialPageParam,
      initialPageCount,
    })
    previousController = currentController
    return currentController
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

  const fetchNextPage = async () => {
    // A dependency can invalidate the derived controller before Svelte runs the
    // effect that subscribes it. Queue the imperative call until that handoff
    // has completed so it cannot target an inactive controller.
    await tick()
    await controller.fetchNextPage()
  }

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
