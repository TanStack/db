import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InferSchemaOutput,
  InsertMutationFnParams,
  OperationType,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "./types"
import type { StandardSchemaV1 } from "@standard-schema/spec"

/**
 * Configuration interface for Local-only collection options
 * @template T - The type of items in the collection
 * @template TSchema - The schema type for validation
 * @template TKey - The type of the key returned by getKey
 */
export interface LocalOnlyCollectionConfig<
  T extends object = object,
  TSchema extends StandardSchemaV1 = never,
  TKey extends string | number = string | number,
> {
  /**
   * Standard Collection configuration properties
   */
  id?: string
  schema?: TSchema
  getKey: (item: T) => TKey

  /**
   * Optional initial data to populate the collection with on creation
   * This data will be applied during the initial sync process
   */
  initialData?: Array<T>

  /**
   * Optional asynchronous handler function called after an insert operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to any value
   */
  onInsert?: (
    params: InsertMutationFnParams<T, TKey, LocalOnlyCollectionUtils>
  ) => Promise<any>

  /**
   * Optional asynchronous handler function called after an update operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to any value
   */
  onUpdate?: (
    params: UpdateMutationFnParams<T, TKey, LocalOnlyCollectionUtils>
  ) => Promise<any>

  /**
   * Optional asynchronous handler function called after a delete operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to any value
   */
  onDelete?: (
    params: DeleteMutationFnParams<T, TKey, LocalOnlyCollectionUtils>
  ) => Promise<any>
}

/**
 * Local-only collection utilities type (currently empty but matches the pattern)
 */
export interface LocalOnlyCollectionUtils extends UtilsRecord {}

/**
 * Creates Local-only collection options for use with a standard Collection
 *
 * This is an in-memory collection that doesn't sync with external sources but uses a loopback sync config
 * that immediately "syncs" all optimistic changes to the collection, making them permanent.
 * Perfect for local-only data that doesn't need persistence or external synchronization.
 *
 * @template T - The schema type if a schema is provided, otherwise the type of items in the collection
 * @template TKey - The type of the key returned by getKey
 * @param config - Configuration options for the Local-only collection
 * @returns Collection options with utilities (currently empty but follows the pattern)
 *
 * @example
 * // Basic local-only collection
 * const collection = createCollection(
 *   localOnlyCollectionOptions({
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * @example
 * // Local-only collection with initial data
 * const collection = createCollection(
 *   localOnlyCollectionOptions({
 *     getKey: (item) => item.id,
 *     initialData: [
 *       { id: 1, name: 'Item 1' },
 *       { id: 2, name: 'Item 2' },
 *     ],
 *   })
 * )
 *
 * @example
 * // Local-only collection with mutation handlers
 * const collection = createCollection(
 *   localOnlyCollectionOptions({
 *     getKey: (item) => item.id,
 *     onInsert: async ({ transaction }) => {
 *       console.log('Item inserted:', transaction.mutations[0].modified)
 *       // Custom logic after insert
 *     },
 *   })
 * )
 */

// Overload for when schema is provided
export function localOnlyCollectionOptions<
  T extends StandardSchemaV1,
  TKey extends string | number = string | number,
>(
  config: LocalOnlyCollectionConfig<InferSchemaOutput<T>, T, TKey> & {
    schema: T
  }
): CollectionConfig<InferSchemaOutput<T>, TKey, T> & {
  utils: LocalOnlyCollectionUtils
  schema: T
}

// Overload for when no schema is provided
// the type T needs to be passed explicitly unless it can be inferred from the getKey function in the config
export function localOnlyCollectionOptions<
  T extends object,
  TKey extends string | number = string | number,
>(
  config: LocalOnlyCollectionConfig<T, never, TKey> & {
    schema?: never // prohibit schema
  }
): CollectionConfig<T, TKey, never> & {
  utils: LocalOnlyCollectionUtils
  schema?: never // no schema in the result
}

export function localOnlyCollectionOptions(
  config: LocalOnlyCollectionConfig<any, any, string | number>
): CollectionConfig<any, string | number, any> & {
  utils: LocalOnlyCollectionUtils
  schema?: StandardSchemaV1
} {
  const { initialData, onInsert, onUpdate, onDelete, ...restConfig } = config

  // Create the sync configuration with transaction confirmation capability
  const syncResult = createLocalOnlySync(initialData)

  /**
   * Create wrapper handlers that call user handlers first, then confirm transactions
   * Wraps the user's onInsert handler to also confirm the transaction immediately
   */
  const wrappedOnInsert = async (
    params: InsertMutationFnParams<
      any,
      string | number,
      LocalOnlyCollectionUtils
    >
  ) => {
    // Call user handler first if provided
    let handlerResult
    if (onInsert) {
      handlerResult = (await onInsert(params)) ?? {}
    }

    // Then synchronously confirm the transaction by looping through mutations
    syncResult.confirmOperationsSync(params.transaction.mutations)

    return handlerResult
  }

  /**
   * Wrapper for onUpdate handler that also confirms the transaction immediately
   */
  const wrappedOnUpdate = async (
    params: UpdateMutationFnParams<
      any,
      string | number,
      LocalOnlyCollectionUtils
    >
  ) => {
    // Call user handler first if provided
    let handlerResult
    if (onUpdate) {
      handlerResult = (await onUpdate(params)) ?? {}
    }

    // Then synchronously confirm the transaction by looping through mutations
    syncResult.confirmOperationsSync(params.transaction.mutations)

    return handlerResult
  }

  /**
   * Wrapper for onDelete handler that also confirms the transaction immediately
   */
  const wrappedOnDelete = async (
    params: DeleteMutationFnParams<
      any,
      string | number,
      LocalOnlyCollectionUtils
    >
  ) => {
    // Call user handler first if provided
    let handlerResult
    if (onDelete) {
      handlerResult = (await onDelete(params)) ?? {}
    }

    // Then synchronously confirm the transaction by looping through mutations
    syncResult.confirmOperationsSync(params.transaction.mutations)

    return handlerResult
  }

  return {
    ...restConfig,
    sync: syncResult.sync,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: {} as LocalOnlyCollectionUtils,
    startSync: true,
    gcTime: 0,
  }
}

/**
 * Internal function to create Local-only sync configuration with transaction confirmation
 *
 * This captures the sync functions and provides synchronous confirmation of operations.
 * It creates a loopback sync that immediately confirms all optimistic operations,
 * making them permanent in the collection.
 *
 * @param initialData - Optional array of initial items to populate the collection
 * @returns Object with sync configuration and confirmOperationsSync function
 */
function createLocalOnlySync<T extends object, TKey extends string | number>(
  initialData?: Array<T>
) {
  // Capture sync functions for transaction confirmation
  let syncBegin: (() => void) | null = null
  let syncWrite: ((message: { type: OperationType; value: T }) => void) | null =
    null
  let syncCommit: (() => void) | null = null

  const sync: SyncConfig<T, TKey> = {
    /**
     * Sync function that captures sync parameters and applies initial data
     * @param params - Sync parameters containing begin, write, and commit functions
     * @returns Unsubscribe function (empty since no ongoing sync is needed)
     */
    sync: (params) => {
      const { begin, write, commit, markReady } = params

      // Capture sync functions for later use by confirmOperationsSync
      syncBegin = begin
      syncWrite = write
      syncCommit = commit

      // Apply initial data if provided
      if (initialData && initialData.length > 0) {
        begin()
        initialData.forEach((item) => {
          write({
            type: `insert`,
            value: item,
          })
        })
        commit()
      }

      // Mark collection as ready since local-only collections are immediately ready
      markReady()

      // Return empty unsubscribe function - no ongoing sync needed
      return () => {}
    },
    /**
     * Get sync metadata - returns empty object for local-only collections
     * @returns Empty metadata object
     */
    getSyncMetadata: () => ({}),
  }

  /**
   * Synchronously confirms optimistic operations by immediately writing through sync
   *
   * This loops through transaction mutations and applies them to move from optimistic to synced state.
   * It's called after user handlers to make optimistic changes permanent.
   *
   * @param mutations - Array of mutation objects from the transaction
   */
  const confirmOperationsSync = (mutations: Array<any>) => {
    if (!syncBegin || !syncWrite || !syncCommit) {
      return // Sync not initialized yet, which is fine
    }

    // Immediately write back through sync interface
    syncBegin()
    mutations.forEach((mutation) => {
      if (syncWrite) {
        syncWrite({
          type: mutation.type,
          value: mutation.modified,
        })
      }
    })
    syncCommit()
  }

  return {
    sync,
    confirmOperationsSync,
  }
}
