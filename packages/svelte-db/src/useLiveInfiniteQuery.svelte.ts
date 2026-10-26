import {
  bindLiveQueryWindow,
  fetchNextLiveQueryWindowPage,
  readLiveQueryWindowPageShape,
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
  LiveQueryWindowBinding,
  NonSingleResult,
  QueryBuilder,
} from '@tanstack/db'

type MaybeGetter<T> = T | (() => T)

type InfiniteQueryOptions = {
  pageSize?: number
  /** First result-page label, not a server cursor or remote offset. */
  initialPageParam?: number
}

// Keep the generic parameter for existing typed config wrappers.
export type LiveInfiniteQueryConfig<_TRow> = InfiniteQueryOptions

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
  // Reject an unsupported config at construction, not on first read.
  readLiveQueryWindowPageShape(config)
  let binding: LiveQueryWindowBinding | null = null

  // Svelte reruns this only when something it reads changed: a dependency,
  // the page shape, or state the query callback reads.
  const controller = $derived.by(() => {
    const previous = binding
    binding = bindLiveQueryWindow(previous, {
      ...readLiveQueryWindowPageShape(config),
      input: queryFnOrCollection,
      dependencies: deps.map((dependency) => dependency()),
      recompile: `always`,
    })
    if (binding !== previous && binding.warning) console.warn(binding.warning)
    return binding.controller
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
    await fetchNextLiveQueryWindowPage(controller)
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
    get persistedStatus() {
      return snapshot.persistedStatus
    },
    get isPersistedReady() {
      return snapshot.isPersistedReady
    },
    get persistedError() {
      return snapshot.persistedError
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
