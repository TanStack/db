import { safeRandomUUID } from './utils/uuid'
import { withCollectionConfigFactory } from './client.js'
import { collectionOptionsClaim } from './collection-options.js'
import { registerTransactionCommitWork } from './transaction-commit-work.js'
import {
  InvalidStorageDataFormatError,
  InvalidStorageObjectFormatError,
  LocalStorageCollectionError,
  SerializationError,
  StorageKeyRequiredError,
} from './errors'
import { codedMessage, codedWarning, devBuild } from './error-message.js'
import type {
  BaseCollectionConfig,
  CollectionConfig,
  DeleteMutationFnParams,
  InferSchemaOutput,
  InsertMutationFnParams,
  PendingMutation,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from './types'
import type { StandardSchemaV1 } from '@standard-schema/spec'

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
    listener: (event: StorageEvent) => void,
  ) => void
  removeEventListener: (
    type: `storage`,
    listener: (event: StorageEvent) => void,
  ) => void
}

// Browser storage events do not reach other Collections in the writing tab.
// A sync run owns one listener for writes through the same Storage object/key.
const sameTabListeners = new WeakMap<StorageApi, Map<string, Set<() => void>>>()

function subscribeToSameTabWrites(
  storage: StorageApi,
  key: string,
  refresh: () => void,
): () => void {
  let byKey = sameTabListeners.get(storage)
  if (!byKey) {
    byKey = new Map()
    sameTabListeners.set(storage, byKey)
  }
  let listeners = byKey.get(key)
  if (!listeners) {
    listeners = new Set()
    byKey.set(key, listeners)
  }
  listeners.add(refresh)
  return () => {
    listeners.delete(refresh)
    if (listeners.size === 0) byKey.delete(key)
    if (byKey.size === 0) sameTabListeners.delete(storage)
  }
}

function publishSameTabWrite(
  storage: StorageApi,
  key: string,
  writer?: { listener: () => void; refresh: () => void },
): void {
  for (const refresh of [...(sameTabListeners.get(storage)?.get(key) ?? [])]) {
    try {
      if (refresh === writer?.listener) writer.refresh()
      else refresh()
    } catch (error) {
      // A peer's parser or sync listener cannot revoke the writer's durable
      // write or prevent another peer from observing it.
      console.warn(
        `[LocalStorageCollection] Error refreshing a same-tab peer for storage key "${key}":`,
        error,
      )
    }
  }
}

/**
 * Internal storage format that includes version tracking
 */
interface StoredItem<T> {
  versionKey: string
  data: T
}

export interface Parser {
  parse: (data: string) => unknown
  stringify: (data: unknown) => string
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

  /**
   * Parser to use for serializing and deserializing data to and from storage
   * Defaults to JSON
   */
  parser?: Parser
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
  /**
   * Accepts this Collection's manual mutations in write order and persists
   * them to localStorage. Call it inside the transaction's mutationFn. The
   * transaction's persistence receipt waits for this work even if the caller
   * does not await the returned Promise. Await it when later mutationFn work
   * depends on the storage write.
   *
   * @param transaction - The transaction containing mutations to accept
   * @example
   * const localSettings = createCollection(localStorageCollectionOptions({...}))
   *
   * const tx = createTransaction({
   *   mutationFn: async ({ transaction }) => {
   *     // Make API call first
   *     await api.save(...)
   *     // Then persist local-storage mutations after success
   *     await localSettings.utils.acceptMutations(transaction)
   *   }
   * })
   */
  acceptMutations: (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }) => Promise<void>
}

/**
 * Validates that a value can be JSON serialized
 * @param parser - The parser to use for serialization
 * @param value - The value to validate for JSON serialization
 * @param operation - The operation type being performed (for error messages)
 * @throws Error if the value cannot be JSON serialized
 */
function validateJsonSerializable(
  parser: Parser,
  value: any,
  operation: string,
): void {
  try {
    parser.stringify(value)
  } catch (error) {
    throw new SerializationError(
      operation,
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * Generate a UUID for version tracking
 * @returns A unique identifier string for tracking data versions
 */
function generateUuid(): string {
  return safeRandomUUID()
}

/**
 * Encodes a key (string or number) into a storage-safe string format.
 * This prevents collisions between numeric and string keys by prefixing with type information.
 *
 * Examples:
 *   - number 1 → "n:1"
 *   - string "1" → "s:1"
 *   - string "n:1" → "s:n:1"
 *
 * @param key - The key to encode (string or number)
 * @returns Type-prefixed string that is safe for storage
 */
function encodeStorageKey(key: string | number): string {
  if (typeof key === `number`) {
    return `n:${key}`
  }
  return `s:${key}`
}

/**
 * Decodes a storage key back to its original form.
 * This is the inverse of encodeStorageKey.
 *
 * @param encodedKey - The encoded key from storage
 * @returns The original key (string or number)
 */
function decodeStorageKey(encodedKey: string): string | number {
  if (encodedKey.startsWith(`n:`)) {
    return Number(encodedKey.slice(2))
  }
  if (encodedKey.startsWith(`s:`)) {
    return encodedKey.slice(2)
  }
  // Fallback for legacy data without encoding
  return encodedKey
}

/**
 * Creates an in-memory storage implementation that mimics the StorageApi interface
 * Used as a fallback when localStorage is not available (e.g., server-side rendering)
 * @returns An object implementing the StorageApi interface using an in-memory Map
 */
function createInMemoryStorage(): StorageApi {
  const storage = new Map<string, string>()

  return {
    getItem(key: string): string | null {
      return storage.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      storage.set(key, value)
    },
    removeItem(key: string): void {
      storage.delete(key)
    },
  }
}

/**
 * Creates a no-op storage event API for environments without window (e.g., server-side)
 * This provides the required interface but doesn't actually listen to any events
 * since cross-tab synchronization is not possible in server environments
 * @returns An object implementing the StorageEventApi interface with no-op methods
 */
function createNoOpStorageEventApi(): StorageEventApi {
  return {
    addEventListener: () => {
      // No-op: cannot listen to storage events without window
    },
    removeEventListener: () => {
      // No-op: cannot remove listeners without window
    },
  }
}

/**
 * Creates localStorage collection options for use with a standard Collection
 *
 * This function creates a collection that persists data to localStorage/sessionStorage
 * and synchronizes changes across browser tabs using storage events. Active
 * Collections sharing this Storage object and storage key also synchronize
 * writes in the same tab, without waiting for a browser event.
 * Create fresh options for each direct `createCollection()` call. One options
 * object contains state owned by one Collection and cannot be reused.
 *
 * **Fallback Behavior:**
 *
 * When localStorage is not available (e.g., in server-side rendering environments),
 * this function automatically falls back to an in-memory storage implementation.
 * This prevents errors during module initialization and allows the collection to
 * work in any environment, though data will not persist across page reloads or
 * be shared across tabs when using the in-memory fallback.
 *
 * **Using with Manual Transactions:**
 *
 * For manual transactions, call `utils.acceptMutations()` in your transaction's `mutationFn`
 * to persist changes made during `tx.mutate()`. The transaction receipt waits for this work even
 * when the call is not awaited. Await it when later mutationFn work depends on the storage write.
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param config - Configuration options for the localStorage collection
 * @returns Collection options with utilities including clearStorage, getStorageSize, and acceptMutations
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
 *
 * @example
 * // Using with manual transactions
 * const localSettings = createCollection(
 *   localStorageCollectionOptions({
 *     storageKey: 'user-settings',
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * const tx = createTransaction({
 *   mutationFn: async ({ transaction }) => {
 *     // Use settings data in API call
 *     const settingsMutations = transaction.mutations.filter(m => m.collection === localSettings)
 *     await api.updateUserProfile({ settings: settingsMutations[0]?.modified })
 *
 *     // Persist local-storage mutations after API success
 *     await localSettings.utils.acceptMutations(transaction)
 *   }
 * })
 *
 * tx.mutate(() => {
 *   localSettings.insert({ id: 'theme', value: 'dark' })
 *   apiCollection.insert({ id: 2, data: 'profile data' })
 * })
 *
 * await tx.commit()
 */

// Overload for when schema is provided
export function localStorageCollectionOptions<
  T extends StandardSchemaV1,
  TKey extends string | number = string | number,
>(
  config: LocalStorageCollectionConfig<InferSchemaOutput<T>, T, TKey> & {
    schema: T
  },
): CollectionConfig<
  InferSchemaOutput<T>,
  TKey,
  T,
  LocalStorageCollectionUtils
> & {
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
  },
): CollectionConfig<T, TKey, never, LocalStorageCollectionUtils> & {
  id: string
  utils: LocalStorageCollectionUtils
  schema?: never // no schema in the result
}

export function localStorageCollectionOptions(
  config: LocalStorageCollectionConfig<any, any, string | number>,
): Omit<
  CollectionConfig<any, string | number, any, LocalStorageCollectionUtils>,
  `id`
> & {
  id: string
  utils: LocalStorageCollectionUtils
  schema?: StandardSchemaV1
} {
  // Validate required parameters
  if (!config.storageKey) {
    throw new StorageKeyRequiredError()
  }

  // Default to window.localStorage if no storage is provided
  // Fall back to in-memory storage if localStorage is not available (e.g., server-side rendering)
  const storage =
    config.storage ||
    (typeof window !== `undefined` ? window.localStorage : null) ||
    createInMemoryStorage()

  // Default to window for storage events if not provided
  // Fall back to no-op storage event API if window is not available (e.g., server-side rendering)
  const storageEventApi =
    config.storageEventApi ||
    (typeof window !== `undefined` ? window : null) ||
    createNoOpStorageEventApi()

  // Default to JSON parser if no parser is provided
  const parser = config.parser || JSON

  // Track the last known state to detect changes
  const lastKnownData = new Map<string | number, StoredItem<any>>()

  // Create the sync configuration
  const sync = createLocalStorageSync<any>(
    config.storageKey,
    storage,
    storageEventApi,
    parser,
    config.getKey,
    lastKnownData,
  )

  /**
   * Save data to storage
   * @param dataMap - Map of items with version tracking to save to storage
   */
  const saveToStorage = (
    dataMap: Map<string | number, StoredItem<any>>,
  ): string => {
    try {
      // Convert Map to object format for storage
      const objectData: Record<string, StoredItem<any>> = {}
      dataMap.forEach((storedItem, key) => {
        objectData[encodeStorageKey(key)] = storedItem
      })
      const serialized = parser.stringify(objectData)
      storage.setItem(config.storageKey, serialized)
      return serialized
    } catch (error) {
      console.error(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `[LocalStorageCollection] Error saving data to storage key "${config.storageKey}":`
          : codedMessage(218, { storageKey: config.storageKey }),
        error,
      )
      throw error
    }
  }

  /**
   * Removes the stored snapshot and publishes removal of accepted synced rows.
   * Pending optimistic mutations can still settle afterward.
   */
  const clearStorage: ClearStorageFn = (): void => {
    storage.removeItem(config.storageKey)
    publishSameTabWrite(storage, config.storageKey)
  }

  /**
   * Get the size of the stored data in bytes (approximate)
   * @returns The approximate size in bytes of the stored collection data
   */
  const getStorageSize: GetStorageSizeFn = (): number => {
    const data = storage.getItem(config.storageKey)
    return data ? new Blob([data]).size : 0
  }

  const persistMutations = (
    mutations: Array<PendingMutation<Record<string, unknown>>>,
  ): void => {
    // A peer may have written after our last storage event. Start from the
    // current durable snapshot so this write preserves untouched peer rows.
    const staged = readFromStorage(
      config.storageKey,
      storage,
      parser,
      config.getKey,
    )
    for (const mutation of mutations) {
      if (mutation.type === `delete`) staged.delete(mutation.key)
      else
        staged.set(mutation.key, {
          versionKey: generateUuid(),
          data: mutation.modified,
        })
    }
    const savedRaw = saveToStorage(staged)
    let persisted: Map<string | number, StoredItem<any>> | undefined
    try {
      if (parser === JSON) {
        // Native values authored through the default JSON parser remain in
        // this Collection until restore; peers see their stored JSON form.
        persisted = staged
      } else {
        persisted = readFromStorage(
          config.storageKey,
          storage,
          parser,
          config.getKey,
        )
      }
      for (const mutation of mutations) {
        const storedItem = persisted.get(mutation.key)
        if (mutation.type === `delete` ? storedItem : !storedItem) {
          throw new InvalidStorageDataFormatError(
            config.storageKey,
            encodeStorageKey(mutation.key),
          )
        }
        if (storedItem) lastKnownData.set(mutation.key, storedItem)
        else lastKnownData.delete(mutation.key)
      }
      sync.confirmOperationsSync(mutations, persisted)
    } finally {
      // Storage has already accepted this snapshot. A local confirmation
      // error must not suppress publication to other active Collections.
      const writerRefresh = sync.manualTrigger
      publishSameTabWrite(
        storage,
        config.storageKey,
        writerRefresh
          ? {
              listener: writerRefresh,
              refresh: () =>
                writerRefresh(
                  persisted && storage.getItem(config.storageKey) === savedRaw
                    ? persisted
                    : undefined,
                ),
            }
          : undefined,
      )
    }
  }

  // Reserve automatic and manual writes in acceptance order. A rejected
  // handler releases only its storage slot after its predecessor, while its
  // own transaction receipt can reject immediately.
  let writeTail: Promise<void> | undefined
  const reserveWrite = () => {
    const previous = writeTail
    let release!: () => void
    const slot = new Promise<void>((resolve) => {
      release = resolve
    })
    writeTail = slot
    const retire = () => {
      release()
      if (writeTail === slot) writeTail = undefined
    }
    return { previous, retire }
  }

  const persistAutomatic = (
    mutations: Array<PendingMutation<Record<string, unknown>>>,
    handler?: () => unknown | Promise<unknown>,
  ): Promise<unknown> => {
    const { previous, retire } = reserveWrite()

    // Native Storage writes synchronously. With no handler or earlier write,
    // preserve that direct-mutation return boundary.
    if (!handler && previous === undefined) {
      try {
        persistMutations(mutations)
        return Promise.resolve({})
      } catch (error) {
        return Promise.reject(error)
      } finally {
        retire()
      }
    }

    let result: unknown
    try {
      result = handler?.()
    } catch (error) {
      if (previous) void previous.then(retire)
      else retire()
      return Promise.reject(error)
    }
    return Promise.resolve(result).then(
      async (value) => {
        await previous
        try {
          persistMutations(mutations)
          return value ?? {}
        } finally {
          retire()
        }
      },
      (error: unknown) => {
        // Rejection belongs to this transaction immediately. Only its empty
        // storage slot must wait for the earlier accepted write to retire.
        if (previous) void previous.then(retire)
        else retire()
        throw error
      },
    )
  }

  const persistManual = (
    mutations: Array<PendingMutation<Record<string, unknown>>>,
  ): Promise<void> => {
    const { previous, retire } = reserveWrite()
    if (previous === undefined) {
      try {
        persistMutations(mutations)
        return Promise.resolve()
      } finally {
        retire()
      }
    }
    return previous.then(() => {
      try {
        persistMutations(mutations)
      } finally {
        retire()
      }
    })
  }

  const wrappedOnInsert = (params: InsertMutationFnParams<any>) => {
    params.transaction.mutations.forEach((mutation) => {
      validateJsonSerializable(parser, mutation.modified, `insert`)
    })
    return persistAutomatic(
      params.transaction.mutations,
      config.onInsert ? () => config.onInsert!(params) : undefined,
    )
  }

  const wrappedOnUpdate = (params: UpdateMutationFnParams<any>) => {
    params.transaction.mutations.forEach((mutation) => {
      validateJsonSerializable(parser, mutation.modified, `update`)
    })
    return persistAutomatic(
      params.transaction.mutations,
      config.onUpdate ? () => config.onUpdate!(params) : undefined,
    )
  }

  const wrappedOnDelete = (params: DeleteMutationFnParams<any>) =>
    persistAutomatic(
      params.transaction.mutations,
      config.onDelete ? () => config.onDelete!(params) : undefined,
    )

  // Extract standard Collection config properties
  // Remove localStorage-specific properties so they don't leak into the CollectionConfig
  const {
    storageKey: _storageKey,
    storage: _storage,
    storageEventApi: _storageEventApi,
    parser: _parser,
    onInsert: _onInsert,
    onUpdate: _onUpdate,
    onDelete: _onDelete,
    id,
    ...restConfig
  } = config

  // Default id to a pattern based on storage key if not provided
  const collectionId = id ?? `local-collection:${config.storageKey}`

  /**
   * Accepts this Collection's manual mutations in write order and resolves
   * after their storage write. A mutationFn receipt tracks this work even
   * when the caller does not await the returned Promise.
   */
  const persistAcceptedMutations = async (
    transaction: {
      mutations: Array<PendingMutation<Record<string, unknown>>>
    },
    owner: PendingMutation<Record<string, unknown>>[`collection`] | undefined,
  ): Promise<void> => {
    const collectionMutations = transaction.mutations.filter(
      (mutation) => mutation.collection === owner,
    )

    if (collectionMutations.length === 0) {
      return Promise.resolve()
    }

    // Validate all mutations can be serialized before modifying storage
    for (const mutation of collectionMutations) {
      switch (mutation.type) {
        case `insert`:
        case `update`:
          validateJsonSerializable(parser, mutation.modified, mutation.type)
          break
        case `delete`:
          validateJsonSerializable(parser, mutation.original, mutation.type)
          break
      }
    }

    await persistManual(collectionMutations)
  }

  const materializedAcceptors = new WeakSet<
    LocalStorageCollectionUtils[`acceptMutations`]
  >()
  const acceptMutations = (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }): Promise<void> => {
    // A DbClient materializes module-level options into a fresh Collection.
    // Route acceptance to that Collection's utility so its automatic and
    // manual writes reserve slots in the same queue.
    const candidates = new Set(
      transaction.mutations
        .filter((mutation) => mutation.collection.id === collectionId)
        .map((mutation) => mutation.collection),
    )
    const owned = [...candidates].filter((candidate) => {
      const candidateAccept = (candidate.utils as LocalStorageCollectionUtils)
        .acceptMutations
      return (
        candidateAccept === acceptMutations ||
        materializedAcceptors.has(candidateAccept)
      )
    })
    if (owned.length > 1 || (candidates.size > 0 && owned.length === 0)) {
      const work = Promise.reject(
        new LocalStorageCollectionError(
          devBuild() && process.env.NODE_ENV !== `production`
            ? `LocalStorage manual acceptance belongs to a different Collection.`
            : codedMessage(231),
        ),
      )
      registerTransactionCommitWork(transaction, work)
      return work
    }
    const owner = owned[0]
    const ownerAccept = owner
      ? (owner.utils as LocalStorageCollectionUtils).acceptMutations
      : undefined
    if (ownerAccept && ownerAccept !== acceptMutations)
      return ownerAccept(transaction)
    const work = persistAcceptedMutations(transaction, owner)
    registerTransactionCommitWork(transaction, work)
    return work
  }

  const options = {
    ...restConfig,
    id: collectionId,
    sync,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: {
      clearStorage,
      getStorageSize,
      acceptMutations,
    },
  }

  let claimed = false
  Object.defineProperty(options, collectionOptionsClaim, {
    enumerable: true,
    value: () => {
      if (claimed)
        throw new LocalStorageCollectionError(
          devBuild() && process.env.NODE_ENV !== `production`
            ? `LocalStorage options can create only one Collection. Create fresh options for each Collection.`
            : codedMessage(230),
        )
      claimed = true
    },
  })

  return withCollectionConfigFactory(options, () => {
    const materialized = localStorageCollectionOptions({
      ...config,
      id: collectionId,
    }) as unknown as typeof options
    materializedAcceptors.add(materialized.utils.acceptMutations)
    return materialized
  })
}

/**
 * Read data from storage without treating a failed read as an empty snapshot.
 * @param parser - The parser to use for deserializing the data
 * @param storageKey - The key used to store data in the storage API
 * @param storage - The storage API to load from (localStorage, sessionStorage, etc.)
 * @returns Map of stored items with version tracking
 */
function readFromStorage<T extends object>(
  storageKey: string,
  storage: StorageApi,
  parser: Parser,
  getKey: (item: T) => string | number,
): Map<string | number, StoredItem<T>> {
  const rawData = storage.getItem(storageKey)
  if (rawData === null) {
    return new Map()
  }

  const parsed = parser.parse(rawData)
  const dataMap = new Map<string | number, StoredItem<T>>()

  // Handle object format where keys map to StoredItem values
  if (typeof parsed === `object` && parsed !== null && !Array.isArray(parsed)) {
    Object.entries(parsed).forEach(([encodedKey, value]) => {
      // Runtime check to ensure the value has the expected StoredItem structure
      if (
        value &&
        typeof value === `object` &&
        `versionKey` in value &&
        typeof value.versionKey === `string` &&
        `data` in value &&
        value.data !== null &&
        typeof value.data === `object`
      ) {
        const storedItem = value as StoredItem<T>
        const decodedKey = decodeStorageKey(encodedKey)
        if (getKey(storedItem.data) !== decodedKey) {
          throw new InvalidStorageDataFormatError(storageKey, encodedKey)
        }
        dataMap.set(decodedKey, storedItem)
      } else {
        throw new InvalidStorageDataFormatError(storageKey, encodedKey)
      }
    })
  } else {
    throw new InvalidStorageObjectFormatError(storageKey)
  }

  return dataMap
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
  parser: Parser,
  getKey: (item: T) => string | number,
  lastKnownData: Map<string | number, StoredItem<T>>,
): SyncConfig<T> & {
  manualTrigger?: (knownSnapshot?: Map<string | number, StoredItem<T>>) => void
  collection: any
  confirmOperationsSync: (
    mutations: Array<any>,
    persisted: Map<string | number, StoredItem<T>>,
  ) => void
} {
  let syncParams: Parameters<SyncConfig<T>[`sync`]>[0] | null = null
  let collection: any = null

  /**
   * Compare two Maps to find differences using version keys
   * @param oldData - The previous state of stored items
   * @param newData - The current state of stored items
   * @returns Array of changes with type, key, and value information
   */
  const findChanges = (
    oldData: Map<string | number, StoredItem<T>>,
    newData: Map<string | number, StoredItem<T>>,
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
  const processStorageChanges = (
    knownSnapshot?: Map<string | number, StoredItem<T>>,
  ) => {
    if (!syncParams) return

    const { begin, write, commit } = syncParams

    // Load the new data
    let newData: Map<string | number, StoredItem<T>>
    try {
      newData =
        knownSnapshot ?? readFromStorage<T>(storageKey, storage, parser, getKey)
    } catch (error) {
      console.warn(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `[LocalStorageCollection] Error loading data from storage key "${storageKey}":`
          : codedWarning(219, { storageKey }),
        error,
      )
      return
    }

    // Find the specific changes
    const changes = findChanges(lastKnownData, newData)

    if (changes.length > 0) {
      // Reject an invalid snapshot before opening a sync transaction. This
      // leaves the previous mirror available for a later valid refresh.
      changes.forEach(({ type, value }) => {
        if (value) validateJsonSerializable(parser, value, type)
      })
      begin()
      changes.forEach(({ type, value }) => {
        if (value) {
          write({ type, value })
        }
      })
      // A commit can synchronously publish to a subscriber that writes again.
      // The nested refresh must compare against this snapshot, not its parent.
      lastKnownData.clear()
      newData.forEach((storedItem, key) => {
        lastKnownData.set(key, storedItem)
      })
      commit()
    }
  }

  const syncConfig: SyncConfig<T> & {
    manualTrigger?: (
      knownSnapshot?: Map<string | number, StoredItem<T>>,
    ) => void
  } = {
    rowUpdateMode: `full`,
    sync: (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const { begin, write, commit, markReady } = params

      // A failed restore cannot establish an empty authoritative snapshot.
      // Read before retaining this sync run's callbacks so startup failure
      // leaves no stale adapter state.
      const initialData = readFromStorage<T>(
        storageKey,
        storage,
        parser,
        getKey,
      )
      initialData.forEach((storedItem) => {
        validateJsonSerializable(parser, storedItem.data, `load`)
      })
      syncParams = params
      collection = params.collection
      // Establish the mirror and same-tab listener before restore publishes
      // callbacks, which can synchronously write through an already-ready peer.
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

      const unsubscribeSameTab = subscribeToSameTabWrites(
        storage,
        storageKey,
        processStorageChanges,
      )
      try {
        if (initialData.size > 0) {
          begin()
          initialData.forEach((storedItem) => {
            write({ type: `insert`, value: storedItem.data })
          })
          commit()
        }
        // Mark collection as ready after initial load, then listen for
        // browser events from other tabs.
        markReady()
        storageEventApi.addEventListener(`storage`, handleStorageEvent)
      } catch (error) {
        unsubscribeSameTab()
        if (syncParams === params) {
          syncParams = null
        }
        throw error
      }
      return {
        cleanup: () => {
          storageEventApi.removeEventListener(`storage`, handleStorageEvent)
          unsubscribeSameTab()
          if (syncParams === params) {
            syncParams = null
          }
        },
      }
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

  /**
   * Confirms mutations by writing them through the sync interface
   * This moves mutations from optimistic to synced state
   * @param mutations - Array of mutation objects to confirm
   */
  const confirmOperationsSync = (
    mutations: Array<any>,
    persisted: Map<string | number, StoredItem<T>>,
  ) => {
    if (!syncParams) {
      // Sync not initialized yet, mutations will be handled on next sync
      return
    }

    const { begin, write, commit } = syncParams

    // Write the mutations through sync to confirm them
    begin()
    mutations.forEach((mutation: any) => {
      write({
        // A peer may have inserted the same key while this local mutation
        // was pending. Full-row update confirms the accepted stored value in
        // either case without a duplicate insert.
        type: mutation.type === `delete` ? `delete` : `update`,
        value:
          mutation.type === `delete`
            ? mutation.original
            : persisted.get(mutation.key)!.data,
      })
    })
    commit()
  }

  return {
    ...syncConfig,
    get collection() {
      return collection
    },
    confirmOperationsSync,
  }
}
