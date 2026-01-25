/**
 * IndexedDB Collection for TanStack DB
 *
 * This module provides a factory function that creates IndexedDB-backed collections
 * compatible with TanStack DB's collection system.
 */

import {
  clear,
  deleteByKey,
  deleteDatabase as deleteIDBDatabase,
  executeTransaction,
  getAll,
  openDatabase,
  put,
} from './wrapper'
import type {
  BaseCollectionConfig,
  ChangeMessageOrDeleteKeyMessage,
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  OperationType,
  PendingMutation,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from '@tanstack/db'
import type { StandardSchemaV1 } from '@standard-schema/spec'

export class DatabaseRequiredError extends Error {
  constructor() {
    super(
      `IndexedDB collection requires a "db" configuration option. ` +
        `Create a database instance using createIndexedDB() and pass it to the collection.`,
    )
    this.name = `DatabaseRequiredError`
  }
}

/**
 * Thrown when the specified object store doesn't exist in the database
 */
export class ObjectStoreNotFoundError extends Error {
  constructor(
    storeName: string,
    databaseName: string,
    availableStores: ReadonlyArray<string>,
  ) {
    super(
      `Object store "${storeName}" not found in database "${databaseName}". ` +
        `Available stores: [${availableStores.join(', ')}]. ` +
        `Add "${storeName}" to the stores array when calling createIndexedDB().`,
    )
    this.name = 'ObjectStoreNotFoundError'
  }
}

/**
 * Thrown when the name (object store) configuration is missing
 */
export class NameRequiredError extends Error {
  constructor() {
    super(
      `IndexedDB collection requires a "name" configuration option. ` +
        `This is the name of the object store within the database.`,
    )
    this.name = `NameRequiredError`
  }
}

/**
 * Thrown when the getKey function is missing
 */
export class GetKeyRequiredError extends Error {
  constructor() {
    super(
      `IndexedDB collection requires a "getKey" configuration option. ` +
        `This function extracts the unique key from each item.`,
    )
    this.name = `GetKeyRequiredError`
  }
}

export interface CreateIndexedDBOptions {
  /** Database name */
  name: string
  /** Schema version (increment when adding/removing stores) */
  version: number
  /** Object store names to create */
  stores: ReadonlyArray<string>
  /** Custom IDBFactory for testing/mocking */
  idbFactory?: IDBFactory
}

/**
 * A shared IndexedDB database instance.
 * Create with createIndexedDB() and pass to collections.
 */
export interface IndexedDBInstance {
  /** The underlying IDBDatabase connection */
  readonly db: IDBDatabase
  /** Database name */
  readonly name: string
  /** Database version */
  readonly version: number
  /** List of available object stores (frozen) */
  readonly stores: ReadonlyArray<string>
  /** IDBFactory used to create this database (for testing) */
  readonly idbFactory?: IDBFactory
  /** Close the database connection */
  close: () => void
}

type InferSchemaOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T> extends object
    ? StandardSchemaV1.InferOutput<T>
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * Schema input type inference helper
 */
type InferSchemaInput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<T> extends object
    ? StandardSchemaV1.InferInput<T>
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * Configuration options for creating an IndexedDB Collection
 */
export interface IndexedDBCollectionConfig<
  T extends object = object,
  TSchema extends StandardSchemaV1 = never,
  TKey extends string | number = string | number,
> extends BaseCollectionConfig<T, TKey, TSchema> {
  /**
   * IndexedDB instance from createIndexedDB()
   * REQUIRED - must create database before collections
   */
  db: IndexedDBInstance

  /**
   * Name of the object store within the database
   * Must exist in db.stores array
   */
  name: string
}

/**
 * Version entry stored in the shared _versions object store
 * Key is a tuple: [name, itemKey]
 */
interface VersionEntry {
  versionKey: string // UUID for change detection
  updatedAt: number // Timestamp for conflict resolution
}

/**
 * Cross-tab message format via BroadcastChannel
 */
interface CrossTabMessage {
  type: 'data-changed' | 'database-cleared'
  database: string
  name: string // Object store name
  collectionVersion: string // Quick "anything changed?" check
  changedKeys: Array<string | number> // Keys that changed (for targeted loading)
  timestamp: number // For conflict resolution
  tabId: string // To avoid processing own messages
}

/**
 * Database information returned by getDatabaseInfo()
 */
export interface DatabaseInfo {
  name: string
  version: number
  objectStores: Array<string>
  estimatedSize?: number // via StorageManager API if available
}

/**
 * Utility functions exposed on collection.utils
 */
export interface IndexedDBCollectionUtils<
  TItem extends object = Record<string, unknown>,
  _TKey extends string | number = string | number,
  TInsertInput extends object = TItem,
> extends UtilsRecord {
  /**
   * Removes all data from the object store
   * Does NOT delete the database itself
   */
  clearObjectStore: () => Promise<void>

  /**
   * Deletes the entire database
   * Use with caution - removes all object stores and indexes
   */
  deleteDatabase: () => Promise<void>

  /**
   * Returns database information for debugging
   */
  getDatabaseInfo: () => Promise<DatabaseInfo>

  /**
   * Accepts mutations from a manual transaction and persists to IndexedDB
   */
  acceptMutations: (transaction: {
    mutations: Array<PendingMutation<TItem>>
  }) => Promise<void>

  /**
   * Exports all data from the object store as an array
   * Useful for backup/debugging
   */
  exportData: () => Promise<Array<TItem>>

  /**
   * Imports data into the object store
   * Clears existing data first
   */
  importData: (items: Array<TInsertInput>) => Promise<void>
}

const VERSIONS_STORE_NAME = '_versions'

/**
 * Creates or opens an IndexedDB database with the specified stores.
 * Call this once at app startup, then pass the instance to collections.
 *
 * All stores are created in a single upgrade transaction, avoiding
 * version race conditions when multiple collections share a database.
 *
 * @example
 * ```typescript
 * const db = await createIndexedDB({
 *   name: 'myApp',
 *   version: 1,
 *   stores: ['todos', 'users', 'settings'],
 * })
 *
 * const todosCollection = createCollection(
 *   indexedDBCollectionOptions({
 *     db,
 *     name: 'todos',
 *     getKey: (item) => item.id,
 *   })
 * )
 * ```
 */
export async function createIndexedDB(
  options: CreateIndexedDBOptions,
): Promise<IndexedDBInstance> {
  const { name, version, stores, idbFactory } = options

  // Validate options
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety for JS consumers
  if (!stores || stores.length === 0) {
    throw new Error(
      'createIndexedDB requires at least one store in the stores array.',
    )
  }

  const storeSet = new Set(stores)
  if (storeSet.size !== stores.length) {
    throw new Error(
      'createIndexedDB stores array contains duplicate store names.',
    )
  }

  for (const storeName of stores) {
    if (!storeName || typeof storeName !== 'string') {
      throw new Error(
        'createIndexedDB stores array contains invalid store names. ' +
          'Each store name must be a non-empty string.',
      )
    }
  }

  const db = await openDatabase(
    name,
    version,
    (database) => {
      // Always create _versions store for cross-tab sync
      if (!database.objectStoreNames.contains(VERSIONS_STORE_NAME)) {
        database.createObjectStore(VERSIONS_STORE_NAME)
      }

      // Create each requested store
      for (const storeName of stores) {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName)
        }
      }
    },
    idbFactory,
  )

  // Create frozen stores array for immutability
  const frozenStores = Object.freeze([...stores])

  return Object.freeze({
    db,
    name,
    version: db.version,
    stores: frozenStores,
    idbFactory,
    close: () => db.close(),
  })
}

/**
 * Creates IndexedDB collection options for use with a standard Collection.
 * This provides persistent local storage with cross-tab synchronization.
 *
 * IMPORTANT: You must first create the database with createIndexedDB() and
 * pass the instance to this function. This ensures all stores are created
 * upfront in a single upgrade transaction.
 *
 * @example
 * // Step 1: Create database with all stores
 * const db = await createIndexedDB({
 *   name: 'myApp',
 *   version: 1,
 *   stores: ['todos', 'users'],
 * })
 *
 * // Step 2: Create collections using the shared database
 * const todosCollection = createCollection(
 *   indexedDBCollectionOptions({
 *     db,
 *     name: 'todos',
 *     schema: todoSchema,
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * @example
 * // Without schema (explicit type)
 * const todosCollection = createCollection<Todo>(
 *   indexedDBCollectionOptions({
 *     db,
 *     name: 'todos',
 *     getKey: (item) => item.id,
 *   })
 * )
 */

// Overload for when schema is provided
export function indexedDBCollectionOptions<
  T extends StandardSchemaV1,
  TKey extends string | number = string | number,
>(
  config: IndexedDBCollectionConfig<InferSchemaOutput<T>, T, TKey> & {
    schema: T
  },
): CollectionConfig<
  InferSchemaOutput<T>,
  TKey,
  T,
  IndexedDBCollectionUtils<InferSchemaOutput<T>, TKey, InferSchemaInput<T>>
> & {
  schema: T
  utils: IndexedDBCollectionUtils<
    InferSchemaOutput<T>,
    TKey,
    InferSchemaInput<T>
  >
}

// Overload for when no schema is provided
export function indexedDBCollectionOptions<
  T extends object,
  TKey extends string | number = string | number,
>(
  config: IndexedDBCollectionConfig<T, never, TKey> & {
    schema?: never
  },
): CollectionConfig<T, TKey, never, IndexedDBCollectionUtils<T, TKey, T>> & {
  schema?: never
  utils: IndexedDBCollectionUtils<T, TKey, T>
}

export function indexedDBCollectionOptions(
  config: IndexedDBCollectionConfig<Record<string, unknown>>,
): CollectionConfig<
  Record<string, unknown>,
  string | number,
  never,
  IndexedDBCollectionUtils
> & {
  utils: IndexedDBCollectionUtils
} {
  const {
    db: dbInstance,
    name,
    getKey,
    onInsert,
    onUpdate,
    onDelete,
    ...baseCollectionConfig
  } = config

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety for JS consumers
  if (!dbInstance) {
    throw new DatabaseRequiredError()
  }

  if (!name) {
    throw new NameRequiredError()
  }

  // Validate that the store exists in the database (sync check)
  if (!dbInstance.db.objectStoreNames.contains(name)) {
    const availableStores = Array.from(dbInstance.db.objectStoreNames)
    throw new ObjectStoreNotFoundError(name, dbInstance.name, availableStores)
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!getKey) {
    throw new GetKeyRequiredError()
  }

  const tabId = crypto.randomUUID()

  // In-memory cache of version entries for change detection
  const versionCache = new Map<string | number, string>()

  // References to sync protocol functions (set during sync initialization)
  let syncBegin: ((options?: { immediate?: boolean }) => void) | null = null
  let syncWrite:
    | ((message: ChangeMessageOrDeleteKeyMessage<any, string | number>) => void)
    | null = null
  let syncCommit: (() => void) | null = null

  // BroadcastChannel for cross-tab sync
  let broadcastChannel: BroadcastChannel | null = null

  function getDatabase(): IDBDatabase {
    return dbInstance.db
  }

  /**
   * Broadcasts a cross-tab message
   */
  function broadcastChange(
    changedKeys: Array<string | number>,
    type: CrossTabMessage['type'] = 'data-changed',
  ): void {
    if (!broadcastChannel) {
      return
    }

    const message: CrossTabMessage = {
      type,
      database: dbInstance.name,
      name,
      collectionVersion: crypto.randomUUID(),
      changedKeys,
      timestamp: Date.now(),
      tabId,
    }

    broadcastChannel.postMessage(message)
  }

  /**
   * Generates a new version key (UUID)
   */
  function generateVersionKey(): string {
    return crypto.randomUUID()
  }

  /**
   * Writes data and version entry atomically
   */
  async function writeWithVersion(
    key: string | number,
    value: Record<string, unknown>,
    _operation: 'insert' | 'update',
  ): Promise<void> {
    const db = getDatabase()
    const versionKey = generateVersionKey()

    await executeTransaction(
      db,
      [name, VERSIONS_STORE_NAME],
      'readwrite',
      (_, stores) => {
        // Write data to data store (out-of-line key)
        put(stores[name]!, value, key as IDBValidKey)

        // Write version entry with array key [name, key]
        const versionEntry: VersionEntry = {
          versionKey,
          updatedAt: Date.now(),
        }
        put(stores[VERSIONS_STORE_NAME]!, versionEntry, [name, key] as IDBValidKey)
      },
    )

    // Update in-memory cache
    versionCache.set(key, versionKey)
  }

  /**
   * Deletes data and version entry atomically
   */
  async function deleteWithVersion(key: string | number): Promise<void> {
    const db = getDatabase()

    await executeTransaction(
      db,
      [name, VERSIONS_STORE_NAME],
      'readwrite',
      (_, stores) => {
        // Delete from data store
        deleteByKey(stores[name]!, key as IDBValidKey)

        // Delete version entry
        deleteByKey(stores[VERSIONS_STORE_NAME]!, [name, key] as IDBValidKey)
      },
    )

    // Update in-memory cache
    versionCache.delete(key)
  }

  /**
   * Queues a sync confirmation via microtask
   */
  function queueSyncConfirmation(
    mutations: Array<{ type: OperationType; key: string | number; value: any }>,
  ): void {
    queueMicrotask(() => {
      if (!syncBegin || !syncWrite || !syncCommit) {
        return
      }

      syncBegin({ immediate: true })
      for (const mutation of mutations) {
        syncWrite({
          type: mutation.type,
          value: mutation.value,
        })
      }
      syncCommit()
    })
  }

  const internalSync: SyncConfig<any>['sync'] = (params) => {
    const { begin, write, commit, markReady, collection } = params

    // Store references for later use in mutation handlers
    syncBegin = begin
    syncWrite = write
    syncCommit = commit

    // Initialize BroadcastChannel for cross-tab sync
    const channelName = `tanstack-db:${dbInstance.name}`
    try {
      broadcastChannel = new BroadcastChannel(channelName)

      // Handle cross-tab messages
      broadcastChannel.onmessage = async (event: MessageEvent<CrossTabMessage>) => {
        const message = event.data

        // Skip our own messages
        if (message.tabId === tabId) {
          return
        }

        // Skip messages for other databases/stores
        if (message.database !== dbInstance.name || message.name !== name) {
          return
        }

        // Handle database clear
        if (message.type === 'database-cleared') {
          begin()
          // Delete all items from collection state
          for (const key of versionCache.keys()) {
            const item = collection.get(key)
            if (item) {
              write({ type: 'delete', value: item })
            }
          }
          versionCache.clear()
          commit()
          return
        }

        // Handle data changes - load changed items
        if (message.changedKeys.length > 0) {
          try {
            const db = getDatabase()

            await executeTransaction(
              db,
              [name, VERSIONS_STORE_NAME],
              'readonly',
              async (_, stores) => {
                const changes: Array<{ type: 'insert' | 'update' | 'delete'; key: string | number; value: any }> = []

                for (const key of message.changedKeys) {
                  // Load version entry
                  const versionRequest = stores[VERSIONS_STORE_NAME]!.get([name, key] as IDBValidKey)
                  const dataRequest = stores[name]!.get(key as IDBValidKey)

                  // Wait for both requests
                  await new Promise<void>((resolve) => {
                    let completed = 0
                    const checkComplete = () => {
                      completed++
                      if (completed === 2) resolve()
                    }
                    versionRequest.onsuccess = checkComplete
                    versionRequest.onerror = checkComplete
                    dataRequest.onsuccess = checkComplete
                    dataRequest.onerror = checkComplete
                  })

                  const versionEntry = versionRequest.result as VersionEntry | undefined
                  const data = dataRequest.result

                  const cachedVersion = versionCache.get(key)

                  if (versionEntry && data) {
                    if (!cachedVersion) {
                      // New item - insert
                      changes.push({ type: 'insert', key, value: data })
                      versionCache.set(key, versionEntry.versionKey)
                    } else if (cachedVersion !== versionEntry.versionKey) {
                      // Changed item - update
                      changes.push({ type: 'update', key, value: data })
                      versionCache.set(key, versionEntry.versionKey)
                    }
                  } else if (cachedVersion && !versionEntry) {
                    // Deleted item
                    const existingItem = collection.get(key)
                    if (existingItem) {
                      changes.push({ type: 'delete', key, value: existingItem })
                    }
                    versionCache.delete(key)
                  }
                }

                // Apply changes via sync protocol
                if (changes.length > 0) {
                  begin()
                  for (const change of changes) {
                    write({
                      type: change.type,
                      value: change.value,
                    })
                  }
                  commit()
                }
              },
            )
          } catch (error) {
            console.error('[IndexedDB Collection] Error processing cross-tab message:', error)
          }
        }
      }
    } catch {
      // BroadcastChannel not available (e.g., in tests or older browsers)
      // Cross-tab sync will be disabled but collection still works
    }

    // Perform initial load
    ;(async () => {
      try {
        const db = getDatabase()

        await executeTransaction(
          db,
          [name, VERSIONS_STORE_NAME],
          'readonly',
          async (_, stores) => {
            // Load all data
            const items = await getAll<Record<string, unknown>>(stores[name]!)

            // Load version entries for this collection
            // Use a cursor to get all entries with keys starting with [name, ...]
            const versionEntries = new Map<string | number, string>()

            await new Promise<void>((resolve) => {
              const range = IDBKeyRange.bound([name], [name, []])
              const cursorRequest = stores[VERSIONS_STORE_NAME]!.openCursor(range)

              cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result
                if (cursor) {
                  const keyArray = cursor.key as [string, string | number]
                  const itemKey = keyArray[1]
                  const entry = cursor.value as VersionEntry
                  versionEntries.set(itemKey, entry.versionKey)
                  cursor.continue()
                } else {
                  resolve()
                }
              }

              cursorRequest.onerror = () => {
                resolve()
              }
            })

            // Build version cache
            for (const [itemKey, versionKey] of versionEntries) {
              versionCache.set(itemKey, versionKey)
            }

            // Write items to collection via sync protocol
            if (items.length > 0) {
              begin()
              for (const item of items) {
                write({ type: 'insert', value: item })
              }
              commit()
            }

            // Mark collection as ready
            markReady()
          },
        )
      } catch (error) {
        console.error('[IndexedDB Collection] Error during initial load:', error)
        // Mark ready even on error to avoid blocking
        markReady()
      }
    })()

    // Return cleanup function
    return {
      cleanup: () => {
        if (broadcastChannel) {
          broadcastChannel.close()
          broadcastChannel = null
        }
        // Database connection managed by caller via dbInstance.close()
        // We don't close it here as other collections may share the same db
        syncBegin = null
        syncWrite = null
        syncCommit = null
        versionCache.clear()
      },
    }
  }

  const wrappedOnInsert = async (
    params: InsertMutationFnParams<any>,
  ): Promise<any> => {
    const { transaction } = params
    const mutations = transaction.mutations

    // Persist to IndexedDB
    for (const mutation of mutations) {
      const key = getKey(mutation.modified)
      await writeWithVersion(key, mutation.modified, 'insert')
    }

    // Queue sync confirmation
    const syncMutations = mutations.map((m) => ({
      type: 'insert' as const,
      key: getKey(m.modified),
      value: m.modified,
    }))
    queueSyncConfirmation(syncMutations)

    // Broadcast to other tabs
    const changedKeys = mutations.map((m) => getKey(m.modified))
    broadcastChange(changedKeys)

    // Call user's onInsert handler if provided
    if (onInsert) {
      return onInsert(params)
    }
  }

  const wrappedOnUpdate = async (
    params: UpdateMutationFnParams<any>,
  ): Promise<any> => {
    const { transaction } = params
    const mutations = transaction.mutations

    // Persist to IndexedDB
    for (const mutation of mutations) {
      const key = mutation.key
      await writeWithVersion(key, mutation.modified, 'update')
    }

    // Queue sync confirmation
    const syncMutations = mutations.map((m) => ({
      type: 'update' as const,
      key: m.key,
      value: m.modified,
    }))
    queueSyncConfirmation(syncMutations)

    // Broadcast to other tabs
    const changedKeys = mutations.map((m) => m.key)
    broadcastChange(changedKeys)

    // Call user's onUpdate handler if provided
    if (onUpdate) {
      return onUpdate(params)
    }
  }

  const wrappedOnDelete = async (
    params: DeleteMutationFnParams<any>,
  ): Promise<any> => {
    const { transaction } = params
    const mutations = transaction.mutations

    // Persist to IndexedDB
    for (const mutation of mutations) {
      const key = mutation.key
      await deleteWithVersion(key)
    }

    // Queue sync confirmation
    const syncMutations = mutations.map((m) => ({
      type: 'delete' as const,
      key: m.key,
      value: m.original,
    }))
    queueSyncConfirmation(syncMutations)

    // Broadcast to other tabs
    const changedKeys = mutations.map((m) => m.key)
    broadcastChange(changedKeys)

    // Call user's onDelete handler if provided
    if (onDelete) {
      return onDelete(params)
    }
  }

  const clearObjectStore = async (): Promise<void> => {
    const db = getDatabase()

    await executeTransaction(
      db,
      [name, VERSIONS_STORE_NAME],
      'readwrite',
      async (_, stores) => {
        // Clear data store
        await clear(stores[name]!)

        // Clear version entries for this collection
        // Use a cursor to delete entries with keys starting with [name, ...]
        await new Promise<void>((resolve) => {
          const range = IDBKeyRange.bound([name], [name, []])
          const cursorRequest = stores[VERSIONS_STORE_NAME]!.openCursor(range)

          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (cursor) {
              cursor.delete()
              cursor.continue()
            } else {
              resolve()
            }
          }

          cursorRequest.onerror = () => {
            resolve()
          }
        })
      },
    )

    // Clear in-memory cache
    versionCache.clear()

    // Broadcast clear to other tabs
    broadcastChange([], 'database-cleared')

    // Update collection state
    if (syncBegin && syncCommit) {
      syncBegin({ immediate: true })
      // The sync protocol will handle the state update
      syncCommit()
    }
  }

  const deleteDatabaseUtil = async (): Promise<void> => {
    // Close the database connection
    dbInstance.close()

    await deleteIDBDatabase(dbInstance.name, dbInstance.idbFactory)

    // Clear in-memory cache
    versionCache.clear()

    // Broadcast to other tabs
    broadcastChange([], 'database-cleared')
  }

  const getDatabaseInfo = async (): Promise<DatabaseInfo> => {
    const db = getDatabase()

    const info: DatabaseInfo = {
      name: db.name,
      version: db.version,
      objectStores: Array.from(db.objectStoreNames),
    }

    // Try to get estimated size via StorageManager API
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime check needed
    if (typeof navigator !== 'undefined' && navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate()
        info.estimatedSize = estimate.usage
      } catch {
        // StorageManager not available or estimate failed
      }
    }

    return info
  }

  const acceptMutations = async (transaction: {
    mutations: Array<PendingMutation<Record<string, unknown>>>
  }): Promise<void> => {
    const { mutations } = transaction

    for (const mutation of mutations) {
      const key = mutation.key

      if (mutation.type === 'insert' || mutation.type === 'update') {
        await writeWithVersion(key, mutation.modified, mutation.type)
      } else {
        await deleteWithVersion(key)
      }
    }

    // Queue sync confirmation
    const syncMutations = mutations.map((m) => ({
      type: m.type as 'insert' | 'update' | 'delete',
      key: m.key,
      value: m.type === 'delete' ? m.original : m.modified,
    }))
    queueSyncConfirmation(syncMutations)

    // Broadcast to other tabs
    const changedKeys = mutations.map((m) => m.key)
    broadcastChange(changedKeys)
  }

  const exportData = async (): Promise<Array<Record<string, unknown>>> => {
    const db = getDatabase()

    return executeTransaction(db, name, 'readonly', async (_, stores) => {
      return getAll<Record<string, unknown>>(stores[name]!)
    })
  }

  const importData = async (
    items: Array<Record<string, unknown>>,
  ): Promise<void> => {
    // Clear existing data first
    await clearObjectStore()

    const db = getDatabase()

    await executeTransaction(
      db,
      [name, VERSIONS_STORE_NAME],
      'readwrite',
      (_, stores) => {
        for (const item of items) {
          const key = getKey(item)
          const versionKey = generateVersionKey()

          // Write data
          put(stores[name]!, item, key as IDBValidKey)

          // Write version entry
          const versionEntry: VersionEntry = {
            versionKey,
            updatedAt: Date.now(),
          }
          put(stores[VERSIONS_STORE_NAME]!, versionEntry, [name, key] as IDBValidKey)

          // Update cache
          versionCache.set(key, versionKey)
        }
      },
    )

    // Queue sync confirmation for all imported items
    const syncMutations = items.map((item) => ({
      type: 'insert' as const,
      key: getKey(item),
      value: item,
    }))
    queueSyncConfirmation(syncMutations)

    // Broadcast to other tabs
    const changedKeys = items.map((item) => getKey(item))
    broadcastChange(changedKeys)
  }

  const utils: IndexedDBCollectionUtils = {
    clearObjectStore,
    deleteDatabase: deleteDatabaseUtil,
    getDatabaseInfo,
    acceptMutations,
    exportData,
    importData,
  }

  // Generate default ID if not provided
  const collectionId =
    baseCollectionConfig.id ?? `indexeddb-collection:${dbInstance.name}:${name}`

  return {
    ...baseCollectionConfig,
    id: collectionId,
    getKey,
    sync: { sync: internalSync },
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils,
  }
}
