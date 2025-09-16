import { QueryObserver } from "@tanstack/query-core"
import {
  GetKeyRequiredError,
  QueryClientRequiredError,
  QueryFnRequiredError,
  QueryKeyRequiredError,
} from "./errors"
import { createWriteUtils } from "./manual-sync"
import type {
  QueryClient,
  QueryFunctionContext,
  QueryKey,
  QueryObserverOptions,
} from "@tanstack/query-core"
import type {
  BaseCollectionConfig,
  ChangeMessage,
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"
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
  queryKey: TQueryKey
  /** Function that fetches data from the server. Must return the complete collection state */
  queryFn: TQueryFn extends (
    context: QueryFunctionContext<TQueryKey>
  ) => Promise<Array<any>>
    ? (context: QueryFunctionContext<TQueryKey>) => Promise<Array<T>>
    : TQueryFn

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
 */
export type RefetchFn = (opts?: { throwOnError?: boolean }) => Promise<void>

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
  /** Get the last error encountered by the query (if any); reset on success */
  lastError: () => TError | undefined
  /** Check if the collection is in an error state */
  isError: () => boolean
  /**
   * Get the number of consecutive sync failures.
   * Incremented only when query fails completely (not per retry attempt); reset on success.
   */
  errorCount: () => number
  /**
   * Clear the error state and trigger a refetch of the query
   * @returns Promise that resolves when the refetch completes successfully
   * @throws Error if the refetch fails
   */
  clearError: () => Promise<void>
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
): CollectionConfig<InferSchemaOutput<T>, TKey, T> & {
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
): CollectionConfig<T, TKey> & {
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
): CollectionConfig<InferSchemaOutput<T>, TKey, T> & {
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
): CollectionConfig<T, TKey> & {
  schema?: never // no schema in the result
  utils: QueryCollectionUtils<T, TKey, T, TError>
}

export function queryCollectionOptions(
  config: QueryCollectionConfig<Record<string, unknown>>
): CollectionConfig & {
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

  /** The last error encountered by the query */
  let lastError: any
  /** The number of consecutive sync failures */
  let errorCount = 0
  /** The timestamp for when the query most recently returned the status as "error" */
  let lastErrorUpdatedAt = 0

  const internalSync: SyncConfig<any>[`sync`] = (params) => {
    const { begin, write, commit, markReady, collection } = params

    const observerOptions: QueryObserverOptions<
      Array<any>,
      any,
      Array<any>,
      Array<any>,
      any
    > = {
      queryKey: queryKey,
      queryFn: queryFn,
      meta: meta,
      enabled: enabled,
      refetchInterval: refetchInterval,
      retry: retry,
      retryDelay: retryDelay,
      staleTime: staleTime,
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

    type UpdateHandler = Parameters<typeof localObserver.subscribe>[0]
    const handleUpdate: UpdateHandler = (result) => {
      if (result.isSuccess) {
        // Clear error state
        lastError = undefined
        errorCount = 0

        const rawData = result.data
        const newItemsArray = select ? select(rawData) : rawData

        if (
          !Array.isArray(newItemsArray) ||
          newItemsArray.some((item) => typeof item !== `object`)
        ) {
          console.error(
            `[QueryCollection] queryFn did not return an array of objects. Skipping update.`,
            newItemsArray
          )
          return
        }

        const currentSyncedItems = new Map(collection.syncedData)
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
            write({ type: `delete`, value: oldItem })
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
          if (!currentSyncedItems.has(key)) {
            write({ type: `insert`, value: newItem })
          }
        })

        commit()

        // Mark collection as ready after first successful query result
        markReady()
      } else if (result.isError) {
        if (result.errorUpdatedAt !== lastErrorUpdatedAt) {
          lastError = result.error
          errorCount++
          lastErrorUpdatedAt = result.errorUpdatedAt
        }

        console.error(
          `[QueryCollection] Error observing query ${String(queryKey)}:`,
          result.error
        )

        // Mark collection as ready even on error to avoid blocking apps
        markReady()
      }
    }

    const actualUnsubscribeFn = localObserver.subscribe(handleUpdate)

    // Ensure we process any existing query data (QueryObserver doesn't invoke its callback automatically with initial
    // state)
    handleUpdate(localObserver.getCurrentResult())

    return async () => {
      actualUnsubscribeFn()
      await queryClient.cancelQueries({ queryKey })
      queryClient.removeQueries({ queryKey })
    }
  }

  /**
   * Refetch the query data
   * @returns Promise that resolves when the refetch is complete
   */
  const refetch: RefetchFn = (opts) => {
    return queryClient.refetchQueries(
      {
        queryKey: queryKey,
      },
      {
        throwOnError: opts?.throwOnError,
      }
    )
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

  return {
    ...baseCollectionConfig,
    getKey,
    sync: { sync: enhancedInternalSync },
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: {
      refetch,
      ...writeUtils,
      lastError: () => lastError,
      isError: () => !!lastError,
      errorCount: () => errorCount,
      clearError: () => {
        lastError = undefined
        errorCount = 0
        lastErrorUpdatedAt = 0
        return refetch({ throwOnError: true })
      },
    },
  }
}
