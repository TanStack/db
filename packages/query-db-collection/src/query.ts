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
  ResolveInput,
  ResolveType,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"

// Re-export for external use
export type { SyncOperation } from "./manual-sync"

// Infer the explicit type from the queryFn return type
type InferExplicit<TQueryFn, TExplicit> = TQueryFn extends (
  context: QueryFunctionContext<any>
) => Promise<Array<infer TItem>>
  ? TItem extends object
    ? TItem
    : TExplicit
  : TExplicit

// Resolve the item type from the queryFn return type
type ResolveItemType<TExplicit, TSchema, TQueryFn> = ResolveType<
  InferExplicit<TQueryFn, TExplicit>,
  TSchema
>

/**
 * Configuration options for creating a Query Collection
 * @template TExplicit - The explicit type of items in the collection (second priority)
 * @template TSchema - The schema type for validation and type inference (highest priority)
 * @template TKey - The type of the key returned by getKey
 * @template TQueryFn - The queryFn type for inferring return type (third priority)
 * @template TError - The type of errors that can occur during queries
 * @template TQueryKey - The type of the query key
 */
export interface QueryCollectionConfig<
  TExplicit extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema = never,
  TQueryFn extends (
    context: QueryFunctionContext<any>
  ) => Promise<Array<any>> = (
    context: QueryFunctionContext<any>
  ) => Promise<Array<any>>,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
> extends BaseCollectionConfig<TExplicit, TKey, TSchema> {
  /** The query key used by TanStack Query to identify this query */
  queryKey: TQueryKey
  /** Function that fetches data from the server. Must return the complete collection state */
  queryFn: TQueryFn extends (
    context: QueryFunctionContext<TQueryKey>
  ) => Promise<Array<any>>
    ? TQueryFn
    : (
        context: QueryFunctionContext<TQueryKey>
      ) => Promise<Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>>

  /** The TanStack Query client instance */
  queryClient: QueryClient

  // Query-specific options
  /** Whether the query should automatically run (default: true) */
  enabled?: boolean
  refetchInterval?: QueryObserverOptions<
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    TError,
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    TQueryKey
  >[`refetchInterval`]
  retry?: QueryObserverOptions<
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    TError,
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    TQueryKey
  >[`retry`]
  retryDelay?: QueryObserverOptions<
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    TError,
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    TQueryKey
  >[`retryDelay`]
  staleTime?: QueryObserverOptions<
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    TError,
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
    Array<ResolveItemType<TExplicit, TSchema, TQueryFn>>,
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
export type RefetchFn = () => Promise<void>

/**
 * Utility methods available on Query Collections for direct writes and manual operations.
 * Direct writes bypass the normal query/mutation flow and write directly to the synced data store.
 * @template TItem - The type of items stored in the collection
 * @template TKey - The type of the item keys
 * @template TInput - The type accepted for insert operations
 */
export interface QueryCollectionUtils<
  TItem extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TInput extends object = TItem,
> extends UtilsRecord {
  /** Manually trigger a refetch of the query */
  refetch: RefetchFn
  /** Insert one or more items directly into the synced data store without triggering a query refetch or optimistic update */
  writeInsert: (data: TInput | Array<TInput>) => void
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
 * Supports automatic type inference following the priority order:
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
 * @template TInput - The type accepted for insert operations
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
  TExplicit extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema = never,
  TQueryFn extends (
    context: QueryFunctionContext<any>
  ) => Promise<Array<any>> = (
    context: QueryFunctionContext<any>
  ) => Promise<Array<any>>,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TInput extends object = ResolveInput<
    InferExplicit<TQueryFn, TExplicit>,
    TSchema
  >,
>(
  config: QueryCollectionConfig<
    TExplicit,
    TKey,
    TSchema,
    TQueryFn,
    TError,
    TQueryKey
  >
): CollectionConfig<
  InferExplicit<TQueryFn, TExplicit>,
  TKey,
  TSchema,
  TInput
> & {
  utils: QueryCollectionUtils<
    ResolveItemType<TExplicit, TSchema, TQueryFn>,
    TKey,
    TInput
  >
} {
  type TItem = ResolveItemType<TExplicit, TSchema, TQueryFn>

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

  const internalSync: SyncConfig<TItem, TKey>[`sync`] = (params) => {
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

    type UpdateHandler = Parameters<typeof localObserver.subscribe>[0]
    const handleUpdate: UpdateHandler = (result) => {
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
        const newItemsMap = new Map<TKey, TItem>()
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
    write: (message: Omit<ChangeMessage<TItem, TKey>, `key`>) => void
    commit: () => void
  } | null = null

  // Enhanced internalSync that captures write functions for manual use
  const enhancedInternalSync: SyncConfig<TItem, TKey>[`sync`] = (params) => {
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
  const writeUtils = createWriteUtils<TItem, TKey, TInput>(() => writeContext)

  // Create wrapper handlers for direct persistence operations that handle refetching
  const wrappedOnInsert = onInsert
    ? async (params: InsertMutationFnParams<TItem, TKey>) => {
        const handlerResult = (await onInsert(params as any)) ?? {}
        const shouldRefetch =
          (handlerResult as { refetch?: boolean }).refetch !== false

        if (shouldRefetch) {
          await refetch()
        }

        return handlerResult
      }
    : undefined

  const wrappedOnUpdate = onUpdate
    ? async (params: UpdateMutationFnParams<TItem, TKey>) => {
        const handlerResult = (await onUpdate(params as any)) ?? {}
        const shouldRefetch =
          (handlerResult as { refetch?: boolean }).refetch !== false

        if (shouldRefetch) {
          await refetch()
        }

        return handlerResult
      }
    : undefined

  const wrappedOnDelete = onDelete
    ? async (params: DeleteMutationFnParams<TItem, TKey>) => {
        const handlerResult = (await onDelete(params as any)) ?? {}
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
