import { QueryObserver } from "@tanstack/query-core"
import {
  DeleteOperationItemNotFoundError,
  DuplicateKeyInBatchError,
  GetKeyRequiredError,
  InvalidItemStructureError,
  InvalidSyncOperationError,
  ItemNotFoundError,
  MissingKeyFieldError,
  QueryClientRequiredError,
  QueryFnRequiredError,
  QueryKeyRequiredError,
  SyncNotInitializedError,
  UnknownOperationTypeError,
  UpdateOperationItemNotFoundError,
} from "./errors"
import type {
  QueryClient,
  QueryFunctionContext,
  QueryKey,
  QueryObserverOptions,
} from "@tanstack/query-core"
import type {
  ChangeMessage,
  Collection,
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

export interface QueryCollectionConfig<
  TItem extends object,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
> {
  queryKey: TQueryKey
  queryFn: (context: QueryFunctionContext<TQueryKey>) => Promise<Array<TItem>>
  queryClient: QueryClient

  // Query-specific options
  enabled?: boolean
  refetchInterval?: QueryObserverOptions<
    Array<TItem>,
    TError,
    Array<TItem>,
    Array<TItem>,
    TQueryKey
  >[`refetchInterval`]
  retry?: QueryObserverOptions<
    Array<TItem>,
    TError,
    Array<TItem>,
    Array<TItem>,
    TQueryKey
  >[`retry`]
  retryDelay?: QueryObserverOptions<
    Array<TItem>,
    TError,
    Array<TItem>,
    Array<TItem>,
    TQueryKey
  >[`retryDelay`]
  staleTime?: QueryObserverOptions<
    Array<TItem>,
    TError,
    Array<TItem>,
    Array<TItem>,
    TQueryKey
  >[`staleTime`]

  // Standard Collection configuration properties
  id?: string
  getKey: CollectionConfig<TItem>[`getKey`]
  schema?: CollectionConfig<TItem>[`schema`]
  sync?: CollectionConfig<TItem>[`sync`]
  startSync?: CollectionConfig<TItem>[`startSync`]

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
  onInsert?: InsertMutationFn<TItem>

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
  onUpdate?: UpdateMutationFn<TItem>

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
  onDelete?: DeleteMutationFn<TItem>
  // TODO type returning { refetch: boolean }
}

/**
 * Type for the refetch utility function
 */
export type RefetchFn = () => Promise<void>

/**
 * Query collection utilities type
 */
/**
 * Sync operation types for batch operations
 */
export type SyncOperation<
  TItem extends object,
  TKey extends string | number,
  TInsertInput extends object,
> =
  | { type: `insert`; data: TInsertInput }
  | { type: `update`; data: Partial<TItem> }
  | { type: `delete`; key: TKey }
  | { type: `upsert`; data: Partial<TItem> }

export interface QueryCollectionUtils<
  TItem extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TInsertInput extends object = TItem,
> extends UtilsRecord {
  refetch: RefetchFn
  syncInsert: (data: TInsertInput | Array<TInsertInput>) => void
  syncUpdate: (updates: Partial<TItem> | Array<Partial<TItem>>) => void
  syncDelete: (keys: TKey | Array<TKey>) => void
  syncUpsert: (data: Partial<TItem> | Array<Partial<TItem>>) => void
  syncBatch: (
    operations: Array<SyncOperation<TItem, TKey, TInsertInput>>
  ) => void
}

/**
 * Creates query collection options for use with a standard Collection
 *
 * @param config - Configuration options for the Query collection
 * @returns Collection options with utilities
 */
export function queryCollectionOptions<
  TItem extends object,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
  TKey extends string | number = string | number,
  TInsertInput extends object = TItem,
>(
  config: QueryCollectionConfig<TItem, TError, TQueryKey>
): CollectionConfig<TItem> & {
  utils: QueryCollectionUtils<TItem, TKey, TInsertInput>
} {
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

  const internalSync: SyncConfig<TItem>[`sync`] = (params: {
    collection: Collection<TItem, TKey, any, any, any>
    begin: () => void
    write: (message: Omit<ChangeMessage<TItem>, `key`>) => void
    commit: () => void
    markReady: () => void
  }) => {
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
          const newItem = newItemsMap.get(key as unknown as TKey)
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

  // Store references to sync functions for manual sync operations
  let syncFunctions: {
    begin: () => void
    write: (message: Omit<ChangeMessage<TItem>, `key`>) => void
    commit: () => void
    collection: Collection<TItem, TKey, any, any, any>
  } | null = null

  // Enhanced internalSync that captures sync functions for manual use
  const enhancedInternalSync: SyncConfig<TItem>[`sync`] = (params: {
    collection: Collection<TItem, TKey, any, any, any>
    begin: () => void
    write: (message: Omit<ChangeMessage<TItem>, `key`>) => void
    commit: () => void
    markReady: () => void
  }) => {
    const { begin, write, commit, collection } = params

    // Store references for manual sync operations
    syncFunctions = { begin, write, commit, collection }

    // Call the original internalSync logic
    return internalSync(params)
  }

  /**
   * Manually insert items into collection state for synchronization purposes
   * Uses the proper sync transaction pattern (begin/write/commit) for consistency
   * @param data - Item or array of items to insert
   * @param options - Optional configuration for validation
   * @throws {Error} If collection is not ready or items have duplicate keys
   */
  const syncInsert = (data: TInsertInput | Array<TInsertInput>): void => {
    if (!syncFunctions) {
      throw new SyncNotInitializedError()
    }

    const { begin, write, commit } = syncFunctions
    const items = Array.isArray(data) ? data : [data]

    // Validate all items first before starting transaction
    const validatedItems: Array<TItem> = []
    for (const item of items) {
      // For query collections, we use the getKey function to validate structure
      let validatedData: TItem
      try {
        validatedData = item as unknown as TItem
        getKey(validatedData) // This will throw if the item doesn't have the required key
      } catch (error) {
        throw new InvalidItemStructureError(String(error))
      }

      validatedItems.push(validatedData)
    }

    // Use proper sync transaction pattern
    begin()

    // Write all validated items
    for (const validatedItem of validatedItems) {
      write({ type: `insert`, value: validatedItem })
    }

    // Commit the transaction
    commit()

    // Update query cache to reflect the new state
    const currentData = syncFunctions.collection.toArray
    queryClient.setQueryData(queryKey, currentData)
  }

  /**
   * Manually update existing items in collection state for synchronization purposes
   * Uses the proper sync transaction pattern (begin/write/commit) for consistency
   * @param updates - Partial item or array of partial items to update
   * @param options - Optional configuration for validation and existence checks
   * @throws {Error} If collection is not ready or items don't exist
   */
  const syncUpdate = (
    updates: Partial<TItem> | Array<Partial<TItem>>
  ): void => {
    if (!syncFunctions) {
      throw new SyncNotInitializedError()
    }

    const { begin, write, commit, collection } = syncFunctions
    const items = Array.isArray(updates) ? updates : [updates]

    // Validate all items and prepare full objects for update
    const itemsToUpdate: Array<TItem> = []
    for (const partialItem of items) {
      // Extract key from partial item (it must contain the key field)
      let key: TKey
      try {
        key = getKey(partialItem as TItem) as TKey
      } catch (error) {
        throw new MissingKeyFieldError(`Update`, String(error))
      }

      // Get existing item and merge with update
      const existingItem = collection.get(key)
      if (!existingItem) {
        throw new ItemNotFoundError(key)
      }

      const mergedItem = { ...existingItem, ...partialItem } as TItem
      itemsToUpdate.push(mergedItem)
    }

    if (itemsToUpdate.length === 0) {
      return // Nothing to update
    }

    // Use proper sync transaction pattern
    begin()

    // Write all updated items
    for (const updatedItem of itemsToUpdate) {
      write({ type: `update`, value: updatedItem })
    }

    // Commit the transaction
    commit()

    // Update query cache to reflect the new state
    const currentData = syncFunctions.collection.toArray
    queryClient.setQueryData(queryKey, currentData)
  }

  /**
   * Manually delete items from collection state for synchronization purposes
   * Uses the proper sync transaction pattern (begin/write/commit) for consistency
   * @param keys - Single key or array of keys to delete
   * @param options - Optional configuration for existence checks
   * @throws {Error} If collection is not ready or items don't exist
   */
  const syncDelete = (keys: TKey | Array<TKey>): void => {
    if (!syncFunctions) {
      throw new SyncNotInitializedError()
    }

    const { begin, write, commit, collection } = syncFunctions
    const keyArray = Array.isArray(keys) ? keys : [keys]
    const itemsToDelete: Array<TItem> = []

    // Collect items to delete and validate existence
    for (const key of keyArray) {
      const item = collection.get(key)
      if (!item) {
        throw new ItemNotFoundError(key)
      }
      itemsToDelete.push(item)
    }

    if (itemsToDelete.length === 0) {
      return // Nothing to delete
    }

    // Use proper sync transaction pattern
    begin()

    // Write all delete operations
    for (const item of itemsToDelete) {
      write({ type: `delete`, value: item })
    }

    // Commit the transaction
    commit()

    // Update query cache to reflect the new state
    const currentData = syncFunctions.collection.toArray
    queryClient.setQueryData(queryKey, currentData)
  }

  /**
   * Manually upsert (insert or update) items in collection state for synchronization purposes
   * Uses the proper sync transaction pattern (begin/write/commit) for consistency
   * @param data - Partial item or array of partial items to upsert
   * @param options - Optional configuration for validation
   */
  const syncUpsert = (data: Partial<TItem> | Array<Partial<TItem>>): void => {
    if (!syncFunctions) {
      throw new SyncNotInitializedError()
    }

    const { begin, write, commit, collection } = syncFunctions
    const items = Array.isArray(data) ? data : [data]
    const upsertOperations: Array<{ type: `insert` | `update`; item: TItem }> =
      []

    // Process each item for upsert
    for (const partialItem of items) {
      // Extract key from partial item (it must contain the key field)
      let key: TKey
      try {
        key = getKey(partialItem as TItem) as TKey
      } catch (error) {
        throw new MissingKeyFieldError(`Upsert`, String(error))
      }

      const exists = collection.has(key)
      let fullItem: TItem

      if (exists) {
        // Update: merge with existing item
        const existingItem = collection.get(key)
        fullItem = { ...existingItem, ...partialItem } as TItem
        upsertOperations.push({ type: `update`, item: fullItem })
      } else {
        // Insert: use as-is (assuming it has all required fields)
        fullItem = partialItem as TItem
        upsertOperations.push({ type: `insert`, item: fullItem })
      }
    }

    if (upsertOperations.length === 0) {
      return // Nothing to upsert
    }

    // Use proper sync transaction pattern
    begin()

    // Write all upsert operations
    for (const { type, item } of upsertOperations) {
      write({ type, value: item })
    }

    // Commit the transaction
    commit()

    // Update query cache to reflect the new state
    const currentData = syncFunctions.collection.toArray
    queryClient.setQueryData(queryKey, currentData)
  }

  /**
   * Perform multiple sync operations atomically in a single transaction
   * Validates for duplicate keys and conflicting operations within the batch
   * @param operations - Array of sync operations to perform
   * @param options - Optional configuration for validation and existence checks
   */
  const syncBatch = (
    operations: Array<SyncOperation<TItem, TKey, TInsertInput>>
  ): void => {
    if (!syncFunctions) {
      throw new SyncNotInitializedError()
    }

    const { begin, write, commit, collection } = syncFunctions

    // Validate operations and check for conflicts
    const seenKeys = new Set<TKey>()
    const processedOperations: Array<{
      type: `insert` | `update` | `delete`
      value: TItem
    }> = []

    for (const operation of operations) {
      let key: TKey
      let value: TItem

      switch (operation.type) {
        case `insert`: {
          try {
            value = operation.data as unknown as TItem
            key = getKey(value) as TKey
          } catch (error) {
            throw new InvalidSyncOperationError(String(error))
          }

          // Check for duplicate keys within batch
          if (seenKeys.has(key)) {
            throw new DuplicateKeyInBatchError(key)
          }
          seenKeys.add(key)

          processedOperations.push({ type: `insert`, value })
          break
        }

        case `update`: {
          try {
            key = getKey(operation.data as TItem) as TKey
          } catch (error) {
            throw new InvalidSyncOperationError(String(error))
          }

          // Check for duplicate keys within batch
          if (seenKeys.has(key)) {
            throw new DuplicateKeyInBatchError(key)
          }
          seenKeys.add(key)

          // Get existing item and merge with update
          const existingItem = collection.get(key)
          if (!existingItem) {
            throw new UpdateOperationItemNotFoundError(key)
          }

          value = { ...existingItem, ...operation.data } as TItem
          processedOperations.push({ type: `update`, value })
          break
        }

        case `delete`: {
          key = operation.key

          // Check for duplicate keys within batch
          if (seenKeys.has(key)) {
            throw new DuplicateKeyInBatchError(key)
          }
          seenKeys.add(key)

          const item = collection.get(key)
          if (!item) {
            throw new DeleteOperationItemNotFoundError(key)
          }
          processedOperations.push({ type: `delete`, value: item })
          break
        }

        case `upsert`: {
          try {
            key = getKey(operation.data as TItem) as TKey
          } catch (error) {
            throw new InvalidSyncOperationError(String(error))
          }

          // Check for duplicate keys within batch
          if (seenKeys.has(key)) {
            throw new DuplicateKeyInBatchError(key)
          }
          seenKeys.add(key)

          const exists = collection.has(key)
          if (exists) {
            // Update: merge with existing item
            const existingItem = collection.get(key)
            value = { ...existingItem, ...operation.data } as TItem
            processedOperations.push({ type: `update`, value })
          } else {
            // Insert: use as-is
            value = operation.data as TItem
            processedOperations.push({ type: `insert`, value })
          }
          break
        }

        default:
          throw new UnknownOperationTypeError((operation as any).type)
      }
    }

    if (processedOperations.length === 0) {
      return // Nothing to process
    }

    // Execute all operations in a single transaction
    begin()

    for (const op of processedOperations) {
      write({ type: op.type, value: op.value })
    }

    commit()

    // Update query cache to reflect the new state
    const currentData = collection.toArray
    queryClient.setQueryData(queryKey, currentData)
  }

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
      syncInsert,
      syncUpdate,
      syncDelete,
      syncUpsert,
      syncBatch,
    },
  }
}
