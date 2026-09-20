import { QueryObserver, hashKey, partialMatchKey } from '@tanstack/query-core'
import {
  LoadSubsetOperationAbortedError,
  deepEquals,
  getLoadSubsetDemandKey,
  warnOnce,
  withCollectionConfigFactory,
  withCollectionSyncConfigFactory,
} from '@tanstack/db'
import {
  GetKeyRequiredError,
  InitialDataInOnDemandModeError,
  QueryClientRequiredError,
  QueryFnRequiredError,
  QueryKeyRequiredError,
} from './errors'
import { createWriteUtils } from './manual-sync'
import type {
  BaseCollectionConfig,
  ChangeMessage,
  CollectionConfig,
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfig,
  SyncMetadataApi,
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
 * Returns the QueryObserverResult from TanStack Query
 */
export type RefetchFn = (opts?: {
  throwOnError?: boolean
}) => Promise<Array<QueryObserverResult<any, any> | void>>

/**
 * Utility methods available on Query Collections for direct writes and manual operations.
 * Direct writes bypass optimistic mutations and write to the synced data store.
 * Eager collections patch Query cache; on-demand collections revalidate scoped entries.
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
  /** Manually trigger a refetch of the query */
  refetch: RefetchFn
  /** Insert items without an optimistic update. On-demand queries revalidate their scoped cache entries. */
  writeInsert: (data: TInsertInput | Array<TInsertInput>) => void
  /** Update items without an optimistic update. On-demand queries revalidate their scoped cache entries. */
  writeUpdate: (updates: Partial<TItem> | Array<Partial<TItem>>) => void
  /** Delete items without an optimistic update. On-demand queries revalidate their scoped cache entries. */
  writeDelete: (keys: TKey | Array<TKey>) => void
  /** Insert or update items without an optimistic update. On-demand queries revalidate their scoped cache entries. */
  writeUpsert: (data: Partial<TItem> | Array<Partial<TItem>>) => void
  /** Execute direct writes as one atomic batch, then update or revalidate the Query cache */
  writeBatch: (callback: () => void) => void

  // Query Observer State (getters)
  /** Get the last error encountered by the query (if any); reset on success */
  lastError: TError | undefined
  /** Check if the collection is in an error state */
  isError: boolean
  /**
   * Get the number of consecutive sync failures.
   * Incremented only when query fails completely (not per retry attempt); reset on success.
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
  /** Get current fetch status */
  fetchStatus: `fetching` | `paused` | `idle`

  /**
   * Clear the error state and trigger a refetch of the query
   * @returns Promise that resolves when the refetch completes successfully
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
  lastErrorUpdatedAt: number
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

let nextQueryCollectionFetchStart = 0
const queryCollectionFetchActionStarts = new WeakMap<object, number>()
const queryCollectionCurrentFetchStarts = new WeakMap<AnyQuery, number>()
const queryCollectionSuccessfulFetchStarts = new WeakMap<AnyQuery, number>()
const queryCollectionRequiredFetchStarts = new WeakMap<AnyQuery, number>()
const queryCollectionCacheOwners = new WeakMap<AnyQuery, Set<object>>()

type PersistedScannedRowForQuery<TItem extends object> = {
  key: string | number
  value: TItem
  metadata?: unknown
}

type QuerySyncMetadataWithPersistedScan<TItem extends object> = SyncMetadataApi<
  string | number
> & {
  row: SyncMetadataApi<string | number>[`row`] & {
    scanPersisted?: (options?: {
      metadataOnly?: boolean
    }) => Promise<Array<PersistedScannedRowForQuery<TItem>>>
  }
}

/**
 * Implementation class for QueryCollectionUtils with explicit dependency injection
 * for better testability and architectural clarity
 */
class QueryCollectionUtilsImpl {
  private state: QueryCollectionState
  private refetchFn: RefetchFn

  // Write methods
  public refetch: RefetchFn
  public writeInsert: any
  public writeUpdate: any
  public writeDelete: any
  public writeUpsert: any
  public writeBatch: any

  constructor(
    state: QueryCollectionState,
    refetch: RefetchFn,
    writeUtils: ReturnType<typeof createWriteUtils>,
  ) {
    this.state = state
    this.refetchFn = refetch

    // Initialize methods to use passed dependencies
    this.refetch = refetch
    this.writeInsert = writeUtils.writeInsert
    this.writeUpdate = writeUtils.writeUpdate
    this.writeDelete = writeUtils.writeDelete
    this.writeUpsert = writeUtils.writeUpsert
    this.writeBatch = writeUtils.writeBatch
  }

  public async clearError() {
    this.state.lastError = undefined
    this.state.errorCount = 0
    this.state.lastErrorUpdatedAt = 0
    await this.refetchFn({ throwOnError: true })
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

  public get fetchStatus(): Array<FetchStatus> {
    return Array.from(this.state.observers.values()).map(
      (observer) => observer.getCurrentResult().fetchStatus,
    )
  }
}

function getLoadSubsetOptionsForMeta(
  opts: LoadSubsetOptions,
): Omit<LoadSubsetOptions, `subscription`> {
  const { subscription: _subscription, ...serializableOptions } = opts
  return serializableOptions
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

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!getKey) {
    throw new GetKeyRequiredError()
  }

  /** State object to hold error tracking and observer reference */
  const state: QueryCollectionState = {
    lastError: undefined as any,
    errorCount: 0,
    lastErrorUpdatedAt: 0,
    observers: new Map<
      string,
      QueryObserver<Array<any>, any, Array<any>, Array<any>, any>
    >(),
  }

  // Query-cache ownership is scoped to this sync generation and keyed by the
  // actual Query object. Weak membership survives subset unload without
  // retaining entries after Query Core garbage-collects them.
  let ownedCacheQueries = new WeakSet<AnyQuery>()
  const cacheOwnerToken = {}
  let trackedCacheQueries: Set<AnyQuery>
  const logicalHashesByQuery = new WeakMap<AnyQuery, Set<string>>()

  // Manual writes require a successful fetch which started after the write.
  // Observe Query Core's fetch/success actions so foreign query functions and
  // initialPromise fetches count, while cancelled/reverted requests do not.
  const requiredFetchStarts = new Map<string, number>()
  const postWriteRefetchGenerations = new Map<string, number>()

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

  const hasPostWriteAuthority = (
    hashedQueryKey: string,
    query: AnyQuery,
  ): boolean => {
    const localRequiredStart = requiredFetchStarts.get(hashedQueryKey)
    const sharedRequiredStart = queryCollectionRequiredFetchStarts.get(query)
    const requiredStart = Math.max(
      localRequiredStart ?? 0,
      sharedRequiredStart ?? 0,
    )
    return (
      (localRequiredStart === undefined && sharedRequiredStart === undefined) ||
      (queryCollectionSuccessfulFetchStarts.get(query) ?? 0) > requiredStart
    )
  }

  const requirePostWriteAuthority = (
    hashedQueryKey: string,
    query: AnyQuery,
  ): number => {
    requiredFetchStarts.set(hashedQueryKey, nextQueryCollectionFetchStart)
    queryCollectionRequiredFetchStarts.set(
      query,
      Math.max(
        queryCollectionRequiredFetchStarts.get(query) ?? 0,
        nextQueryCollectionFetchStart,
      ),
    )
    const generation =
      (postWriteRefetchGenerations.get(hashedQueryKey) ?? 0) + 1
    postWriteRefetchGenerations.set(hashedQueryKey, generation)
    return generation
  }

  const isObserverEnabled = (
    observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
  ): boolean => {
    const observerEnabled = observer.options.enabled
    return typeof observerEnabled === `function`
      ? observerEnabled(observer.getCurrentQuery()) !== false
      : observerEnabled !== false
  }

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
  const manualWriteSnapshots = new Map<
    string,
    { data: unknown; dataUpdateCount: number }
  >()

  // queryKey → reference count (how many loadSubset calls are active)
  // Reference counting for QueryObserver lifecycle management
  // =========================================================
  // Tracks how many live query subscriptions are using each QueryObserver.
  // Multiple live queries with identical predicates share the same QueryObserver for efficiency.
  //
  // Lifecycle:
  // - Increment: when createQueryFromOpts creates or reuses an observer
  // - Decrement: when subscription.unsubscribe() passes predicates to collection._sync.unloadSubset()
  // - Reset: when cleanupQuery() is triggered by TanStack Query's cache GC
  //
  // When refcount reaches 0, unloadSubset():
  // 1. Computes the same queryKey from the predicates
  // 2. Uses existing machinery (queryToRows map) to find rows that query loaded
  // 3. Decrements refcount and GCs rows where count reaches 0
  const queryRefCounts = new Map<string, number>()

  // Eager startup holds one reference until cleanup. Cache removal detaches
  // observation, not that ownership or its rows.
  let ensureEagerSubscription = () => {}

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
    // Rebuild on every start so caches created while sync was stopped are owned.
    trackedCacheQueries = new Set(
      queryClient.getQueryCache().findAll({ queryKey: baseKey }),
    )
    const { begin, write, commit, markReady, markError, collection, metadata } =
      params
    const persistedMetadata = metadata as
      | QuerySyncMetadataWithPersistedScan<any>
      | undefined

    // Track whether sync has been started
    let syncStarted = false
    let startupRetentionSettled = false
    const pendingStartupLoads = new Map<LoadSubsetOptions, Set<object>>()
    const retainedQueriesPendingRevalidation = new Set<string>()
    const pendingResultApplications = new Map<string, Promise<void>>()
    const failedResultApplications = new Map<string, unknown>()
    type ResultApplicationController = AbortController & {
      rollback?: () => void
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
        | Record<string, unknown>
        | undefined
    }

    const getPersistedOwners = (rowKey: string | number) => {
      const rowMetadata = getRowMetadata(rowKey)
      const queryMetadata = rowMetadata?.queryCollection
      if (!queryMetadata || typeof queryMetadata !== `object`) {
        return new Set<string>()
      }

      const owners = (queryMetadata as Record<string, unknown>).owners
      if (!owners || typeof owners !== `object`) {
        return new Set<string>()
      }

      return new Set(Object.keys(owners as Record<string, true>))
    }

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

      const ownedRows = new Set<string | number>()
      for (const [rowKey] of collection._state.syncedData.entries()) {
        const owners = getPersistedOwners(rowKey)
        if (owners.size === 0) {
          continue
        }

        addRowOwners(rowKey, owners)

        if (owners.has(hashedQueryKey)) {
          ownedRows.add(rowKey)
        }
      }
      return ownedRows
    }

    const loadPersistedBaselineForQuery = async (
      hashedQueryKey: string,
    ): Promise<
      Map<
        string | number,
        {
          value: any
          owners: Set<string>
        }
      >
    > => {
      const knownRows = queryToRows.get(hashedQueryKey)
      if (
        knownRows &&
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

      const scanPersisted = persistedMetadata?.row.scanPersisted
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

        if (ownerSet.has(hashedQueryKey)) {
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

      const baseline = await loadPersistedBaselineForQuery(hashedQueryKey)
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
        persistedRetentionTimers.delete(entry.queryHash)
        void runPersistedRetentionMaintenance(async () => {
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

    /**
     * Generate a consistent query key from LoadSubsetOptions.
     * CRITICAL: Must use identical logic in both createQueryFromOpts and unloadSubset
     * so that refcount increment/decrement operations target the same hashedQueryKey.
     * Inconsistent keys would cause refcount leaks and prevent proper cleanup.
     */
    const generateQueryKeyFromOptions = (opts: LoadSubsetOptions): QueryKey => {
      if (typeof queryKey === `function`) {
        // Function-based queryKey: use it to build the key from opts
        return queryKey(opts)
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
    ): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const unsubscribe = observer.subscribe((result) => {
          // Use a microtask in case `subscribe` is called synchronously, before `unsubscribe` is initialized
          queueMicrotask(() => {
            const query = observer.getCurrentQuery()
            if (
              (result.isSuccess &&
                hasPostWriteAuthority(hashedQueryKey, query) &&
                !collection.deferDataRefresh) ||
              (result.isError && !result.isFetching)
            ) {
              unsubscribe()
              const pending = pendingReadyUnsubscribes.get(hashedQueryKey)
              pending?.delete(cancel)
              if (pending?.size === 0) {
                pendingReadyUnsubscribes.delete(hashedQueryKey)
              }

              if (result.isSuccess) {
                resolve()
              } else {
                reject(result.error)
              }
            }
          })
        })
        const cancel = () => {
          unsubscribe()
          reject(new LoadSubsetOperationAbortedError())
        }
        const pending =
          pendingReadyUnsubscribes.get(hashedQueryKey) ?? new Set()
        pending.add(cancel)
        pendingReadyUnsubscribes.set(hashedQueryKey, pending)
      })

    const waitForQueryReadyAndApplied = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
    ): Promise<void> =>
      waitForQueryReady(observer, hashedQueryKey).then(() => {
        const settlement = getResultApplicationSettlement(hashedQueryKey)
        return settlement === true ? undefined : settlement
      })

    const createQueryFromOpts = (
      opts: LoadSubsetOptions = {},
      queryFunction: typeof queryFn = queryFn,
    ): true | Promise<void> => {
      if (!startupRetentionSettled) {
        // Immutable request data may be reused; ownership belongs to each call.
        const acquisition = {}
        const pending = pendingStartupLoads.get(opts) ?? new Set<object>()
        pending.add(acquisition)
        pendingStartupLoads.set(opts, pending)
        return startupRetentionMaintenancePromise.then(() => {
          if (!pendingStartupLoads.get(opts)?.delete(acquisition)) {
            throw new LoadSubsetOperationAbortedError()
          }
          if (pending.size === 0) pendingStartupLoads.delete(opts)
          const resumed = createQueryFromOpts(opts, queryFunction)
          return resumed === true ? undefined : resumed
        })
      }

      // Generate key using common function
      const key = generateQueryKeyFromOptions(opts)
      const hashedQueryKey = hashKey(key)
      const extendedMeta = {
        ...meta,
        loadSubsetOptions: getLoadSubsetOptionsForMeta(opts),
      }
      const retainedEntry = metadata?.collection.get(
        `${QUERY_COLLECTION_GC_PREFIX}${hashedQueryKey}`,
      )
      if (
        parsePersistedQueryRetentionEntry(retainedEntry, hashedQueryKey) !==
        undefined
      ) {
        retainedQueriesPendingRevalidation.add(hashedQueryKey)
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

        // Get the current result and return based on its state
        const observer = state.observers.get(hashedQueryKey)!
        const currentResult = observer.getCurrentResult()

        if (
          currentResult.isSuccess &&
          hasPostWriteAuthority(hashedQueryKey, observer.getCurrentQuery())
        ) {
          if (collection.deferDataRefresh) {
            return waitForQueryReadyAndApplied(observer, hashedQueryKey)
          }
          return getResultApplicationSettlement(hashedQueryKey)
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
        queryFn: queryFunction,
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
      const localQuery = localObserver.getCurrentQuery()
      trackOwnedCacheQuery(localQuery, hashedQueryKey)
      const resolvedQueryGcTime = queryClient.getQueryCache().find({
        queryKey: key,
        exact: true,
      })?.gcTime
      const effectivePersistedGcTime = persistedGcTime ?? resolvedQueryGcTime

      hashToQueryKey.set(hashedQueryKey, key)
      state.observers.set(hashedQueryKey, localObserver)
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

      // Check if data already exists in QueryClient cache (persisted within gcTime from
      // a previous observer). This avoids creating unnecessary promises and subscription
      // delays when recreating an observer for data that's already cached.
      const cachedData = queryClient.getQueryData(key)
      if (cachedData !== undefined) {
        // Still subscribe if sync is active so we receive future updates
        if (syncStarted || collection.subscriberCount > 0) {
          subscribeToQuery(localObserver, hashedQueryKey)
        }
        const currentResult = localObserver.getCurrentResult()
        if (currentResult.isError && !currentResult.isFetching) {
          return Promise.reject(currentResult.error)
        }
        if (
          !currentResult.isSuccess ||
          !hasPostWriteAuthority(
            hashedQueryKey,
            localObserver.getCurrentQuery(),
          )
        ) {
          return waitForQueryReadyAndApplied(localObserver, hashedQueryKey)
        }
        if (collection.deferDataRefresh) {
          return waitForQueryReadyAndApplied(localObserver, hashedQueryKey)
        }
        return getResultApplicationSettlement(hashedQueryKey)
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

    const applySuccessfulResult = async (
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
    ): Promise<void> => {
      const hashedQueryKey = hashKey(queryKey)

      if (collection.status === `cleaned-up` || signal?.aborted) {
        return
      }

      const rawData = result.data
      const newItemsArray = select ? select(rawData) : rawData

      if (
        !Array.isArray(newItemsArray) ||
        newItemsArray.some((item) => typeof item !== `object`)
      ) {
        const errorMessage = select
          ? `@tanstack/query-db-collection: select() must return an array of objects. Got: ${typeof newItemsArray} for queryKey ${JSON.stringify(queryKey)}`
          : `@tanstack/query-db-collection: queryFn must return an array of objects. Got: ${typeof newItemsArray} for queryKey ${JSON.stringify(queryKey)}`

        console.error(errorMessage)
        return
      }

      const currentSyncedItems: Map<string | number, any> = new Map(
        collection._state.syncedData.entries(),
      )
      const shouldUsePersistedBaseline = persistedBaseline !== undefined
      const previouslyOwnedRows = shouldUsePersistedBaseline
        ? new Set(persistedBaseline.keys())
        : getHydratedOwnedRowsForQueryBaseline(hashedQueryKey)

      const newItemsMap = new Map<string | number, any>()
      newItemsArray.forEach((item) => {
        const key = getKey(item)
        newItemsMap.set(key, item)
      })

      const previousOwnedRows = queryToRows.has(hashedQueryKey)
        ? new Set(queryToRows.get(hashedQueryKey))
        : undefined
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
        previousOwnersByRow.forEach((owners, key) => {
          if (owners === undefined) {
            rowToQueries.delete(key)
          } else {
            rowToQueries.set(key, owners)
          }
        })
      }
      applicationToken.rollback = restoreOwnershipTracking

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
        }

        previouslyOwnedRows.forEach((key) => {
          const oldItem = shouldUsePersistedBaseline
            ? persistedBaseline.get(key)?.value
            : currentSyncedItems.get(key)
          if (!oldItem) {
            return
          }
          const newItem = newItemsMap.get(key)
          if (!newItem) {
            const owners = getPersistedOwners(key)
            owners.delete(hashedQueryKey)
            setPersistedOwners(key, owners)
            const needToRemove = removeRowOwner(key, hashedQueryKey)
            if (needToRemove) {
              write({ type: `delete`, value: oldItem })
            }
          } else if (!deepEquals(oldItem, newItem)) {
            write({ type: `update`, value: newItem })
          }
        })

        newItemsMap.forEach((newItem, key) => {
          const owners = getPersistedOwners(key)
          const addsOwner = !owners.has(hashedQueryKey)
          const insertsRow = !currentSyncedItems.has(key)
          if (addsOwner) {
            owners.add(hashedQueryKey)
          }
          addRowOwner(key, hashedQueryKey)
          if (insertsRow) {
            write({ type: `insert`, value: newItem })
          }
          if (addsOwner || insertsRow) {
            // An insert clears stale metadata for its key. Stage ownership
            // afterward so rows and ownership commit as one state change.
            setPersistedOwners(key, owners)
          }
        })

        resultTransaction = collection._state.pendingSyncedTransactions.at(-1)
        const applied = commit(signal)
        transactionActive = false
        retainedQueriesPendingRevalidation.delete(hashedQueryKey)
        cancelPersistedRetentionExpiry(hashedQueryKey)

        // Readiness is publication: do not expose it until the establishing
        // transaction's rows and events are visible.
        if (applied !== true) await applied
        if (!signal?.aborted) markReady()
      } catch (error) {
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
    }

    const reconcileSuccessfulResult = async (
      queryKey: QueryKey,
      result: QueryObserverResult<any, any>,
      applicationToken: ResultApplicationController,
      signal: AbortSignal,
    ) => {
      const hashedQueryKey = hashKey(queryKey)
      const persistedBaseline =
        await loadPersistedBaselineForQuery(hashedQueryKey)
      if (
        collection.status === `cleaned-up` ||
        resultApplicationControllers.get(hashedQueryKey) !== applicationToken
      ) {
        return
      }
      await applySuccessfulResult(
        queryKey,
        result,
        applicationToken,
        persistedBaseline,
        signal,
      )
    }

    const trackResultApplication = (
      hashedQueryKey: string,
      application: Promise<void>,
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
          if (finish()) failedResultApplications.delete(hashedQueryKey)
        },
        (error) => {
          if (!finish()) return
          failedResultApplications.set(hashedQueryKey, error)
          state.lastError = error
          state.errorCount++
          state.lastErrorUpdatedAt = Date.now()
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
      apply: (
        signal: AbortSignal,
        applicationToken: ResultApplicationController,
      ) => Promise<void>,
    ): void => {
      invalidatePendingResultApplication(hashedQueryKey)
      const controller: ResultApplicationController = new AbortController()
      resultApplicationControllers.set(hashedQueryKey, controller)
      const application = apply(controller.signal, controller)
      const cleanupController = () => {
        if (resultApplicationControllers.get(hashedQueryKey) === controller) {
          resultApplicationControllers.delete(hashedQueryKey)
        }
      }
      void application.then(cleanupController, cleanupController)
      if (resultApplicationControllers.get(hashedQueryKey) === controller) {
        trackResultApplication(hashedQueryKey, application)
      }
    }

    // eslint-disable-next-line no-shadow
    const makeQueryResultHandler = (queryKey: QueryKey) => {
      const hashedQueryKey = hashKey(queryKey)
      const handleQueryResult: UpdateHandler = (result) => {
        const observer = state.observers.get(hashedQueryKey)
        if (observer) {
          const query = observer.getCurrentQuery()
          trackOwnedCacheQuery(query, hashedQueryKey)
          if (result.isSuccess) {
            if (!hasPostWriteAuthority(hashedQueryKey, query)) {
              // Query observers are notified before Query Cache subscribers.
              // Recheck after the cache success action records fetch authority.
              queueMicrotask(() => {
                const currentObserver = state.observers.get(hashedQueryKey)
                if (
                  currentObserver === observer &&
                  hasPostWriteAuthority(
                    hashedQueryKey,
                    currentObserver.getCurrentQuery(),
                  )
                ) {
                  handleQueryResult(currentObserver.getCurrentResult())
                }
              })
              return
            }
            requiredFetchStarts.delete(hashedQueryKey)
          }
        }
        if (result.isSuccess) {
          // Error state follows observer notification order, not the later
          // publication time of a queued successful result.
          state.lastError = undefined
          state.errorCount = 0

          // Skip processing this result while data refreshes are deferred.
          // Optimistic state covers the gap. Once the barrier resolves,
          // trigger a fresh refetch to get authoritative data.
          if (collection.deferDataRefresh) {
            collection.deferDataRefresh.then(() => {
              const observer = state.observers.get(hashedQueryKey)
              if (observer) {
                observer.refetch().catch(() => {
                  // Errors handled by the next handleQueryResult invocation
                })
              }
            })
            return
          }

          const manualWriteSnapshot = manualWriteSnapshots.get(hashedQueryKey)
          if (manualWriteSnapshot) {
            const currentQuery = state.observers
              .get(hashedQueryKey)
              ?.getCurrentQuery()
            if (
              currentQuery?.state.dataUpdateCount ===
                manualWriteSnapshot.dataUpdateCount &&
              currentQuery.state.data === manualWriteSnapshot.data
            ) {
              return
            }
            manualWriteSnapshots.delete(hashedQueryKey)
          }

          if (retainedQueriesPendingRevalidation.has(hashedQueryKey)) {
            const query = queryClient.getQueryCache().find({
              queryKey,
              exact: true,
            })
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

            enqueueResultApplication(hashedQueryKey, (signal, token) =>
              reconcileSuccessfulResult(queryKey, result, token, signal),
            )
          } else {
            enqueueResultApplication(hashedQueryKey, (signal, token) =>
              applySuccessfulResult(queryKey, result, token, undefined, signal),
            )
          }
        } else {
          // A reset/recreation can reuse a dataUpdateCount. Retire the old
          // snapshot marker on the intervening non-success notification so a
          // fresh authoritative result cannot be mistaken for stale data.
          manualWriteSnapshots.delete(hashedQueryKey)
        }

        if (result.isError) {
          const isNewError =
            result.errorUpdatedAt !== state.lastErrorUpdatedAt ||
            result.error !== state.lastError
          if (isNewError) {
            state.lastError = result.error
            state.errorCount++
            state.lastErrorUpdatedAt = result.errorUpdatedAt
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

    const subscribeToQuery = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string,
    ) => {
      if (!isSubscribed(hashedQueryKey)) {
        // Cache removal does not retire eager ownership. Reattach the observer
        // to the current cache entry before subscribing to its updates.
        if (syncMode === `eager`) observer.setOptions(observer.options)
        const cachedQueryKey = hashToQueryKey.get(hashedQueryKey)!
        const handleQueryResult = makeQueryResultHandler(cachedQueryKey)
        const unsubscribeFn = observer.subscribe(handleQueryResult)
        unsubscribes.set(hashedQueryKey, unsubscribeFn)

        // Process the current result immediately if available
        // This ensures data is synced when resubscribing to a query with cached data
        const currentResult = observer.getCurrentResult()
        if (currentResult.isSuccess || currentResult.isError) {
          handleQueryResult(currentResult)
        }
      }
    }

    const subscribeToQueries = () => {
      state.observers.forEach(subscribeToQuery)
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
      unsubscribes.get(hashedQueryKey)?.()
      unsubscribes.delete(hashedQueryKey)
      unsubscribePendingReadyListeners(hashedQueryKey)
      cancelPersistedRetentionExpiry(hashedQueryKey)
      retainedQueriesPendingRevalidation.delete(hashedQueryKey)
      invalidatePendingResultApplication(hashedQueryKey)
      manualWriteSnapshots.delete(hashedQueryKey)

      const nextOwnersByRow = removeQueryOwnership(hashedQueryKey)
      const rowsToDelete: Array<any> = []

      nextOwnersByRow.forEach((nextOwners, rowKey) => {
        if (nextOwners.size === 0 && collection.has(rowKey)) {
          rowsToDelete.push(collection.get(rowKey))
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
        commit()
      }

      state.observers.delete(hashedQueryKey)
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

      if (
        effectivePersistedGcTime !== undefined &&
        metadata &&
        persistedMetadata?.row.scanPersisted
      ) {
        invalidatePendingResultApplication(hashedQueryKey)
        manualWriteSnapshots.delete(hashedQueryKey)
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
              : { expiresAt: Date.now() + effectivePersistedGcTime }),
          },
        )
        commit()
        if (effectivePersistedGcTime !== Number.POSITIVE_INFINITY) {
          schedulePersistedRetentionExpiry({
            queryHash: hashedQueryKey,
            mode: `ttl`,
            expiresAt: Date.now() + effectivePersistedGcTime,
          })
        }
        unsubscribes.get(hashedQueryKey)?.()
        unsubscribes.delete(hashedQueryKey)
        state.observers.delete(hashedQueryKey)
        hashToQueryKey.delete(hashedQueryKey)
        queryRefCounts.set(hashedQueryKey, 0)
        return
      }

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
          event.type === `added` &&
          partialMatchKey(event.query.queryKey, baseKey)
        ) {
          trackCacheQuery(event.query)
        }

        if (event.type === `updated`) {
          if (event.action.type === `fetch`) {
            let fetchStart = queryCollectionFetchActionStarts.get(event.action)
            if (fetchStart === undefined) {
              fetchStart = ++nextQueryCollectionFetchStart
              queryCollectionFetchActionStarts.set(event.action, fetchStart)
            }
            queryCollectionCurrentFetchStarts.set(event.query, fetchStart)
          } else if (event.action.type === `success` && !event.action.manual) {
            const fetchStart = queryCollectionCurrentFetchStarts.get(
              event.query,
            )
            if (fetchStart !== undefined) {
              queryCollectionSuccessfulFetchStarts.set(event.query, fetchStart)
            }
          }
        }

        // Ownership uses our stable key, not the Query client's optional
        // custom cache hash function.
        const hashedKey = hashKey(event.query.queryKey)
        if (event.type === `removed`) {
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
      pendingStartupLoads.clear()
      ensureEagerSubscription = () => {}
      unsubscribeFromCollectionEvents()
      unsubscribeFromQueries()
      persistedRetentionTimers.forEach((timer) => {
        clearTimeout(timer)
      })
      persistedRetentionTimers.clear()

      const allHashedKeys = new Set([
        ...state.observers.keys(),
        ...queryToRows.keys(),
      ])

      // Force cleanup all queries (explicit cleanup path)
      // This ignores hasListeners and always cleans up
      for (const hashedKey of allHashedKeys) {
        forceCleanupQuery(hashedKey)
      }

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
        queryCollectionCacheOwners.get(query)?.delete(cacheOwnerToken)
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
     * 1. Receives the same predicates that were passed to loadSubset
     * 2. Computes the queryKey using generateQueryKeyFromOptions (same logic as loadSubset)
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
     * We don't cancel in-flight requests. Unsubscribing from the observer is sufficient
     * to prevent late-arriving data from being processed. The request completes and is cached
     * by TanStack Query, allowing quick remounts to restore data without refetching.
     */
    const unloadSubset = (options: LoadSubsetOptions) => {
      // No observer lease exists until startup maintenance has finished.
      const pending = pendingStartupLoads.get(options)
      if (pending) {
        pending.delete(pending.values().next().value!)
        if (pending.size === 0) pendingStartupLoads.delete(options)
        return
      }
      // 1. Same predicates → 2. Same queryKey
      const key = generateQueryKeyFromOptions(options)
      const hashedQueryKey = hashKey(key)

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

    // Create deduplicated loadSubset wrapper for non-eager modes
    // This prevents redundant snapshot requests when multiple concurrent
    // live queries request overlapping or subset predicates
    const loadSubsetDedupe =
      syncMode === `eager` ? undefined : createQueryFromOpts

    return {
      loadSubset: loadSubsetDedupe,
      unloadSubset: syncMode === `eager` ? undefined : unloadSubset,
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
   * @returns Promise that resolves when the refetch is complete, with QueryObserverResult
   */
  const refetch: RefetchFn = async (opts) => {
    // An idle eager observer still owns rows; refetch must deliver its result.
    ensureEagerSubscription()
    const allQueryKeys = [...hashToQueryKey.values()]
    const refetchPromises = allQueryKeys.map((qKey) => {
      const queryObserver = state.observers.get(hashKey(qKey))!
      return queryObserver.refetch({
        throwOnError: opts?.throwOnError,
      })
    })

    return Promise.all(refetchPromises)
  }

  /**
   * Updates a single query key in the cache with new items, handling both direct arrays
   * and wrapped response formats (when `select` is used).
   */
  const updateCacheDataForKey = (key: QueryKey, items: Array<any>): void => {
    if (select) {
      // When `select` is used, the cache contains a wrapped response (e.g., { data: [...], meta: {...} })
      // We need to update the cache while preserving the wrapper structure
      queryClient.setQueryData(key, (oldData: any) => {
        if (!oldData || typeof oldData !== `object`) {
          // No existing cache or not an object - don't corrupt the cache
          return oldData
        }

        if (Array.isArray(oldData)) {
          // Cache is already a raw array (shouldn't happen with select, but handle it)
          return items
        }

        // Use the select function to identify which property contains the items array.
        // This is more robust than guessing based on property order.
        const selectedArray = select(oldData)

        if (Array.isArray(selectedArray)) {
          // Find the property that matches the selected array by reference equality
          for (const propKey of Object.keys(oldData)) {
            if (oldData[propKey] === selectedArray) {
              // Found the exact property - create a shallow copy with updated items
              return { ...oldData, [propKey]: items }
            }
          }
        }

        // Fallback: check common property names used for data arrays
        if (Array.isArray(oldData.data)) {
          return { ...oldData, data: items }
        }
        if (Array.isArray(oldData.items)) {
          return { ...oldData, items: items }
        }
        if (Array.isArray(oldData.results)) {
          return { ...oldData, results: items }
        }

        // Last resort: find first array property
        for (const propKey of Object.keys(oldData)) {
          if (Array.isArray(oldData[propKey])) {
            return { ...oldData, [propKey]: items }
          }
        }

        // Couldn't safely identify the array property - don't corrupt the cache
        // Return oldData unchanged to avoid breaking select
        return oldData
      })
    } else {
      // Raw row writes must not overwrite a different cache format. Avoid even
      // a no-op setQueryData: it marks unrelated data fresh and clears invalidation.
      const previous = queryClient.getQueryData(key)
      if (previous === undefined || Array.isArray(previous))
        queryClient.setQueryData(key, items)
    }
  }

  /**
   * Updates Query cache state after a manual write.
   *
   * An on-demand cache entry belongs to one exact queryFn result and may be
   * predicate-, order-, or window-scoped. A normalized collection snapshot
   * cannot preserve that shape. Revalidate actively owned, enabled observers
   * and remove every other scoped entry so a later owner fetches it again.
   * Eager collections retain their single full-result cache patch.
   */
  const updateCacheData = (getItems: () => Array<any>): void => {
    if (syncMode === `on-demand`) {
      const deferredRefresh = writeContext?.collection.deferDataRefresh
      const revalidatingQueries = new Set<AnyQuery>()
      const ownObserverCounts = new Map<AnyQuery, number>()

      for (const observer of state.observers.values()) {
        const query = observer.getCurrentQuery()
        ownObserverCounts.set(query, (ownObserverCounts.get(query) ?? 0) + 1)
      }

      const refetchTrackedQuery = async (
        query: AnyQuery,
        logicalHashes: Set<string>,
        generations: Map<string, number>,
      ): Promise<void> => {
        try {
          await query.fetch(undefined, { cancelRefetch: false })
        } catch {
          // A failed post-write refetch is terminal for this attempt.
          return
        }

        const stillNeedsAuthority = [...logicalHashes].some(
          (hashedQueryKey) =>
            postWriteRefetchGenerations.get(hashedQueryKey) ===
              generations.get(hashedQueryKey) &&
            !hasPostWriteAuthority(hashedQueryKey, query),
        )
        if (
          stillNeedsAuthority &&
          queryClient.getQueryCache().get(query.queryHash) === query &&
          !query.isDisabled()
        ) {
          try {
            // The first call may have reused a request which began before the
            // write. One bounded follow-up then establishes authority.
            await query.fetch(undefined, { cancelRefetch: false })
          } catch {
            // The Query result owns error publication.
          }
        }
      }

      for (const [hashedQueryKey, observer] of state.observers) {
        if ((queryRefCounts.get(hashedQueryKey) ?? 0) <= 0) {
          continue
        }

        const query = observer.getCurrentQuery()
        if (!isObserverEnabled(observer)) {
          continue
        }

        const generation = requirePostWriteAuthority(hashedQueryKey, query)
        revalidatingQueries.add(query)
        const ownedAtSchedule = ownedCacheQueries.has(query)
        query.invalidate()
        manualWriteSnapshots.set(hashedQueryKey, {
          data: query.state.data,
          dataUpdateCount: query.state.dataUpdateCount,
        })

        const retireProtectedQuery = () => {
          if (!ownedAtSchedule) return
          if (queryClient.getQueryCache().get(query.queryHash) !== query) return
          if (query.getObserversCount() > 0) {
            query.invalidate()
            if (!query.isDisabled()) {
              const logicalHashes = new Set([hashedQueryKey])
              const generations = new Map([[hashedQueryKey, generation]])
              void refetchTrackedQuery(query, logicalHashes, generations)
            }
          } else {
            queryClient.getQueryCache().remove(query)
          }
        }

        const refetchObserver = async () => {
          if (
            state.observers.get(hashedQueryKey) !== observer ||
            (queryRefCounts.get(hashedQueryKey) ?? 0) <= 0
          ) {
            retireProtectedQuery()
            return
          }

          if (
            hasPostWriteAuthority(hashedQueryKey, observer.getCurrentQuery())
          ) {
            return
          }

          const result = await observer.refetch().catch(() => undefined)
          if (
            result?.isError ||
            postWriteRefetchGenerations.get(hashedQueryKey) !== generation
          ) {
            return
          }

          const currentQuery = observer.getCurrentQuery()
          if (hasPostWriteAuthority(hashedQueryKey, currentQuery)) return
          if (
            state.observers.get(hashedQueryKey) === observer &&
            (queryRefCounts.get(hashedQueryKey) ?? 0) > 0 &&
            isObserverEnabled(observer)
          ) {
            // A cancellation/revert or a reused pre-write request can resolve
            // without authority. Retry once; errors end the attempt.
            await observer.refetch().catch(() => undefined)
          } else {
            retireProtectedQuery()
          }
        }

        if (deferredRefresh) {
          void deferredRefresh.then(refetchObserver, refetchObserver)
        } else {
          void refetchObserver()
        }
      }

      for (const query of [...trackedCacheQueries]) {
        if (revalidatingQueries.has(query)) continue

        const ownedByAnotherCollection = [
          ...(queryCollectionCacheOwners.get(query) ?? []),
        ].some((owner) => owner !== cacheOwnerToken)
        if (ownedByAnotherCollection) continue

        const ownObservers = ownObserverCounts.get(query) ?? 0
        if (query.getObserversCount() > ownObservers) {
          // A disabled collection observer must not authorize a foreign
          // observer to refetch on the collection's behalf.
          if (ownObservers > 0) continue

          const logicalHashes = getLogicalHashes(query)
          const generations = new Map<string, number>()
          for (const hashedQueryKey of logicalHashes) {
            generations.set(
              hashedQueryKey,
              requirePostWriteAuthority(hashedQueryKey, query),
            )
          }
          query.invalidate()
          if (!query.isDisabled()) {
            void refetchTrackedQuery(query, logicalHashes, generations)
          }
          continue
        }

        queryClient.getQueryCache().remove(query)
      }
      return
    }

    const items = getItems()
    const allCached = [...trackedCacheQueries]

    if (allCached.length > 0) {
      for (const query of allCached) {
        updateCacheDataForKey(query.queryKey, items)
      }
    } else {
      // Fallback: no queries in cache yet, seed the base query key.
      // This handles the case where updateCacheData is called before any queries are created.
      updateCacheDataForKey(baseKey, items)
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
    updateCacheData?: (getItems: () => Array<any>) => void
  } | null = null

  // Enhanced internalSync that captures write functions for manual use
  const enhancedInternalSync: SyncConfig<any>[`sync`] = (params) => {
    const { begin, write, commit, collection } = params
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
    writeContext = {
      collection,
      queryClient,
      queryKey: contextQueryKey,
      getKey: getKey as (item: any) => string | number,
      begin,
      write,
      commit,
      updateCacheData,
    }

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
        try {
          sync.cleanup?.()
        } finally {
          unmountQueryClient()
        }
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
      await refetch()
    }
  }

  // Create wrapper handlers for direct persistence operations that handle refetching
  // These wrappers process deprecated return values but don't pass them through
  const wrappedOnInsert = onInsert
    ? async (
        params: Parameters<NonNullable<typeof onInsert>>[0],
      ): Promise<void> => {
        const handlerResult = (await onInsert(params)) ?? {}
        await handleDeprecatedAutoRefetch(handlerResult)
      }
    : undefined

  const wrappedOnUpdate = onUpdate
    ? async (
        params: Parameters<NonNullable<typeof onUpdate>>[0],
      ): Promise<void> => {
        const handlerResult = (await onUpdate(params)) ?? {}
        await handleDeprecatedAutoRefetch(handlerResult)
      }
    : undefined

  const wrappedOnDelete = onDelete
    ? async (
        params: Parameters<NonNullable<typeof onDelete>>[0],
      ): Promise<void> => {
        const handlerResult = (await onDelete(params)) ?? {}
        await handleDeprecatedAutoRefetch(handlerResult)
      }
    : undefined

  // Create utils instance with state and dependencies passed explicitly
  const utils: any = new QueryCollectionUtilsImpl(state, refetch, writeUtils)

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
