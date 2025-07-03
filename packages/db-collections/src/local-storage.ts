import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  ResolveType,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"

/**
 * Storage API interface - subset of DOM Storage that we need
 */
export type StorageApi = Pick<Storage, `getItem` | `setItem` | `removeItem`>

/**
 * Storage event API - subset of Window for 'storage' events only
 */
export type StorageEventApi = {
  addEventListener: (
    type: `storage`,
    listener: (event: StorageEvent) => void
  ) => void
  removeEventListener: (
    type: `storage`,
    listener: (event: StorageEvent) => void
  ) => void
}

/**
 * Internal storage format that includes version tracking
 */
interface StoredItem<T> {
  versionKey: string
  data: T
}

/**
 * Configuration interface for localStorage collection options
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 *
 * @remarks
 * Type resolution follows a priority order:
 * 1. If you provide an explicit type via generic parameter, it will be used
 * 2. If no explicit type is provided but a schema is, the schema's output type will be inferred
 * 3. If neither explicit type nor schema is provided, the fallback type will be used
 *
 * You should provide EITHER an explicit type OR a schema, but not both, as they would conflict.
 */
export interface LocalStorageCollectionConfig<
  TExplicit = unknown,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
> {
  /**
   * The key to use for storing the collection data in localStorage/sessionStorage
   */
  storageKey: string

  /**
   * Storage API to use (defaults to window.localStorage)
   * Can be any object that implements the Storage interface (e.g., sessionStorage)
   */
  storage?: StorageApi

  /**
   * Storage event API to use for cross-tab synchronization (defaults to window)
   * Can be any object that implements addEventListener/removeEventListener for storage events
   */
  storageEventApi?: StorageEventApi

  /**
   * Collection identifier (defaults to "local-collection:{storageKey}" if not provided)
   */
  id?: string
  schema?: TSchema
  getKey: CollectionConfig<ResolveType<TExplicit, TSchema, TFallback>>[`getKey`]
  sync?: CollectionConfig<ResolveType<TExplicit, TSchema, TFallback>>[`sync`]

  /**
   * Optional asynchronous handler function called before an insert operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onInsert?: (
    params: InsertMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<any>

  /**
   * Optional asynchronous handler function called before an update operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onUpdate?: (
    params: UpdateMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<any>

  /**
   * Optional asynchronous handler function called before a delete operation
   * @param params Object containing transaction and mutation information
   * @returns Promise resolving to any value
   */
  onDelete?: (
    params: DeleteMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<any>
}

/**
 * Type for the clear utility function
 */
export type ClearStorageFn = () => void

/**
 * Type for the getStorageSize utility function
 */
export type GetStorageSizeFn = () => number

/**
 * LocalStorage collection utilities type
 */
export interface LocalStorageCollectionUtils extends UtilsRecord {
  clearStorage: ClearStorageFn
  getStorageSize: GetStorageSizeFn
}

/**
 * Validates that a value can be JSON serialized
 */
function validateJsonSerializable(value: any, operation: string): void {
  try {
    JSON.stringify(value)
  } catch (error) {
    throw new Error(
      `Cannot ${operation} item because it cannot be JSON serialized: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

/**
 * Generate a UUID for version tracking
 */
function generateUuid(): string {
  return crypto.randomUUID()
}

/**
 * Creates localStorage collection options for use with a standard Collection
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param config - Configuration options for the localStorage collection
 * @returns Collection options with utilities
 */
export function localStorageCollectionOptions<
  TExplicit = unknown,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
>(config: LocalStorageCollectionConfig<TExplicit, TSchema, TFallback>) {
  type ResolvedType = ResolveType<TExplicit, TSchema, TFallback>

  // Validate required parameters
  if (!config.storageKey) {
    throw new Error(`[LocalStorageCollection] storageKey must be provided.`)
  }

  // Default to window.localStorage if no storage is provided
  const storage =
    config.storage ||
    (typeof window !== `undefined` ? window.localStorage : null)

  if (!storage) {
    throw new Error(
      `[LocalStorageCollection] No storage available. Please provide a storage option or ensure window.localStorage is available.`
    )
  }

  // Default to window for storage events if not provided
  const storageEventApi =
    config.storageEventApi || (typeof window !== `undefined` ? window : null)

  if (!storageEventApi) {
    throw new Error(
      `[LocalStorageCollection] No storage event API available. Please provide a storageEventApi option or ensure window is available.`
    )
  }

  // Track the last known state to detect changes
  const lastKnownData = new Map<string | number, StoredItem<ResolvedType>>()

  // Create the sync configuration
  const sync = createLocalStorageSync<ResolvedType>(
    config.storageKey,
    storage,
    storageEventApi,
    config.getKey,
    lastKnownData
  )

  // Manual trigger function for local sync updates
  const triggerLocalSync = () => {
    if (sync.manualTrigger) {
      sync.manualTrigger()
    }
  }

  /**
   * Save data to storage
   */
  const saveToStorage = (
    dataMap: Map<string | number, StoredItem<ResolvedType>>
  ): void => {
    try {
      // Convert Map to object format for storage
      const objectData: Record<string, StoredItem<ResolvedType>> = {}
      dataMap.forEach((storedItem, key) => {
        objectData[String(key)] = storedItem
      })
      const serialized = JSON.stringify(objectData)
      storage.setItem(config.storageKey, serialized)
    } catch (error) {
      console.error(
        `[LocalStorageCollection] Error saving data to storage key "${config.storageKey}":`,
        error
      )
      throw error
    }
  }

  /**
   * Clear all data from the storage key
   */
  const clearStorage: ClearStorageFn = (): void => {
    storage.removeItem(config.storageKey)
  }

  /**
   * Get the size of the stored data in bytes (approximate)
   */
  const getStorageSize: GetStorageSizeFn = (): number => {
    const data = storage.getItem(config.storageKey)
    return data ? new Blob([data]).size : 0
  }

  // Create wrapper handlers for direct persistence operations that perform actual storage operations
  const wrappedOnInsert = config.onInsert
    ? async (params: InsertMutationFnParams<ResolvedType>) => {
        // Validate that all values in the transaction can be JSON serialized
        params.transaction.mutations.forEach((mutation) => {
          validateJsonSerializable(mutation.modified, `insert`)
        })

        // Call the user handler BEFORE persisting changes
        const handlerResult = (await config.onInsert!(params)) ?? {}

        // Only persist to storage if the handler succeeded
        // Load current data from storage
        const currentData = loadFromStorage<ResolvedType>(
          config.storageKey,
          storage
        )

        // Add new items with version keys
        params.transaction.mutations.forEach((mutation) => {
          const key = config.getKey(mutation.modified)
          const storedItem: StoredItem<ResolvedType> = {
            versionKey: generateUuid(),
            data: mutation.modified,
          }
          currentData.set(key, storedItem)
        })

        // Save to storage
        saveToStorage(currentData)

        // Manually trigger local sync since storage events don't fire for current tab
        triggerLocalSync()

        return handlerResult
      }
    : undefined

  const wrappedOnUpdate = config.onUpdate
    ? async (params: UpdateMutationFnParams<ResolvedType>) => {
        // Validate that all values in the transaction can be JSON serialized
        params.transaction.mutations.forEach((mutation) => {
          validateJsonSerializable(mutation.modified, `update`)
        })

        // Call the user handler BEFORE persisting changes
        const handlerResult = (await config.onUpdate!(params)) ?? {}

        // Only persist to storage if the handler succeeded
        // Load current data from storage
        const currentData = loadFromStorage<ResolvedType>(
          config.storageKey,
          storage
        )

        // Update items with new version keys
        params.transaction.mutations.forEach((mutation) => {
          const key = config.getKey(mutation.modified)
          const storedItem: StoredItem<ResolvedType> = {
            versionKey: generateUuid(),
            data: mutation.modified,
          }
          currentData.set(key, storedItem)
        })

        // Save to storage
        saveToStorage(currentData)

        // Manually trigger local sync since storage events don't fire for current tab
        triggerLocalSync()

        return handlerResult
      }
    : undefined

  const wrappedOnDelete = config.onDelete
    ? async (params: DeleteMutationFnParams<ResolvedType>) => {
        // Call the user handler BEFORE persisting changes
        const handlerResult = (await config.onDelete!(params)) ?? {}

        // Only persist to storage if the handler succeeded
        // Load current data from storage
        const currentData = loadFromStorage<ResolvedType>(
          config.storageKey,
          storage
        )

        // Remove items
        params.transaction.mutations.forEach((mutation) => {
          // For delete operations, mutation.original contains the full object
          const key = config.getKey(mutation.original)
          currentData.delete(key)
        })

        // Save to storage
        saveToStorage(currentData)

        // Manually trigger local sync since storage events don't fire for current tab
        triggerLocalSync()

        return handlerResult
      }
    : undefined

  // Extract standard Collection config properties
  const {
    storageKey: _storageKey,
    storage: _storage,
    storageEventApi: _storageEventApi,
    onInsert: _onInsert,
    onUpdate: _onUpdate,
    onDelete: _onDelete,
    id,
    ...restConfig
  } = config

  // Default id to a pattern based on storage key if not provided
  const collectionId = id ?? `local-collection:${config.storageKey}`

  return {
    ...restConfig,
    id: collectionId,
    sync,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: {
      clearStorage,
      getStorageSize,
    },
  }
}

/**
 * Load data from storage and return as a Map
 */
function loadFromStorage<T extends object>(
  storageKey: string,
  storage: StorageApi
): Map<string | number, StoredItem<T>> {
  try {
    const rawData = storage.getItem(storageKey)
    if (!rawData) {
      return new Map()
    }

    const parsed = JSON.parse(rawData)
    const dataMap = new Map<string | number, StoredItem<T>>()

    // Handle object format where keys map to StoredItem values
    if (
      typeof parsed === `object` &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      Object.entries(parsed).forEach(([key, value]) => {
        // Runtime check to ensure the value has the expected StoredItem structure
        if (
          value &&
          typeof value === `object` &&
          `versionKey` in value &&
          `data` in value
        ) {
          const storedItem = value as StoredItem<T>
          dataMap.set(key, storedItem)
        } else {
          throw new Error(
            `[LocalStorageCollection] Invalid data format in storage key "${storageKey}" for key "${key}".`
          )
        }
      })
    } else {
      throw new Error(
        `[LocalStorageCollection] Invalid data format in storage key "${storageKey}". Expected object format.`
      )
    }

    return dataMap
  } catch (error) {
    console.warn(
      `[LocalStorageCollection] Error loading data from storage key "${storageKey}":`,
      error
    )
    return new Map()
  }
}

/**
 * Internal function to create localStorage sync configuration
 */
function createLocalStorageSync<T extends object>(
  storageKey: string,
  storage: StorageApi,
  storageEventApi: StorageEventApi,
  getKey: (item: T) => string | number,
  lastKnownData: Map<string | number, StoredItem<T>>
): SyncConfig<T> & { manualTrigger?: () => void } {
  let syncParams: Parameters<SyncConfig<T>[`sync`]>[0] | null = null

  /**
   * Compare two Maps to find differences using version keys
   */
  const findChanges = (
    oldData: Map<string | number, StoredItem<T>>,
    newData: Map<string | number, StoredItem<T>>
  ): Array<{
    type: `insert` | `update` | `delete`
    key: string | number
    value?: T
  }> => {
    const changes: Array<{
      type: `insert` | `update` | `delete`
      key: string | number
      value?: T
    }> = []

    // Check for deletions and updates
    oldData.forEach((oldStoredItem, key) => {
      const newStoredItem = newData.get(key)
      if (!newStoredItem) {
        changes.push({ type: `delete`, key, value: oldStoredItem.data })
      } else if (oldStoredItem.versionKey !== newStoredItem.versionKey) {
        changes.push({ type: `update`, key, value: newStoredItem.data })
      }
    })

    // Check for insertions
    newData.forEach((newStoredItem, key) => {
      if (!oldData.has(key)) {
        changes.push({ type: `insert`, key, value: newStoredItem.data })
      }
    })

    return changes
  }

  /**
   * Process storage changes and update collection
   */
  const processStorageChanges = () => {
    if (!syncParams) return

    const { begin, write, commit } = syncParams

    // Load the new data
    const newData = loadFromStorage<T>(storageKey, storage)

    // Find the specific changes
    const changes = findChanges(lastKnownData, newData)

    if (changes.length > 0) {
      begin()
      changes.forEach(({ type, value }) => {
        if (value) {
          validateJsonSerializable(value, type)
          write({ type, value })
        }
      })
      commit()

      // Update lastKnownData
      lastKnownData.clear()
      newData.forEach((storedItem, key) => {
        lastKnownData.set(key, storedItem)
      })
    }
  }

  const syncConfig: SyncConfig<T> & { manualTrigger?: () => void } = {
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const { begin, write, commit } = params

      // Store sync params for later use
      syncParams = params

      // Initial load
      const initialData = loadFromStorage<T>(storageKey, storage)
      if (initialData.size > 0) {
        begin()
        initialData.forEach((storedItem) => {
          validateJsonSerializable(storedItem.data, `load`)
          write({ type: `insert`, value: storedItem.data })
        })
        commit()
      }

      // Update lastKnownData
      lastKnownData.clear()
      initialData.forEach((storedItem, key) => {
        lastKnownData.set(key, storedItem)
      })

      // Listen for storage events from other tabs
      const handleStorageEvent = (event: StorageEvent) => {
        // Only respond to changes to our specific key and from our storage
        if (event.key !== storageKey || event.storageArea !== storage) {
          return
        }

        processStorageChanges()
      }

      // Add storage event listener for cross-tab sync
      storageEventApi.addEventListener(`storage`, handleStorageEvent)

      // Note: Cleanup is handled automatically by the collection when it's disposed
    },

    /**
     * Get sync metadata - returns storage key information
     */
    getSyncMetadata: () => ({
      storageKey,
      storageType:
        storage === (typeof window !== `undefined` ? window.localStorage : null)
          ? `localStorage`
          : `custom`,
    }),

    // Manual trigger function for local updates
    manualTrigger: processStorageChanges,
  }

  return syncConfig
}
