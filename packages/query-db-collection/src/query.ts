import {
  CancelledError,
  QueryObserver,
  hashKey,
  isCancelledError,
  partialMatchKey,
} from '@tanstack/query-core'
import {
  LoadSubsetOperationAbortedError,
  compileSingleRowExpression,
  deepEquals,
  getLegacyLoadSubsetDemandKey,
  getLoadSubsetDemandKey,
  normalizeLegacyLoadSubsetDemandKey,
  toBooleanPredicate,
  validateSyncPersistenceCapability,
  warnOnce,
  whenSyncAccepted,
  withCollectionConfigFactory,
  withCollectionSyncConfigFactory,
} from '@tanstack/db'
import {
  GetKeyRequiredError,
  InitialDataInOnDemandModeError,
  InvalidQueryResultError,
  QueryClientRequiredError,
  QueryCollectionError,
  QueryFnRequiredError,
  QueryKeyRequiredError,
} from './errors'
import { createWriteUtils } from './manual-sync'
import { runCleanupWithLocalTeardown } from './cleanup'
import type { UpdateCacheData } from './manual-sync'
import type {
  BaseCollectionConfig,
  ChangeMessage,
  CollectionConfig,
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfig,
} from '@tanstack/db'
import type {
  FetchStatus,
  Query,
  QueryClient,
  QueryFunctionContext,
  QueryKey,
  QueryObserverOptions,
  QueryObserverResult,
} from '@tanstack/query-core'
import type { StandardSchemaV1 } from '@standard-schema/spec'

// Re-export for external use
export type { SyncOperation } from './manual-sync'

// Schema output type inference helper (matches electric.ts pattern)
type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends object
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

// Schema input type inference helper (matches electric.ts pattern)
type InferSchemaInput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<T> extends object
    ? StandardSchemaV1.InferInput<T>
    : Record<string, unknown>
  : Record<string, unknown>

type TQueryKeyBuilder<TQueryKey> = (opts: LoadSubsetOptions) => TQueryKey

function isStoredLoadSubsetOptions(value: unknown): value is LoadSubsetOptions {
  // This adapter stores typed request options in its observer metadata.
  return value !== null && typeof value === `object`
}

const queryObserverOptionKeys = [
  `enabled`,
  `refetchInterval`,
  `retry`,
  `retryDelay`,
  `staleTime`,
  `gcTime`,
  `refetchOnWindowFocus`,
  `refetchOnReconnect`,
  `refetchOnMount`,
  `networkMode`,
] as const

type QueryObserverOptionKey = (typeof queryObserverOptionKeys)[number]

type QueryObserverOptionValues = Pick<
  QueryObserverOptions<Array<any>, any, Array<any>, Array<any>, any>,
  QueryObserverOptionKey
>

function pickDefinedQueryObserverOptions(
  config: Partial<QueryObserverOptionValues>,
): Partial<QueryObserverOptionValues> {
  const options: Partial<QueryObserverOptionValues> = {}

  for (const key of queryObserverOptionKeys) {
    if (config[key] !== undefined) {
      ;(options as Record<QueryObserverOptionKey, unknown>)[key] = config[key]
    }
  }

  return options
}

/**
 * Configuration options for creating a Query Collection
 * @template T - The explicit type of items stored in the collection
 * @template TQueryFn - The queryFn type
 * @template TError - The type of errors that can occur during queries
 * @template TQueryKey - The type of the query key
 * @template TKey - The type of the item keys
 * @template TSchema - The schema type for validation
 */
export interface QueryCollectionConfig<
  T extends object = object,
  TQueryFn extends (context: QueryFunctionContext<any>) => any = (
    context: QueryFunctionContext<any>,
  ) => any,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
  TQueryData = Awaited<ReturnType<TQueryFn>>,
> extends BaseCollectionConfig<
  T,
  TKey,
  TSchema,
  QueryCollectionUtils<
    T,
    TKey,
    [TSchema] extends [never] ? T : InferSchemaInput<TSchema>,
    TError
  >
> {
  /** The query key used by TanStack Query to identify this query */
  queryKey: TQueryKey | TQueryKeyBuilder<TQueryKey>
  /** Function that fetches data from the server. Must return the complete collection state */
  queryFn: TQueryFn extends (
    context: QueryFunctionContext<TQueryKey>,
  ) => Promise<Array<any>> | Array<any>
    ? (context: QueryFunctionContext<TQueryKey>) => Promise<Array<T>> | Array<T>
    : TQueryFn
  /**
   * Extracts the row array TanStack DB materializes from the Query response.
   * The Query cache keeps the original response shape.
   */
  select?: (data: TQueryData) => Array<T>
  /** The TanStack Query client instance */
  queryClient: QueryClient

  // Query-specific options
  /** Whether the query should automatically run (default: true) */
  enabled?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`enabled`]
  refetchInterval?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`refetchInterval`]
  retry?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`retry`]
  retryDelay?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`retryDelay`]
  staleTime?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`staleTime`]
  gcTime?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`gcTime`]
  refetchOnWindowFocus?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`refetchOnWindowFocus`]
  refetchOnReconnect?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`refetchOnReconnect`]
  refetchOnMount?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`refetchOnMount`]
  networkMode?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`networkMode`]
  /**
   * Data used to initialize the TanStack Query cache for an eager collection.
   * The value has the original Query response shape and is projected through
   * the collection's select option before rows are materialized.
   */
  initialData?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`initialData`]
  /** The timestamp TanStack Query uses to determine initialData freshness. */
  initialDataUpdatedAt?: QueryObserverOptions<
    TQueryData,
    TError,
    Array<T>,
    TQueryData,
    TQueryKey
  >[`initialDataUpdatedAt`]
  persistedGcTime?: number

  /**
   * Metadata to pass to the query.
   * Available in queryFn via context.meta
   *
   * @example
   * // Using meta for error context
   * queryFn: async (context) => {
   *   try {
   *     return await api.getTodos(userId)
   *   } catch (error) {
   *     // Use meta for better error messages
   *     throw new Error(
   *       context.meta?.errorMessage || 'Failed to load todos'
   *     )
   *   }
   * },
   * meta: {
   *   errorMessage: `Failed to load todos for user ${userId}`
   * }
   */
  meta?: Record<string, unknown>
}

/**
 * Type for the refetch utility function
 * Returns QueryObserverResults from TanStack Query after the applicable
 * boundary. Normally this waits until each accepted result has been applied to
 * the Collection. While a user mutation is persisting or its handler is
 * active, refetch retains the Query fetch boundary because normal application
 * is queued behind that transaction. At the application boundary,
 * `throwOnError` applies to both Query fetch and Collection application
 * failures. At the fetch boundary it applies only to Query fetch failure; a
 * later application failure is recorded by the Collection error utilities.
 * At the application boundary, a successful Query result that the adapter
 * cannot apply rejects with `InvalidQueryResultError` regardless of
 * `throwOnError`. At the fetch boundary, that failure is recorded by the
 * Collection error utilities. If application is deferred at the application
 * boundary, the promise waits for the replacement result to apply.
 */
export type RefetchFn = (opts?: {
  throwOnError?: boolean
}) => Promise<Array<QueryObserverResult<any, any> | void>>

/**
 * Utility methods available on Query Collections for direct writes and manual operations.
 * Direct writes bypass optimistic mutations and write to the synced data store.
 * Direct writes do not trigger a Query refetch. On-demand cache edits are
 * best-effort and do not establish scoped result authority.
 * @template TItem - The type of items stored in the collection
 * @template TKey - The type of the item keys
 * @template TInsertInput - The type accepted for insert operations
 * @template TError - The type of errors that can occur during queries
 */
export interface QueryCollectionUtils<
  TItem extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TInsertInput extends object = TItem,
  TError = unknown,
> {
  // Keep this interface closed: extending UtilsRecord would make every
  // nonexistent adapter utility appear as `any`.
  /** Manually refetch and await the applicable fetch or application boundary. */
  refetch: RefetchFn
  /** Insert items without an optimistic update. Resolves when the sync commit applies. */
  writeInsert: (data: TInsertInput | Array<TInsertInput>) => Promise<void>
  /** Update items without an optimistic update. Resolves when the sync commit applies. */
  writeUpdate: (
    updates: Partial<TItem> | Array<Partial<TItem>>,
  ) => Promise<void>
  /** Delete items without an optimistic update. Resolves when the sync commit applies. */
  writeDelete: (keys: TKey | Array<TKey>) => Promise<void>
  /** Insert or update items without an optimistic update. Resolves when the sync commit applies. */
  writeUpsert: (data: Partial<TItem> | Array<Partial<TItem>>) => Promise<void>
  /** Execute direct writes as one atomic batch. Resolves when the sync commit applies. */
  writeBatch: (callback: () => void) => Promise<void>

  // Query Observer State (getters)
  /** Get the last error encountered by the query (if any); reset after a successful result applies */
  lastError: TError | undefined
  /** Check if the collection is in an error state */
  isError: boolean
  /**
   * Get the number of consecutive sync failures.
   * Incremented only when query fails completely (not per retry attempt); reset after a successful result applies.
   */
  errorCount: number
  /** Check if query is currently fetching (initial or background) */
  isFetching: boolean
  /** Check if query is refetching in background (not initial fetch) */
  isRefetching: boolean
  /** Check if query is loading for the first time (no data yet) */
  isLoading: boolean
  /** Get timestamp of last successful data update (in milliseconds) */
  dataUpdatedAt: number
  /**
   * Get the aggregate observer fetch status. Returns `fetching` if any
   * observer is fetching, otherwise `paused` if any observer is paused, and
   * `idle` when every observer is idle or no observers exist.
   */
  fetchStatus: `fetching` | `paused` | `idle`

  /**
   * Refetch, retaining errors until a successful result applies. While a user
   * mutation is persisting or its handler is active, this retains the Query
   * fetch boundary so it cannot wait on publication blocked by that
   * transaction.
   * @returns Promise that resolves when the applicable refetch boundary completes
   * @throws Error if the refetch fails
   */
  clearError: () => Promise<void>
}

/**
 * Internal state object for tracking query observer and errors
 */
interface QueryCollectionState {
  lastError: any
  errorCount: number
  observers: Map<
    string,
    QueryObserver<Array<any>, any, Array<any>, Array<any>, any>
  >
}

type PersistedQueryRetentionEntry =
  | {
      queryHash: string
      mode: `ttl`
      expiresAt: number
    }
  | {
      queryHash: string
      mode: `until-revalidated`
    }

const QUERY_COLLECTION_GC_PREFIX = `queryCollection:gc:`

type AnyQuery = Query<any, any, any, any>

const queryCollectionCurrentFetchStarts = new WeakMap<AnyQuery, number>()
const queryCollectionSuccessfulFetchStarts = new WeakMap<AnyQuery, number>()
const queryCollectionSuccessfulFetchData = new WeakMap<AnyQuery, unknown>()
const queryCollectionSuccessfulFetchVersions = new WeakMap<AnyQuery, number>()
const queryCollectionCacheOwners = new WeakMap<AnyQuery, Set<object>>()
// These belong to the physical Query, which can be shared by Collections.
// A separate signal preserves Query Core's ignored-signal cache behavior.
type PhysicalFetchState = {
  operations: Map<
    number,
    {
      controller?: AbortController
      startedWithAcquisition: boolean
      cancelledByCore?: boolean
    }
  >
  acquisitions: Set<{ options: { signal?: AbortSignal } }>
  cleanupWatch?: { starts: Set<number>; stop: () => void }
}
const queryCollectionPhysicalFetchStates = new WeakMap<
  AnyQuery,
  PhysicalFetchState
>()
const queryCollectionOnDemandObservers = new WeakSet<
  QueryObserver<any, any, any, any, any>
>()
function getPhysicalFetchState(query: AnyQuery): PhysicalFetchState {
  let state = queryCollectionPhysicalFetchStates.get(query)
  if (!state) {
    state = { operations: new Map(), acquisitions: new Set() }
    queryCollectionPhysicalFetchStates.set(query, state)
  }
  return state
}
function hasLivePhysicalAcquisition(state: PhysicalFetchState): boolean {
  for (const { options } of state.acquisitions) {
    if (!options.signal?.aborted) return true
  }
  return false
}
function hasIndependentQueryObserver(query: AnyQuery): boolean {
  return query.observers.some(
    (observer) => !queryCollectionOnDemandObservers.has(observer),
  )
}
function abortUnownedPhysicalFetch(query: AnyQuery): void {
  const state = queryCollectionPhysicalFetchStates.get(query)
  if (!state || query.state.fetchStatus === `idle`) return
  if (hasLivePhysicalAcquisition(state)) return
  // Query Core observers and eager Collections also own this physical fetch.
  // An on-demand Collection observer alone cannot keep an aborted lease live.
  if (hasIndependentQueryObserver(query)) return
  state.operations.forEach(({ controller }) => controller?.abort())
}
function watchPhysicalFetchAfterCleanup(
  queryClient: QueryClient,
  query: AnyQuery,
): void {
  const state = queryCollectionPhysicalFetchStates.get(query)
  if (!state) return
  const starts = [...state.operations]
    .filter(([, operation]) => operation.controller)
    .map(([start]) => start)
  if (starts.length === 0) return
  const existingWatch = state.cleanupWatch
  if (existingWatch) {
    starts.forEach((start) => existingWatch.starts.add(start))
    return
  }
  const watchedStarts = new Set(starts)

  const stop = queryClient.getQueryCache().subscribe((event) => {
    if (event.query !== query) return
    if (event.type === `fetchCancelled`) {
      state.operations.get(event.fetchSequence)?.controller?.abort()
      // This fetch is terminal even when a silent nonrevert cancellation
      // leaves Query Core's visible fetch status unchanged.
      if (watchedStarts.delete(event.fetchSequence))
        state.operations.delete(event.fetchSequence)
    }
    if (event.type === `removed`) {
      state.operations.forEach(({ controller }) => controller?.abort())
      state.operations.clear()
      state.cleanupWatch?.stop()
      return
    }
    if (event.type === `observerRemoved`) abortUnownedPhysicalFetch(query)
    if (
      event.type === `updated` &&
      (event.action.type === `success` || event.action.type === `error`) &&
      event.fetchSequence !== undefined
    )
      if (watchedStarts.delete(event.fetchSequence))
        state.operations.delete(event.fetchSequence)
    // An outside observer can start a successor in its result callback before
    // this terminal cache event. Retire the event's fetch, not the Query's
    // current fetch status or the successor's state.
    if (watchedStarts.size === 0) state.cleanupWatch?.stop()
  })
  state.cleanupWatch = {
    starts: watchedStarts,
    stop: () => {
      state.cleanupWatch = undefined
      stop()
    },
  }
  abortUnownedPhysicalFetch(query)
}
function hasCanceledRetainedFetch(query: AnyQuery): boolean {
  const state = queryCollectionPhysicalFetchStates.get(query)
  const operation =
    query.fetchSequence === undefined
      ? undefined
      : state?.operations.get(query.fetchSequence)
  return (
    operation?.startedWithAcquisition === true &&
    operation.controller?.signal.aborted === true &&
    (operation.cancelledByCore === true ||
      [...(state?.acquisitions ?? [])].some(
        ({ options }) => options.signal?.aborted,
      ))
  )
}
const queryCollectionCachePatches = new WeakMap<
  AnyQuery,
  {
    owner: object
    session: object | undefined
    data: unknown
    attribution?:
      | { kind: `direct`; position: number }
      | { kind: `fetched`; fetchStart: number; sourceStart: number }
  }
>()

/**
 * Implementation class for QueryCollectionUtils with explicit dependency injection
 * for better testability and architectural clarity
 */
class QueryCollectionUtilsImpl implements QueryCollectionUtils {
  private state: QueryCollectionState

  // Write methods
  public refetch: RefetchFn
  public writeInsert: QueryCollectionUtils[`writeInsert`]
  public writeUpdate: QueryCollectionUtils[`writeUpdate`]
  public writeDelete: QueryCollectionUtils[`writeDelete`]
  public writeUpsert: QueryCollectionUtils[`writeUpsert`]
  public writeBatch: QueryCollectionUtils[`writeBatch`]

  constructor(
    state: QueryCollectionState,
    refetch: RefetchFn,
    writeUtils: ReturnType<typeof createWriteUtils>,
  ) {
    this.state = state

    // Initialize methods to use passed dependencies
    this.refetch = refetch
    this.writeInsert = writeUtils.writeInsert
    this.writeUpdate = writeUtils.writeUpdate
    this.writeDelete = writeUtils.writeDelete
    this.writeUpsert = writeUtils.writeUpsert
    this.writeBatch = writeUtils.writeBatch
  }

  public async clearError() {
    await this.refetch({ throwOnError: true })
  }

  // Getters for error state
  public get lastError() {
    return this.state.lastError
  }

  public get isError() {
    return !!this.state.lastError
  }

  public get errorCount() {
    return this.state.errorCount
  }

  // Getters for QueryObserver state
  public get isFetching() {
    // check if any observer is fetching
    return Array.from(this.state.observers.values()).some(
      (observer) => observer.getCurrentResult().isFetching,
    )
  }

  public get isRefetching() {
    // check if any observer is refetching
    return Array.from(this.state.observers.values()).some(
      (observer) => observer.getCurrentResult().isRefetching,
    )
  }

  public get isLoading() {
    // check if any observer is loading
    return Array.from(this.state.observers.values()).some(
      (observer) => observer.getCurrentResult().isLoading,
    )
  }

  public get dataUpdatedAt() {
    // compute the max dataUpdatedAt of all observers
    return Math.max(
      0,
      ...Array.from(this.state.observers.values()).map(
        (observer) => observer.getCurrentResult().dataUpdatedAt,
      ),
    )
  }

  public get fetchStatus(): FetchStatus {
    let aggregate: FetchStatus = `idle`
    for (const observer of this.state.observers.values()) {
      const fetchStatus = observer.getCurrentResult().fetchStatus
      if (fetchStatus === `fetching`) return `fetching`
      if (fetchStatus === `paused`) aggregate = `paused`
    }
    return aggregate
  }
}

/**
 * Creates query collection options for use with a standard Collection.
 * This integrates TanStack Query with TanStack DB for automatic synchronization.
 *
 * Supports automatic type inference following the priority order:
 * 1. Schema inference (highest priority)
 * 2. QueryFn return type inference (second priority)
 *
 * @template T - Type of the schema if a schema is provided otherwise it is the type of the values returned by the queryFn
 * @template TError - The type of errors that can occur during queries
 * @template TQueryKey - The type of the query key
 * @template TKey - The type of the item keys
 * @param config - Configuration options for the Query collection
 * @returns Collection options with utilities for direct writes and manual operations
 *
 * @example
 * // Type inferred from queryFn return type (NEW!)
 * const todosCollection = createCollection(
 *   queryCollectionOptions({
 *     queryKey: ['todos'],
 *     queryFn: async () => {
 *       const response = await fetch('/api/todos')
 *       return response.json() as Todo[] // Type automatically inferred!
 *     },
 *     queryClient,
 *     getKey: (item) => item.id, // item is typed as Todo
 *   })
 * )
 *
 * @example
 * // Explicit type
 * const todosCollection = createCollection<Todo>(
 *   queryCollectionOptions({
 *     queryKey: ['todos'],
 *     queryFn: async () => fetch('/api/todos').then(r => r.json()),
 *     queryClient,
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * @example
 * // Schema inference
 * const todosCollection = createCollection(
 *   queryCollectionOptions({
 *     queryKey: ['todos'],
 *     queryFn: async () => fetch('/api/todos').then(r => r.json()),
 *     queryClient,
 *     schema: todoSchema, // Type inferred from schema
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * @example
 * // With persistence handlers
 * const todosCollection = createCollection(
 *   queryCollectionOptions({
 *     queryKey: ['todos'],
 *     queryFn: fetchTodos,
 *     queryClient,
 *     getKey: (item) => item.id,
 *     onInsert: async ({ transaction }) => {
 *       await api.createTodos(transaction.mutations.map(m => m.modified))
 *     },
 *     onUpdate: async ({ transaction }) => {
 *       await api.updateTodos(transaction.mutations)
 *     },
 *     onDelete: async ({ transaction }) => {
 *       await api.deleteTodos(transaction.mutations.map(m => m.key))
 *     }
 *   })
 * )
 *
 * @example
 * // The select option extracts the items array from a response with metadata
 * const todosCollection = createCollection(
 *   queryCollectionOptions({
 *     queryKey: ['todos'],
 *     queryFn: async () => fetch('/api/todos').then(r => r.json()),
 *     select: (data) => data.items, // Extract the array of items
 *     queryClient,
 *     schema: todoSchema,
 *     getKey: (item) => item.id,
 *   })
 * )
 */
// Overload for when schema is provided and select present
export function queryCollectionOptions<
  T extends StandardSchemaV1,
  TQueryFn extends (context: QueryFunctionContext<any>) => any,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
  TQueryData = Awaited<ReturnType<TQueryFn>>,
>(
  config: Omit<
    QueryCollectionConfig<
      InferSchemaOutput<T>,
      TQueryFn,
      TError,
      TQueryKey,
      TKey,
      T,
      TQueryData
    >,
    `select`
  > & {
    schema: T
    select: (data: TQueryData) => Array<InferSchemaOutput<T>>
  },
): CollectionConfig<
  InferSchemaOutput<T>,
  TKey,
  T,
  QueryCollectionUtils<InferSchemaOutput<T>, TKey, InferSchemaInput<T>, TError>
> & {
  schema: T
  utils: QueryCollectionUtils<
    InferSchemaOutput<T>,
    TKey,
    InferSchemaInput<T>,
    TError
  >
}

// Overload for when no schema is provided and select present
export function queryCollectionOptions<
  T extends object,
  TQueryFn extends (context: QueryFunctionContext<any>) => any = (
    context: QueryFunctionContext<any>,
  ) => any,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
  TQueryData = Awaited<ReturnType<TQueryFn>>,
>(
  config: QueryCollectionConfig<
    T,
    TQueryFn,
    TError,
    TQueryKey,
    TKey,
    never,
    TQueryData
  > & {
    schema?: never // prohibit schema
    select: (data: TQueryData) => Array<T>
  },
): CollectionConfig<
  T,
  TKey,
  never,
  QueryCollectionUtils<T, TKey, T, TError>
> & {
  schema?: never // no schema in the result
  utils: QueryCollectionUtils<T, TKey, T, TError>
}

// Overload for when schema is provided
export function queryCollectionOptions<
  T extends StandardSchemaV1,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
>(
  config: QueryCollectionConfig<
    InferSchemaOutput<T>,
    (
      context: QueryFunctionContext<any>,
    ) => Array<InferSchemaOutput<T>> | Promise<Array<InferSchemaOutput<T>>>,
    TError,
    TQueryKey,
    TKey,
    T
  > & {
    schema: T
  },
): CollectionConfig<
  InferSchemaOutput<T>,
  TKey,
  T,
  QueryCollectionUtils<InferSchemaOutput<T>, TKey, InferSchemaInput<T>, TError>
> & {
  schema: T
  utils: QueryCollectionUtils<
    InferSchemaOutput<T>,
    TKey,
    InferSchemaInput<T>,
    TError
  >
}

// Overload for when no schema is provided
export function queryCollectionOptions<
  T extends object,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
>(
  config: QueryCollectionConfig<
    T,
    (context: QueryFunctionContext<any>) => Array<T> | Promise<Array<T>>,
    TError,
    TQueryKey,
    TKey
  > & {
    schema?: never // prohibit schema
  },
): CollectionConfig<
  T,
  TKey,
  never,
  QueryCollectionUtils<T, TKey, T, TError>
> & {
  schema?: never // no schema in the result
  utils: QueryCollectionUtils<T, TKey, T, TError>
}

export function queryCollectionOptions(
  config: QueryCollectionConfig<
    Record<string, unknown>,
    (context: QueryFunctionContext<any>) => any
  >,
): CollectionConfig<
  Record<string, unknown>,
  string | number,
  never,
  QueryCollectionUtils
> & {
  utils: QueryCollectionUtils
} {
  const {
    queryKey,
    queryFn,
    select,
    queryClient,
    enabled,
    refetchInterval,
    retry,
    retryDelay,
    staleTime,
    gcTime,
    refetchOnWindowFocus,
    refetchOnReconnect,
    refetchOnMount,
    networkMode,
    initialData,
    initialDataUpdatedAt,
    persistedGcTime,
    getKey,
    onInsert,
    onUpdate,
    onDelete,
    meta,
    ...baseCollectionConfig
  } = config

  // Default to eager sync mode if not provided
  const syncMode = baseCollectionConfig.syncMode ?? `eager`

  if (
    syncMode === `on-demand` &&
    (initialData !== undefined || initialDataUpdatedAt !== undefined)
  ) {
    throw new InitialDataInOnDemandModeError()
  }

  const initialDataObserverOptions =
    syncMode === `eager`
      ? {
          ...(initialData !== undefined && { initialData }),
          ...(initialDataUpdatedAt !== undefined && {
            initialDataUpdatedAt,
          }),
          // Placeholder data is observer-local UI state in TanStack Query. It
          // must not be exposed as collection-wide normalized rows, including
          // when supplied through QueryClient defaults.
          placeholderData: undefined,
        }
      : {
          // A collection-wide initializer cannot establish membership for
          // arbitrary on-demand subsets. A defined initializer is needed to
          // override a QueryClient default because Query Core can apply
          // defaults again while constructing each Query.
          initialData: () => undefined,
          initialDataUpdatedAt: undefined,
          placeholderData: undefined,
        }

  // Compute the base query key once for cache lookups.
  // All derived keys (from on-demand predicates or function-based queryKey) must
  // share this prefix so that queryCache.findAll({ queryKey: baseKey }) can find them.
  const baseKey: QueryKey =
    typeof queryKey === `function`
      ? (queryKey({}) as unknown as QueryKey)
      : (queryKey as unknown as QueryKey)
  const fullSourceKey =
    syncMode === `on-demand` && typeof queryKey !== `function`
      ? baseKey
      : undefined
  const fullSourceHash = fullSourceKey && hashKey(fullSourceKey)

  /**
   * Validates that a derived query key extends the base key prefix.
   * TanStack Query uses prefix matching in findAll(), so all keys for this collection
   * must start with baseKey for stale cache updates to work correctly.
   */
  const validateQueryKeyPrefix = (key: QueryKey): void => {
    if (typeof queryKey !== `function`) return
    const isValidPrefix =
      key.length >= baseKey.length &&
      baseKey.every((segment, i) => deepEquals(segment, key[i]))
    if (!isValidPrefix) {
      console.warn(
        `[QueryCollection] queryKey function must return keys that extend the base key prefix. ` +
          `Base: ${JSON.stringify(baseKey)}, Got: ${JSON.stringify(key)}. ` +
          `This can cause stale cache issues.`,
      )
    }
  }

  // Validate required parameters

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!queryKey) {
    throw new QueryKeyRequiredError()
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!queryFn) {
    throw new QueryFnRequiredError()
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!queryClient) {
    throw new QueryClientRequiredError()
  }
  if (
    typeof queryClient.getQueryCache().reserveSequence !== `function` ||
    typeof queryClient.getQueryCache().currentSequence !== `number`
  ) {
    throw new Error(
      `@tanstack/query-db-collection requires a Query Core version with fetch attribution`,
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!getKey) {
    throw new GetKeyRequiredError()
  }

  /** State object to hold error tracking and observer reference */
  const state: QueryCollectionState = {
    lastError: undefined as any,
    errorCount: 0,
    observers: new Map<
      string,
      QueryObserver<Array<any>, any, Array<any>, Array<any>, any>
    >(),
  }
  let activeMutationHandlerCount = 0

  // Query Cache fetch actions give each request a stable identity. Observer
  // results and their exact Collection applications are attached to that
  // identity so unrelated same-key cache work cannot become a refetch
  // obligation merely because it happened before the call returned.
  type FetchApplicationRecord = {
    result?: QueryObserverResult<any, any>
    settlement?: Promise<void>
    terminal?: boolean
  }
  const resultApplicationSettlements = new WeakMap<
    QueryObserverResult<any, any>,
    Map<string, Promise<void>>
  >()
  const fetchApplicationRecords = new WeakMap<
    AnyQuery,
    Map<number, Map<string, FetchApplicationRecord>>
  >()
  // A queryFn can synchronously cancel its own fetch and let another observer
  // start a successor before observer.refetch() returns. Capture the retryer
  // that belongs to the call before invoking user code.
  type RefetchCapture = {
    query: AnyQuery
    fetchStart?: number
    promise?: Promise<unknown>
    cancellation?: Promise<CancelledError | undefined>
  }
  let activeRefetchCapture: RefetchCapture | undefined
  const observeCancellation = (
    promise: Promise<unknown>,
  ): Promise<CancelledError | undefined> =>
    promise.then(
      () => undefined,
      (error: unknown) => (isCancelledError(error) ? error : undefined),
    )
  // Query-cache ownership is scoped to this sync run and keyed by the
  // actual Query object. Weak membership survives subset unload without
  // retaining entries after Query Core garbage-collects them.
  let ownedCacheQueries = new WeakSet<AnyQuery>()
  const cacheOwnerToken = {}
  let trackedCacheQueries: Set<AnyQuery>
  const logicalHashesByQuery = new WeakMap<AnyQuery, Set<string>>()

  // A rotated persisted cache generation requires a successful fetch that
  // started after rotation. Direct writes have no such fetch requirement.
  let requiredCacheGenerationFetchStart: number | undefined
  let scopedRecoveryEpoch = 0
  let scopedRecoveryPending = false
  const trackCacheQuery = (query: AnyQuery, logicalHash?: string): void => {
    trackedCacheQueries.add(query)
    if (logicalHash !== undefined) {
      const hashes = logicalHashesByQuery.get(query) ?? new Set<string>()
      hashes.add(logicalHash)
      logicalHashesByQuery.set(query, hashes)
    }
  }

  const trackOwnedCacheQuery = (query: AnyQuery, logicalHash: string): void => {
    ownedCacheQueries.add(query)
    trackCacheQuery(query, logicalHash)
    const owners = queryCollectionCacheOwners.get(query) ?? new Set<object>()
    owners.add(cacheOwnerToken)
    queryCollectionCacheOwners.set(query, owners)
  }

  const getLogicalHashes = (query: AnyQuery): Set<string> =>
    logicalHashesByQuery.get(query) ?? new Set([hashKey(query.queryKey)])

  const getFetchApplicationRecord = (
    query: AnyQuery,
    fetchStart: number,
    hashedQueryKey: string,
  ): FetchApplicationRecord => {
    const recordsByStart =
      fetchApplicationRecords.get(query) ??
      new Map<number, Map<string, FetchApplicationRecord>>()
    fetchApplicationRecords.set(query, recordsByStart)
    const recordsByHash =
      recordsByStart.get(fetchStart) ??
      new Map<string, FetchApplicationRecord>()
    recordsByStart.set(fetchStart, recordsByHash)
    const record = recordsByHash.get(hashedQueryKey) ?? {}
    recordsByHash.set(hashedQueryKey, record)
    return record
  }

  const getRecordedResultApplicationSettlement = (
    hashedQueryKey: string,
    result: QueryObserverResult<any, any>,
  ): Promise<void> | undefined =>
    resultApplicationSettlements.get(result)?.get(hashedQueryKey)

  const recordResultApplicationSettlement = (
    hashedQueryKey: string,
    result: QueryObserverResult<any, any>,
    settlement: Promise<void>,
  ): void => {
    const settlementsByHash =
      resultApplicationSettlements.get(result) ?? new Map()
    settlementsByHash.set(hashedQueryKey, settlement)
    resultApplicationSettlements.set(result, settlementsByHash)
  }

  const captureFetchResult = (query: AnyQuery, fetchStart: number): void => {
    for (const hashedQueryKey of getLogicalHashes(query)) {
      const observer = state.observers.get(hashedQueryKey)
      if (!observer || observer.getCurrentQuery() !== query) continue
      const result = observer.getCurrentResult()
      const record = getFetchApplicationRecord(
        query,
        fetchStart,
        hashedQueryKey,
      )
      if (record.terminal) continue
      record.result = result
      const settlement = getRecordedResultApplicationSettlement(
        hashedQueryKey,
        result,
      )
      if (settlement) record.settlement = settlement
    }
  }

  const captureFetchApplications = (
    query: AnyQuery,
    fetchStart: number,
  ): void => {
    const recordsByHash = fetchApplicationRecords.get(query)?.get(fetchStart)
    if (!recordsByHash) return
    for (const [hashedQueryKey, record] of recordsByHash) {
      if (!record.result) continue
      const settlement = getRecordedResultApplicationSettlement(
        hashedQueryKey,
        record.result,
      )
      if (settlement) record.settlement = settlement
    }
  }

  const retireFetchApplicationRecords = (
    query: AnyQuery,
    fetchStarts: ReadonlyArray<number>,
  ): void => {
    const recordsByStart = fetchApplicationRecords.get(query)
    if (!recordsByStart) return
    for (const fetchStart of fetchStarts) recordsByStart.delete(fetchStart)
    if (recordsByStart.size === 0) fetchApplicationRecords.delete(query)
  }

  const hasCurrentCacheGenerationFetch = (query: AnyQuery): boolean =>
    requiredCacheGenerationFetchStart === undefined ||
    (queryCollectionSuccessfulFetchStarts.get(query) ?? 0) >
      requiredCacheGenerationFetchStart

  // hashedQueryKey → queryKey
  const hashToQueryKey = new Map<string, QueryKey>()

  // queryKey → Set<RowKey>. Entry presence means ownership is resolved;
  // an empty set represents a resolved query that currently owns no rows.
  const queryToRows = new Map<string, Set<string | number>>()

  // RowKey → Set<queryKey>
  const rowToQueries = new Map<string | number, Set<string>>()

  // queryKey → QueryObserver's unsubscribe function
  const unsubscribes = new Map<string, () => void>()
  const pendingReadyUnsubscribes = new Map<string, Set<() => void>>()
  // A fetch that started before a direct write returns older server data.
  // Compare their positions when the fetched result is applied.
  let directWriteGeneration = 0
  // Only live rows with no subset owner need a position after acceptance.
  // A later cached result can then be compared with that row's last write,
  // without retaining positions for every key ever written.
  const unownedDirectWritePositions = new Map<string | number, number>()
  // Direct writes use accepted-fetch order; competing fetched rows use their
  // first observed source-invocation order.
  type AcceptedRowPosition =
    | { kind: `direct`; acceptance: number }
    | { kind: `fetched`; source: number; query: AnyQuery }
  const acceptedRowPositions = new Map<string | number, AcceptedRowPosition>()
  const acceptedRowIsNewer = (
    accepted: AcceptedRowPosition | undefined,
    fetchStart: number | undefined,
    sourceStart: number | undefined,
  ): boolean =>
    accepted?.kind === `direct`
      ? accepted.acceptance > (fetchStart ?? 0)
      : accepted?.kind === `fetched` &&
        sourceStart !== undefined &&
        accepted.source > sourceStart
  const awaitingFetchSuccessNotification = new WeakSet<object>()
  const awaitingFetchSuccessVersions = new WeakMap<AnyQuery, number>()
  const fetchStartGenerations = new Map<string, number>()
  const getResultFetchStart = (
    result: QueryObserverResult<any, any>,
    query?: AnyQuery,
  ): number | undefined => {
    if (result.dataSourceSequence !== undefined) return result.dataFetchSequence
    // Query Core can fulfill an accepted fetch without observing a source
    // invocation. Reused data keeps only its previous known authority.
    if (query && queryCollectionSuccessfulFetchData.get(query) === result.data)
      return queryCollectionSuccessfulFetchStarts.get(query)
    return undefined
  }
  const cancelPreWriteFetch = (
    query: AnyQuery,
    hashedQueryKey: string,
  ): void => {
    const fetchStart =
      queryCollectionCurrentFetchStarts.get(query) ??
      fetchStartGenerations.get(hashedQueryKey)
    if (
      query.state.fetchStatus === `fetching` &&
      (fetchStart ?? directWriteGeneration) < directWriteGeneration
    ) {
      // Query Core otherwise reuses an empty-cache request from before the write.
      void query.cancel({ silent: true })
    }
  }
  const pendingResultApplications = new Map<string, Promise<void>>()
  // Query cache can advance while no Collection acquisition owns its rows.
  // A later acquisition needs this Collection's applied version, not Query
  // Core's successful cache version, to decide whether it is ready.
  const appliedResultVersions = new Map<
    string,
    { query: AnyQuery; version: number; data: unknown }
  >()
  const hasAppliedResult = (hash: string, query: AnyQuery): boolean => {
    const applied = appliedResultVersions.get(hash)
    return (
      applied?.query === query &&
      applied.version === query.state.dataUpdateCount &&
      applied.data === query.state.data
    )
  }
  // The generation of the latest direct write to each key.
  const directWriteKeyGenerations = new Map<string | number, number>()
  // Direct writes that wait for earlier commits. A result that arrives
  // meanwhile is handled after them.
  let pendingDirectWrites: Promise<void> | undefined
  // True while a direct write puts its accepted rows into the cache.
  let writingDirectCache = false
  // A derived select can leave an older cache envelope untouched. Its current
  // successful result must not be replayed after a direct write.
  const unpatchedCacheVersions = new WeakMap<AnyQuery, number>()
  // Results deferred behind direct writes that have not applied yet.
  let deferredResults = 0

  // queryKey → reference count (how many loadSubset calls are active)
  // Reference counting for QueryObserver lifecycle management
  // =========================================================
  // Tracks how many live query subscriptions are using each QueryObserver.
  // Multiple live queries with identical predicates share the same QueryObserver for efficiency.
  //
  // Lifecycle:
  // - Increment: when createQueryFromOpts creates or reuses an observer
  // - Decrement: when subscription.unsubscribe() releases its acquisition options
  // - Reset: when cleanupQuery() is triggered by TanStack Query's cache GC
  //
  // When refcount reaches 0, unloadSubset():
  // 1. Looks up the Query chosen when those options acquired a lease
  // 2. Uses existing machinery (queryToRows map) to find rows that query loaded
  // 3. Decrements refcount and GCs rows where count reaches 0
  const queryRefCounts = new Map<string, number>()
  // A completed full-source Query can own narrower demands without a second
  // transport. Pin each demand to its chosen Query until its final release.
  const fullSourceDependents = new Map<string, number>()
  type AcquisitionRoute = {
    options: LoadSubsetOptions
    requestedHash: string
    physicalHash: string
    query: AnyQuery
    removeAbortListener?: () => void
  }
  let acquisitionRoutes = new WeakMap<
    LoadSubsetOptions,
    Array<AcquisitionRoute>
  >()
  const activeAcquisitions = new Map<string, Set<AcquisitionRoute>>()
  const hasLiveAcquisition = (physicalHash: string): boolean => {
    for (const { options } of activeAcquisitions.get(physicalHash) ?? []) {
      if (!options.signal?.aborted) return true
    }
    return false
  }
  const recordAcquisitionRoute = (
    options: LoadSubsetOptions,
    requestedHash: string,
    physicalHash: string,
  ): void => {
    const query = state.observers.get(physicalHash)!.getCurrentQuery()
    const route: AcquisitionRoute = {
      options,
      requestedHash,
      physicalHash,
      query,
    }
    const routes = acquisitionRoutes.get(options) ?? []
    routes.push(route)
    acquisitionRoutes.set(options, routes)
    const active = activeAcquisitions.get(physicalHash) ?? new Set()
    active.add(route)
    activeAcquisitions.set(physicalHash, active)
    getPhysicalFetchState(query).acquisitions.add(route)
    if (options.signal) {
      const onAbort = () => abortUnownedPhysicalFetch(query)
      options.signal.addEventListener(`abort`, onAbort, { once: true })
      route.removeAbortListener = () =>
        options.signal?.removeEventListener(`abort`, onAbort)
    }
    if (physicalHash === fullSourceHash && requestedHash !== fullSourceHash) {
      fullSourceDependents.set(
        requestedHash,
        (fullSourceDependents.get(requestedHash) ?? 0) + 1,
      )
    }
  }
  const releaseAcquisitionRoute = (route: AcquisitionRoute): void => {
    route.removeAbortListener?.()
    const active = activeAcquisitions.get(route.physicalHash)
    active?.delete(route)
    if (active?.size === 0) activeAcquisitions.delete(route.physicalHash)
    getPhysicalFetchState(route.query).acquisitions.delete(route)
    abortUnownedPhysicalFetch(route.query)
  }

  // Eager startup holds one reference until cleanup. Cache removal detaches
  // observation, not that ownership or its rows.
  let ensureEagerSubscription = () => {}
  let applyRefetchResultWhenUnsubscribed = (
    _hashedQueryKey: string,
    _result: QueryObserverResult<any, any>,
  ): boolean => false

  type ExceptionalResultSettlement =
    | {
        type: `pending`
        promise: Promise<QueryObserverResult<unknown, unknown>>
        reject: (error: unknown) => void
      }
    | { type: `rejected`; error: unknown }
  let getExceptionalResultSettlement = (
    _result: QueryObserverResult<unknown, unknown>,
  ): ExceptionalResultSettlement | undefined => undefined
  let activeSyncSession: object | undefined

  const addRowOwner = (rowKey: string | number, hashedQueryKey: string) => {
    const owners = rowToQueries.get(rowKey) || new Set<string>()
    owners.add(hashedQueryKey)
    rowToQueries.set(rowKey, owners)

    const ownedRows =
      queryToRows.get(hashedQueryKey) || new Set<string | number>()
    ownedRows.add(rowKey)
    queryToRows.set(hashedQueryKey, ownedRows)
  }

  const addRowOwners = (rowKey: string | number, owners: Set<string>) => {
    if (owners.size === 0) {
      rowToQueries.delete(rowKey)
      return
    }

    rowToQueries.set(rowKey, new Set(owners))
    owners.forEach((owner) => {
      const ownedRows = queryToRows.get(owner) || new Set<string | number>()
      ownedRows.add(rowKey)
      queryToRows.set(owner, ownedRows)
    })
  }

  const removeRowOwner = (rowKey: string | number, hashedQueryKey: string) => {
    const owners = rowToQueries.get(rowKey)
    owners?.delete(hashedQueryKey)
    if (!owners?.size) {
      rowToQueries.delete(rowKey)
    }

    const ownedRows = queryToRows.get(hashedQueryKey)
    ownedRows?.delete(rowKey)

    return !owners?.size
  }

  const removeQueryOwnership = (hashedQueryKey: string) => {
    const nextOwnersByRow = new Map<string | number, Set<string>>()

    const rowKeys =
      queryToRows.get(hashedQueryKey) ?? new Set<string | number>()

    rowKeys.forEach((rowKey) => {
      const owners = rowToQueries.get(rowKey)

      if (!owners) {
        return
      }

      const nextOwners = new Set(owners)
      nextOwners.delete(hashedQueryKey)
      nextOwnersByRow.set(rowKey, nextOwners)
    })

    return nextOwnersByRow
  }

  const internalSync: SyncConfig<any>[`sync`] = (params) => {
    const syncSession = {}
    activeSyncSession = syncSession
    pendingResultApplications.clear()
    requiredCacheGenerationFetchStart = undefined
    scopedRecoveryPending = false
    // Rebuild on every start so caches created while sync was stopped are owned.
    trackedCacheQueries = new Set(
      queryClient.getQueryCache().findAll({ queryKey: baseKey }),
    )
    for (const query of trackedCacheQueries) {
      if (query.state.fetchStatus === `fetching`) {
        fetchStartGenerations.set(
          hashKey(query.queryKey),
          queryCollectionCurrentFetchStarts.get(query) ??
            fetchStartGenerations.get(hashKey(query.queryKey)) ??
            directWriteGeneration,
        )
      }
    }
    const { begin, write, commit, markReady, markError, collection, metadata } =
      params
    const persistence =
      metadata === undefined
        ? null
        : validateSyncPersistenceCapability(metadata.persistence)
    if (persistence?.startupCacheGenerationRotated === true) {
      requiredCacheGenerationFetchStart =
        queryClient.getQueryCache().currentSequence
      for (const query of trackedCacheQueries) {
        if (
          query.state.fetchStatus !== `idle` &&
          queryCollectionCurrentFetchStarts.get(query) === undefined
        ) {
          // This Query fetch began before our cache listener existed. It
          // cannot establish the replacement persisted cache generation.
          queryCollectionCurrentFetchStarts.set(
            query,
            requiredCacheGenerationFetchStart,
          )
        }
      }
    }

    // Track whether sync has been started
    let syncStarted = false
    let startupRetentionSettled = false
    const pendingStartupLoads = new Map<LoadSubsetOptions, Set<object>>()
    const retainedQueriesPendingRevalidation = new Set<string>()
    const retainedRevalidationStarts = new Map<string, number>()
    const awaitingRetainedFetchSuccess = new WeakSet<object>()
    const terminalErrorResults = new WeakMap<
      AnyQuery,
      Map<number, Map<string, QueryObserverResult<any, any>>>
    >()
    const hasFreshRetainedFetch = (hash: string, query: AnyQuery): boolean => {
      const requiredStart = retainedRevalidationStarts.get(hash)
      return (
        requiredStart === undefined ||
        ((queryCollectionSuccessfulFetchStarts.get(query) ?? 0) >
          requiredStart &&
          queryCollectionSuccessfulFetchData.get(query) === query.state.data)
      )
    }
    const throwOnUnattributableRetainedResult = (
      hash: string,
      query: AnyQuery,
    ): void => {
      if (
        retainedQueriesPendingRevalidation.has(hash) &&
        !hasFreshRetainedFetch(hash, query) &&
        query.state.status === `success` &&
        query.state.fetchStatus === `idle` &&
        query.dataFetchSequence !== undefined &&
        query.dataSourceSequence === undefined
      ) {
        throw new QueryCollectionError(
          `[QueryCollection] Cannot revalidate persisted query ${hash}: the Query persister result provenance is unknown. Use a source-backed query for this revalidation.`,
        )
      }
    }
    const observedErrorUpdates = new WeakMap<AnyQuery, number>()
    // Observer results snapshot the fetch that produced their data before
    // another observer can reenter Query Core and start a replacement.
    let errorRevision = 0
    const failedResultApplications = new Map<string, unknown>()
    const exceptionalResultSettlements = new WeakMap<
      QueryObserverResult<unknown, unknown>,
      ExceptionalResultSettlement
    >()
    const pendingExceptionalResultSettlements = new Set<
      ExceptionalResultSettlement & { type: `pending` }
    >()
    const deferredRefreshes = new Map<
      Promise<void>,
      Map<string, Promise<QueryObserverResult<unknown, unknown>>>
    >()
    const readExceptionalResultSettlement = (
      result: QueryObserverResult<unknown, unknown>,
    ) => exceptionalResultSettlements.get(result)
    const writeExceptionalResultSettlement = (
      result: QueryObserverResult<unknown, unknown>,
      settlement: ExceptionalResultSettlement,
    ) => {
      exceptionalResultSettlements.set(result, settlement)
    }
    getExceptionalResultSettlement = readExceptionalResultSettlement
    type ResultApplicationController = AbortController & {
      rollback?: () => void
      settleRefetchAtFetchBoundary?: () => void
    }
    const resultApplicationControllers = new Map<
      string,
      ResultApplicationController
    >()
    const effectivePersistedGcTimes = new Map<string, number>()
    const persistedRetentionTimers = new Map<
      string,
      ReturnType<typeof setTimeout>
    >()
    const legacyPersistedOwnerHashes = new Map<string, Set<string>>()
    let persistedOwnerHashes: Set<string> | undefined
    let persistedOwnerScan: Promise<void> | undefined

    const scanPersistedOwnerHashes = (): Promise<void> => {
      persistedOwnerScan ??= persistence!
        .scanPersistedRows({
          metadataOnly: true,
        })
        .then((rows) => {
          const hashes = new Set<string>()
          for (const row of rows) {
            const rowMetadata = row.metadata as
              Record<string, unknown> | undefined
            const queryMetadata = rowMetadata?.queryCollection
            if (!queryMetadata || typeof queryMetadata !== `object`) continue
            const owners = (queryMetadata as Record<string, unknown>).owners
            if (!owners || typeof owners !== `object`) continue
            Object.keys(owners).forEach((hash) => hashes.add(hash))
          }
          persistedOwnerHashes = hashes
        })
        .catch((error: unknown) => {
          persistedOwnerScan = undefined
          throw error
        })
      return persistedOwnerScan
    }

    const getLegacyOwnerHashes = (
      demandKey: string,
      currentHash: string,
      options: LoadSubsetOptions,
    ): Set<string> => {
      const aliases = new Set<string>()
      if (typeof queryKey === `function`) return aliases
      const oldShapeKey = getLegacyLoadSubsetDemandKey(options)
      const oldShapeIdentity =
        oldShapeKey === undefined
          ? undefined
          : normalizeLegacyLoadSubsetDemandKey(oldShapeKey)
      const candidateHashes = new Set(persistedOwnerHashes)
      metadata?.collection
        .list(QUERY_COLLECTION_GC_PREFIX)
        .forEach(({ key, value }) => {
          const hash = key.slice(QUERY_COLLECTION_GC_PREFIX.length)
          if (parsePersistedQueryRetentionEntry(value, hash)) {
            candidateHashes.add(hash)
          }
        })
      for (const hash of candidateHashes) {
        if (hash === currentHash) continue
        try {
          const parts: unknown = JSON.parse(hash)
          if (!Array.isArray(parts) || typeof parts.at(-1) !== `string`)
            continue
          const oldKey = parts.at(-1) as string
          const normalized = normalizeLegacyLoadSubsetDemandKey(oldKey)
          if (
            hashKey([...queryKey, oldKey]) === hash &&
            normalized !== undefined &&
            (normalized === demandKey || normalized === oldShapeIdentity)
          ) {
            aliases.add(hash)
          }
        } catch {
          // Foreign or malformed ownership keys cannot certify an alias.
        }
      }
      return aliases
    }
    let persistedRetentionMaintenance = Promise.resolve()

    const invalidatePendingResultApplication = (hashedQueryKey: string) => {
      const controller = resultApplicationControllers.get(hashedQueryKey)
      controller?.rollback?.()
      pendingResultApplications.delete(hashedQueryKey)
      failedResultApplications.delete(hashedQueryKey)
      resultApplicationControllers.delete(hashedQueryKey)
      controller?.abort()
    }

    const waitForCurrentResultApplication = async (
      hashedQueryKey: string,
    ): Promise<void> => {
      for (;;) {
        const application = pendingResultApplications.get(hashedQueryKey)
        if (!application) return
        try {
          await application
        } catch (error) {
          if (
            pendingResultApplications.get(hashedQueryKey) === application ||
            (failedResultApplications.has(hashedQueryKey) &&
              failedResultApplications.get(hashedQueryKey) === error)
          ) {
            throw error
          }
        }
      }
    }

    const waitForAuthoritativeObserverResult = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
      createCancellationError: () => Error,
      acceptsResult: (result: QueryObserverResult<any, any>) => boolean = () =>
        true,
    ): Promise<QueryObserverResult<Array<any>, any>> =>
      new Promise((resolve, reject) => {
        let active = true
        let unsubscribe = () => {}
        const pending =
          pendingReadyUnsubscribes.get(hashedQueryKey) ?? new Set()
        const finish = (settle: () => void) => {
          if (!active) return
          active = false
          unsubscribe()
          pending.delete(cancel)
          if (pending.size === 0) {
            pendingReadyUnsubscribes.delete(hashedQueryKey)
          }
          settle()
        }
        const cancel = () => {
          finish(() => reject(createCancellationError()))
        }
        pending.add(cancel)
        pendingReadyUnsubscribes.set(hashedQueryKey, pending)

        unsubscribe = observer.subscribe((result) => {
          queueMicrotask(() => {
            if (
              (result.isSuccess && !collection.deferDataRefresh) ||
              (result.isError && !result.isFetching)
            ) {
              if (acceptsResult(result)) finish(() => resolve(result))
            }
          })
        })
      })

    const getDeferredRefresh = (
      hashedQueryKey: string,
      barrier: Promise<void>,
    ): Promise<QueryObserverResult<unknown, unknown>> => {
      const barrierRefreshes = deferredRefreshes.get(barrier) ?? new Map()
      const existing = barrierRefreshes.get(hashedQueryKey)
      if (existing) return existing

      const refresh = barrier.then(async () => {
        const observer = state.observers.get(hashedQueryKey)
        if (!observer) throw new CancelledError()

        let replacement = await observer.refetch()
        for (;;) {
          if (!replacement.isSuccess) return replacement
          // Let the result handler classify the replacement before reading
          // its Collection application settlement.
          await new Promise<void>((resolve) => queueMicrotask(resolve))
          if (collection.deferDataRefresh) {
            replacement = await waitForAuthoritativeObserverResult(
              observer,
              hashedQueryKey,
              () => new CancelledError(),
            )
            continue
          }
          const replacementSettlement =
            readExceptionalResultSettlement(replacement)
          if (replacementSettlement?.type === `rejected`) {
            throw replacementSettlement.error
          }
          if (replacementSettlement?.type === `pending`) {
            return replacementSettlement.promise
          }
          const application = getResultApplicationSettlement(hashedQueryKey)
          if (application !== true) await application
          return replacement
        }
      })

      barrierRefreshes.set(hashedQueryKey, refresh)
      deferredRefreshes.set(barrier, barrierRefreshes)
      const removeRefresh = () => {
        if (barrierRefreshes.get(hashedQueryKey) !== refresh) return
        barrierRefreshes.delete(hashedQueryKey)
        if (barrierRefreshes.size === 0) deferredRefreshes.delete(barrier)
      }
      void refresh.then(removeRefresh, removeRefresh)
      return refresh
    }

    const scheduleDeferredResultSettlement = (
      hashedQueryKey: string,
      result: QueryObserverResult<unknown, unknown>,
      refresh: Promise<QueryObserverResult<unknown, unknown>>,
    ): ExceptionalResultSettlement & { type: `pending` } => {
      const existing = readExceptionalResultSettlement(result)
      if (existing?.type === `pending`) return existing

      let rejectSettlement!: (error: unknown) => void
      const promise = new Promise<QueryObserverResult<unknown, unknown>>(
        (resolve, reject) => {
          rejectSettlement = reject
          void refresh.then(resolve, reject)
        },
      )
      // Automatic refreshes may have no public waiter. Their Query and
      // application paths retain diagnostics; this prevents an unhandled
      // rejection while preserving the rejection for a public refetch waiter.
      void promise.catch(() => {})
      const settlement = {
        type: `pending` as const,
        promise,
        reject: rejectSettlement,
      }
      writeExceptionalResultSettlement(result, settlement)
      pendingExceptionalResultSettlements.add(settlement)

      void promise.then(
        () => {
          pendingExceptionalResultSettlements.delete(settlement)
        },
        () => {
          pendingExceptionalResultSettlements.delete(settlement)
        },
      )

      return settlement
    }

    const getResultApplicationSettlement = (
      hashedQueryKey: string,
    ): true | Promise<void> => {
      const pending = pendingResultApplications.get(hashedQueryKey)
      if (pending) {
        return waitForCurrentResultApplication(hashedQueryKey)
      }

      if (failedResultApplications.has(hashedQueryKey)) {
        return Promise.reject(failedResultApplications.get(hashedQueryKey))
      }

      return true
    }

    const getRowMetadata = (rowKey: string | number) => {
      return (metadata?.row.get(rowKey) ??
        collection._state.syncedMetadata.get(rowKey)) as
        Record<string, unknown> | undefined
    }

    const getOwnersFromMetadata = (rowMetadata: unknown) => {
      if (!rowMetadata || typeof rowMetadata !== `object`) {
        return new Set<string>()
      }
      const queryMetadata = (rowMetadata as Record<string, unknown>)
        .queryCollection
      if (!queryMetadata || typeof queryMetadata !== `object`) {
        return new Set<string>()
      }

      const owners = (queryMetadata as Record<string, unknown>).owners
      if (!owners || typeof owners !== `object`) {
        return new Set<string>()
      }

      return new Set(Object.keys(owners as Record<string, true>))
    }

    const getPersistedOwners = (rowKey: string | number) =>
      getOwnersFromMetadata(getRowMetadata(rowKey))

    const setPersistedOwners = (
      rowKey: string | number,
      owners: Set<string>,
    ) => {
      if (!metadata) {
        return
      }

      const currentMetadata = { ...(getRowMetadata(rowKey) ?? {}) }
      if (owners.size === 0) {
        delete currentMetadata.queryCollection
        if (Object.keys(currentMetadata).length === 0) {
          metadata.row.delete(rowKey)
        } else {
          metadata.row.set(rowKey, currentMetadata)
        }
        return
      }

      metadata.row.set(rowKey, {
        ...currentMetadata,
        queryCollection: {
          owners: Object.fromEntries(
            Array.from(owners.values()).map((owner) => [owner, true]),
          ),
        },
      })
    }

    const parsePersistedQueryRetentionEntry = (
      value: unknown,
      expectedHash: string,
    ): PersistedQueryRetentionEntry | undefined => {
      if (!value || typeof value !== `object`) {
        return undefined
      }

      const record = value as Record<string, unknown>
      if (record.queryHash !== expectedHash) {
        return undefined
      }

      if (record.mode === `until-revalidated`) {
        return {
          queryHash: expectedHash,
          mode: `until-revalidated`,
        }
      }

      if (
        record.mode === `ttl` &&
        typeof record.expiresAt === `number` &&
        Number.isFinite(record.expiresAt)
      ) {
        return {
          queryHash: expectedHash,
          mode: `ttl`,
          expiresAt: record.expiresAt,
        }
      }

      return undefined
    }

    const runPersistedRetentionMaintenance = (task: () => Promise<void>) => {
      persistedRetentionMaintenance = persistedRetentionMaintenance.then(
        task,
        task,
      )
      return persistedRetentionMaintenance
    }

    const cancelPersistedRetentionExpiry = (hashedQueryKey: string) => {
      const timer = persistedRetentionTimers.get(hashedQueryKey)
      if (timer) {
        clearTimeout(timer)
        persistedRetentionTimers.delete(hashedQueryKey)
      }
    }

    const getHydratedOwnedRowsForQueryBaseline = (hashedQueryKey: string) => {
      const knownRows = queryToRows.get(hashedQueryKey)
      if (knownRows) {
        return new Set(knownRows)
      }

      const legacyOwnerHashes = legacyPersistedOwnerHashes.get(hashedQueryKey)
      const ownedRows = new Set<string | number>()
      for (const [rowKey] of collection._state.syncedData.entries()) {
        const owners = getPersistedOwners(rowKey)
        if (owners.size === 0) {
          continue
        }

        addRowOwners(rowKey, owners)

        if (
          owners.has(hashedQueryKey) ||
          (legacyOwnerHashes !== undefined &&
            [...legacyOwnerHashes].some((hash) => owners.has(hash)))
        ) {
          ownedRows.add(rowKey)
        }
      }
      return ownedRows
    }

    const loadPersistedBaselineForQuery = async (
      hashedQueryKey: string,
      incomingItemsAreEmpty = false,
    ): Promise<
      Map<
        string | number,
        {
          value: any
          owners: Set<string>
        }
      >
    > => {
      const recoveryEpoch = scopedRecoveryEpoch
      const legacyOwnerHashes = legacyPersistedOwnerHashes.get(hashedQueryKey)
      const knownRows = queryToRows.get(hashedQueryKey)
      // An empty result cannot collide with an unseen durable owner. A later
      // nonempty result can, so scan storage before assigning its row owners.
      if (
        knownRows &&
        legacyOwnerHashes === undefined &&
        (knownRows.size > 0 || incomingItemsAreEmpty) &&
        Array.from(knownRows).every((rowKey) => collection.has(rowKey))
      ) {
        const baseline = new Map<
          string | number,
          { value: any; owners: Set<string> }
        >()
        knownRows.forEach((rowKey) => {
          const value = collection.get(rowKey)
          const owners = rowToQueries.get(rowKey)
          if (value && owners) {
            baseline.set(rowKey, {
              value,
              owners: new Set(owners),
            })
          }
        })
        return baseline
      }

      const scanPersisted = persistence?.scanPersistedRows
      if (!scanPersisted) {
        const baseline = new Map<
          string | number,
          { value: any; owners: Set<string> }
        >()
        getHydratedOwnedRowsForQueryBaseline(hashedQueryKey).forEach(
          (rowKey) => {
            const value = collection.get(rowKey)
            const owners = rowToQueries.get(rowKey)
            if (value && owners) {
              baseline.set(rowKey, {
                value,
                owners: new Set(owners),
              })
            }
          },
        )
        return baseline
      }

      const baseline = new Map<
        string | number,
        { value: any; owners: Set<string> }
      >()
      const scannedRows = await scanPersisted()
      if (recoveryEpoch !== scopedRecoveryEpoch || scopedRecoveryPending) {
        return baseline
      }

      scannedRows.forEach((row) => {
        const rowMetadata = row.metadata as Record<string, unknown> | undefined
        const queryMetadata = rowMetadata?.queryCollection
        if (!queryMetadata || typeof queryMetadata !== `object`) {
          return
        }

        const owners = (queryMetadata as Record<string, unknown>).owners
        if (!owners || typeof owners !== `object`) {
          return
        }

        const ownerSet = new Set(Object.keys(owners as Record<string, true>))
        if (ownerSet.size === 0) {
          return
        }

        addRowOwners(row.key, ownerSet)

        if (
          ownerSet.has(hashedQueryKey) ||
          (legacyOwnerHashes !== undefined &&
            [...legacyOwnerHashes].some((hash) => ownerSet.has(hash)))
        ) {
          baseline.set(row.key, {
            value: row.value,
            owners: ownerSet,
          })
        }
      })

      return baseline
    }

    const cleanupPersistedPlaceholder = async (hashedQueryKey: string) => {
      if (!metadata) {
        return
      }

      const recoveryEpoch = scopedRecoveryEpoch
      const baseline = await loadPersistedBaselineForQuery(hashedQueryKey)
      if (recoveryEpoch !== scopedRecoveryEpoch || scopedRecoveryPending) {
        return
      }
      const rowsToDelete: Array<any> = []

      begin()

      baseline.forEach(({ value: oldItem, owners }, rowKey) => {
        owners.delete(hashedQueryKey)
        setPersistedOwners(rowKey, owners)
        const needToRemove = removeRowOwner(rowKey, hashedQueryKey)
        if (needToRemove) {
          rowsToDelete.push(oldItem)
        }
      })

      rowsToDelete.forEach((row) => {
        write({ type: `delete`, value: row })
      })

      metadata.collection.delete(
        `${QUERY_COLLECTION_GC_PREFIX}${hashedQueryKey}`,
      )
      commit()
      queryToRows.delete(hashedQueryKey)
    }

    const schedulePersistedRetentionExpiry = (
      entry: PersistedQueryRetentionEntry,
    ) => {
      if (entry.mode !== `ttl`) {
        return
      }

      cancelPersistedRetentionExpiry(entry.queryHash)

      const delay = Math.max(0, entry.expiresAt - Date.now())
      const timer = setTimeout(() => {
        void runPersistedRetentionMaintenance(async () => {
          // An acquisition that began before expiry may still be discovering
          // this hash as a historical alias. Its scan settles before its
          // continuation cancels the timer or reports a scan failure.
          try {
            await persistedOwnerScan
          } catch {
            // A failed scan leaves no acquired alias to protect this owner.
          }
          if (persistedRetentionTimers.get(entry.queryHash) !== timer) return
          persistedRetentionTimers.delete(entry.queryHash)
          const currentEntry = metadata?.collection.get(
            `${QUERY_COLLECTION_GC_PREFIX}${entry.queryHash}`,
          )
          const parsedCurrentEntry = parsePersistedQueryRetentionEntry(
            currentEntry,
            entry.queryHash,
          )
          if (
            !parsedCurrentEntry ||
            parsedCurrentEntry.mode !== `ttl` ||
            parsedCurrentEntry.expiresAt > Date.now()
          ) {
            return
          }
          await cleanupPersistedPlaceholder(entry.queryHash)
        })
      }, delay)

      persistedRetentionTimers.set(entry.queryHash, timer)
    }

    const consumePersistedQueryRetentionAtStartup = async () => {
      if (!metadata) {
        return
      }

      const retentionEntries = metadata.collection.list(
        QUERY_COLLECTION_GC_PREFIX,
      )
      const now = Date.now()

      for (const { key, value } of retentionEntries) {
        const hashedQueryKey = key.slice(QUERY_COLLECTION_GC_PREFIX.length)
        const parsed = parsePersistedQueryRetentionEntry(value, hashedQueryKey)
        if (!parsed) {
          continue
        }

        if (parsed.mode === `ttl` && parsed.expiresAt <= now) {
          await cleanupPersistedPlaceholder(parsed.queryHash)
        } else if (parsed.mode === `ttl`) {
          schedulePersistedRetentionExpiry(parsed)
        }
      }
    }

    /** Generate the semantic Query key when a subset acquires a lease. */
    const generateQueryKeyFromOptions = (opts: LoadSubsetOptions): QueryKey => {
      if (typeof queryKey === `function`) {
        // Refetch starts another acquisition for the same semantic demand. It
        // must not create a second Query cache or unload identity.
        const { refetch: _refetch, ...queryKeyOptions } = opts
        return queryKey(queryKeyOptions)
      } else if (syncMode === `on-demand`) {
        // A static on-demand key is extended by exact semantic demand so
        // equivalent predicates share one entry while distinct windows do not.
        const demandKey = getLoadSubsetDemandKey(opts)
        return demandKey !== undefined ? [...queryKey, demandKey] : queryKey
      } else {
        // Static queryKey in eager mode: use as-is
        return queryKey
      }
    }

    const startupRetentionEntries = metadata?.collection.list(
      QUERY_COLLECTION_GC_PREFIX,
    )
    const startupRetentionMaintenancePromise =
      !startupRetentionEntries || startupRetentionEntries.length === 0
        ? (() => {
            startupRetentionSettled = true
            return Promise.resolve()
          })()
        : runPersistedRetentionMaintenance(async () => {
            try {
              await consumePersistedQueryRetentionAtStartup()
            } finally {
              startupRetentionSettled = true
            }
          })

    const waitForQueryReady = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
      acceptsResult?: (result: QueryObserverResult<any, any>) => boolean,
    ): Promise<void> =>
      waitForAuthoritativeObserverResult(
        observer,
        hashedQueryKey,
        () => new LoadSubsetOperationAbortedError(),
        acceptsResult,
      ).then((result) => {
        if (result.isError) throw result.error
      })

    const waitForQueryReadyAndApplied = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
      acceptsResult?: (result: QueryObserverResult<any, any>) => boolean,
    ): Promise<void> =>
      waitForQueryReady(observer, hashedQueryKey, (result) => {
        if (acceptsResult?.(result) === false) return false
        if (
          !retainedQueriesPendingRevalidation.has(hashedQueryKey) ||
          result.isError
        )
          return true
        const query = observer.getCurrentQuery()
        // A manual cache edit can report success while the physical fetch is
        // still in flight. The retained owner must wait for that fetch to end.
        // Source freshness and opaque provenance are checked after it ends.
        return (
          query.state.fetchStatus === `idle` &&
          query.dataFetchSequence !== undefined
        )
      }).then(() => {
        throwOnUnattributableRetainedResult(
          hashedQueryKey,
          observer.getCurrentQuery(),
        )
        const settlement = getResultApplicationSettlement(hashedQueryKey)
        return settlement === true ? undefined : settlement
      })

    const refetchAndWaitForApplication = async (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
      joinFreshRetainedFetch = false,
    ): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        let active = true
        const pending =
          pendingReadyUnsubscribes.get(hashedQueryKey) ?? new Set()
        const finish = (settle: () => void) => {
          if (!active) return
          active = false
          pending.delete(cancel)
          if (pending.size === 0) {
            pendingReadyUnsubscribes.delete(hashedQueryKey)
          }
          settle()
        }
        const cancel = () => {
          finish(() => reject(new LoadSubsetOperationAbortedError()))
        }
        pending.add(cancel)
        pendingReadyUnsubscribes.set(hashedQueryKey, pending)

        const refetch = async () => {
          const waitsForDeferredApplication = !!collection.deferDataRefresh
          let deferredApplicationSettled = false
          cancelPreWriteFetch(observer.getCurrentQuery(), hashedQueryKey)
          for (;;) {
            if (!active) return
            try {
              const query = observer.getCurrentQuery()
              const retainedStart =
                retainedRevalidationStarts.get(hashedQueryKey)
              const joinsRetainedFetch =
                joinFreshRetainedFetch &&
                retainedStart !== undefined &&
                query.state.fetchStatus === `fetching` &&
                (queryCollectionCurrentFetchStarts.get(query) ?? 0) >
                  retainedStart
              const capture: RefetchCapture = { query }
              const previousCapture = activeRefetchCapture
              activeRefetchCapture = capture
              let fetch: ReturnType<typeof observer.refetch>
              try {
                fetch = observer.refetch({
                  throwOnError: true,
                  cancelRefetch: !joinsRetainedFetch,
                })
              } finally {
                activeRefetchCapture = previousCapture
              }
              // Query Core can turn a canceled fetch into the prior cached
              // result. The retryer's promise retains the cancellation that
              // observer.refetch hides from this exact-demand caller.
              let physical =
                capture.promise ?? observer.getCurrentQuery().promise
              if (!physical) throw new Error(`Query refetch started no fetch`)
              let cancellation = await (capture.cancellation ??
                observeCancellation(physical))
              while (cancellation?.silent) {
                const successor = capture.query.promise
                if (!successor || successor === physical)
                  throw new LoadSubsetOperationAbortedError()
                physical = successor
                cancellation = await observeCancellation(physical)
              }
              if (cancellation?.revert)
                throw new LoadSubsetOperationAbortedError()
              const fetched = await fetch
              const exceptional = readExceptionalResultSettlement(fetched)
              if (exceptional?.type === `pending`) {
                await exceptional.promise
                deferredApplicationSettled = true
              } else {
                deferredApplicationSettled = false
                if (exceptional?.type === `rejected`) throw exceptional.error
              }
            } catch (error) {
              if (error instanceof LoadSubsetOperationAbortedError) throw error
              const fetchStart = queryCollectionCurrentFetchStarts.get(
                observer.getCurrentQuery(),
              )
              const retainedStart =
                retainedRevalidationStarts.get(hashedQueryKey)
              if (
                (requiredCacheGenerationFetchStart === undefined ||
                  (fetchStart !== undefined &&
                    fetchStart > requiredCacheGenerationFetchStart)) &&
                (retainedStart === undefined ||
                  (fetchStart !== undefined && fetchStart > retainedStart))
              ) {
                throw error
              }
              // An old in-flight fetch may fail after the cache rotates. Its
              // failure cannot settle the replacement generation's demand.
              continue
            }
            // A refetch may join an old in-flight Query fetch. Its result does
            // not establish the new persisted cache generation, so start a
            // fetch after that old work settles instead of waiting forever for
            // a notification no one has arranged.
            await new Promise<void>((resume) => queueMicrotask(resume))
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Cancellation can run while the refetch or microtask is pending.
            if (!active) return
            throwOnUnattributableRetainedResult(
              hashedQueryKey,
              observer.getCurrentQuery(),
            )
            if (
              hasCurrentCacheGenerationFetch(observer.getCurrentQuery()) &&
              hasFreshRetainedFetch(hashedQueryKey, observer.getCurrentQuery())
            ) {
              break
            }
          }
          if (deferredApplicationSettled) return
          if (
            waitsForDeferredApplication ||
            !hasCurrentCacheGenerationFetch(observer.getCurrentQuery()) ||
            !hasFreshRetainedFetch(hashedQueryKey, observer.getCurrentQuery())
          ) {
            await waitForQueryReadyAndApplied(observer, hashedQueryKey)
            return
          }
          const settlement = getResultApplicationSettlement(hashedQueryKey)
          if (settlement !== true) await settlement
        }
        void refetch().then(
          () => finish(resolve),
          (error: unknown) => finish(() => reject(error)),
        )
      })

    const refetchOrWaitForEnabledQuery = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
    ): Promise<void> => {
      const query = observer.getCurrentQuery()
      const queryEnabled =
        typeof enabled === `function` ? enabled(query) : enabled !== false
      if (queryEnabled)
        return refetchAndWaitForApplication(observer, hashedQueryKey, true)

      // An explicit utility refetch can still start this disabled Query. Until
      // then, neither a locally edited cache nor an old cache generation may
      // settle its acquisition as though a physical result had arrived.
      const cachedVersion = query.state.dataUpdateCount
      return waitForQueryReadyAndApplied(observer, hashedQueryKey, (result) => {
        if (result.isError) return true
        const current = observer.getCurrentQuery()
        return (
          current.state.dataUpdateCount > cachedVersion &&
          queryCollectionSuccessfulFetchVersions.get(current) ===
            current.state.dataUpdateCount &&
          hasCurrentCacheGenerationFetch(current) &&
          hasFreshRetainedFetch(hashedQueryKey, current)
        )
      })
    }

    const restartCanceledPhysicalFetch = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
    ): Promise<void> | undefined => {
      const query = observer.getCurrentQuery()
      const physical = queryCollectionPhysicalFetchStates.get(query)
      const operation =
        query.fetchSequence === undefined
          ? undefined
          : physical?.operations.get(query.fetchSequence)
      const canceledController = operation?.controller
      if (
        operation?.startedWithAcquisition !== true ||
        canceledController?.signal.aborted !== true ||
        query.state.fetchStatus === `idle` ||
        !hasLiveAcquisition(hashedQueryKey)
      )
        return undefined
      if (!hasCanceledRetainedFetch(query)) {
        // A released caller's provider may ignore its aborted signal and
        // finish successfully. Reuse that result; only a rejected old fetch
        // requires new work for the successor.
        return waitForQueryReadyAndApplied(observer, hashedQueryKey).catch(
          (error: unknown) => {
            if (
              !hasLiveAcquisition(hashedQueryKey) ||
              observer.getCurrentQuery() !== query
            )
              throw error
            if (
              operation.controller !== canceledController &&
              query.state.fetchStatus === `fetching`
            )
              return waitForQueryReadyAndApplied(observer, hashedQueryKey)
            return refetchAndWaitForApplication(observer, hashedQueryKey)
          },
        )
      }
      // A retained canceled caller cannot lend its physical fetch to a new
      // Collection owner, including an owner in a different Collection.
      const retired =
        query.state.fetchStatus === `fetching`
          ? query.cancel({ silent: true })
          : Promise.resolve()
      return retired.then(() =>
        refetchAndWaitForApplication(observer, hashedQueryKey),
      )
    }

    const createQueryFromOpts = (
      opts: LoadSubsetOptions = {},
      queryFunction: typeof queryFn = queryFn,
    ): true | Promise<void> => {
      const deferUntil = (work: Promise<unknown>): Promise<void> => {
        // The scan discovers keys; it does not establish an observer lease.
        const token = {}
        const pending = pendingStartupLoads.get(opts) ?? new Set<object>()
        pending.add(token)
        pendingStartupLoads.set(opts, pending)
        const releaseToken = (): boolean => {
          const current = pendingStartupLoads.get(opts) === pending
          const active = pending.delete(token)
          if (current && pending.size === 0) pendingStartupLoads.delete(opts)
          return current && active
        }
        return work.then(
          () => {
            if (!releaseToken() || opts.signal?.aborted) {
              throw new LoadSubsetOperationAbortedError()
            }
            const resumed = createQueryFromOpts(opts, queryFunction)
            return resumed === true ? undefined : resumed
          },
          (error: unknown) => {
            releaseToken()
            throw error
          },
        )
      }
      if (opts.signal?.aborted) {
        return Promise.reject(new LoadSubsetOperationAbortedError())
      }
      if (!startupRetentionSettled) {
        return deferUntil(startupRetentionMaintenancePromise)
      }

      const requestedKey = generateQueryKeyFromOptions(opts)
      if (opts.signal?.aborted) {
        return Promise.reject(new LoadSubsetOperationAbortedError())
      }
      const requestedHash = hashKey(requestedKey)
      let legacyAliases: Set<string> | undefined
      if (
        metadata &&
        syncMode === `on-demand` &&
        typeof queryKey !== `function`
      ) {
        const demandKey = getLoadSubsetDemandKey(opts)
        if (
          demandKey !== undefined &&
          (getLegacyLoadSubsetDemandKey(opts) !== undefined ||
            demandKey.includes(`"name":"eq"`))
        ) {
          if (persistence?.scanPersistedRows && !persistedOwnerHashes)
            return deferUntil(scanPersistedOwnerHashes())
          legacyAliases = getLegacyOwnerHashes(demandKey, requestedHash, opts)
          if (legacyAliases.size > 0) {
            legacyPersistedOwnerHashes.set(requestedHash, legacyAliases)
            legacyAliases.forEach(cancelPersistedRetentionExpiry)
          }
        }
      }
      const fullObserver =
        fullSourceHash === undefined
          ? undefined
          : state.observers.get(fullSourceHash)
      const hasFullSourceDependent = fullSourceDependents.has(requestedHash)
      if (hasFullSourceDependent && fullObserver === undefined) {
        throw new Error(`A full-source dependent lost its Query observer`)
      }
      const fullQuery = fullObserver?.getCurrentQuery()
      const fullResult = fullObserver?.getCurrentResult()
      const appliedFullResult =
        fullResult !== undefined &&
        fullQuery !== undefined &&
        hasAppliedResult(fullSourceHash!, fullQuery) &&
        getRecordedResultApplicationSettlement(fullSourceHash!, fullResult) !==
          undefined
      const retainedRequestedEntry = metadata?.collection.get(
        `${QUERY_COLLECTION_GC_PREFIX}${requestedHash}`,
      )
      const requestedScopeNeedsRevalidation =
        parsePersistedQueryRetentionEntry(
          retainedRequestedEntry,
          requestedHash,
        ) !== undefined || (legacyAliases?.size ?? 0) > 0
      // Existing dependents keep their original observer lease even if an
      // explicit refetch creates an exact Query for the same requested scope.
      // A new dependent needs a currently successful, applied full result.
      const sharesFullSource =
        !opts.refetch &&
        fullSourceKey !== undefined &&
        fullSourceHash !== requestedHash &&
        !requestedScopeNeedsRevalidation &&
        (hasFullSourceDependent || !state.observers.has(requestedHash)) &&
        (queryRefCounts.get(fullSourceHash!) ?? 0) > 0 &&
        fullResult?.isSuccess === true &&
        fullQuery?.state.fetchStatus === `idle` &&
        hasCurrentCacheGenerationFetch(fullQuery) &&
        !pendingResultApplications.has(fullSourceHash!) &&
        !failedResultApplications.has(fullSourceHash!) &&
        appliedFullResult
      const key = sharesFullSource ? fullSourceKey : requestedKey
      const hashedQueryKey = sharesFullSource ? fullSourceHash! : requestedHash
      const {
        subscription: _subscription,
        refetch: _refetch,
        ...requestOptions
      } = opts
      const extendedMeta = { ...meta }
      // Query functions need request options, but SSR must not serialize them.
      Object.defineProperty(extendedMeta, `loadSubsetOptions`, {
        value: requestOptions,
        enumerable: false,
        configurable: true,
        writable: true,
      })
      const retainedEntry =
        hashedQueryKey === requestedHash
          ? retainedRequestedEntry
          : metadata?.collection.get(
              `${QUERY_COLLECTION_GC_PREFIX}${hashedQueryKey}`,
            )
      if (
        parsePersistedQueryRetentionEntry(retainedEntry, hashedQueryKey) !==
          undefined ||
        (legacyAliases?.size ?? 0) > 0
      ) {
        retainedQueriesPendingRevalidation.add(hashedQueryKey)
        if (!retainedRevalidationStarts.has(hashedQueryKey))
          retainedRevalidationStarts.set(
            hashedQueryKey,
            queryClient.getQueryCache().currentSequence,
          )
      }
      cancelPersistedRetentionExpiry(hashedQueryKey)

      validateQueryKeyPrefix(key)

      if (state.observers.has(hashedQueryKey)) {
        // We already have a query for this queryKey
        // Increment reference count since another consumer is using this observer
        queryRefCounts.set(
          hashedQueryKey,
          (queryRefCounts.get(hashedQueryKey) || 0) + 1,
        )
        recordAcquisitionRoute(opts, requestedHash, hashedQueryKey)

        // Get the current result and return based on its state
        const observer = state.observers.get(hashedQueryKey)!
        const currentResult = observer.getCurrentResult()

        const currentQuery = observer.getCurrentQuery()
        const restart = restartCanceledPhysicalFetch(observer, hashedQueryKey)
        if (restart) return restart

        if (opts.refetch) {
          return refetchAndWaitForApplication(observer, hashedQueryKey)
        }
        const query = observer.getCurrentQuery()
        const directPatch = queryCollectionCachePatches.get(query)
        if (
          unpatchedCacheVersions.has(query) ||
          (syncMode === `on-demand` &&
            directPatch !== undefined &&
            (directPatch.owner !== cacheOwnerToken ||
              directPatch.session !== syncSession)) ||
          (directWriteGeneration > 0 &&
            query.state.dataUpdateCount >
              (queryCollectionSuccessfulFetchVersions.get(query) ?? 0))
        ) {
          return refetchOrWaitForEnabledQuery(observer, hashedQueryKey)
        }

        if (
          !hasCurrentCacheGenerationFetch(observer.getCurrentQuery()) ||
          retainedQueriesPendingRevalidation.has(hashedQueryKey)
        ) {
          return refetchOrWaitForEnabledQuery(observer, hashedQueryKey)
        }

        if (currentResult.isSuccess) {
          if (collection.deferDataRefresh) {
            return waitForQueryReadyAndApplied(observer, hashedQueryKey)
          }
          const settleCurrentResult = (): true | Promise<void> => {
            if (
              queryCollectionSuccessfulFetchVersions.get(currentQuery) ===
                currentQuery.state.dataUpdateCount &&
              !hasAppliedResult(hashedQueryKey, currentQuery)
            ) {
              makeQueryResultHandler(key)(observer.getCurrentResult())
            }
            return getResultApplicationSettlement(hashedQueryKey)
          }
          const pending = getResultApplicationSettlement(hashedQueryKey)
          return pending === true
            ? settleCurrentResult()
            : pending.then(() => {
                const settlement = settleCurrentResult()
                return settlement === true ? undefined : settlement
              })
        } else if (currentResult.isError && !currentResult.isFetching) {
          // Error already occurred, reject immediately
          return Promise.reject(currentResult.error)
        } else {
          return waitForQueryReadyAndApplied(observer, hashedQueryKey)
        }
      }

      const observerOptions: QueryObserverOptions<
        Array<any>,
        any,
        Array<any>,
        Array<any>,
        any
      > = {
        ...pickDefinedQueryObserverOptions({
          enabled,
          refetchInterval,
          retry,
          retryDelay,
          staleTime,
          gcTime,
          refetchOnWindowFocus,
          refetchOnReconnect,
          refetchOnMount,
          networkMode,
        }),
        ...initialDataObserverOptions,
        queryKey: key,
        queryFn: (context: Parameters<typeof queryFunction>[0]) => {
          const fetchStart = context.fetchSequence
          if (fetchStart === undefined)
            throw new Error(`Query Core did not attribute the physical fetch`)
          const logicalHash = hashKey(context.queryKey)
          fetchStartGenerations.set(logicalHash, fetchStart)
          const physicalQuery = queryClient.getQueryCache().find({
            queryKey: context.queryKey,
            exact: true,
          })
          if (!physicalQuery)
            throw new Error(`Missing physical Query for fetch`)
          const physical = getPhysicalFetchState(physicalQuery)
          const operation = physical.operations.get(fetchStart) ?? {
            startedWithAcquisition: hasLivePhysicalAcquisition(physical),
          }
          // A retained Query can keep this queryFn after Collection cleanup.
          // With no Collection cache listener, its independent refetch needs
          // no Collection operation record and must not retain one per fetch.
          if ((queryCollectionCacheOwners.get(physicalQuery)?.size ?? 0) > 0)
            physical.operations.set(fetchStart, operation)
          // A real data property keeps request metadata safe to inspect and
          // clone. Query Core's own lazy signal remains unread when the
          // acquisition-driven provider ignores cancellation.
          operation.controller?.abort()
          operation.controller = undefined
          if (syncMode === `eager`) return queryFunction(context)
          let signal: AbortSignal
          const hasAcquisition = hasLivePhysicalAcquisition(physical)
          if (
            !operation.startedWithAcquisition ||
            (!hasAcquisition && hasIndependentQueryObserver(physicalQuery))
          ) {
            // A Query Core observer can refetch after every Collection caller
            // releases or aborts, including when a paused acquisition resumes.
            // Its signal owns that independent work.
            signal = context.signal
          } else {
            // A paused Collection fetch may reach queryFn only after its sole
            // caller has aborted. It cannot start provider work on reconnect.
            if (!hasAcquisition) {
              void physicalQuery.cancel({ revert: true })
              throw new CancelledError({ revert: true })
            }
            const controller = new AbortController()
            operation.controller = controller
            abortUnownedPhysicalFetch(physicalQuery)
            signal = controller.signal
          }
          const queryContext = Object.defineProperties(
            {} as typeof context,
            Object.getOwnPropertyDescriptors(context),
          )
          queryContext.meta = {
            ...context.meta,
            loadSubsetOptions: {
              ...requestOptions,
              signal,
            },
          }
          return queryFunction(queryContext)
        },
        meta: extendedMeta,
        structuralSharing: true,
        notifyOnChangeProps: `all`,
      }

      const localObserver = new QueryObserver<
        Array<any>,
        any,
        Array<any>,
        Array<any>,
        any
      >(queryClient, observerOptions)
      if (syncMode === `on-demand`)
        queryCollectionOnDemandObservers.add(localObserver)
      const localQuery = localObserver.getCurrentQuery()
      trackOwnedCacheQuery(localQuery, hashedQueryKey)
      const resolvedQueryGcTime = queryClient.getQueryCache().find({
        queryKey: key,
        exact: true,
      })?.gcTime
      const effectivePersistedGcTime = persistedGcTime ?? resolvedQueryGcTime

      hashToQueryKey.set(hashedQueryKey, key)
      state.observers.set(hashedQueryKey, localObserver)
      const physicalFetchStart =
        queryCollectionCurrentFetchStarts.get(localQuery)
      if (
        physicalFetchStart !== undefined &&
        (localQuery.state.fetchStatus === `fetching` ||
          queryCollectionSuccessfulFetchData.get(localQuery) ===
            localQuery.state.data)
      ) {
        fetchStartGenerations.set(hashedQueryKey, physicalFetchStart)
      }
      if (effectivePersistedGcTime !== undefined) {
        effectivePersistedGcTimes.set(hashedQueryKey, effectivePersistedGcTime)
      } else {
        effectivePersistedGcTimes.delete(hashedQueryKey)
      }

      // Increment reference count for this query
      queryRefCounts.set(
        hashedQueryKey,
        (queryRefCounts.get(hashedQueryKey) || 0) + 1,
      )
      recordAcquisitionRoute(opts, requestedHash, hashedQueryKey)

      const restart = restartCanceledPhysicalFetch(
        localObserver,
        hashedQueryKey,
      )
      if (restart) {
        if (syncStarted || collection.subscriberCount > 0)
          subscribeToQuery(localObserver, hashedQueryKey)
        return restart
      }

      // Check if data already exists in QueryClient cache (persisted within gcTime from
      // a previous observer). This avoids creating unnecessary promises and subscription
      // delays when recreating an observer for data that's already cached.
      const cachedData = queryClient.getQueryData(key)
      if (cachedData !== undefined) {
        const directPatch = queryCollectionCachePatches.get(localQuery)
        const foreignDirectPatch =
          syncMode === `on-demand` &&
          directPatch !== undefined &&
          (directPatch.owner !== cacheOwnerToken ||
            directPatch.session !== syncSession)
        const unverifiedCacheEdit =
          directWriteGeneration > 0 &&
          localQuery.state.dataUpdateCount >
            (queryCollectionSuccessfulFetchVersions.get(localQuery) ?? 0)
        // A fresh persisted Collection has no in-memory position for a row
        // written by a prior instance, whether that row has a subset owner
        // or not. If it collides with cached Query data, fetch on acquisition
        // to establish their order. The write itself starts no request.
        const cachedRows =
          persistence?.scanPersistedRows === undefined
            ? undefined
            : select
              ? select(cachedData)
              : cachedData
        const unknownPersistedRowOrder =
          persistence?.scanPersistedRows !== undefined &&
          Array.isArray(cachedRows) &&
          cachedRows.some((row) => {
            const rowKey = getKey(row)
            return (
              collection._state.getAcceptedSyncedRow(rowKey) !== undefined &&
              !unownedDirectWritePositions.has(rowKey) &&
              !rowToQueries.has(rowKey)
            )
          })
        // Still subscribe if sync is active so we receive future updates
        if (syncStarted || collection.subscriberCount > 0) {
          subscribeToQuery(
            localObserver,
            hashedQueryKey,
            foreignDirectPatch ||
              unverifiedCacheEdit ||
              unknownPersistedRowOrder ||
              retainedQueriesPendingRevalidation.has(hashedQueryKey)
              ? {
                  data: localQuery.state.data,
                  version: localQuery.state.dataUpdateCount,
                  fetchStart: queryCollectionCurrentFetchStarts.get(localQuery),
                }
              : undefined,
          )
        }
        const currentResult = localObserver.getCurrentResult()
        if (
          opts.refetch ||
          unpatchedCacheVersions.has(localQuery) ||
          foreignDirectPatch ||
          unverifiedCacheEdit ||
          unknownPersistedRowOrder ||
          retainedQueriesPendingRevalidation.has(hashedQueryKey)
        ) {
          return opts.refetch
            ? refetchAndWaitForApplication(localObserver, hashedQueryKey)
            : refetchOrWaitForEnabledQuery(localObserver, hashedQueryKey)
        }
        if (!hasCurrentCacheGenerationFetch(localObserver.getCurrentQuery())) {
          return refetchOrWaitForEnabledQuery(localObserver, hashedQueryKey)
        }
        if (currentResult.isError && !currentResult.isFetching) {
          return Promise.reject(currentResult.error)
        }
        if (!currentResult.isSuccess) {
          return waitForQueryReadyAndApplied(localObserver, hashedQueryKey)
        }
        if (collection.deferDataRefresh) {
          return waitForQueryReadyAndApplied(localObserver, hashedQueryKey)
        }
        return getResultApplicationSettlement(hashedQueryKey)
      }

      // A pending Query fetch may have started before a private startup cache
      // rotation or persisted-owner retention. Subscribe first, then join it
      // and require another fetch if its result cannot establish authority.
      if (
        requiredCacheGenerationFetchStart !== undefined ||
        retainedQueriesPendingRevalidation.has(hashedQueryKey)
      ) {
        if (syncStarted || collection.subscriberCount > 0) {
          subscribeToQuery(localObserver, hashedQueryKey)
        }
        return refetchOrWaitForEnabledQuery(localObserver, hashedQueryKey)
      }

      // Create a promise that resolves when the query result is first available
      const readyPromise = waitForQueryReadyAndApplied(
        localObserver,
        hashedQueryKey,
      )

      // If sync has started or there are subscribers to the collection, subscribe to the query straight away
      // This creates the main subscription that handles data updates
      if (syncStarted || collection.subscriberCount > 0) {
        subscribeToQuery(localObserver, hashedQueryKey)
      }

      return readyPromise
    }

    type UpdateHandler = Parameters<QueryObserver[`subscribe`]>[0]

    const validateSuccessfulResultItems = (
      resultQueryKey: QueryKey,
      rawData: unknown,
    ): { items: Array<any> } | { error: InvalidQueryResultError } => {
      const newItemsArray = select ? select(rawData) : rawData

      const source = select ? `select()` : `queryFn`
      if (!Array.isArray(newItemsArray)) {
        return {
          error: new InvalidQueryResultError(
            `@tanstack/query-db-collection: ${source} must return an array of objects. Got: ${typeof newItemsArray} for queryKey ${JSON.stringify(resultQueryKey)}`,
          ),
        }
      }

      const invalidItemIndex = newItemsArray.findIndex(
        (item) => item === null || typeof item !== `object`,
      )
      if (invalidItemIndex !== -1) {
        const invalidItem = newItemsArray[invalidItemIndex]
        const invalidItemDescription =
          invalidItem === null ? `null` : typeof invalidItem
        return {
          error: new InvalidQueryResultError(
            `@tanstack/query-db-collection: ${source} must return an array of objects. Invalid item at index ${invalidItemIndex}: ${invalidItemDescription} for queryKey ${JSON.stringify(resultQueryKey)}`,
          ),
        }
      }

      return { items: newItemsArray }
    }

    /** Keep later accepted direct rows and later source-invoked fetched rows. */
    const mergeOlderRows = (
      items: Array<any>,
      fetchStart: number,
      sourceStart: number | undefined,
      hashedQueryKey: string,
      cacheQuery?: AnyQuery,
    ): Array<any> => {
      const rows = new Map(items.map((row) => [getKey(row), row]))
      const laterKeys = new Set<string | number>()
      for (const [key, generation] of directWriteKeyGenerations) {
        if (generation > fetchStart) laterKeys.add(key)
      }
      for (const [key, position] of acceptedRowPositions) {
        if (
          cacheQuery &&
          position.kind === `fetched` &&
          position.query !== cacheQuery
        )
          continue
        if (
          acceptedRowIsNewer(
            position,
            sourceStart === undefined ? undefined : fetchStart,
            sourceStart,
          )
        )
          laterKeys.add(key)
      }
      for (const key of laterKeys) {
        // A scoped result must not acquire an unrelated direct insert.
        if (
          syncMode === `on-demand` &&
          !rows.has(key) &&
          !queryToRows.get(hashedQueryKey)?.has(key)
        )
          continue
        const accepted = collection._state.getAcceptedSyncedRow(key)
        if (accepted === undefined) rows.delete(key)
        else rows.set(key, accepted)
      }
      return Array.from(rows.values())
    }

    /** Settles once no direct write waits for earlier commits. */
    const directWritesSettled = async (): Promise<void> => {
      while (pendingDirectWrites) await pendingDirectWrites
    }

    const validateSuccessfulResultItemsForApplication = (
      resultQueryKey: QueryKey,
      result: QueryObserverResult<any, any>,
    ): Array<any> => {
      const validation = validateSuccessfulResultItems(
        resultQueryKey,
        result.data,
      )
      if (`error` in validation) {
        writeExceptionalResultSettlement(result, {
          type: `rejected`,
          error: validation.error,
        })
        throw validation.error
      }
      return validation.items
    }

    const applySuccessfulResult = (
      queryKey: QueryKey,
      result: QueryObserverResult<any, any>,
      applicationToken: ResultApplicationController,
      persistedBaseline?: Map<
        string | number,
        {
          value: any
          owners: Set<string>
        }
      >,
      signal?: AbortSignal,
      validatedItems?: Array<any>,
    ): true | Promise<void> => {
      const hashedQueryKey = hashKey(queryKey)

      if (collection.status === `cleaned-up` || signal?.aborted) {
        throw new LoadSubsetOperationAbortedError()
      }
      // A canceled caller keeps its lease until explicit release. That lease
      // cannot authorize a late Query result to publish into the Collection.
      if (syncMode === `on-demand` && !hasLiveAcquisition(hashedQueryKey)) {
        return true
      }

      if (isMutationPublicationBlocked()) {
        applicationToken.settleRefetchAtFetchBoundary?.()
      }

      const newItemsArray =
        validatedItems ??
        validateSuccessfulResultItemsForApplication(queryKey, result)

      // Diff against accepted rows: an earlier result or direct write can be
      // accepted while it waits behind a persisting optimistic transaction.
      const currentSyncedItems: Map<string | number, any> = new Map(
        collection._state.acceptedSyncedEntries(),
      )
      const shouldUsePersistedBaseline = persistedBaseline !== undefined
      const legacyOwnerHashes = legacyPersistedOwnerHashes.get(hashedQueryKey)
      const previouslyOwnedRows = shouldUsePersistedBaseline
        ? new Set(persistedBaseline.keys())
        : getHydratedOwnedRowsForQueryBaseline(hashedQueryKey)
      const currentQuery = queryClient
        .getQueryCache()
        .find({ queryKey, exact: true })
      const directPatch = currentQuery
        ? queryCollectionCachePatches.get(currentQuery)
        : undefined
      const patchAttribution =
        directPatch !== undefined && directPatch.data === result.data
          ? directPatch.attribution
          : undefined
      const cachedRemoteFetchStart =
        result.dataSourceSequence === undefined &&
        patchAttribution?.kind === `fetched`
          ? patchAttribution.fetchStart
          : getResultFetchStart(result, currentQuery)
      const cachedRemoteSourceStart =
        result.dataSourceSequence ??
        (patchAttribution?.kind === `fetched`
          ? patchAttribution.sourceStart
          : undefined)
      const incomingPosition =
        syncMode === `eager` &&
        cachedRemoteSourceStart === undefined &&
        patchAttribution?.kind === `direct`
          ? patchAttribution.position
          : cachedRemoteFetchStart
      const newItemsMap = new Map<string | number, any>()
      newItemsArray.forEach((item) => {
        const key = getKey(item)
        const acceptedPosition = acceptedRowPositions.get(key)
        newItemsMap.set(
          key,
          acceptedRowIsNewer(
            acceptedPosition,
            incomingPosition,
            cachedRemoteSourceStart,
          ) && currentSyncedItems.has(key)
            ? currentSyncedItems.get(key)
            : item,
        )
      })
      if (syncMode === `eager`) {
        // A new complete snapshot replaces direct rows without subset owners.
        // Hydrated rows with no claim are not necessarily this Query's rows.
        unownedDirectWritePositions.forEach((directPosition, key) => {
          if (
            currentSyncedItems.has(key) &&
            cachedRemoteFetchStart !== undefined &&
            cachedRemoteFetchStart > directPosition
          )
            previouslyOwnedRows.add(key)
        })
      } else if (
        cachedRemoteFetchStart !== undefined &&
        (unownedDirectWritePositions.size > 0 ||
          persistence?.scanPersistedRows !== undefined)
      ) {
        // A complete later result settles ownerless direct rows in its scope.
        // A window or cursor cannot prove omission outside the returned page.
        const scope =
          state.observers.get(hashedQueryKey)?.options.meta?.loadSubsetOptions
        if (
          isStoredLoadSubsetOptions(scope) &&
          scope.limit === undefined &&
          scope.offset === undefined &&
          scope.cursor === undefined
        ) {
          const matches = scope.where
            ? compileSingleRowExpression(scope.where)
            : undefined
          currentSyncedItems.forEach((row, key) => {
            const directPosition = unownedDirectWritePositions.get(key)
            if (
              directPosition === undefined
                ? !persistence?.scanPersistedRows ||
                  getPersistedOwners(key).size > 0
                : cachedRemoteFetchStart <= directPosition
            )
              return
            try {
              if (matches && !toBooleanPredicate(matches(row))) return
            } catch {
              return
            }
            if (newItemsMap.has(key)) return
            previouslyOwnedRows.add(key)
          })
        }
      }

      const settledDirectPositions = new Map<string | number, number>()
      const removedRows = new Set<string | number>()

      const previousOwnedRows = queryToRows.has(hashedQueryKey)
        ? new Set(queryToRows.get(hashedQueryKey))
        : undefined
      const previousLegacyOwnedRows = new Map(
        [...(legacyOwnerHashes ?? [])].map((hash) => [
          hash,
          queryToRows.has(hash) ? new Set(queryToRows.get(hash)) : undefined,
        ]),
      )
      const affectedRowKeys = new Set([
        ...previouslyOwnedRows,
        ...newItemsMap.keys(),
      ])
      const previousOwnersByRow = new Map<
        string | number,
        Set<string> | undefined
      >()
      affectedRowKeys.forEach((key) => {
        const owners = rowToQueries.get(key)
        previousOwnersByRow.set(key, owners ? new Set(owners) : undefined)
      })
      let transactionActive = false
      let resultTransaction: { applicationStarted: boolean } | undefined

      const restoreOwnershipTracking = () => {
        // Core flips this at its no-cancel point before publication can reenter.
        if (resultTransaction?.applicationStarted) return
        // A wrapped sync may reserve and apply its core transaction entirely
        // inside commit(), so there is no pending transaction to capture above.
        // In that case the collection's committed metadata is the publication
        // boundary; pending wrapper metadata is intentionally not consulted.
        if (
          resultTransaction === undefined &&
          Array.from(affectedRowKeys).every((key) => {
            const trackedOwners = rowToQueries.get(key) ?? new Set<string>()
            const publishedOwners = getOwnersFromMetadata(
              collection._state.syncedMetadata.get(key),
            )
            return (
              trackedOwners.size === publishedOwners.size &&
              Array.from(trackedOwners).every((owner) =>
                publishedOwners.has(owner),
              )
            )
          })
        ) {
          return
        }
        if (!state.observers.has(hashedQueryKey)) return
        if (
          resultApplicationControllers.get(hashedQueryKey) !== applicationToken
        ) {
          return
        }

        if (previousOwnedRows === undefined) {
          queryToRows.delete(hashedQueryKey)
        } else {
          queryToRows.set(hashedQueryKey, previousOwnedRows)
        }
        previousLegacyOwnedRows.forEach((rows, hash) => {
          if (rows === undefined) queryToRows.delete(hash)
          else queryToRows.set(hash, rows)
        })
        previousOwnersByRow.forEach((owners, key) => {
          if (owners === undefined) {
            rowToQueries.delete(key)
          } else {
            rowToQueries.set(key, owners)
          }
        })
      }
      applicationToken.rollback = restoreOwnershipTracking

      const failApplication = (error: unknown): never => {
        restoreOwnershipTracking()

        if (transactionActive) {
          const cancellation = new AbortController()
          cancellation.abort()
          try {
            commit(cancellation.signal)
          } catch {
            // Preserve the application error that caused the rollback.
          }
        }
        throw error
      }

      try {
        // From this point onward the result, including an empty result, is the
        // authoritative ownership baseline until this query is cleaned up.
        queryToRows.set(
          hashedQueryKey,
          queryToRows.get(hashedQueryKey) ?? new Set<string | number>(),
        )

        begin()
        transactionActive = true
        if (metadata) {
          metadata.collection.delete(
            `${QUERY_COLLECTION_GC_PREFIX}${hashedQueryKey}`,
          )
          legacyOwnerHashes?.forEach((hash) => {
            metadata.collection.delete(`${QUERY_COLLECTION_GC_PREFIX}${hash}`)
          })
        }

        previouslyOwnedRows.forEach((key) => {
          const oldItem = shouldUsePersistedBaseline
            ? persistedBaseline.get(key)?.value
            : currentSyncedItems.get(key)
          const newItem = newItemsMap.get(key)
          legacyOwnerHashes?.forEach((hash) => removeRowOwner(key, hash))
          if (!newItem) {
            const directPosition = unownedDirectWritePositions.get(key)
            if (directPosition !== undefined)
              settledDirectPositions.set(key, directPosition)
            const owners = getPersistedOwners(key)
            owners.delete(hashedQueryKey)
            legacyOwnerHashes?.forEach((hash) => owners.delete(hash))
            setPersistedOwners(key, owners)
            const needToRemove = removeRowOwner(key, hashedQueryKey)
            // A superseded result's row can still be waiting for durable
            // storage, so delete by key even when no stored row is known.
            if (needToRemove) {
              write({ type: `delete`, key })
              removedRows.add(key)
            }
          } else if (oldItem && !deepEquals(oldItem, newItem)) {
            write({ type: `update`, value: newItem })
          }
        })

        newItemsMap.forEach((newItem, key) => {
          const directPosition = unownedDirectWritePositions.get(key)
          if (
            !previouslyOwnedRows.has(key) &&
            directPosition !== undefined &&
            (cachedRemoteFetchStart ?? 0) <= directPosition
          ) {
            // Replaying a pre-write cache entry cannot claim a direct row's
            // lifetime. A later physical fetch may claim it.
            return
          }
          if (
            directPosition !== undefined &&
            cachedRemoteFetchStart !== undefined &&
            cachedRemoteFetchStart > directPosition
          ) {
            settledDirectPositions.set(key, directPosition)
          }
          const owners = getPersistedOwners(key)
          let retiredLegacyOwner = false
          for (const hash of legacyOwnerHashes ?? []) {
            if (owners.delete(hash)) retiredLegacyOwner = true
          }
          const addsOwner = !owners.has(hashedQueryKey)
          const insertsRow = !currentSyncedItems.has(key)
          if (addsOwner) {
            owners.add(hashedQueryKey)
          }
          addRowOwner(key, hashedQueryKey)
          if (insertsRow) {
            write({ type: `insert`, value: newItem })
          } else if (
            !previouslyOwnedRows.has(key) &&
            (result.isFetchedAfterMount ||
              (directPosition !== undefined &&
                cachedRemoteFetchStart !== undefined &&
                cachedRemoteFetchStart > directPosition)) &&
            !deepEquals(currentSyncedItems.get(key), newItem)
          ) {
            // A fetched row can first claim a directly inserted key. That
            // claim also replaces the direct value with the server value.
            write({ type: `update`, value: newItem })
          }
          if (addsOwner || insertsRow || retiredLegacyOwner) {
            // An insert clears stale metadata for its key. Stage ownership
            // afterward so rows and ownership commit as one state change.
            setPersistedOwners(key, owners)
          }
        })

        resultTransaction = collection._state.pendingSyncedTransactions.at(-1)
        // No asynchronous work occurs between this check and commit. If a
        // mutation started during fetch or baseline loading, explicit refetch
        // callers stop at the Query fetch boundary while the application stays
        // in the normal publication queue.
        if (isMutationPublicationBlocked()) {
          applicationToken.settleRefetchAtFetchBoundary?.()
        }
        // An accepted sync transaction always applies, so a later result or
        // cleanup must not cancel it or roll back the ownership it records.
        const applied = commit()
        const appliedQuery = currentQuery
        const appliedVersion = appliedQuery?.state.dataUpdateCount
        const recordAppliedVersion = () => {
          if (
            appliedQuery &&
            appliedVersion !== undefined &&
            appliedQuery.state.dataUpdateCount === appliedVersion &&
            appliedQuery.state.data === result.data
          ) {
            appliedResultVersions.set(hashedQueryKey, {
              query: appliedQuery,
              version: appliedVersion,
              data: result.data,
            })
          }
        }
        applicationToken.rollback = undefined
        transactionActive = false
        retainedQueriesPendingRevalidation.delete(hashedQueryKey)
        retainedRevalidationStarts.delete(hashedQueryKey)
        cancelPersistedRetentionExpiry(hashedQueryKey)

        // Readiness counts accepted rows; the application, which settles a
        // subset load, waits for them to be visible.
        const finishApplication = () => {
          if (legacyOwnerHashes !== undefined) {
            legacyOwnerHashes.forEach((hash) => {
              queryToRows.delete(hash)
              persistedOwnerHashes?.delete(hash)
            })
            legacyPersistedOwnerHashes.delete(hashedQueryKey)
          }
          removedRows.forEach((key) => {
            if (collection._state.getAcceptedSyncedRow(key) === undefined)
              acceptedRowPositions.delete(key)
          })
          const recordFetchPosition = (position: number, source: number) => {
            newItemsMap.forEach((_item, key) => {
              if (collection._state.getAcceptedSyncedRow(key) === undefined)
                return
              if (
                !acceptedRowIsNewer(
                  acceptedRowPositions.get(key),
                  position,
                  source,
                )
              )
                if (currentQuery)
                  acceptedRowPositions.set(key, {
                    kind: `fetched`,
                    source,
                    query: currentQuery,
                  })
            })
          }
          if (
            cachedRemoteFetchStart !== undefined &&
            cachedRemoteSourceStart !== undefined
          ) {
            recordFetchPosition(cachedRemoteFetchStart, cachedRemoteSourceStart)
          } else if (currentQuery) {
            // Observer callbacks run before QueryCache's success notification.
            // Only that physical success can assign a fetch position.
            const appliedData = currentQuery.state.data
            queueMicrotask(() => {
              if (
                queryCollectionSuccessfulFetchData.get(currentQuery) ===
                appliedData
              ) {
                const position =
                  queryCollectionSuccessfulFetchStarts.get(currentQuery)
                const source = result.dataSourceSequence
                if (position !== undefined && source !== undefined)
                  recordFetchPosition(position, source)
              }
            })
          }
          settledDirectPositions.forEach((position, key) => {
            if (unownedDirectWritePositions.get(key) === position)
              unownedDirectWritePositions.delete(key)
          })
          if (!signal?.aborted) markReady()
        }
        const accepted = whenSyncAccepted(applied)
        if (accepted === true) finishApplication()
        else void accepted.then(finishApplication, () => undefined)
        if (applied !== true) {
          return applied.then(recordAppliedVersion, failApplication)
        }
        recordAppliedVersion()
        return true
      } catch (error) {
        return failApplication(error)
      }
    }

    const reconcileSuccessfulResult = async (
      queryKey: QueryKey,
      result: QueryObserverResult<any, any>,
      applicationToken: ResultApplicationController,
      signal: AbortSignal,
      selectedItems?: Array<any>,
      fetchStart?: number,
    ) => {
      const hashedQueryKey = hashKey(queryKey)
      // Validate before persistence I/O so the public refetch can observe this
      // result's application rejection instead of fulfilling early.
      const validatedItems =
        selectedItems ??
        validateSuccessfulResultItemsForApplication(queryKey, result)
      const persistedBaseline = await loadPersistedBaselineForQuery(
        hashedQueryKey,
        validatedItems.length === 0,
      )
      if (
        collection.status === `cleaned-up` ||
        resultApplicationControllers.get(hashedQueryKey) !== applicationToken
      ) {
        throw new LoadSubsetOperationAbortedError()
      }
      const appliedThroughGeneration = directWriteGeneration
      const query = queryClient.getQueryCache().find({ queryKey, exact: true })
      const physicalFetchStart = query
        ? queryCollectionCurrentFetchStarts.get(query)
        : undefined
      const currentItems =
        fetchStart !== undefined && fetchStart < appliedThroughGeneration
          ? mergeOlderRows(
              validatedItems,
              fetchStart,
              result.dataSourceSequence,
              hashedQueryKey,
            )
          : validatedItems
      await applySuccessfulResult(
        queryKey,
        result,
        applicationToken,
        persistedBaseline,
        signal,
        currentItems,
      )
      if (
        fetchStart !== undefined &&
        fetchStart < appliedThroughGeneration &&
        fetchStartGenerations.get(hashedQueryKey) === fetchStart &&
        query &&
        queryCollectionCurrentFetchStarts.get(query) === physicalFetchStart
      ) {
        fetchStartGenerations.set(hashedQueryKey, appliedThroughGeneration)
      }
    }

    const trackResultApplication = (
      hashedQueryKey: string,
      application: Promise<void>,
      isFetching: boolean,
      applicationErrorRevision: number,
    ): void => {
      pendingResultApplications.set(hashedQueryKey, application)
      const finish = () => {
        if (pendingResultApplications.get(hashedQueryKey) === application) {
          pendingResultApplications.delete(hashedQueryKey)
          return true
        }
        return false
      }
      void application.then(
        () => {
          if (finish()) {
            failedResultApplications.delete(hashedQueryKey)
            // Applying cached data during a fetch does not establish recovery.
            if (!isFetching && applicationErrorRevision === errorRevision) {
              state.lastError = undefined
              state.errorCount = 0
            }
          }
        },
        (error) => {
          if (!finish()) return
          failedResultApplications.set(hashedQueryKey, error)
          state.lastError = error
          state.errorCount++
          errorRevision++
          console.error(
            `[QueryCollection] Error applying query ${String(hashToQueryKey.get(hashedQueryKey))}:`,
            error,
          )
          if (collection.status === `loading`) {
            markError(error)
          }
        },
      )
    }

    const enqueueResultApplication = (
      hashedQueryKey: string,
      result: QueryObserverResult<any, any>,
      apply: (
        signal: AbortSignal,
        applicationToken: ResultApplicationController,
      ) => true | Promise<void>,
    ): void => {
      invalidatePendingResultApplication(hashedQueryKey)
      const currentErrorRevision = errorRevision
      const controller: ResultApplicationController = new AbortController()
      let settleRefetchAtFetchBoundary = () => {}
      const fetchBoundary = new Promise<void>((resolve) => {
        settleRefetchAtFetchBoundary = resolve
      })
      controller.settleRefetchAtFetchBoundary = settleRefetchAtFetchBoundary
      resultApplicationControllers.set(hashedQueryKey, controller)
      let application: true | Promise<void>
      try {
        application = apply(controller.signal, controller)
      } catch (error) {
        application = Promise.reject(error)
      }
      if (application === true) {
        // Keep a causal witness for refetch callers without turning the
        // Collection's synchronous readiness signal back into a Promise.
        if (resultApplicationControllers.get(hashedQueryKey) === controller) {
          recordResultApplicationSettlement(
            hashedQueryKey,
            result,
            Promise.resolve(),
          )
          resultApplicationControllers.delete(hashedQueryKey)
          failedResultApplications.delete(hashedQueryKey)
          if (!result.isFetching && currentErrorRevision === errorRevision) {
            state.lastError = undefined
            state.errorCount = 0
          }
        }
        return
      }
      const refetchSettlement = Promise.race([application, fetchBoundary])
      // Most applications are observer-driven and have no explicit refetch
      // caller. Keep their derived settlement from becoming an unhandled
      // rejection; a refetch that captures this promise still observes the
      // original rejection when throwOnError is enabled.
      void refetchSettlement.catch(() => undefined)
      recordResultApplicationSettlement(
        hashedQueryKey,
        result,
        refetchSettlement,
      )
      const cleanupController = () => {
        if (resultApplicationControllers.get(hashedQueryKey) === controller) {
          resultApplicationControllers.delete(hashedQueryKey)
        }
      }
      void application.then(cleanupController, cleanupController)
      if (resultApplicationControllers.get(hashedQueryKey) === controller) {
        trackResultApplication(
          hashedQueryKey,
          application,
          result.isFetching,
          currentErrorRevision,
        )
      }
    }

    // eslint-disable-next-line no-shadow
    const makeQueryResultHandler = (queryKey: QueryKey) => {
      const hashedQueryKey = hashKey(queryKey)
      const observerEpoch = scopedRecoveryEpoch
      const handleQueryResult: UpdateHandler = (result) => {
        if (
          activeSyncSession !== syncSession ||
          scopedRecoveryPending ||
          observerEpoch !== scopedRecoveryEpoch
        ) {
          return
        }
        const observer = state.observers.get(hashedQueryKey)
        const observedQuery = observer?.getCurrentQuery()
        if (observer && observedQuery) {
          trackOwnedCacheQuery(observedQuery, hashedQueryKey)
        }
        if (syncMode === `on-demand` && !hasLiveAcquisition(hashedQueryKey)) {
          return
        }
        // A direct cache write cannot establish fetched result authority or
        // clear a recorded fetch error.
        if (writingDirectCache) return
        if (
          observedQuery &&
          !result.isFetching &&
          (result.isSuccess || result.isError)
        ) {
          if (result.isError) {
            const byVersion =
              terminalErrorResults.get(observedQuery) ?? new Map()
            const byHash = byVersion.get(result.errorUpdateCount) ?? new Map()
            byHash.set(hashedQueryKey, result)
            byVersion.set(result.errorUpdateCount, byHash)
            terminalErrorResults.set(observedQuery, byVersion)
          } else if (result.dataFetchSequence !== undefined) {
            const record = getFetchApplicationRecord(
              observedQuery,
              result.dataFetchSequence,
              hashedQueryKey,
            )
            record.result = result
            record.terminal = true
          }
        }
        if (observedQuery) {
          const fetchStart =
            queryCollectionCurrentFetchStarts.get(observedQuery)
          if (
            result.isError &&
            requiredCacheGenerationFetchStart !== undefined &&
            fetchStart !== undefined &&
            fetchStart <= requiredCacheGenerationFetchStart
          ) {
            return
          }
          if (result.isSuccess) {
            if (
              result.isFetching &&
              !collection.deferDataRefresh &&
              queryToRows.has(hashedQueryKey) &&
              hasAppliedResult(hashedQueryKey, observedQuery) &&
              queryCollectionSuccessfulFetchData.get(observedQuery) ===
                observedQuery.state.data
            ) {
              // Fetch startup repeats the last cached server result. An
              // already-owned scope has applied it; replay cannot undo a
              // direct write that is still waiting for its sync commit.
              return
            }
            if (!hasCurrentCacheGenerationFetch(observedQuery)) {
              // Observer callbacks precede the cache success event that
              // records this fetch's persisted cache generation.
              queueMicrotask(() => {
                const currentObserver = state.observers.get(hashedQueryKey)
                if (
                  currentObserver &&
                  currentObserver === observer &&
                  hasCurrentCacheGenerationFetch(
                    currentObserver.getCurrentQuery(),
                  )
                ) {
                  handleQueryResult(currentObserver.getCurrentResult())
                }
              })
              return
            }
            if (
              result.dataSourceSequence === undefined &&
              !(
                queryCollectionCachePatches.get(observedQuery)?.data ===
                  result.data &&
                queryCollectionCachePatches.get(observedQuery)?.attribution
                  ?.kind === `fetched`
              ) &&
              directWriteGeneration > 0 &&
              observedQuery.state.dataUpdateCount >
                (queryCollectionSuccessfulFetchVersions.get(observedQuery) ?? 0)
            ) {
              // Query observers run before the cache success event. Wait for
              // that event to distinguish a physical fetch from a local
              // setQueryData edit. The latter cannot replace a direct write.
              const version = observedQuery.state.dataUpdateCount
              if (awaitingFetchSuccessVersions.get(observedQuery) !== version) {
                awaitingFetchSuccessVersions.set(observedQuery, version)
                queueMicrotask(() => {
                  const currentObserver = state.observers.get(hashedQueryKey)
                  if (
                    currentObserver === observer &&
                    observedQuery.state.data === result.data &&
                    observedQuery.state.dataUpdateCount === version
                  )
                    handleQueryResult(result)
                })
                return
              }
              if (
                directWriteGeneration > 0 &&
                queryCollectionSuccessfulFetchData.get(observedQuery) !==
                  observedQuery.state.data
              )
                return
            }
            const currentFetchStart = getResultFetchStart(result, observedQuery)
            if (
              !result.isFetching &&
              (unownedDirectWritePositions.size > 0 ||
                persistence?.scanPersistedRows !== undefined) &&
              currentFetchStart !== undefined &&
              currentFetchStart !==
                queryCollectionSuccessfulFetchStarts.get(observedQuery) &&
              !awaitingFetchSuccessNotification.has(result)
            ) {
              // Query observers run before the cache success event. Let that
              // event identify whether this result came from a physical fetch
              // or a local cache edit before assigning direct-row authority.
              awaitingFetchSuccessNotification.add(result)
              queueMicrotask(() => {
                const currentObserver = state.observers.get(hashedQueryKey)
                if (currentObserver?.getCurrentResult() === result)
                  handleQueryResult(result)
              })
              return
            }
            const unpatchedVersion = unpatchedCacheVersions.get(observedQuery)
            if (unpatchedVersion !== undefined) {
              if (observedQuery.state.dataUpdateCount <= unpatchedVersion)
                return
              unpatchedCacheVersions.delete(observedQuery)
            }
          }
        }
        if (result.isSuccess && collection.deferDataRefresh) {
          // A direct write cannot bypass the held publication boundary, even
          // when a derived select needs its fetched rows merged later.
          if (result.isFetching) {
            void getDeferredRefresh(hashedQueryKey, collection.deferDataRefresh)
            return
          }
          scheduleDeferredResultSettlement(
            hashedQueryKey,
            result,
            getDeferredRefresh(hashedQueryKey, collection.deferDataRefresh),
          )
          return
        }
        if (
          result.isSuccess &&
          !result.isFetching &&
          result.dataSourceSequence !== undefined &&
          (pendingDirectWrites !== undefined ||
            (getResultFetchStart(result, observedQuery) ?? 0) <
              directWriteGeneration)
        ) {
          // This fetch started before a direct write, or a direct write still
          // waits. Once no write waits, take the keys that accepted writes
          // claimed after this fetch started from the accepted rows, and the
          // rest from this result. Settle its waiter after those rows apply.
          const query = observer?.getCurrentQuery()
          const fetchStart = getResultFetchStart(result, observedQuery) ?? 0
          const sourceStart = result.dataSourceSequence
          if (readExceptionalResultSettlement(result)?.type === `pending`)
            return
          const validation = validateSuccessfulResultItems(
            queryKey,
            result.data,
          )
          if (query && `items` in validation) {
            deferredResults++
            const refresh = (async () => {
              await directWritesSettled()
              const current = state.observers.get(hashedQueryKey)
              if (current?.getCurrentQuery() !== query) {
                throw new CancelledError()
              }
              const merged = mergeOlderRows(
                validation.items,
                fetchStart,
                sourceStart,
                hashedQueryKey,
              )
              // Subscribe before the cache update, so its notification
              // cannot be missed.
              let unsubscribe = () => {}
              const notified = new Promise<void>((resolve) => {
                unsubscribe = current.subscribe(() => resolve())
              })
              const before = current.getCurrentResult()
              try {
                fetchStartGenerations.set(hashedQueryKey, directWriteGeneration)
                const patched = updateCacheDataForKey(
                  queryKey,
                  merged,
                  undefined,
                  {
                    kind: `fetched`,
                    fetchStart,
                    sourceStart,
                  },
                )
                if (!patched) {
                  // A derived select has no inverse into its response. Apply
                  // the merged rows directly while leaving its cache envelope
                  // intact and marked against later stale replay.
                  enqueueResultApplication(
                    hashedQueryKey,
                    result,
                    (signal, token) =>
                      retainedQueriesPendingRevalidation.has(hashedQueryKey)
                        ? reconcileSuccessfulResult(
                            queryKey,
                            result,
                            token,
                            signal,
                            merged,
                            fetchStart,
                          )
                        : applySuccessfulResult(
                            queryKey,
                            result,
                            token,
                            undefined,
                            signal,
                            merged,
                          ),
                  )
                  const application =
                    getResultApplicationSettlement(hashedQueryKey)
                  if (application !== true) await application
                  return current.getCurrentResult()
                }
                // Rows equal to the cache leave the current result unchanged,
                // so no notification follows. Handle it now: it is no longer
                // stale.
                if (current.getCurrentResult() === before)
                  handleQueryResult(before)
                else await notified
              } finally {
                unsubscribe()
              }
              // Let the handler classify the merged result first.
              await new Promise<void>((resolve) => queueMicrotask(resolve))
              const application = getResultApplicationSettlement(hashedQueryKey)
              if (application !== true) await application
              return current.getCurrentResult()
            })()
            const settled = () => {
              deferredResults--
            }
            void refresh.then(settled, settled)
            scheduleDeferredResultSettlement(hashedQueryKey, result, refresh)
            return
          }
        }
        if (result.isSuccess) {
          if (retainedQueriesPendingRevalidation.has(hashedQueryKey)) {
            const query = queryClient.getQueryCache().find({
              queryKey,
              exact: true,
            })
            if (query && !hasFreshRetainedFetch(hashedQueryKey, query)) {
              // Observer callbacks precede the cache success event that
              // records a physical fetch's position.
              if (
                !result.isFetching &&
                !awaitingRetainedFetchSuccess.has(result) &&
                (getResultFetchStart(result, query) ?? 0) >
                  (retainedRevalidationStarts.get(hashedQueryKey) ?? 0)
              ) {
                awaitingRetainedFetchSuccess.add(result)
                queueMicrotask(() => {
                  if (
                    state.observers.get(hashedQueryKey)?.getCurrentQuery() ===
                    query
                  )
                    handleQueryResult(result)
                })
              }
              return
            }
            if (query?.state.dataUpdateCount === 0) {
              // Initial data seeds Query state without a fetch. It must not
              // satisfy persistence retention that lasts until revalidation.
              if (!result.isFetching) {
                state.observers
                  .get(hashedQueryKey)
                  ?.refetch()
                  .catch(() => {
                    // Errors handled by the next handleQueryResult invocation
                  })
              }
              return
            }
            if (result.isFetching) return

            enqueueResultApplication(hashedQueryKey, result, (signal, token) =>
              reconcileSuccessfulResult(
                queryKey,
                result,
                token,
                signal,
                undefined,
                getResultFetchStart(result, query) ?? 0,
              ),
            )
          } else {
            enqueueResultApplication(hashedQueryKey, result, (signal, token) =>
              applySuccessfulResult(queryKey, result, token, undefined, signal),
            )
          }
        }

        if (
          observedQuery &&
          result.errorUpdateCount <
            (observedErrorUpdates.get(observedQuery) ?? 0)
        ) {
          observedErrorUpdates.delete(observedQuery)
        }
        // Retry attempts can re-notify the previous error before the fetch settles.
        if (result.isError && result.fetchStatus === `idle`) {
          const isNewError =
            !observedQuery ||
            result.errorUpdateCount !== observedErrorUpdates.get(observedQuery)
          if (isNewError) {
            if (observedQuery) {
              observedErrorUpdates.set(observedQuery, result.errorUpdateCount)
            }
            state.lastError = result.error
            state.errorCount++
            errorRevision++
          }

          console.error(
            `[QueryCollection] Error observing query ${String(queryKey)}:`,
            result.error,
          )

          // A failure before the first successful snapshot leaves no usable
          // collection state. Later refetch failures keep the last ready
          // snapshot available while utils expose the error.
          if (collection.status === `loading`) {
            markError(result.error)
          }
        }
      }
      return handleQueryResult
    }

    const isSubscribed = (hashedQueryKey: string) => {
      return unsubscribes.has(hashedQueryKey)
    }

    applyRefetchResultWhenUnsubscribed = (hashedQueryKey, result) => {
      if (isSubscribed(hashedQueryKey)) return false
      const trackedQueryKey = hashToQueryKey.get(hashedQueryKey)
      if (!trackedQueryKey) return false
      makeQueryResultHandler(trackedQueryKey)(result)
      return true
    }

    const subscribeToQuery = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
      ignoredCacheSnapshot?: {
        data: unknown
        version: number
        fetchStart: number | undefined
      },
    ) => {
      if (!isSubscribed(hashedQueryKey)) {
        // Cache removal does not retire eager ownership. Reattach the observer
        // to the current cache entry before subscribing to its updates.
        if (syncMode === `eager`) observer.setOptions(observer.options)
        const cachedQueryKey = hashToQueryKey.get(hashedQueryKey)!
        const handleQueryResult = makeQueryResultHandler(cachedQueryKey)
        const applyResult = (result: QueryObserverResult<any, any>) => {
          if (ignoredCacheSnapshot && result.isSuccess) {
            const query = observer.getCurrentQuery()
            if (
              query.state.data === ignoredCacheSnapshot.data &&
              query.state.dataUpdateCount === ignoredCacheSnapshot.version &&
              (query.state.fetchStatus !== `idle` ||
                queryCollectionCurrentFetchStarts.get(query) ===
                  ignoredCacheSnapshot.fetchStart)
            )
              return
          }
          handleQueryResult(result)
        }
        const unsubscribeFn = observer.subscribe(applyResult)
        unsubscribes.set(hashedQueryKey, unsubscribeFn)

        // Process the current result immediately if available
        // This ensures data is synced when resubscribing to a query with cached data
        const currentResult = observer.getCurrentResult()
        if (currentResult.isSuccess || currentResult.isError) {
          applyResult(currentResult)
        }
      }
    }

    const subscribeToQueries = () => {
      state.observers.forEach((observer, hashedQueryKey) =>
        subscribeToQuery(observer, hashedQueryKey),
      )
    }

    const unsubscribeFromQueries = () => {
      unsubscribes.forEach((unsubscribeFn) => {
        unsubscribeFn()
      })
      unsubscribes.clear()
    }

    ensureEagerSubscription = () => {
      if (syncMode !== `eager`) return
      state.observers.forEach((observer, key) => {
        const query = observer.getCurrentQuery()
        if (queryClient.getQueryCache().get(query.queryHash) !== query) {
          subscribeToQuery(observer, key)
        }
      })
    }

    // Mark that sync has started
    syncStarted = true

    // Set up event listener for subscriber changes
    const unsubscribeFromCollectionEvents = collection.on(
      `subscribers:change`,
      ({ subscriberCount }) => {
        if (subscriberCount > 0) {
          subscribeToQueries()
        } else if (subscriberCount === 0) {
          unsubscribeFromQueries()
        }
      },
    )

    // If syncMode is eager, create the initial query without any predicates
    if (syncMode === `eager`) {
      const result = createQueryFromOpts({})
      if (result instanceof Promise) {
        void result.catch(() => {
          // Errors are handled by the query result handler.
        })
      }
    } else {
      if (startupRetentionSettled) {
        markReady()
      } else {
        // In on-demand mode, there is no initial query, but retained-placeholder
        // maintenance still needs to finish before the collection is treated as ready.
        void startupRetentionMaintenancePromise.then(() => {
          if (collection.status === `loading`) {
            markReady()
          }
        })
      }
    }

    // Always subscribe when sync starts (this could be from preload(), startSync config, or first subscriber)
    // We'll dynamically unsubscribe/resubscribe based on subscriber count to maintain staleTime behavior
    subscribeToQueries()

    // Ensure we process any existing query data (QueryObserver doesn't invoke its callback automatically with initial state)
    state.observers.forEach((observer, hashedQueryKey) => {
      const query = observer.getCurrentQuery()
      const directPatch = queryCollectionCachePatches.get(query)
      if (
        syncMode === `on-demand` &&
        directPatch &&
        (directPatch.owner !== cacheOwnerToken ||
          directPatch.session !== syncSession)
      )
        return
      const cachedQueryKey = hashToQueryKey.get(hashedQueryKey)!
      const handleQueryResult = makeQueryResultHandler(cachedQueryKey)
      handleQueryResult(observer.getCurrentResult())
    })

    /**
     * Perform row-level cleanup and remove all tracking for a query.
     * Callers are responsible for ensuring the query is safe to cleanup.
     */
    const unsubscribePendingReadyListeners = (hashedQueryKey: string) => {
      pendingReadyUnsubscribes.get(hashedQueryKey)?.forEach((unsubscribe) => {
        unsubscribe()
      })
      pendingReadyUnsubscribes.delete(hashedQueryKey)
    }

    const cleanupQueryInternal = (hashedQueryKey: string) => {
      const observer = state.observers.get(hashedQueryKey)
      const query = observer?.getCurrentQuery()
      unsubscribes.get(hashedQueryKey)?.()
      unsubscribes.delete(hashedQueryKey)
      unsubscribePendingReadyListeners(hashedQueryKey)
      cancelPersistedRetentionExpiry(hashedQueryKey)
      retainedQueriesPendingRevalidation.delete(hashedQueryKey)
      retainedRevalidationStarts.delete(hashedQueryKey)
      invalidatePendingResultApplication(hashedQueryKey)

      const nextOwnersByRow = removeQueryOwnership(hashedQueryKey)
      const rowsToDelete: Array<any> = []

      nextOwnersByRow.forEach((nextOwners, rowKey) => {
        const row = collection._state.getAcceptedSyncedRow(rowKey)
        if (nextOwners.size === 0 && row) {
          rowsToDelete.push(row)
        }
      })

      const shouldWriteMetadata =
        metadata !== undefined && nextOwnersByRow.size > 0
      const retentionKey = `${QUERY_COLLECTION_GC_PREFIX}${hashedQueryKey}`
      const hasRetentionMarker =
        metadata?.collection.get(retentionKey) !== undefined
      const needsTransaction =
        shouldWriteMetadata || rowsToDelete.length > 0 || hasRetentionMarker
      if (needsTransaction) {
        begin()
      }

      nextOwnersByRow.forEach((owners, rowKey) => {
        if (owners.size === 0) {
          rowToQueries.delete(rowKey)
        } else {
          rowToQueries.set(rowKey, owners)
        }

        if (shouldWriteMetadata) {
          setPersistedOwners(rowKey, owners)
        }
      })

      if (rowsToDelete.length > 0) {
        rowsToDelete.forEach((row) => {
          write({ type: `delete`, value: row })
        })
      }

      if (hasRetentionMarker) {
        metadata.collection.delete(retentionKey)
      }

      if (needsTransaction) {
        const applied = commit()
        const retireDeletedPositions = () => {
          rowsToDelete.forEach((row) => {
            const key = getKey(row)
            if (collection._state.getAcceptedSyncedRow(key) === undefined)
              acceptedRowPositions.delete(key)
          })
        }
        const accepted = whenSyncAccepted(applied)
        if (accepted === true) retireDeletedPositions()
        else void accepted.then(retireDeletedPositions, () => undefined)
      }

      state.observers.delete(hashedQueryKey)
      if (query?.state.fetchStatus !== `fetching`)
        fetchStartGenerations.delete(hashedQueryKey)
      queryToRows.delete(hashedQueryKey)
      hashToQueryKey.delete(hashedQueryKey)
      queryRefCounts.delete(hashedQueryKey)
      effectivePersistedGcTimes.delete(hashedQueryKey)
    }

    /**
     * Attempt to cleanup a query when it appears unused.
     * Respects refcounts and invalidateQueries cycles via hasListeners().
     */
    const cleanupQueryIfIdle = (hashedQueryKey: string) => {
      const refcount = queryRefCounts.get(hashedQueryKey) || 0
      const observer = state.observers.get(hashedQueryKey)
      const effectivePersistedGcTime =
        effectivePersistedGcTimes.get(hashedQueryKey)

      if (refcount <= 0) {
        // Drop our subscription so hasListeners reflects only active consumers
        unsubscribes.get(hashedQueryKey)?.()
        unsubscribes.delete(hashedQueryKey)
        unsubscribePendingReadyListeners(hashedQueryKey)
      }

      // Refcounts are explicit ownership tokens. A cache event can remove the
      // observer while an active acquisition still owns this query.
      if (refcount > 0) {
        return
      }

      const hasListeners = observer?.hasListeners() ?? false
      if (hasListeners) {
        // During invalidateQueries, TanStack Query keeps internal listeners alive.
        // Leave refcount at 0 but keep observer so it can resubscribe.
        queryRefCounts.set(hashedQueryKey, 0)
        return
      }

      const legacyTtlEntries: Array<
        Extract<PersistedQueryRetentionEntry, { mode: `ttl` }>
      > = []
      legacyPersistedOwnerHashes.get(hashedQueryKey)?.forEach((oldHash) => {
        const oldEntry = parsePersistedQueryRetentionEntry(
          metadata?.collection.get(`${QUERY_COLLECTION_GC_PREFIX}${oldHash}`),
          oldHash,
        )
        if (oldEntry?.mode === `ttl`) legacyTtlEntries.push(oldEntry)
      })

      if (
        effectivePersistedGcTime !== undefined &&
        metadata &&
        persistence?.scanPersistedRows
      ) {
        invalidatePendingResultApplication(hashedQueryKey)
        const expiresAt = Date.now() + effectivePersistedGcTime
        begin()
        metadata.collection.set(
          `${QUERY_COLLECTION_GC_PREFIX}${hashedQueryKey}`,
          {
            queryHash: hashedQueryKey,
            mode:
              effectivePersistedGcTime === Number.POSITIVE_INFINITY
                ? `until-revalidated`
                : `ttl`,
            ...(effectivePersistedGcTime === Number.POSITIVE_INFINITY
              ? {}
              : { expiresAt }),
          },
        )
        if (effectivePersistedGcTime !== Number.POSITIVE_INFINITY) {
          legacyTtlEntries.forEach((entry) => {
            metadata.collection.set(
              `${QUERY_COLLECTION_GC_PREFIX}${entry.queryHash}`,
              {
                ...entry,
                expiresAt,
              },
            )
          })
        }
        commit()
        if (effectivePersistedGcTime !== Number.POSITIVE_INFINITY) {
          schedulePersistedRetentionExpiry({
            queryHash: hashedQueryKey,
            mode: `ttl`,
            expiresAt,
          })
        }
        legacyTtlEntries.forEach((entry) =>
          schedulePersistedRetentionExpiry({
            ...entry,
            expiresAt:
              effectivePersistedGcTime === Number.POSITIVE_INFINITY
                ? entry.expiresAt
                : expiresAt,
          }),
        )
        unsubscribes.get(hashedQueryKey)?.()
        unsubscribes.delete(hashedQueryKey)
        state.observers.delete(hashedQueryKey)
        // Query Core may keep an empty-cache fetch alive without an observer.
        // A later lease can reuse that request, so keep its start position.
        if (observer?.getCurrentQuery().state.fetchStatus !== `fetching`)
          fetchStartGenerations.delete(hashedQueryKey)
        hashToQueryKey.delete(hashedQueryKey)
        queryRefCounts.set(hashedQueryKey, 0)
        return
      }

      legacyTtlEntries.forEach(schedulePersistedRetentionExpiry)
      cleanupQueryInternal(hashedQueryKey)
    }

    /**
     * Force cleanup used by explicit collection cleanup.
     * Ignores refcounts/hasListeners and removes everything.
     */
    const forceCleanupQuery = (hashedQueryKey: string) => {
      cleanupQueryInternal(hashedQueryKey)
    }

    // Subscribe to the query client's cache to handle queries that are GCed by tanstack query
    const unsubscribeQueryCache = queryClient
      .getQueryCache()
      .subscribe((event) => {
        if (
          event.type === `fetchSourceStarted` &&
          activeRefetchCapture?.query === event.query &&
          activeRefetchCapture.fetchStart === event.fetchSequence &&
          activeRefetchCapture.promise === undefined
        ) {
          // A synchronous queryFn can remove its Query before Core emits this
          // event. The retired Query's retryer still owns the refetch caller.
          activeRefetchCapture.promise = event.promise
          activeRefetchCapture.cancellation = observeCancellation(event.promise)
        }
        if (
          event.type === `added` &&
          partialMatchKey(event.query.queryKey, baseKey)
        ) {
          trackCacheQuery(event.query)
        }

        if (!trackedCacheQueries.has(event.query)) return

        if (event.type === `observerRemoved`)
          abortUnownedPhysicalFetch(event.query)

        if (event.type === `fetchStarted`) {
          // Query Core reserves this position before observer callbacks can
          // reenter it. Every Collection sharing the Query sees the same ID.
          const fetchStart = event.fetchSequence
          if (
            activeRefetchCapture?.query === event.query &&
            activeRefetchCapture.fetchStart === undefined
          )
            activeRefetchCapture.fetchStart = fetchStart
          const physical = getPhysicalFetchState(event.query)
          const latestOperation = Math.max(0, ...physical.operations.keys())
          if (fetchStart >= latestOperation) {
            for (const [position, operation] of physical.operations) {
              if (position === fetchStart) continue
              operation.controller?.abort()
              physical.operations.delete(position)
            }
          }
          if (!physical.operations.has(fetchStart))
            physical.operations.set(fetchStart, {
              startedWithAcquisition: hasLivePhysicalAcquisition(physical),
            })
          const physicalHash = hashKey(event.query.queryKey)
          fetchStartGenerations.set(
            physicalHash,
            Math.max(fetchStartGenerations.get(physicalHash) ?? 0, fetchStart),
          )
          state.observers.forEach((observer, logicalHash) => {
            if (observer.getCurrentQuery() === event.query)
              fetchStartGenerations.set(
                logicalHash,
                Math.max(
                  fetchStartGenerations.get(logicalHash) ?? 0,
                  fetchStart,
                ),
              )
          })
          queryCollectionCurrentFetchStarts.set(
            event.query,
            Math.max(
              queryCollectionCurrentFetchStarts.get(event.query) ?? 0,
              fetchStart,
            ),
          )
          const obsoleteFetchStarts = [
            ...(fetchApplicationRecords.get(event.query)?.keys() ?? []),
          ].filter((start) => start !== fetchStart)
          if (obsoleteFetchStarts.length > 0) {
            queueMicrotask(() =>
              retireFetchApplicationRecords(event.query, obsoleteFetchStarts),
            )
          }
          captureFetchResult(event.query, fetchStart)
        } else if (event.type === `fetchCancelled`) {
          const operation = getPhysicalFetchState(event.query).operations.get(
            event.fetchSequence,
          )
          if (operation) {
            operation.cancelledByCore = true
            operation.controller?.abort()
          }
          queueMicrotask(() =>
            retireFetchApplicationRecords(event.query, [event.fetchSequence]),
          )
        } else if (event.type === `updated`) {
          if (event.action.type === `success` && !event.action.manual) {
            // An observer can directly edit this Query while Query Core is
            // still notifying observers of the fetch. Its success action is
            // the fetched payload; the current Query state may already hold
            // the later local edit and must keep that provenance.
            const fetchStart = event.fetchSequence
            if (fetchStart !== undefined) {
              if (event.sourceSequence !== undefined) {
                // A success with no observed source invocation can replay
                // cached data. It cannot supersede a direct write.
                if (event.query.state.data === event.action.data)
                  queryCollectionCachePatches.delete(event.query)
                queryCollectionSuccessfulFetchData.set(
                  event.query,
                  event.action.data,
                )
                queryCollectionSuccessfulFetchVersions.set(
                  event.query,
                  event.state.dataUpdateCount,
                )
                queryCollectionSuccessfulFetchStarts.set(
                  event.query,
                  fetchStart,
                )
              }
              captureFetchResult(event.query, fetchStart)
              for (const hashedQueryKey of getLogicalHashes(event.query)) {
                const observer = state.observers.get(hashedQueryKey)
                const logicalQueryKey = hashToQueryKey.get(hashedQueryKey)
                if (!observer || !logicalQueryKey) continue
                if (observer.getCurrentQuery() !== event.query) continue
                const result = observer.getCurrentResult()
                const fetchedData = event.action.data
                if (
                  !result.isSuccess ||
                  !result.isFetching ||
                  result.data !== fetchedData ||
                  result.dataFetchSequence !== fetchStart
                )
                  continue
                queueMicrotask(() => {
                  if (
                    observer.getCurrentResult() === result &&
                    event.query.state.data === fetchedData
                  )
                    makeQueryResultHandler(logicalQueryKey)(result)
                })
              }
              if (
                !writingDirectCache &&
                pendingDirectWrites === undefined &&
                event.query.state.data === event.action.data &&
                ([...directWriteKeyGenerations.values()].some(
                  (position) => position > fetchStart,
                ) ||
                  [...acceptedRowPositions.values()].some(
                    (position) =>
                      (position.kind === `direct` ||
                        position.query === event.query) &&
                      acceptedRowIsNewer(
                        position,
                        event.sourceSequence === undefined
                          ? undefined
                          : fetchStart,
                        event.sourceSequence,
                      ),
                  ))
              ) {
                // An earlier Query observer can start the next fetch before
                // this Collection sees this terminal result. The cache event
                // still identifies the older result and its direct-write
                // overlay, even when our observer only sees the next fetch.
                const validation = validateSuccessfulResultItems(
                  event.query.queryKey,
                  event.action.data,
                )
                if (`items` in validation) {
                  const raw = event.action.data
                  const patchable =
                    !select ||
                    Array.isArray(raw) ||
                    (raw !== null &&
                      typeof raw === `object` &&
                      Object.values(raw).includes(validation.items))
                  if (patchable) {
                    const merged = mergeOlderRows(
                      validation.items,
                      fetchStart,
                      event.sourceSequence,
                      hashKey(event.query.queryKey),
                      event.query,
                    )
                    updateCacheDataForKey(
                      event.query.queryKey,
                      merged,
                      validation.items,
                      event.sourceSequence === undefined
                        ? undefined
                        : {
                            kind: `fetched`,
                            fetchStart,
                            sourceStart: event.sourceSequence,
                          },
                    )
                  }
                }
              }
              // The observer result handler may attach its application promise
              // after the cache success action. Capture again in the microtask.
              queueMicrotask(() => {
                captureFetchApplications(event.query, fetchStart)
                retireFetchApplicationRecords(event.query, [fetchStart])
              })
              getPhysicalFetchState(event.query).operations.delete(fetchStart)
            }
          } else if (event.action.type === `error`) {
            const fetchStart = event.fetchSequence
            if (
              fetchStart !== undefined &&
              isCancelledError(event.action.error) &&
              event.state.fetchStatus === `idle`
            )
              getPhysicalFetchState(event.query)
                .operations.get(fetchStart)
                ?.controller?.abort()
            if (fetchStart !== undefined) {
              const results = terminalErrorResults
                .get(event.query)
                ?.get(event.state.errorUpdateCount)
              results?.forEach((result, hash) => {
                const record = getFetchApplicationRecord(
                  event.query,
                  fetchStart,
                  hash,
                )
                record.result = result
                record.terminal = true
              })
              terminalErrorResults
                .get(event.query)
                ?.delete(event.state.errorUpdateCount)
              queueMicrotask(() =>
                retireFetchApplicationRecords(event.query, [fetchStart]),
              )
              getPhysicalFetchState(event.query).operations.delete(fetchStart)
            }
          } else if (
            event.action.type === `setState` &&
            event.action.state.fetchStatus === `idle` &&
            event.query.state.fetchStatus === `idle`
          ) {
            const fetchStart = event.fetchSequence
            if (fetchStart !== undefined)
              getPhysicalFetchState(event.query)
                .operations.get(fetchStart)
                ?.controller?.abort()
            // Query Core uses a setState action, not an error action, when a
            // reverted cancellation restores the pre-fetch state. Reset also
            // reaches this terminal state. Neither path should retain causal
            // fetch records until another fetch happens.
            if (fetchStart !== undefined) {
              queueMicrotask(() =>
                retireFetchApplicationRecords(event.query, [fetchStart]),
              )
              if (event.query.fetchSequence !== fetchStart)
                getPhysicalFetchState(event.query).operations.delete(fetchStart)
            }
          }
        }

        // Ownership uses our stable key, not the Query client's optional
        // custom cache hash function.
        const hashedKey = hashKey(event.query.queryKey)
        // A retained fetch no longer needs its start position once it settles
        // or leaves the cache while the subset has no observer lease.
        if (
          !state.observers.has(hashedKey) &&
          (event.type === `removed` ||
            event.query.state.fetchStatus !== `fetching`)
        ) {
          fetchStartGenerations.delete(hashedKey)
        }
        if (event.type === `removed`) {
          const physical = queryCollectionPhysicalFetchStates.get(event.query)
          physical?.operations.forEach(({ controller }) => controller?.abort())
          physical?.operations.clear()
          trackedCacheQueries.delete(event.query)
          // Only cleanup if this is OUR query (we track it)
          if (hashToQueryKey.has(hashedKey)) {
            if (syncMode === `eager`) {
              unsubscribes.get(hashedKey)?.()
              unsubscribes.delete(hashedKey)
              unsubscribePendingReadyListeners(hashedKey)
              if (collection.subscriberCount > 0) ensureEagerSubscription()
              return
            }
            // TanStack Query GC'd this query after gcTime expired.
            // Use the guarded cleanup path to avoid deleting rows for active queries.
            cleanupQueryIfIdle(hashedKey)
          }
        }
      })

    const cleanup = () => {
      if (activeSyncSession === syncSession) activeSyncSession = undefined
      pendingStartupLoads.clear()
      fullSourceDependents.clear()
      appliedResultVersions.clear()
      activeAcquisitions.forEach((routes) => {
        routes.forEach(releaseAcquisitionRoute)
      })
      activeAcquisitions.clear()
      acquisitionRoutes = new WeakMap()
      retainedRevalidationStarts.clear()
      ensureEagerSubscription = () => {}
      applyRefetchResultWhenUnsubscribed = () => false
      unsubscribeFromCollectionEvents()
      unsubscribeFromQueries()
      persistedRetentionTimers.forEach((timer) => {
        clearTimeout(timer)
      })
      persistedRetentionTimers.clear()
      pendingExceptionalResultSettlements.forEach((settlement) => {
        settlement.reject(new CancelledError())
      })
      pendingExceptionalResultSettlements.clear()
      deferredRefreshes.clear()
      if (getExceptionalResultSettlement === readExceptionalResultSettlement) {
        getExceptionalResultSettlement = () => undefined
      }

      const allHashedKeys = new Set([
        ...state.observers.keys(),
        ...queryToRows.keys(),
      ])

      // Force cleanup all queries (explicit cleanup path)
      // This ignores hasListeners and always cleans up
      for (const hashedKey of allHashedKeys) {
        forceCleanupQuery(hashedKey)
      }
      fetchStartGenerations.clear()
      unownedDirectWritePositions.clear()
      acceptedRowPositions.clear()

      // Unsubscribe from cache events (cleanup already happened above)
      unsubscribeQueryCache()

      // Removing a Query destroys it and synchronously cancels its retryer.
      // Finish this before a later collection sync can create a replacement.
      for (const query of [...trackedCacheQueries]) {
        const belongsToCleanup = [...getLogicalHashes(query)].some((hash) =>
          allHashedKeys.has(hash),
        )
        if (
          belongsToCleanup &&
          (syncMode === `eager` ||
            (ownedCacheQueries.has(query) && query.getObserversCount() === 0))
        ) {
          queryClient.getQueryCache().remove(query)
        }
      }
      for (const query of trackedCacheQueries) {
        const owners = queryCollectionCacheOwners.get(query)
        owners?.delete(cacheOwnerToken)
        if (
          (owners?.size ?? 0) === 0 &&
          queryClient.getQueryCache().get(query.queryHash) === query
        )
          watchPhysicalFetchAfterCleanup(queryClient, query)
      }
      trackedCacheQueries.clear()
      ownedCacheQueries = new WeakSet<AnyQuery>()
    }

    /**
     * Unload a query subset - the subscription-based cleanup path (on-demand mode).
     *
     * Called when a live query subscription unsubscribes (via collection._sync.unloadSubset()).
     *
     * Flow:
     * 1. Receives the options object for the acquisition being released
     * 2. Finds the physical Query chosen by that acquisition
     * 3. Decrements refcount
     * 4. If refcount reaches 0:
     *    - Checks hasListeners() to detect invalidateQueries cycles
     *    - If hasListeners is true: resets refcount (TanStack Query keeping observer alive)
     *    - If hasListeners is false: calls forceCleanupQuery() to perform row-level GC
     *
     * The hasListeners() check prevents premature cleanup during invalidateQueries:
     * - invalidateQueries causes temporary unsubscribe/resubscribe
     * - During unsubscribe, our refcount drops to 0
     * - But observer.hasListeners() is still true (TanStack Query's internal listeners)
     * - We skip cleanup and reset refcount, allowing resubscribe to succeed
     *
     * Ordinary in-flight requests may continue after this observer unsubscribes and remain
     * cached by TanStack Query. A pending explicit refetch is acquisition-scoped: releasing
     * its final owner rejects that caller and unsubscribes this observer, which lets Query
     * cancel the transport when no peer observer still owns it.
     */
    const unloadSubset = (options: LoadSubsetOptions) => {
      // No observer lease exists until startup maintenance has finished.
      const pending = pendingStartupLoads.get(options)
      if (pending) {
        pending.delete(pending.values().next().value!)
        if (pending.size === 0) pendingStartupLoads.delete(options)
        return
      }
      const routes = acquisitionRoutes.get(options)
      if (!routes?.length) return
      const route = routes.pop()!
      const { requestedHash, physicalHash: hashedQueryKey } = route
      if (routes.length === 0) acquisitionRoutes.delete(options)
      releaseAcquisitionRoute(route)
      if (
        hashedQueryKey === fullSourceHash &&
        requestedHash !== fullSourceHash
      ) {
        const dependentCount = fullSourceDependents.get(requestedHash)
        if (dependentCount === 1) fullSourceDependents.delete(requestedHash)
        else if (dependentCount !== undefined)
          fullSourceDependents.set(requestedHash, dependentCount - 1)
      }

      // 3. Decrement refcount
      const currentCount = queryRefCounts.get(hashedQueryKey) || 0
      const newCount = currentCount - 1

      // Update refcount
      if (newCount <= 0) {
        queryRefCounts.set(hashedQueryKey, 0)
        cleanupQueryIfIdle(hashedQueryKey)
      } else {
        // Still have other references, just decrement
        queryRefCounts.set(hashedQueryKey, newCount)
      }
    }

    const restartAfterScopedRecovery = async (
      cacheRotated: Promise<void>,
    ): Promise<void> => {
      // This portion must run before the persistence wrapper yields for the
      // rotation. Old Query callbacks and pending applications cannot write
      // into the replacement persisted cache generation.
      const recoveryEpoch = ++scopedRecoveryEpoch
      scopedRecoveryPending = true
      unsubscribeFromQueries()
      for (const hashedQueryKey of state.observers.keys()) {
        unsubscribePendingReadyListeners(hashedQueryKey)
        invalidatePendingResultApplication(hashedQueryKey)
      }

      await cacheRotated
      if (activeSyncSession !== syncSession) throw new CancelledError()
      // An earlier rotation cannot reopen callbacks while a later rotation
      // still owns the replacement cache boundary.
      if (recoveryEpoch !== scopedRecoveryEpoch) return

      // The wrapper has truncated the old public rows. Query's ownership and
      // retention records describe those rows, not the new generation.
      queryToRows.clear()
      rowToQueries.clear()
      retainedQueriesPendingRevalidation.clear()
      retainedRevalidationStarts.clear()
      directWriteKeyGenerations.clear()
      unownedDirectWritePositions.clear()
      acceptedRowPositions.clear()
      persistedRetentionTimers.forEach((timer) => clearTimeout(timer))
      persistedRetentionTimers.clear()
      requiredCacheGenerationFetchStart =
        queryClient.getQueryCache().currentSequence
      scopedRecoveryPending = false
      state.observers.forEach((observer, hashedQueryKey) => {
        if ((queryRefCounts.get(hashedQueryKey) ?? 0) > 0) {
          subscribeToQuery(observer, hashedQueryKey)
        }
      })
    }

    // Create deduplicated loadSubset wrapper for non-eager modes
    // This prevents redundant snapshot requests when multiple concurrent
    // live queries request overlapping or subset predicates
    const loadSubsetDedupe =
      syncMode === `eager`
        ? undefined
        : (options: LoadSubsetOptions): true | Promise<void> => {
            const result = createQueryFromOpts(options)
            const signal = options.signal
            if (!signal) return result
            if (result === true)
              return signal.aborted
                ? Promise.reject(new LoadSubsetOperationAbortedError())
                : true
            return new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                signal.removeEventListener(`abort`, onAbort)
                reject(new LoadSubsetOperationAbortedError())
              }
              signal.addEventListener(`abort`, onAbort, { once: true })
              void result.then(
                () => {
                  signal.removeEventListener(`abort`, onAbort)
                  if (signal.aborted) onAbort()
                  else resolve()
                },
                (error: unknown) => {
                  signal.removeEventListener(`abort`, onAbort)
                  if (signal.aborted) onAbort()
                  else reject(error)
                },
              )
              if (signal.aborted) onAbort()
            })
          }

    return {
      loadSubset: loadSubsetDedupe,
      unloadSubset: syncMode === `eager` ? undefined : unloadSubset,
      restartAfterScopedRecovery:
        syncMode === `on-demand` ? restartAfterScopedRecovery : undefined,
      cleanup,
    }
  }

  /**
   * Refetch the query data
   *
   * Uses queryObserver.refetch() because:
   * - Bypasses `enabled: false` to support manual/imperative refetch patterns (e.g., button-triggered fetch)
   * - Ensures clearError() works even when enabled: false
   * - Always refetches THIS specific collection (exact targeting via observer)
   * - Respects retry, retryDelay, and other observer options
   *
   * This matches TanStack Query's hook behavior where refetch() bypasses enabled: false.
   * See: https://tanstack.com/query/latest/docs/framework/react/guides/disabling-queries
   *
   * Used by both:
   * - utils.refetch() - for explicit user-triggered refetches
   * - Internal handlers (onInsert/onUpdate/onDelete) - after mutations to get fresh data
   *
   * Calls wait for each accepted Query result to be applied to Collection rows
   * unless a user mutation is persisting or its handler is active. Normal
   * publication is blocked behind that transaction, so those calls retain the
   * Query fetch boundary.
   *
   * @returns Promise that resolves with each QueryObserverResult
   */
  const refetchQueryResults = async (
    opts: Parameters<RefetchFn>[0],
    awaitApplications: boolean,
  ): ReturnType<RefetchFn> => {
    const allQueryKeys = [...hashToQueryKey.values()]

    // A replaced eager Query must reattach before refetch. An idle observer
    // on the same Query is applied explicitly below to avoid an extra fetch.
    ensureEagerSubscription()
    const syncSession = activeSyncSession
    const recoveryEpoch = scopedRecoveryEpoch
    const refetchPromises = allQueryKeys.map(async (trackedQueryKey) => {
      if (scopedRecoveryPending) throw new CancelledError()
      const hashedQueryKey = hashKey(trackedQueryKey)
      const queryObserver = state.observers.get(hashedQueryKey)
      if (!queryObserver) return undefined
      const readExceptionalSettlement = getExceptionalResultSettlement

      let query = queryObserver.getCurrentQuery()
      let startingResult: QueryObserverResult<any, any>
      let fetchRecord: FetchApplicationRecord | undefined
      let replaced = false
      let result: QueryObserverResult<any, any> =
        queryObserver.getCurrentResult()
      try {
        cancelPreWriteFetch(query, hashedQueryKey)
        const capture: RefetchCapture = { query }
        const previousCapture = activeRefetchCapture
        activeRefetchCapture = capture
        let fetch: ReturnType<typeof queryObserver.refetch>
        try {
          fetch = queryObserver.refetch({
            throwOnError: opts?.throwOnError,
          })
        } finally {
          activeRefetchCapture = previousCapture
        }
        query = queryObserver.getCurrentQuery()
        // Query.fetch can turn a reverted cancellation into old data, and a
        // silent replacement into the successor's result. Its own retryer
        // promise retains which happened to this call's physical fetch.
        let activeFetch = capture.promise ?? query.promise
        if (!activeFetch) throw new Error(`Query refetch started no fetch`)
        let fetchCancellation =
          capture.cancellation ?? observeCancellation(activeFetch)
        startingResult = queryObserver.getCurrentResult()
        const fetchStart =
          capture.fetchStart ?? queryCollectionCurrentFetchStarts.get(query)
        if (fetchStart !== undefined) {
          fetchRecord = getFetchApplicationRecord(
            query,
            fetchStart,
            hashedQueryKey,
          )
        }
        const fetchOutcome = fetch.then(
          (value) => ({ type: `success` as const, value }),
          (error: unknown) => ({ type: `error` as const, error }),
        )
        let cancellation = await fetchCancellation
        if (
          awaitApplications &&
          opts?.throwOnError &&
          activeSyncSession === syncSession &&
          cancellation?.revert
        ) {
          throw new LoadSubsetOperationAbortedError()
        }
        let fetchError: unknown
        let fetchFailed = false
        while (cancellation?.silent) {
          replaced = true
          // Query Core may settle the original observer call from an older
          // result after a second replacement. Follow the physical successor
          // instead of treating that old settlement as this call's result.
          const successor = capture.query.promise
          if (!successor || successor === activeFetch) throw cancellation
          activeFetch = successor
          fetchCancellation = observeCancellation(activeFetch)
          try {
            await activeFetch
            fetchError = undefined
            fetchFailed = false
          } catch (error) {
            fetchError = error
            fetchFailed = true
          }
          cancellation = await fetchCancellation
          result = queryObserver.getCurrentResult()
        }
        if (!replaced) {
          const outcome = await fetchOutcome
          if (outcome.type === `error`) {
            fetchError = outcome.error
            fetchFailed = true
            result = queryObserver.getCurrentResult()
          } else {
            result = outcome.value
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Recovery can start while this fetch is pending.
        if (scopedRecoveryPending || recoveryEpoch !== scopedRecoveryEpoch) {
          throw new CancelledError()
        }
        // A later independent fetch cannot make this reverted fetch succeed.
        if (
          awaitApplications &&
          opts?.throwOnError &&
          activeSyncSession === syncSession &&
          cancellation?.revert
        ) {
          throw new LoadSubsetOperationAbortedError()
        }
        if (fetchFailed && opts?.throwOnError) throw fetchError
        if (replaced) {
          // Query Core makes this call follow a replacement. Its old record
          // cannot supply the returned result or its application settlement.
          const successorStart = queryCollectionSuccessfulFetchStarts.get(query)
          fetchRecord =
            successorStart === undefined
              ? undefined
              : getFetchApplicationRecord(query, successorStart, hashedQueryKey)
        }
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Recovery can start while this fetch is pending.
        if (scopedRecoveryPending || recoveryEpoch !== scopedRecoveryEpoch) {
          throw new CancelledError()
        }
        const currentResult = queryObserver.getCurrentResult()
        const appliedUnsubscribed = applyRefetchResultWhenUnsubscribed(
          hashedQueryKey,
          currentResult,
        )
        const causalResult = appliedUnsubscribed
          ? currentResult
          : (fetchRecord?.result ?? currentResult)
        if (fetchRecord) {
          fetchRecord.result = causalResult
          fetchRecord.settlement ??= getRecordedResultApplicationSettlement(
            hashedQueryKey,
            causalResult,
          )
        }
        throw error
      }

      const causalResult =
        fetchRecord?.terminal && fetchRecord.result
          ? fetchRecord.result
          : result
      applyRefetchResultWhenUnsubscribed(hashedQueryKey, causalResult)
      if (fetchRecord) {
        fetchRecord.result = causalResult
        fetchRecord.settlement ??= getRecordedResultApplicationSettlement(
          hashedQueryKey,
          causalResult,
        )
      }

      // Query observers can report success before the Query cache records the
      // fetch authority used by the result handler. Let that queued handler
      // classify this result before reading its exceptional settlement.
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      const exceptionalSettlement =
        readExceptionalSettlement(causalResult) ??
        readExceptionalSettlement(result)
      const settlement =
        (replaced ? fetchRecord?.settlement : undefined) ??
        getRecordedResultApplicationSettlement(hashedQueryKey, causalResult) ??
        getRecordedResultApplicationSettlement(hashedQueryKey, startingResult)
      if (
        activeSyncSession !== syncSession &&
        exceptionalSettlement === undefined &&
        settlement === undefined
      ) {
        throw new CancelledError()
      }
      if (awaitApplications) {
        if (exceptionalSettlement?.type === `rejected`) {
          throw exceptionalSettlement.error
        }
        if (exceptionalSettlement?.type === `pending`) {
          const replacement = await exceptionalSettlement.promise
          if (recoveryEpoch !== scopedRecoveryEpoch) {
            throw new CancelledError()
          }
          if (!replacement.isSuccess && opts?.throwOnError) {
            throw replacement.error
          }
          return replacement
        }
      }

      if (awaitApplications && !isMutationPublicationBlocked() && settlement) {
        if (opts?.throwOnError) {
          await settlement
        } else {
          await settlement.catch(() => undefined)
        }
      }
      if (recoveryEpoch !== scopedRecoveryEpoch) throw new CancelledError()
      return causalResult
    })

    return await Promise.all(refetchPromises)
  }

  const isMutationPublicationBlocked = (): boolean => {
    if (activeMutationHandlerCount > 0) return true
    for (const transaction of writeContext?.collection._state.transactions.values() ??
      []) {
      if (transaction.state === `persisting`) return true
    }
    return false
  }

  const refetch: RefetchFn = (opts) =>
    refetchQueryResults(opts, !isMutationPublicationBlocked())

  const ownedByAnotherCollection = (query: AnyQuery): boolean => {
    for (const owner of queryCollectionCacheOwners.get(query) ?? []) {
      if (owner !== cacheOwnerToken) return true
    }
    return false
  }

  /**
   * Updates a single query key in the cache with new items, handling both direct arrays
   * and wrapped response formats (when `select` is used).
   */
  const updateCacheDataForKey = (
    key: QueryKey,
    items: Array<any>,
    selectedItems?: Array<any>,
    attribution?:
      | { kind: `direct`; position: number }
      | { kind: `fetched`; fetchStart: number; sourceStart: number },
  ): boolean => {
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: key, exact: true })
    const markUnpatchable = (): void => {
      if (query) unpatchedCacheVersions.set(query, query.state.dataUpdateCount)
    }
    if (syncMode === `on-demand` && query && ownedByAnotherCollection(query)) {
      // Neither a local write nor its merge with an older fetch can become
      // another Collection's fetched result through the shared cache.
      markUnpatchable()
      return false
    }
    if (
      query?.state.status === `pending` &&
      query.state.fetchStatus !== `idle`
    ) {
      // An unfinished request cannot be completed by a direct write. An idle
      // eager raw-row cache still participates in the cache-seeding contract.
      markUnpatchable()
      return false
    }
    const writeCache = (data: unknown): void => {
      if (query) {
        queryCollectionCachePatches.set(query, {
          owner: cacheOwnerToken,
          session: activeSyncSession,
          data,
          attribution,
        })
        // An idle eager seed needs a coherent Query status. Keep its zero
        // freshness timestamp; other edits preserve fetch and error state.
        query.setState(
          query.state.status === `pending`
            ? { data, status: `success` }
            : { data },
        )
        unpatchedCacheVersions.delete(query)
      } else {
        queryClient.setQueryData(key, data)
        const seededQuery = queryClient
          .getQueryCache()
          .find({ queryKey: key, exact: true })
        if (seededQuery)
          queryCollectionCachePatches.set(seededQuery, {
            owner: cacheOwnerToken,
            session: activeSyncSession,
            data,
            attribution,
          })
      }
    }
    if (select) {
      const oldData = query?.state.data
      if (!oldData || typeof oldData !== `object`) {
        markUnpatchable()
        return false
      }
      if (Array.isArray(oldData)) {
        writeCache(items)
        return true
      }

      // Only a direct array property can be replaced without an inverse for
      // select. A derived projection may change each row's response shape.
      const selectedArray = selectedItems ?? select(oldData)
      if (!Array.isArray(selectedArray)) {
        markUnpatchable()
        return false
      }
      const property = Object.keys(oldData).find(
        (name) => (oldData as Record<string, unknown>)[name] === selectedArray,
      )
      if (property === undefined) {
        markUnpatchable()
        return false
      }
      writeCache({ ...oldData, [property]: items })
      return true
    } else {
      // Raw row writes must not overwrite a different cache format. Avoid even
      // a no-op setQueryData: it marks unrelated data fresh and clears invalidation.
      const previous = query?.state.data
      if (previous === undefined || Array.isArray(previous)) {
        writeCache(items)
        return true
      }
      return false
    }
  }

  // A direct write takes its position when it is called, so a fetch that
  // starts later counts as newer even if the write applies later.
  const reserveDirectWrite = (): number => {
    directWriteGeneration = queryClient.getQueryCache().reserveSequence()
    // A query that is not fetching holds no rows older than this write. A
    // deferred result keeps its own fetch start until it is merged.
    for (const [hashedQueryKey, observer] of state.observers) {
      if (
        observer.getCurrentQuery().state.fetchStatus !== `fetching` &&
        !pendingResultApplications.has(hashedQueryKey)
      )
        fetchStartGenerations.set(hashedQueryKey, directWriteGeneration)
    }
    return directWriteGeneration
  }

  // Only an accepted write gains precedence over an older fetch.
  const claimDirectWriteKeys = (
    keys: Array<string | number>,
    position: number,
  ): void => {
    // Only a fetch in flight, or a deferred result, can return rows older
    // than this write. Without one, the per-key positions are not needed.
    let older =
      deferredResults > 0 ||
      pendingDirectWrites !== undefined ||
      pendingResultApplications.size > 0
    if (!older) {
      for (const query of trackedCacheQueries) {
        if (query.state.fetchStatus === `fetching`) {
          older = true
          break
        }
      }
    }
    if (!older) directWriteKeyGenerations.clear()
    else for (const key of keys) directWriteKeyGenerations.set(key, position)
  }

  const noteWaitingDirectWrite = (waiting: Promise<void>): void => {
    const tail: Promise<void> = Promise.all([
      pendingDirectWrites,
      waiting,
    ]).then(
      () => {
        if (pendingDirectWrites === tail) pendingDirectWrites = undefined
      },
      () => {
        if (pendingDirectWrites === tail) pendingDirectWrites = undefined
      },
    )
    pendingDirectWrites = tail
  }

  const updateCacheData: UpdateCacheData<any> = (
    getItems,
    changedKeys,
    position,
  ) => {
    writingDirectCache = true
    try {
      const acceptedItems = getItems(changedKeys)
      const accepted = new Map(
        acceptedItems.map((item) => [getKey(item), item]),
      )
      writeDirectCache(getItems, changedKeys, accepted, position)
      // A deleted row ends its fetched ownership lifetime. A later direct
      // insert of the same key must not inherit that old subset's owners.
      for (const key of changedKeys) {
        if (accepted.has(key)) {
          acceptedRowPositions.set(key, {
            kind: `direct`,
            acceptance: position,
          })
          if ((rowToQueries.get(key)?.size ?? 0) === 0)
            unownedDirectWritePositions.set(key, position)
          else unownedDirectWritePositions.delete(key)
          continue
        }
        unownedDirectWritePositions.delete(key)
        acceptedRowPositions.delete(key)
        for (const owner of [...(rowToQueries.get(key) ?? [])]) {
          removeRowOwner(key, owner)
        }
      }
    } finally {
      writingDirectCache = false
    }
  }

  // A direct write patches keys already present in active on-demand cache
  // entries. It cannot infer membership or window replacements from one row,
  // so inserted rows acquire no subset owner. Inactive entries under the base
  // key are removed so a later owner fetches its scope instead of reviving
  // stale rows. Unrelated Query entries belong outside that key prefix.
  // Eager collections retain their full-result cache patch.
  const writeDirectCache = (
    getItems: Parameters<UpdateCacheData<any>>[0],
    changedKeys: Array<string | number>,
    accepted: Map<string | number, any>,
    position: number,
  ): void => {
    const changed = new Set(changedKeys)
    const patchRows = (rows: Array<any>) => {
      const present = new Set<string | number>()
      let touched = false
      const patched = rows.flatMap((row) => {
        const key = getKey(row)
        present.add(key)
        if (!changed.has(key)) return [row]
        touched = true
        const next = accepted.get(key)
        return next === undefined ? [] : [next]
      })
      return { patched, present, touched }
    }

    if (syncMode === `on-demand`) {
      const affectedOwners = new Set(
        changedKeys.flatMap((key) => [...(rowToQueries.get(key) ?? [])]),
      )
      const activeQueries = new Set<AnyQuery>()

      for (const [hashedQueryKey, observer] of state.observers) {
        const query = observer.getCurrentQuery()
        if (activeQueries.has(query)) continue
        // Resolved disjoint scopes cannot contain this accepted key. A query
        // still fetching or awaiting its first result may hold provisional
        // cached rows, so inspect those entries before their owner is known.
        if (
          !affectedOwners.has(hashedQueryKey) &&
          queryToRows.has(hashedQueryKey) &&
          query.state.fetchStatus !== `fetching` &&
          !pendingResultApplications.has(hashedQueryKey)
        )
          continue
        activeQueries.add(query)
        const data = query.state.data
        const rows = select && data !== undefined ? select(data) : data
        if (!Array.isArray(rows)) continue
        const { patched, touched } = patchRows(rows)
        if (!touched) continue
        updateCacheDataForKey(query.queryKey, patched, rows, {
          kind: `direct`,
          position,
        })
      }

      for (const query of [...trackedCacheQueries]) {
        if (activeQueries.has(query)) continue
        if (ownedByAnotherCollection(query) || query.getObserversCount() > 0)
          continue
        queryClient.getQueryCache().remove(query)
      }
      return
    }

    const allCached = [...trackedCacheQueries]

    if (allCached.length > 0) {
      for (const query of allCached) {
        const data = query.state.data
        const rows = select && data !== undefined ? select(data) : data
        if (!Array.isArray(rows)) {
          updateCacheDataForKey(query.queryKey, getItems(), undefined, {
            kind: `direct`,
            position,
          })
          continue
        }
        const { patched, present } = patchRows(rows)
        for (const key of changedKeys) {
          const next = accepted.get(key)
          if (!present.has(key) && next !== undefined) patched.push(next)
        }
        updateCacheDataForKey(query.queryKey, patched, rows, {
          kind: `direct`,
          position,
        })
      }
    } else {
      // Fallback: no queries in cache yet, seed the base query key.
      // This handles the case where updateCacheData is called before any queries are created.
      updateCacheDataForKey(baseKey, getItems(), undefined, {
        kind: `direct`,
        position,
      })
    }
  }

  // Create write context for manual write operations
  let writeContext: {
    collection: any
    queryClient: QueryClient
    queryKey: Array<unknown>
    getKey: (item: any) => string | number
    begin: () => void
    write: (message: Omit<ChangeMessage<any>, `key`>) => void
    commit: () => SyncAppliedReceipt
    updateCacheData?: UpdateCacheData<any>
    reserveDirectWrite?: () => number
    claimDirectWriteKeys?: (
      keys: Array<string | number>,
      position: number,
    ) => void
    noteWaitingDirectWrite?: (waiting: Promise<void>) => void
    earlierCommits?: () => Promise<void> | undefined
  } | null = null

  // Enhanced internalSync that captures write functions for manual use
  const enhancedInternalSync: SyncConfig<any>[`sync`] = (syncParams) => {
    // A direct write validates against every earlier commit, so track when
    // the last commit is accepted.
    let earlierCommits: Promise<void> | undefined
    const commit: typeof syncParams.commit = (signal) => {
      const applied = syncParams.commit(signal)
      const accepted = whenSyncAccepted(applied)
      if (accepted !== true) {
        const tail = accepted.then(
          () => {
            if (earlierCommits === tail) earlierCommits = undefined
          },
          () => {
            if (earlierCommits === tail) earlierCommits = undefined
          },
        )
        earlierCommits = tail
      }
      return applied
    }
    const params = { ...syncParams, commit }
    const { begin, write, collection } = params
    let queryClientMounted = false

    const mountQueryClient = () => {
      if (!queryClientMounted) {
        queryClient.mount()
        queryClientMounted = true
      }
    }

    const unmountQueryClient = () => {
      if (queryClientMounted) {
        queryClient.unmount()
        queryClientMounted = false
      }
    }

    mountQueryClient()

    // Get the base query key for the context (handle both static and function-based keys)
    const contextQueryKey =
      typeof queryKey === `function`
        ? (queryKey({}) as unknown as Array<unknown>)
        : (queryKey as unknown as Array<unknown>)

    // Store references for manual write operations
    const currentWriteContext = {
      collection,
      queryClient,
      queryKey: contextQueryKey,
      getKey: getKey as (item: any) => string | number,
      begin,
      write,
      commit,
      updateCacheData,
      reserveDirectWrite,
      claimDirectWriteKeys,
      noteWaitingDirectWrite,
      earlierCommits: () => earlierCommits,
    }
    writeContext = currentWriteContext

    // Call the original internalSync logic, pairing QueryClient mount with the
    // collection sync lifecycle so focus/reconnect managers dispatch events for
    // standalone QueryClient usage.
    const syncResult = internalSync(params)
    const sync =
      typeof syncResult === `function`
        ? { cleanup: syncResult }
        : typeof syncResult === `object`
          ? syncResult
          : {}

    return {
      ...sync,
      cleanup: () => {
        if (writeContext === currentWriteContext) writeContext = null
        return runCleanupWithLocalTeardown(sync.cleanup, unmountQueryClient)
      },
    }
  }

  // Create write utils using the manual-sync module
  const writeUtils = createWriteUtils<any, string | number, any>(
    () => writeContext,
  )

  // Helper to handle deprecated auto-refetch behavior with warnings
  async function handleDeprecatedAutoRefetch(
    handlerResult: unknown,
  ): Promise<void> {
    const canHaveProperties =
      (typeof handlerResult === `object` && handlerResult !== null) ||
      typeof handlerResult === `function`
    const explicitRefetchFalse =
      canHaveProperties &&
      'refetch' in handlerResult &&
      (handlerResult as Record<string, unknown>).refetch === false

    if (explicitRefetchFalse) {
      return
    } else {
      warnOnce(
        'query-collection-auto-refetch',
        '[TanStack DB] DEPRECATED: QueryCollection handlers currently auto-refetch after completion. ' +
          'This behavior will be removed in v1.0. To prepare: ' +
          '(1) Add `await collection.utils.refetch()` and temporarily return `{ refetch: false }` to avoid a second refetch, or ' +
          "(2) Return `{ refetch: false }` to opt out now if you don't need it. " +
          'See: https://tanstack.com/db/latest/docs/collections/query-collection#controlling-refetch-behavior',
      )
      await refetchQueryResults(undefined, false)
    }
  }

  const runMutationHandler = async <TParams>(
    handler: (params: TParams) => unknown,
    params: TParams,
  ): Promise<unknown> => {
    activeMutationHandlerCount++
    try {
      return await handler(params)
    } finally {
      activeMutationHandlerCount--
    }
  }

  // Create wrapper handlers for direct persistence operations that handle refetching
  // These wrappers process deprecated return values but don't pass them through
  const wrappedOnInsert = onInsert
    ? async (
        params: Parameters<NonNullable<typeof onInsert>>[0],
      ): Promise<void> => {
        const handlerResult = (await runMutationHandler(onInsert, params)) ?? {}
        await handleDeprecatedAutoRefetch(handlerResult)
      }
    : undefined

  const wrappedOnUpdate = onUpdate
    ? async (
        params: Parameters<NonNullable<typeof onUpdate>>[0],
      ): Promise<void> => {
        const handlerResult = (await runMutationHandler(onUpdate, params)) ?? {}
        await handleDeprecatedAutoRefetch(handlerResult)
      }
    : undefined

  const wrappedOnDelete = onDelete
    ? async (
        params: Parameters<NonNullable<typeof onDelete>>[0],
      ): Promise<void> => {
        const handlerResult = (await runMutationHandler(onDelete, params)) ?? {}
        await handleDeprecatedAutoRefetch(handlerResult)
      }
    : undefined

  // Create utils instance with state and dependencies passed explicitly
  const utils: QueryCollectionUtils = new QueryCollectionUtilsImpl(
    state,
    refetch,
    writeUtils,
  )

  const sync = withCollectionSyncConfigFactory(
    { sync: enhancedInternalSync },
    (source, utilities, startSyncIfIdle) => {
      const boundUtilities = utilities as Record<
        string,
        (...args: Array<any>) => any
      >
      for (const name of Object.keys(writeUtils)) {
        const write = boundUtilities[name]!
        boundUtilities[name] = (...args) => {
          startSyncIfIdle()
          return write(...args)
        }
      }
      return source
    },
  )

  const options = {
    ...baseCollectionConfig,
    getKey,
    syncMode,
    sync,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils,
  }

  return withCollectionConfigFactory(
    options,
    (client) =>
      queryCollectionOptions({
        ...config,
        queryClient:
          client.getDependency<QueryClient>(`queryClient`) ??
          config.queryClient,
        id: options.id,
      }) as typeof options,
  )
}
