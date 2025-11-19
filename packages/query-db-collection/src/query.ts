import { QueryObserver, hashKey } from "@tanstack/query-core"
import {
  GetKeyRequiredError,
  QueryClientRequiredError,
  QueryFnRequiredError,
  QueryKeyRequiredError,
} from "./errors"
import { createWriteUtils } from "./manual-sync"
import type {
  BaseCollectionConfig,
  ChangeMessage,
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  LoadSubsetOptions,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"
import type {
  FetchStatus,
  QueryClient,
  QueryFunctionContext,
  QueryKey,
  QueryObserverOptions,
  QueryObserverResult,
} from "@tanstack/query-core"
import type { StandardSchemaV1 } from "@standard-schema/spec"

// Re-export for external use
export type { SyncOperation } from "./manual-sync"

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
  TQueryFn extends (context: QueryFunctionContext<any>) => Promise<any> = (
    context: QueryFunctionContext<any>
  ) => Promise<any>,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
  TQueryData = Awaited<ReturnType<TQueryFn>>,
> extends BaseCollectionConfig<T, TKey, TSchema> {
  /** The query key used by TanStack Query to identify this query */
  queryKey: TQueryKey | TQueryKeyBuilder<TQueryKey>
  /** Function that fetches data from the server. Must return the complete collection state */
  queryFn: TQueryFn extends (
    context: QueryFunctionContext<TQueryKey>
  ) => Promise<Array<any>>
    ? (context: QueryFunctionContext<TQueryKey>) => Promise<Array<T>>
    : TQueryFn
  /* Function that extracts array items from wrapped API responses (e.g metadata, pagination)  */
  select?: (data: TQueryData) => Array<T>
  /** The TanStack Query client instance */
  queryClient: QueryClient

  // Query-specific options
  /** Whether the query should automatically run (default: true) */
  enabled?: boolean
  refetchInterval?: QueryObserverOptions<
    Array<T>,
    TError,
    Array<T>,
    Array<T>,
    TQueryKey
  >[`refetchInterval`]
  retry?: QueryObserverOptions<
    Array<T>,
    TError,
    Array<T>,
    Array<T>,
    TQueryKey
  >[`retry`]
  retryDelay?: QueryObserverOptions<
    Array<T>,
    TError,
    Array<T>,
    Array<T>,
    TQueryKey
  >[`retryDelay`]
  staleTime?: QueryObserverOptions<
    Array<T>,
    TError,
    Array<T>,
    Array<T>,
    TQueryKey
  >[`staleTime`]

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
}) => Promise<QueryObserverResult<any, any> | void>

/**
 * Utility methods available on Query Collections for direct writes and manual operations.
 * Direct writes bypass the normal query/mutation flow and write directly to the synced data store.
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
> extends UtilsRecord {
  /** Manually trigger a refetch of the query */
  refetch: RefetchFn
  /** Insert one or more items directly into the synced data store without triggering a query refetch or optimistic update */
  writeInsert: (data: TInsertInput | Array<TInsertInput>) => void
  /** Update one or more items directly in the synced data store without triggering a query refetch or optimistic update */
  writeUpdate: (updates: Partial<TItem> | Array<Partial<TItem>>) => void
  /** Delete one or more items directly from the synced data store without triggering a query refetch or optimistic update */
  writeDelete: (keys: TKey | Array<TKey>) => void
  /** Insert or update one or more items directly in the synced data store without triggering a query refetch or optimistic update */
  writeUpsert: (data: Partial<TItem> | Array<Partial<TItem>>) => void
  /** Execute multiple write operations as a single atomic batch to the synced data store */
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
    writeUtils: ReturnType<typeof createWriteUtils>
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
      (observer) => observer.getCurrentResult().isFetching
    )
  }

  public get isRefetching() {
    // check if any observer is refetching
    return Array.from(this.state.observers.values()).some(
      (observer) => observer.getCurrentResult().isRefetching
    )
  }

  public get isLoading() {
    // check if any observer is loading
    return Array.from(this.state.observers.values()).some(
      (observer) => observer.getCurrentResult().isLoading
    )
  }

  public get dataUpdatedAt() {
    // compute the max dataUpdatedAt of all observers
    return Math.max(
      0,
      ...Array.from(this.state.observers.values()).map(
        (observer) => observer.getCurrentResult().dataUpdatedAt
      )
    )
  }

  public get fetchStatus(): Array<FetchStatus> {
    return Array.from(this.state.observers.values()).map(
      (observer) => observer.getCurrentResult().fetchStatus
    )
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
  TQueryFn extends (context: QueryFunctionContext<any>) => Promise<any>,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
  TQueryData = Awaited<ReturnType<TQueryFn>>,
>(
  config: QueryCollectionConfig<
    InferSchemaOutput<T>,
    TQueryFn,
    TError,
    TQueryKey,
    TKey,
    T
  > & {
    schema: T
    select: (data: TQueryData) => Array<InferSchemaInput<T>>
  }
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
  TQueryFn extends (context: QueryFunctionContext<any>) => Promise<any> = (
    context: QueryFunctionContext<any>
  ) => Promise<any>,
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
  }
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
      context: QueryFunctionContext<any>
    ) => Promise<Array<InferSchemaOutput<T>>>,
    TError,
    TQueryKey,
    TKey,
    T
  > & {
    schema: T
  }
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
    (context: QueryFunctionContext<any>) => Promise<Array<T>>,
    TError,
    TQueryKey,
    TKey
  > & {
    schema?: never // prohibit schema
  }
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
  config: QueryCollectionConfig<Record<string, unknown>>
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
    getKey,
    onInsert,
    onUpdate,
    onDelete,
    meta,
    ...baseCollectionConfig
  } = config

  // Default to eager sync mode if not provided
  const syncMode = baseCollectionConfig.syncMode ?? `eager`

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

  // hashedQueryKey → queryKey
  const hashToQueryKey = new Map<string, QueryKey>()

  // queryKey → Set<RowKey>
  const queryToRows = new Map<string, Set<string | number>>()

  // RowKey → Set<queryKey>
  const rowToQueries = new Map<string | number, Set<string>>()

  // queryKey → QueryObserver's unsubscribe function
  const unsubscribes = new Map<string, () => void>()

  // Helper function to add a row to the internal state
  const addRow = (rowKey: string | number, hashedQueryKey: string) => {
    const rowToQueriesSet = rowToQueries.get(rowKey) || new Set()
    rowToQueriesSet.add(hashedQueryKey)
    rowToQueries.set(rowKey, rowToQueriesSet)

    const queryToRowsSet = queryToRows.get(hashedQueryKey) || new Set()
    queryToRowsSet.add(rowKey)
    queryToRows.set(hashedQueryKey, queryToRowsSet)
  }

  // Helper function to remove a row from the internal state
  const removeRow = (rowKey: string | number, hashedQuerKey: string) => {
    const rowToQueriesSet = rowToQueries.get(rowKey) || new Set()
    rowToQueriesSet.delete(hashedQuerKey)
    rowToQueries.set(rowKey, rowToQueriesSet)

    const queryToRowsSet = queryToRows.get(hashedQuerKey) || new Set()
    queryToRowsSet.delete(rowKey)
    queryToRows.set(hashedQuerKey, queryToRowsSet)

    return rowToQueriesSet.size === 0
  }

  const internalSync: SyncConfig<any>[`sync`] = (params) => {
    const { begin, write, commit, markReady, collection } = params

    // Track whether sync has been started
    let syncStarted = false

    const createQueryFromOpts = (
      opts: LoadSubsetOptions = {},
      queryFunction: typeof queryFn = queryFn
    ): true | Promise<void> => {
      // Push the predicates down to the queryKey and queryFn
      const key = typeof queryKey === `function` ? queryKey(opts) : queryKey
      const hashedQueryKey = hashKey(key)
      const extendedMeta = { ...meta, loadSubsetOptions: opts }

      if (state.observers.has(hashedQueryKey)) {
        // We already have a query for this queryKey
        // Get the current result and return based on its state
        const observer = state.observers.get(hashedQueryKey)!
        const currentResult = observer.getCurrentResult()

        if (currentResult.isSuccess) {
          // Data is already available, return true synchronously
          return true
        } else if (currentResult.isError) {
          // Error already occurred, reject immediately
          return Promise.reject(currentResult.error)
        } else {
          // Query is still loading, wait for the first result
          return new Promise<void>((resolve, reject) => {
            const unsubscribe = observer.subscribe((result) => {
              if (result.isSuccess) {
                unsubscribe()
                resolve()
              } else if (result.isError) {
                unsubscribe()
                reject(result.error)
              }
            })
          })
        }
      }

      const observerOptions: QueryObserverOptions<
        Array<any>,
        any,
        Array<any>,
        Array<any>,
        any
      > = {
        queryKey: key,
        queryFn: queryFunction,
        meta: extendedMeta,
        structuralSharing: true,
        notifyOnChangeProps: `all`,

        // Only include options that are explicitly defined to allow QueryClient defaultOptions to be used
        ...(enabled !== undefined && { enabled }),
        ...(refetchInterval !== undefined && { refetchInterval }),
        ...(retry !== undefined && { retry }),
        ...(retryDelay !== undefined && { retryDelay }),
        ...(staleTime !== undefined && { staleTime }),
      }

      const localObserver = new QueryObserver<
        Array<any>,
        any,
        Array<any>,
        Array<any>,
        any
      >(queryClient, observerOptions)

      hashToQueryKey.set(hashedQueryKey, key)
      state.observers.set(hashedQueryKey, localObserver)

      // Create a promise that resolves when the query result is first available
      const readyPromise = new Promise<void>((resolve, reject) => {
        const unsubscribe = localObserver.subscribe((result) => {
          if (result.isSuccess) {
            unsubscribe()
            resolve()
          } else if (result.isError) {
            unsubscribe()
            reject(result.error)
          }
        })
      })

      // If sync has started or there are subscribers to the collection, subscribe to the query straight away
      // This creates the main subscription that handles data updates
      if (syncStarted || collection.subscriberCount > 0) {
        subscribeToQuery(localObserver, hashedQueryKey)
      }

      // Tell tanstack query to GC the query when the subscription is unsubscribed
      // The subscription is unsubscribed when the live query is GCed.
      const subscription = opts.subscription
      subscription?.once(`unsubscribed`, () => {
        queryClient.removeQueries({ queryKey: key, exact: true })
      })

      return readyPromise
    }

    type UpdateHandler = Parameters<QueryObserver[`subscribe`]>[0]

    const makeQueryResultHandler = (queryKey: QueryKey) => {
      const hashedQueryKey = hashKey(queryKey)
      const handleQueryResult: UpdateHandler = (result) => {
        if (result.isSuccess) {
          // Clear error state
          state.lastError = undefined
          state.errorCount = 0

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
            collection._state.syncedData.entries()
          )
          const newItemsMap = new Map<string | number, any>()
          newItemsArray.forEach((item) => {
            const key = getKey(item)
            newItemsMap.set(key, item)
          })

          begin()

          // Helper function for shallow equality check of objects
          const shallowEqual = (
            obj1: Record<string, any>,
            obj2: Record<string, any>
          ): boolean => {
            // Get all keys from both objects
            const keys1 = Object.keys(obj1)
            const keys2 = Object.keys(obj2)

            // If number of keys is different, objects are not equal
            if (keys1.length !== keys2.length) return false

            // Check if all keys in obj1 have the same values in obj2
            return keys1.every((key) => {
              // Skip comparing functions and complex objects deeply
              if (typeof obj1[key] === `function`) return true
              return obj1[key] === obj2[key]
            })
          }

          currentSyncedItems.forEach((oldItem, key) => {
            const newItem = newItemsMap.get(key)
            if (!newItem) {
              const needToRemove = removeRow(key, hashedQueryKey) // returns true if the row is no longer referenced by any queries
              if (needToRemove) {
                write({ type: `delete`, value: oldItem })
              }
            } else if (
              !shallowEqual(
                oldItem as Record<string, any>,
                newItem as Record<string, any>
              )
            ) {
              // Only update if there are actual differences in the properties
              write({ type: `update`, value: newItem })
            }
          })

          newItemsMap.forEach((newItem, key) => {
            addRow(key, hashedQueryKey)
            if (!currentSyncedItems.has(key)) {
              write({ type: `insert`, value: newItem })
            }
          })

          commit()

          // Mark collection as ready after first successful query result
          markReady()
        } else if (result.isError) {
          if (result.errorUpdatedAt !== state.lastErrorUpdatedAt) {
            state.lastError = result.error
            state.errorCount++
            state.lastErrorUpdatedAt = result.errorUpdatedAt
          }

          console.error(
            `[QueryCollection] Error observing query ${String(queryKey)}:`,
            result.error
          )

          // Mark collection as ready even on error to avoid blocking apps
          markReady()
        }
      }
      return handleQueryResult
    }

    const isSubscribed = (hashedQueryKey: string) => {
      return unsubscribes.has(hashedQueryKey)
    }

    const subscribeToQuery = (
      observer: QueryObserver<Array<any>, any, Array<any>, Array<any>, any>,
      hashedQueryKey: string
    ) => {
      if (!isSubscribed(hashedQueryKey)) {
        const queryKey = hashToQueryKey.get(hashedQueryKey)!
        const handleQueryResult = makeQueryResultHandler(queryKey)
        const unsubscribeFn = observer.subscribe(handleQueryResult)
        unsubscribes.set(hashedQueryKey, unsubscribeFn)
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
      }
    )

    // If syncMode is eager, create the initial query without any predicates
    if (syncMode === `eager`) {
      // Catch any errors to prevent unhandled rejections
      const initialResult = createQueryFromOpts({})
      if (initialResult instanceof Promise) {
        initialResult.catch(() => {
          // Errors are already handled by the query result handler
        })
      }
    } else {
      // In on-demand mode, mark ready immediately since there's no initial query
      markReady()
    }

    // Always subscribe when sync starts (this could be from preload(), startSync config, or first subscriber)
    // We'll dynamically unsubscribe/resubscribe based on subscriber count to maintain staleTime behavior
    subscribeToQueries()

    // Ensure we process any existing query data (QueryObserver doesn't invoke its callback automatically with initial state)
    state.observers.forEach((observer, hashedQueryKey) => {
      const queryKey = hashToQueryKey.get(hashedQueryKey)!
      const handleQueryResult = makeQueryResultHandler(queryKey)
      handleQueryResult(observer.getCurrentResult())
    })

    // Subscribe to the query client's cache to handle queries that are GCed by tanstack query
    const unsubscribeQueryCache = queryClient
      .getQueryCache()
      .subscribe((event) => {
        const hashedKey = event.query.queryHash
        if (event.type === `removed`) {
          cleanupQuery(hashedKey)
        }
      })

    function cleanupQuery(hashedQueryKey: string) {
      // Unsubscribe from the query's observer
      unsubscribes.get(hashedQueryKey)?.()

      // Get all the rows that are in the result of this query
      const rowKeys = queryToRows.get(hashedQueryKey) ?? new Set()

      // Remove the query from these rows
      rowKeys.forEach((rowKey) => {
        const queries = rowToQueries.get(rowKey) // set of queries that reference this row
        if (queries && queries.size > 0) {
          queries.delete(hashedQueryKey)
          if (queries.size === 0) {
            // Reference count dropped to 0, we can GC the row
            rowToQueries.delete(rowKey)

            if (collection.has(rowKey)) {
              begin()
              write({ type: `delete`, value: collection.get(rowKey) })
              commit()
            }
          }
        }
      })

      // Remove the query from the internal state
      unsubscribes.delete(hashedQueryKey)
      state.observers.delete(hashedQueryKey)
      queryToRows.delete(hashedQueryKey)
      hashToQueryKey.delete(hashedQueryKey)
    }

    const cleanup = async () => {
      unsubscribeFromCollectionEvents()
      unsubscribeFromQueries()

      const queryKeys = [...hashToQueryKey.values()]

      hashToQueryKey.clear()
      queryToRows.clear()
      rowToQueries.clear()
      state.observers.clear()
      unsubscribeQueryCache()

      await Promise.all(
        queryKeys.map(async (queryKey) => {
          await queryClient.cancelQueries({ queryKey })
          queryClient.removeQueries({ queryKey })
        })
      )
    }

    // Create deduplicated loadSubset wrapper for non-eager modes
    // This prevents redundant snapshot requests when multiple concurrent
    // live queries request overlapping or subset predicates
    const loadSubsetDedupe =
      syncMode === `eager` ? undefined : createQueryFromOpts

    return {
      loadSubset: loadSubsetDedupe,
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
    const queryKeys = [...hashToQueryKey.values()]
    const refetchPromises = queryKeys.map((queryKey) => {
      const queryObserver = state.observers.get(hashKey(queryKey))!
      return queryObserver.refetch({
        throwOnError: opts?.throwOnError,
      })
    })

    await Promise.all(refetchPromises)
  }

  // Create write context for manual write operations
  let writeContext: {
    collection: any
    queryClient: QueryClient
    queryKey: Array<unknown>
    getKey: (item: any) => string | number
    begin: () => void
    write: (message: Omit<ChangeMessage<any>, `key`>) => void
    commit: () => void
  } | null = null

  // Enhanced internalSync that captures write functions for manual use
  const enhancedInternalSync: SyncConfig<any>[`sync`] = (params) => {
    const { begin, write, commit, collection } = params

    // Store references for manual write operations
    writeContext = {
      collection,
      queryClient,
      queryKey: queryKey as unknown as Array<unknown>,
      getKey: getKey as (item: any) => string | number,
      begin,
      write,
      commit,
    }

    // Call the original internalSync logic
    return internalSync(params)
  }

  // Create write utils using the manual-sync module
  const writeUtils = createWriteUtils<any, string | number, any>(
    () => writeContext
  )

  // Create wrapper handlers for direct persistence operations that handle refetching
  const wrappedOnInsert = onInsert
    ? async (params: InsertMutationFnParams<any>) => {
        const handlerResult = (await onInsert(params)) ?? {}
        const shouldRefetch =
          (handlerResult as { refetch?: boolean }).refetch !== false

        if (shouldRefetch) {
          await refetch()
        }

        return handlerResult
      }
    : undefined

  const wrappedOnUpdate = onUpdate
    ? async (params: UpdateMutationFnParams<any>) => {
        const handlerResult = (await onUpdate(params)) ?? {}
        const shouldRefetch =
          (handlerResult as { refetch?: boolean }).refetch !== false

        if (shouldRefetch) {
          await refetch()
        }

        return handlerResult
      }
    : undefined

  const wrappedOnDelete = onDelete
    ? async (params: DeleteMutationFnParams<any>) => {
        const handlerResult = (await onDelete(params)) ?? {}
        const shouldRefetch =
          (handlerResult as { refetch?: boolean }).refetch !== false

        if (shouldRefetch) {
          await refetch()
        }

        return handlerResult
      }
    : undefined

  // Create utils instance with state and dependencies passed explicitly
  const utils: any = new QueryCollectionUtilsImpl(state, refetch, writeUtils)

  return {
    ...baseCollectionConfig,
    getKey,
    syncMode,
    sync: { sync: enhancedInternalSync },
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils,
  }
}
