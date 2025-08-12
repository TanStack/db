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
  ChangeMessage,
  CollectionConfig,
  DeleteMutationFn,
  DeleteMutationFnParams,
  InsertMutationFn,
  InsertMutationFnParams,
  SyncConfig,
  UpdateMutationFn,
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

// QueryFn return type inference helper
type InferQueryFnOutput<TQueryFn> = TQueryFn extends (
  context: QueryFunctionContext<any>
) => Promise<Array<infer TItem>>
  ? TItem extends object
    ? TItem
    : Record<string, unknown>
  : Record<string, unknown>

// Type resolution system with priority order (matches electric.ts pattern)
type ResolveType<
  TExplicit extends object | unknown = unknown,
  TSchema extends StandardSchemaV1 = never,
  TQueryFn = unknown,
> = unknown extends TExplicit
  ? [TSchema] extends [never]
    ? InferQueryFnOutput<TQueryFn>
    : InferSchemaOutput<TSchema>
  : TExplicit

/**
 * Configuration options for creating a Query Collection
 * @template TExplicit - The explicit type of items stored in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TQueryFn - The queryFn type for inferring return type (third priority)
 * @template TError - The type of errors that can occur during queries
 * @template TQueryKey - The type of the query key
 */
export interface QueryCollectionConfig<
  TExplicit extends object = object,
  TSchema extends StandardSchemaV1 = never,
  TQueryFn extends (
    context: QueryFunctionContext<any>
  ) => Promise<Array<any>> = (
    context: QueryFunctionContext<any>
  ) => Promise<Array<any>>,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
> {
  /** The query key used by TanStack Query to identify this query */
  queryKey: TQueryKey
  /** Function that fetches data from the server. Must return the complete collection state */
  queryFn: TQueryFn extends (
    context: QueryFunctionContext<TQueryKey>
  ) => Promise<Array<any>>
    ? TQueryFn
    : (
        context: QueryFunctionContext<TQueryKey>
      ) => Promise<Array<ResolveType<TExplicit, TSchema, TQueryFn>>>

  /** The TanStack Query client instance */
  queryClient: QueryClient

  // Query-specific options
  /** Whether the query should automatically run (default: true) */
  enabled?: boolean
  refetchInterval?: QueryObserverOptions<
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    TError,
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    TQueryKey
  >[`refetchInterval`]
  retry?: QueryObserverOptions<
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    TError,
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    TQueryKey
  >[`retry`]
  retryDelay?: QueryObserverOptions<
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    TError,
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    TQueryKey
  >[`retryDelay`]
  staleTime?: QueryObserverOptions<
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    TError,
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    Array<ResolveType<TExplicit, TSchema, TQueryFn>>,
    TQueryKey
  >[`staleTime`]

  // Standard Collection configuration properties
  /** Unique identifier for the collection */
  id?: string
  /** Function to extract the unique key from an item */
  getKey: CollectionConfig<ResolveType<TExplicit, TSchema, TQueryFn>>[`getKey`]
  /** Schema for validating items */
  schema?: TSchema
  sync?: CollectionConfig<ResolveType<TExplicit, TSchema, TQueryFn>>[`sync`]
  startSync?: CollectionConfig<
    ResolveType<TExplicit, TSchema, TQueryFn>
  >[`startSync`]

  // Direct persistence handlers
  /**
   * Optional asynchronous handler function called before an insert operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to void or { refetch?: boolean } to control refetching
   * @example
   * // Basic query collection insert handler
   * onInsert: async ({ transaction }) => {
   *   const newItem = transaction.mutations[0].modified
   *   await api.createTodo(newItem)
   *   // Automatically refetches query after insert
   * }
   *
   * @example
   * // Insert handler with refetch control
   * onInsert: async ({ transaction }) => {
   *   const newItem = transaction.mutations[0].modified
   *   await api.createTodo(newItem)
   *   return { refetch: false } // Skip automatic refetch
   * }
   *
   * @example
   * // Insert handler with multiple items
   * onInsert: async ({ transaction }) => {
   *   const items = transaction.mutations.map(m => m.modified)
   *   await api.createTodos(items)
   *   // Will refetch query to get updated data
   * }
   *
   * @example
   * // Insert handler with error handling
   * onInsert: async ({ transaction }) => {
   *   try {
   *     const newItem = transaction.mutations[0].modified
   *     await api.createTodo(newItem)
   *   } catch (error) {
   *     console.error('Insert failed:', error)
   *     throw error // Transaction will rollback optimistic changes
   *   }
   * }
   */
  onInsert?: InsertMutationFn<ResolveType<TExplicit, TSchema, TQueryFn>>

  /**
   * Optional asynchronous handler function called before an update operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to void or { refetch?: boolean } to control refetching
   * @example
   * // Basic query collection update handler
   * onUpdate: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.updateTodo(mutation.original.id, mutation.changes)
   *   // Automatically refetches query after update
   * }
   *
   * @example
   * // Update handler with multiple items
   * onUpdate: async ({ transaction }) => {
   *   const updates = transaction.mutations.map(m => ({
   *     id: m.key,
   *     changes: m.changes
   *   }))
   *   await api.updateTodos(updates)
   *   // Will refetch query to get updated data
   * }
   *
   * @example
   * // Update handler with manual refetch
   * onUpdate: async ({ transaction, collection }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.updateTodo(mutation.original.id, mutation.changes)
   *
   *   // Manually trigger refetch
   *   await collection.utils.refetch()
   *
   *   return { refetch: false } // Skip automatic refetch
   * }
   *
   * @example
   * // Update handler with related collection refetch
   * onUpdate: async ({ transaction, collection }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.updateTodo(mutation.original.id, mutation.changes)
   *
   *   // Refetch related collections when this item changes
   *   await Promise.all([
   *     collection.utils.refetch(), // Refetch this collection
   *     usersCollection.utils.refetch(), // Refetch users
   *     tagsCollection.utils.refetch() // Refetch tags
   *   ])
   *
   *   return { refetch: false } // Skip automatic refetch since we handled it manually
   * }
   */
  onUpdate?: UpdateMutationFn<ResolveType<TExplicit, TSchema, TQueryFn>>

  /**
   * Optional asynchronous handler function called before a delete operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to void or { refetch?: boolean } to control refetching
   * @example
   * // Basic query collection delete handler
   * onDelete: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.deleteTodo(mutation.original.id)
   *   // Automatically refetches query after delete
   * }
   *
   * @example
   * // Delete handler with refetch control
   * onDelete: async ({ transaction }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.deleteTodo(mutation.original.id)
   *   return { refetch: false } // Skip automatic refetch
   * }
   *
   * @example
   * // Delete handler with multiple items
   * onDelete: async ({ transaction }) => {
   *   const keysToDelete = transaction.mutations.map(m => m.key)
   *   await api.deleteTodos(keysToDelete)
   *   // Will refetch query to get updated data
   * }
   *
   * @example
   * // Delete handler with related collection refetch
   * onDelete: async ({ transaction, collection }) => {
   *   const mutation = transaction.mutations[0]
   *   await api.deleteTodo(mutation.original.id)
   *
   *   // Refetch related collections when this item is deleted
   *   await Promise.all([
   *     collection.utils.refetch(), // Refetch this collection
   *     usersCollection.utils.refetch(), // Refetch users
   *     projectsCollection.utils.refetch() // Refetch projects
   *   ])
   *
   *   return { refetch: false } // Skip automatic refetch since we handled it manually
   * }
   */
  onDelete?: DeleteMutationFn<ResolveType<TExplicit, TSchema, TQueryFn>>

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
export type RefetchFn = () => Promise<void>

/**
 * Utility methods available on Query Collections for direct writes and manual operations.
 * Direct writes bypass the normal query/mutation flow and write directly to the synced data store.
 * @template TItem - The type of items stored in the collection
 * @template TKey - The type of the item keys
 * @template TInsertInput - The type accepted for insert operations
 */
export interface QueryCollectionUtils<
  TItem extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TInsertInput extends object = TItem,
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
}

/**
 * Creates query collection options for use with a standard Collection.
 * This integrates TanStack Query with TanStack DB for automatic synchronization.
 *
 * Supports automatic type inference following the same priority as electric-db-collection:
 * 1. Explicit type (highest priority)
 * 2. Schema inference (second priority)
 * 3. QueryFn return type inference (third priority)
 * 4. Fallback to Record<string, unknown>
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TQueryFn - The queryFn type for inferring return type (third priority)
 * @template TError - The type of errors that can occur during queries
 * @template TQueryKey - The type of the query key
 * @template TKey - The type of the item keys
 * @template TInsertInput - The type accepted for insert operations
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
 * // Explicit type (highest priority)
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
 * // Schema inference (second priority)
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
export function queryCollectionOptions<
  TExplicit extends object = object,
  TSchema extends StandardSchemaV1 = never,
  TQueryFn extends (
    context: QueryFunctionContext<any>
  ) => Promise<Array<any>> = (
    context: QueryFunctionContext<any>
  ) => Promise<Array<any>>,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
  TInsertInput extends object = ResolveType<TExplicit, TSchema, TQueryFn>,
>(
  config: QueryCollectionConfig<TExplicit, TSchema, TQueryFn, TError, TQueryKey>
): CollectionConfig<ResolveType<TExplicit, TSchema, TQueryFn>> & {
  utils: QueryCollectionUtils<
    ResolveType<TExplicit, TSchema, TQueryFn>,
    TKey,
    TInsertInput
  >
} {
  type TItem = ResolveType<TExplicit, TSchema, TQueryFn>

  const {
    queryKey,
    queryFn,
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

  const internalSync: SyncConfig<TItem>[`sync`] = (params) => {
    const { begin, write, commit, markReady, collection } = params

    const observerOptions: QueryObserverOptions<
      Array<TItem>,
      TError,
      Array<TItem>,
      Array<TItem>,
      TQueryKey
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
      Array<TItem>,
      TError,
      Array<TItem>,
      Array<TItem>,
      TQueryKey
    >(queryClient, observerOptions)

    const actualUnsubscribeFn = localObserver.subscribe((result) => {
      if (result.isSuccess) {
        const newItemsArray = result.data

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
        const newItemsMap = new Map<string | number, TItem>()
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
            if (typeof obj1[key] === `object` && obj1[key] !== null) {
              // For nested objects, just compare references
              // A more robust solution might do recursive shallow comparison
              // or let users provide a custom equality function
              return obj1[key] === obj2[key]
            }
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
        console.error(
          `[QueryCollection] Error observing query ${String(queryKey)}:`,
          result.error
        )

        // Mark collection as ready even on error to avoid blocking apps
        markReady()
      }
    })

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
  const refetch: RefetchFn = async (): Promise<void> => {
    return queryClient.refetchQueries({
      queryKey: queryKey,
    })
  }

  // Create write context for manual write operations
  let writeContext: {
    collection: any
    queryClient: QueryClient
    queryKey: Array<unknown>
    getKey: (item: TItem) => TKey
    begin: () => void
    write: (message: Omit<ChangeMessage<TItem>, `key`>) => void
    commit: () => void
  } | null = null

  // Enhanced internalSync that captures write functions for manual use
  const enhancedInternalSync: SyncConfig<TItem>[`sync`] = (params) => {
    const { begin, write, commit, collection } = params

    // Store references for manual write operations
    writeContext = {
      collection,
      queryClient,
      queryKey: queryKey as unknown as Array<unknown>,
      getKey: getKey as (item: TItem) => TKey,
      begin,
      write,
      commit,
    }

    // Call the original internalSync logic
    return internalSync(params)
  }

  // Create write utils using the manual-sync module
  const writeUtils = createWriteUtils<TItem, TKey, TInsertInput>(
    () => writeContext
  )

  // Create wrapper handlers for direct persistence operations that handle refetching
  const wrappedOnInsert = onInsert
    ? async (params: InsertMutationFnParams<TItem>) => {
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
    ? async (params: UpdateMutationFnParams<TItem>) => {
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
    ? async (params: DeleteMutationFnParams<TItem>) => {
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
    },
  }
}
