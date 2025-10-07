import type {
  BaseCollectionConfig,
  CollectionConfig,
  DeleteMutationFnParams,
  InferSchemaOutput,
  InsertMutationFnParams,
  OperationType,
  PendingMutation,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "./types"
import type { StandardSchemaV1 } from "@standard-schema/spec"

/**
 * Configuration interface for Local-only collection options
 * @template T - The type of items in the collection
 * @template TSchema - The schema type for validation
 * @template TKey - The type of the key returned by `getKey`
 */
export interface LocalOnlyCollectionConfig<
  T extends object = object,
  TSchema extends StandardSchemaV1 = never,
  TKey extends string | number = string | number,
> extends Omit<
    BaseCollectionConfig<T, TKey, TSchema, LocalOnlyCollectionUtils>,
    `gcTime` | `startSync`
  > {
  /**
   * Optional initial data to populate the collection with on creation
   * This data will be applied during the initial sync process
   */
  initialData?: Array<T>
}

/**
 * Local-only collection utilities type
 */
export interface LocalOnlyCollectionUtils extends UtilsRecord {
  /**
   * Accepts mutations from a transaction that belong to this collection and persists them.
   * This should be called in your transaction's mutationFn to persist local-only data.
   *
   * @param transaction - The transaction containing mutations to accept
   * @example
   * const localData = createCollection(localOnlyCollectionOptions({...}))
   *
   * const tx = createTransaction({
   *   mutationFn: async ({ transaction }) => {
   *     // Make API call first
   *     await api.save(...)
   *     // Then persist local-only mutations after success
   *     localData.utils.acceptMutations(transaction)
   *   }
   * })
   */
  acceptMutations: (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }) => void
}

/**
 * Creates Local-only collection options for use with a standard Collection
 *
 * This is an in-memory collection that doesn't sync with external sources but uses a loopback sync config
 * that immediately "syncs" all optimistic changes to the collection, making them permanent.
 * Perfect for local-only data that doesn't need persistence or external synchronization.
 *
 * **Using with Manual Transactions:**
 *
 * For manual transactions, you must call `utils.acceptMutations()` in your transaction's `mutationFn`
 * to persist changes made during `tx.mutate()`. This is necessary because local-only collections
 * don't participate in the standard mutation handler flow for manual transactions.
 *
 * @template T - The schema type if a schema is provided, otherwise the type of items in the collection
 * @template TKey - The type of the key returned by getKey
 * @param config - Configuration options for the Local-only collection
 * @returns Collection options with utilities including acceptMutations
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
 *
 * @example
 * // Using with manual transactions
 * const localData = createCollection(
 *   localOnlyCollectionOptions({
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * const tx = createTransaction({
 *   mutationFn: async ({ transaction }) => {
 *     // Use local data in API call
 *     const localMutations = transaction.mutations.filter(m => m.collection === localData)
 *     await api.save({ metadata: localMutations[0]?.modified })
 *
 *     // Persist local-only mutations after API success
 *     localData.utils.acceptMutations(transaction)
 *   }
 * })
 *
 * tx.mutate(() => {
 *   localData.insert({ id: 1, data: 'metadata' })
 *   apiCollection.insert({ id: 2, data: 'main data' })
 * })
 *
 * await tx.commit()
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
): CollectionConfig<T, TKey> & {
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

  /**
   * Accepts mutations from a transaction that belong to this collection and persists them
   */
  const acceptMutations = (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }) => {
    // Filter mutations that belong to this collection
    const collectionMutations = transaction.mutations.filter(
      (m) => m.collection === syncResult.collection
    )

    if (collectionMutations.length === 0) {
      return
    }

    // Persist the mutations through sync
    syncResult.confirmOperationsSync(collectionMutations)
  }

  return {
    ...restConfig,
    sync: syncResult.sync,
    onInsert: wrappedOnInsert as any,
    onUpdate: wrappedOnUpdate as any,
    onDelete: wrappedOnDelete as any,
    utils: {
      acceptMutations,
    } as LocalOnlyCollectionUtils,
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
  // Capture sync functions and collection for transaction confirmation
  let syncBegin: (() => void) | null = null
  let syncWrite: ((message: { type: OperationType; value: T }) => void) | null =
    null
  let syncCommit: (() => void) | null = null
  let collection: any = null

  const sync: SyncConfig<T, TKey> = {
    /**
     * Sync function that captures sync parameters and applies initial data
     * @param params - Sync parameters containing begin, write, and commit functions
     * @returns Unsubscribe function (empty since no ongoing sync is needed)
     */
    sync: (params) => {
      const { begin, write, commit, markReady } = params

      // Capture sync functions and collection for later use
      syncBegin = begin
      syncWrite = write
      syncCommit = commit
      collection = params.collection

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
    collection,
  }
}
