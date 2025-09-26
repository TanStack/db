import {
  InvalidStorageDataFormatError,
  InvalidStorageObjectFormatError,
  NoStorageAvailableError,
  NoStorageEventApiError,
  SerializationError,
  StorageKeyRequiredError,
} from "./errors"
import type {
  BaseCollectionConfig,
  CollectionConfig,
  DeleteMutationFnParams,
  InferSchemaOutput,
  InsertMutationFnParams,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "./types"
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
 * @template T - The type of items in the collection
 * @template TSchema - The schema type for validation
 * @template TKey - The type of the key returned by `getKey`
 */
export interface LocalStorageCollectionConfig<
  T extends object = object,
  TSchema extends StandardSchemaV1 = never,
  TKey extends string | number = string | number,
> extends BaseCollectionConfig<T, TKey, TSchema> {
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
 * @param value - The value to validate for JSON serialization
 * @param operation - The operation type being performed (for error messages)
 * @throws Error if the value cannot be JSON serialized
 */
function validateJsonSerializable(value: any, operation: string): void {
  try {
    JSON.stringify(value)
  } catch (error) {
    throw new SerializationError(
      operation,
      error instanceof Error ? error.message : String(error)
    )
  }
}

/**
 * Generate a UUID for version tracking
 * @returns A unique identifier string for tracking data versions
 */
function generateUuid(): string {
  return crypto.randomUUID()
}

/**
 * Creates localStorage collection options for use with a standard Collection
 *
 * This function creates a collection that persists data to localStorage/sessionStorage
 * and synchronizes changes across browser tabs using storage events.
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param config - Configuration options for the localStorage collection
 * @returns Collection options with utilities including clearStorage and getStorageSize
 *
 * @example
 * // Basic localStorage collection
 * const collection = createCollection(
 *   localStorageCollectionOptions({
 *     storageKey: 'todos',
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * @example
 * // localStorage collection with custom storage
 * const collection = createCollection(
 *   localStorageCollectionOptions({
 *     storageKey: 'todos',
 *     storage: window.sessionStorage, // Use sessionStorage instead
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * @example
 * // localStorage collection with mutation handlers
 * const collection = createCollection(
 *   localStorageCollectionOptions({
 *     storageKey: 'todos',
 *     getKey: (item) => item.id,
 *     onInsert: async ({ transaction }) => {
 *       console.log('Item inserted:', transaction.mutations[0].modified)
 *     },
 *   })
 * )
 */

// Overload for when schema is provided
export function localStorageCollectionOptions<
  T extends StandardSchemaV1,
  TKey extends string | number = string | number,
>(
  config: LocalStorageCollectionConfig<InferSchemaOutput<T>, T, TKey> & {
    schema: T
  }
): CollectionConfig<InferSchemaOutput<T>, TKey, T> & {
  id: string
  utils: LocalStorageCollectionUtils
  schema: T
}

// Overload for when no schema is provided
// the type T needs to be passed explicitly unless it can be inferred from the getKey function in the config
export function localStorageCollectionOptions<
  T extends object,
  TKey extends string | number = string | number,
>(
  config: LocalStorageCollectionConfig<T, never, TKey> & {
    schema?: never // prohibit schema
  }
): CollectionConfig<T, TKey> & {
  id: string
  utils: LocalStorageCollectionUtils
  schema?: never // no schema in the result
}

export function localStorageCollectionOptions(
  config: LocalStorageCollectionConfig<any, any, string | number>
): Omit<CollectionConfig<any, string | number, any>, `id`> & {
  id: string
  utils: LocalStorageCollectionUtils
  schema?: StandardSchemaV1
} {
  // Validate required parameters
  if (!config.storageKey) {
    throw new StorageKeyRequiredError()
  }

  // Default to window.localStorage if no storage is provided
  const storage =
    config.storage ||
    (typeof window !== `undefined` ? window.localStorage : null)

  if (!storage) {
    throw new NoStorageAvailableError()
  }

  // Default to window for storage events if not provided
  const storageEventApi =
    config.storageEventApi || (typeof window !== `undefined` ? window : null)

  if (!storageEventApi) {
    throw new NoStorageEventApiError()
  }

  // Track the last known state to detect changes
  const lastKnownData = new Map<string | number, StoredItem<any>>()

  // Create the sync configuration
  const sync = createLocalStorageSync<any>(
    config.storageKey,
    storage,
    storageEventApi,
    config.getKey,
    lastKnownData
  )

  /**
   * Manual trigger function for local sync updates
   * Forces a check for storage changes and updates the collection if needed
   */
  const triggerLocalSync = () => {
    if (sync.manualTrigger) {
      sync.manualTrigger()
    }
  }

  /**
   * Save data to storage
   * @param dataMap - Map of items with version tracking to save to storage
   */
  const saveToStorage = (
    dataMap: Map<string | number, StoredItem<any>>
  ): void => {
    try {
      // Convert Map to object format for storage
      const objectData: Record<string, StoredItem<any>> = {}
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
   * Removes all collection data from the configured storage
   */
  const clearStorage: ClearStorageFn = (): void => {
    storage.removeItem(config.storageKey)
  }

  /**
   * Get the size of the stored data in bytes (approximate)
   * @returns The approximate size in bytes of the stored collection data
   */
  const getStorageSize: GetStorageSizeFn = (): number => {
    const data = storage.getItem(config.storageKey)
    return data ? new Blob([data]).size : 0
  }

  /*
   * Create wrapper handlers for direct persistence operations that perform actual storage operations
   * Wraps the user's onInsert handler to also save changes to localStorage
   */
  const wrappedOnInsert = async (params: InsertMutationFnParams<any>) => {
    // Validate that all values in the transaction can be JSON serialized
    params.transaction.mutations.forEach((mutation) => {
      validateJsonSerializable(mutation.modified, `insert`)
    })

    // Call the user handler BEFORE persisting changes (if provided)
    let handlerResult: any = {}
    if (config.onInsert) {
      handlerResult = (await config.onInsert(params)) ?? {}
    }

    // Always persist to storage
    // Load current data from storage
    const currentData = loadFromStorage<any>(config.storageKey, storage)

    // Add new items with version keys
    params.transaction.mutations.forEach((mutation) => {
      const key = config.getKey(mutation.modified)
      const storedItem: StoredItem<any> = {
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

  const wrappedOnUpdate = async (params: UpdateMutationFnParams<any>) => {
    // Validate that all values in the transaction can be JSON serialized
    params.transaction.mutations.forEach((mutation) => {
      validateJsonSerializable(mutation.modified, `update`)
    })

    // Call the user handler BEFORE persisting changes (if provided)
    let handlerResult: any = {}
    if (config.onUpdate) {
      handlerResult = (await config.onUpdate(params)) ?? {}
    }

    // Always persist to storage
    // Load current data from storage
    const currentData = loadFromStorage<any>(config.storageKey, storage)

    // Update items with new version keys
    params.transaction.mutations.forEach((mutation) => {
      const key = config.getKey(mutation.modified)
      const storedItem: StoredItem<any> = {
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

  const wrappedOnDelete = async (params: DeleteMutationFnParams<any>) => {
    // Call the user handler BEFORE persisting changes (if provided)
    let handlerResult: any = {}
    if (config.onDelete) {
      handlerResult = (await config.onDelete(params)) ?? {}
    }

    // Always persist to storage
    // Load current data from storage
    const currentData = loadFromStorage<any>(config.storageKey, storage)

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
 * @param storageKey - The key used to store data in the storage API
 * @param storage - The storage API to load from (localStorage, sessionStorage, etc.)
 * @returns Map of stored items with version tracking, or empty Map if loading fails
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
          throw new InvalidStorageDataFormatError(storageKey, key)
        }
      })
    } else {
      throw new InvalidStorageObjectFormatError(storageKey)
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
 * Creates a sync configuration that handles localStorage persistence and cross-tab synchronization
 * @param storageKey - The key used for storing data in localStorage
 * @param storage - The storage API to use (localStorage, sessionStorage, etc.)
 * @param storageEventApi - The event API for listening to storage changes
 * @param getKey - Function to extract the key from an item
 * @param lastKnownData - Map tracking the last known state for change detection
 * @returns Sync configuration with manual trigger capability
 */
function createLocalStorageSync<T extends object>(
  storageKey: string,
  storage: StorageApi,
  storageEventApi: StorageEventApi,
  _getKey: (item: T) => string | number,
  lastKnownData: Map<string | number, StoredItem<T>>
): SyncConfig<T> & { manualTrigger?: () => void } {
  let syncParams: Parameters<SyncConfig<T>[`sync`]>[0] | null = null

  /**
   * Compare two Maps to find differences using version keys
   * @param oldData - The previous state of stored items
   * @param newData - The current state of stored items
   * @returns Array of changes with type, key, and value information
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
   * Loads new data from storage, compares with last known state, and applies changes
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
      const { begin, write, commit, markReady } = params

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

      // Mark collection as ready after initial load
      markReady()

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
     * @returns Object containing storage key and storage type metadata
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
