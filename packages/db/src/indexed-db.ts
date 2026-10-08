/**
 * IndexedDB Collection for TanStack DB
 *
 * This module provides a factory function that creates IndexedDB-backed collections
 * compatible with TanStack DB's collection system.
 */

import { SchemaMustBeSynchronousError, SchemaValidationError } from './errors'
import { safeRandomUUID } from './utils/uuid'
import { withCollectionConfigFactory } from './client.js'
import {
  clear,
  executeTransaction,
  getAll,
  getByKey,
  openDatabase,
} from './indexed-db-wrapper'
import { codedMessage, devBuild } from './error-message.js'
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
} from './types'
import type { StandardSchemaV1 } from '@standard-schema/spec'

export class DatabaseRequiredError extends Error {
  constructor() {
    super(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `IndexedDB collection requires a "db" configuration option. ` +
            `Create a database instance using createIndexedDB() and pass it to the collection.`
        : codedMessage(175),
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Object store "${storeName}" not found in database "${databaseName}". ` +
            `Available stores: [${availableStores.join(', ')}]. ` +
            `Add "${storeName}" to the stores array when calling createIndexedDB().`
        : codedMessage(176, { storeName, databaseName, availableStores }),
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `IndexedDB collection requires a "name" configuration option. ` +
            `This is the name of the object store within the database.`
        : codedMessage(177),
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
      devBuild() && process.env.NODE_ENV !== `production`
        ? `IndexedDB collection requires a "getKey" configuration option. ` +
            `This function extracts the unique key from each item.`
        : codedMessage(178),
    )
    this.name = `GetKeyRequiredError`
  }
}

export interface CreateIndexedDBOptions {
  /** Database name */
  name: string
  /** Schema version (increment when adding stores) */
  version: number
  /** Object store names to create */
  stores: ReadonlyArray<string>
  /** Custom IDBFactory for testing/mocking */
  idbFactory?: IDBFactory
  /** Reports a native blocker without settling the open request. */
  onBlocked?: (event: IDBVersionChangeEvent) => void
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
  /** Requested object store names (frozen); omissions do not remove stores */
  readonly stores: ReadonlyArray<string>
  /** IDBFactory used to create this database (for testing) */
  readonly idbFactory?: IDBFactory
  /** Close the connection and mark its managed Collections as errored. */
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
   * Must exist in the underlying database
   */
  name: string
}

/**
 * Version entry stored in the shared _versions object store
 * Key is a tuple: [name, itemKey]
 */
interface VersionEntry {
  versionKey: string // UUID for change detection
}

/**
 * Cross-tab message format via BroadcastChannel
 */
interface CrossTabMessage {
  type: 'data-changed' | 'database-cleared'
  database: string
  name: string // Object store name
  changedKeys: Array<string | number> // Keys that changed (for targeted loading)
  tabId: string // To avoid processing own messages
}

// BroadcastChannel is shared transport. Admit only this protocol before reading
// its routing fields or issuing storage work. Invalid messages carry no writes.
function isCrossTabMessage(value: unknown): value is CrossTabMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    (message.type === 'data-changed' || message.type === 'database-cleared') &&
    typeof message.database === 'string' &&
    typeof message.name === 'string' &&
    typeof message.tabId === 'string' &&
    Array.isArray(message.changedKeys) &&
    message.changedKeys.every(
      (key: unknown) =>
        typeof key === 'string' ||
        (typeof key === 'number' && !Number.isNaN(key)),
    )
  )
}

/**
 * Database information returned by getDatabaseInfo()
 */
export interface DatabaseInfo {
  name: string
  version: number
  objectStores: Array<string>
  /** Origin-wide storage usage in bytes, including other databases and caches. */
  estimatedSize?: number
}

/**
 * Utility functions exposed on collection.utils
 */
export interface IndexedDBCollectionUtils<
  TItem extends object = Record<string, unknown>,
  TInsertInput extends object = TItem,
> extends UtilsRecord {
  /**
   * Removes all data from the object store
   * Does NOT delete the database itself
   */
  clearObjectStore: () => Promise<void>

  /**
   * Returns database information for debugging
   */
  getDatabaseInfo: () => Promise<DatabaseInfo>

  /**
   * Accepts mutations from a manual transaction and persists to IndexedDB
   */
  acceptMutations: (transaction: {
    mutations: Array<PendingMutation>
  }) => Promise<void>

  /**
   * Exports all data from the object store as an array
   * Useful for backup/debugging
   */
  exportData: () => Promise<Array<TItem>>

  /**
   * Validates input rows and atomically replaces the object store.
   * Failure preserves the previous rows and versions.
   */
  importData: (items: Array<TInsertInput>) => Promise<void>
}

const VERSIONS_STORE_NAME = '_versions'
// Connection closure is sticky, including Collections started after close.
// Keep core's sync run alive: admitted writes and accepted sync transactions
// still owe their confirmations, while new reads have no publication authority.
const connections = new WeakMap<
  IDBDatabase,
  {
    error?: Error
    listeners: Set<() => void>
  }
>()

/**
 * Creates or opens an IndexedDB database with the specified stores.
 * Call this once at app startup, then pass the instance to collections.
 * The connection closes on versionchange so another context can upgrade or
 * delete the database. Affected Collections enter error and retain their rows.
 * Recreate affected Collections with a new instance before
 * further persistence.
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
 *     getKey: (item: { id: string }) => item.id,
 *   })
 * )
 * ```
 */
export async function createIndexedDB(
  options: CreateIndexedDBOptions,
): Promise<IndexedDBInstance> {
  const { name, version, stores, idbFactory, onBlocked } = options

  // Validate options
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety for JS consumers
  if (!stores || stores.length === 0) {
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? 'createIndexedDB requires at least one store in the stores array.'
        : codedMessage(193),
    )
  }

  const storeSet = new Set(stores)
  if (storeSet.size !== stores.length) {
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? 'createIndexedDB stores array contains duplicate store names.'
        : codedMessage(194),
    )
  }

  for (const storeName of stores) {
    if (storeName === VERSIONS_STORE_NAME) {
      throw new Error(
        devBuild() && process.env.NODE_ENV !== `production`
          ? 'The "_versions" store is reserved for IndexedDB Collection metadata.'
          : codedMessage(195),
      )
    }
    if (!storeName || typeof storeName !== 'string') {
      throw new Error(
        devBuild() && process.env.NODE_ENV !== `production`
          ? 'createIndexedDB stores array contains invalid store names. ' +
              'Each store name must be a non-empty string.'
          : codedMessage(196),
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
    onBlocked,
  )

  const connection: { error?: Error; listeners: Set<() => void> } = {
    listeners: new Set(),
  }
  connections.set(db, connection)
  const close = () => {
    db.close()
    if (connection.error) return
    connection.error = new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `IndexedDB connection "${name}" closed. Recreate its Collections with a new database instance.`
        : codedMessage(197, { name }),
    )
    // Record closure before reentrant listeners can request more work. Core
    // reports user event-listener failures asynchronously and notifies siblings.
    for (const notify of [...connection.listeners]) notify()
  }
  db.addEventListener('versionchange', close)
  db.addEventListener('close', close)

  // Create frozen stores array for immutability
  const frozenStores = Object.freeze([...stores])

  return Object.freeze({
    db,
    name,
    version: db.version,
    stores: frozenStores,
    idbFactory,
    close,
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
 *     getKey: (item: { id: string }) => item.id,
 *   })
 * )
 *
 * @example
 * // Without schema (explicit type)
 * const todosCollection = createCollection(
 *   indexedDBCollectionOptions<Todo>({
 *     db,
 *     name: 'todos',
 *     getKey: (item: { id: string }) => item.id,
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
  IndexedDBCollectionUtils<InferSchemaOutput<T>, InferSchemaInput<T>>
> & {
  schema: T
  utils: IndexedDBCollectionUtils<InferSchemaOutput<T>, InferSchemaInput<T>>
}

// Overload for when no schema is provided
export function indexedDBCollectionOptions<
  T extends object,
  TKey extends string | number = string | number,
>(
  config: IndexedDBCollectionConfig<T, never, TKey> & {
    schema?: never
  },
): CollectionConfig<T, TKey, never, IndexedDBCollectionUtils<T>> & {
  schema?: never
  utils: IndexedDBCollectionUtils<T>
}

export function indexedDBCollectionOptions(
  config: IndexedDBCollectionConfig<Record<string, unknown>, StandardSchemaV1>,
): CollectionConfig<
  Record<string, unknown>,
  string | number,
  StandardSchemaV1,
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
  if (name === VERSIONS_STORE_NAME) {
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? 'The "_versions" store is reserved for IndexedDB Collection metadata.'
        : codedMessage(198),
    )
  }

  // Validate that the store exists in the database (sync check)
  for (const storeName of [name, VERSIONS_STORE_NAME]) {
    if (!dbInstance.db.objectStoreNames.contains(storeName)) {
      throw new ObjectStoreNotFoundError(
        storeName,
        dbInstance.name,
        Array.from(dbInstance.db.objectStoreNames),
      )
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!getKey) {
    throw new GetKeyRequiredError()
  }

  type Item = Record<string, unknown>
  type Mutation = {
    type: OperationType
    key: string | number
    modified: Item
  }
  type Sync = Parameters<SyncConfig<Item>['sync']>[0]
  const collectionId =
    baseCollectionConfig.id ??
    `indexed-db-collection:${dbInstance.name}:${name}`
  const connection = connections.get(dbInstance.db)
  const tabId = safeRandomUUID()
  const versionCache = new Map<string | number, string>()
  let collection: Sync['collection'] | undefined
  let acceptance: Promise<void> = Promise.resolve()
  let activeSync: Sync | undefined
  let broadcastChannel: BroadcastChannel | undefined

  function broadcastChange(
    changedKeys: Array<string | number>,
    type: CrossTabMessage['type'] = 'data-changed',
  ): void {
    let channel = broadcastChannel
    if (!channel) {
      try {
        channel = new BroadcastChannel(`tanstack-db:${dbInstance.name}`)
      } catch {
        return // Local persistence does not require BroadcastChannel.
      }
    }
    try {
      channel.postMessage({
        type,
        database: dbInstance.name,
        name,
        changedKeys,
        tabId,
      } satisfies CrossTabMessage)
    } finally {
      // Utility writes are legal before startup and after cleanup. Their
      // send-only channel owns no subscription and ends with the send.
      if (channel !== broadcastChannel) channel.close()
    }
  }

  // Jump to this store's compound-key prefix without ambient IDBKeyRange.
  // Stop after its last key; sibling rows are never visited. Request errors must
  // reject the surrounding transaction, including failures while deleting.
  function visitVersions(
    store: IDBObjectStore,
    visit: (cursor: IDBCursorWithValue) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.openCursor()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        try {
          const [storeName] = cursor.key as [string, string | number]
          if (storeName < name) {
            cursor.continue([name])
          } else if (storeName === name) {
            visit(cursor)
            cursor.continue()
          } else {
            resolve()
          }
        } catch (error) {
          reject(error)
        }
      }
    })
  }

  // Stage cache changes until the ONE data-and-version transaction completes.
  // A failed request, including synchronous structured-clone failure, aborts
  // every mutation in this Collection's batch.
  async function persist(
    mutations: Array<Mutation>,
    replace = false,
  ): Promise<void> {
    const versions = new Map<string | number, string>()
    await executeTransaction(
      dbInstance.db,
      [name, VERSIONS_STORE_NAME],
      'readwrite',
      async (_, stores) => {
        if (replace) {
          await clear(stores[name]!)
          await visitVersions(stores[VERSIONS_STORE_NAME]!, (cursor) => {
            cursor.delete()
          })
        }
        for (const mutation of mutations) {
          const { key } = mutation
          if (mutation.type === 'delete') {
            stores[name]!.delete(key)
            stores[VERSIONS_STORE_NAME]!.delete([name, key])
          } else {
            const versionKey = safeRandomUUID()
            stores[name]!.put(mutation.modified, key)
            stores[VERSIONS_STORE_NAME]!.put(
              {
                versionKey,
              } satisfies VersionEntry,
              [name, key],
            )
            versions.set(key, versionKey)
          }
        }
      },
    )
    if (replace) versionCache.clear()
    for (const mutation of mutations) {
      const version = versions.get(mutation.key)
      if (version === undefined) versionCache.delete(mutation.key)
      else versionCache.set(mutation.key, version)
    }
  }

  function confirm(mutations: Array<Mutation>, replace = false): void {
    if (!activeSync) return
    // Core queues ordinary confirmation until optimistic settlement.
    // Full-row update confirms put even if a peer inserted during the handler.
    // A replacement's truncate already supplies its own publication boundary.
    activeSync.begin()
    if (replace) activeSync.truncate({ markReady: !connection?.error })
    for (const mutation of mutations) {
      activeSync.write(
        mutation.type === 'delete'
          ? { type: 'delete', key: mutation.key }
          : { type: 'update', value: mutation.modified },
      )
    }
    activeSync.commit()
  }

  // Startup and replacement notifications read rows and versions from one
  // native snapshot, then publish only into the sync run that requested it.
  async function restore(params: Sync, replace: boolean): Promise<void> {
    const snapshot = await executeTransaction(
      dbInstance.db,
      [name, VERSIONS_STORE_NAME],
      'readonly',
      async (_, stores) => {
        const items = await getAll<Item>(stores[name]!)
        const versions = new Map<string | number, string>()
        await visitVersions(stores[VERSIONS_STORE_NAME]!, (cursor) => {
          const [, key] = cursor.key as [string, string | number]
          versions.set(key, (cursor.value as VersionEntry).versionKey)
        })
        return { items, versions }
      },
    )
    if (activeSync !== params || connection?.error) return
    versionCache.clear()
    for (const [key, version] of snapshot.versions)
      versionCache.set(key, version)
    params.begin()
    if (replace) params.truncate()
    for (const item of snapshot.items)
      params.write({ type: 'insert', value: item })
    params.commit()
    if (!replace) params.markReady()
  }

  const internalSync: SyncConfig<Item>['sync'] = (params) => {
    const { begin, write, commit, markError } = params
    activeSync = params
    collection = params.collection
    let channel: BroadcastChannel | undefined
    const retire = () => {
      channel?.close()
      if (activeSync === params) {
        broadcastChannel = undefined
        markError(connection?.error)
      }
    }
    if (connection?.error) {
      retire()
      return
    }
    connection?.listeners.add(retire)

    try {
      channel = new BroadcastChannel(`tanstack-db:${dbInstance.name}`)
      broadcastChannel = channel
      channel.onmessage = async (event: MessageEvent<CrossTabMessage>) => {
        const message: unknown = event.data
        if (!isCrossTabMessage(message)) return
        if (
          activeSync !== params ||
          connection?.error ||
          message.tabId === tabId ||
          message.database !== dbInstance.name ||
          message.name !== name
        )
          return
        try {
          if (message.type === 'database-cleared') {
            // The notification describes an earlier replacement. Current
            // durable rows may also contain later accepted writes.
            await restore(params, true)
            return
          }
          if (!message.changedKeys.length) return
          const rows = await executeTransaction(
            dbInstance.db,
            [name, VERSIONS_STORE_NAME],
            'readonly',
            async (_, stores) => {
              const result = []
              for (const key of message.changedKeys) {
                const [version, value] = await Promise.all([
                  getByKey<VersionEntry>(stores[VERSIONS_STORE_NAME]!, [
                    name,
                    key,
                  ]),
                  getByKey<Item>(stores[name]!, key),
                ])
                result.push({ key, version, value })
              }
              return result
            },
          )
          if (activeSync !== params || connection?.error) return
          const changes: Array<ChangeMessageOrDeleteKeyMessage<Item>> = []
          for (const { key, version, value } of rows) {
            const cached = versionCache.get(key)
            if (value) {
              if (!version || cached !== version.versionKey) {
                changes.push({
                  type: 'update',
                  value,
                })
                if (version) versionCache.set(key, version.versionKey)
                else versionCache.delete(key)
              }
            } else {
              // Source deletion is independent of the optimistic public view.
              changes.push({ type: 'delete', key })
              versionCache.delete(key)
            }
          }
          if (changes.length) {
            begin()
            for (const change of changes) write(change)
            commit()
          }
        } catch (error) {
          if (activeSync === params) markError(error)
        }
      }
    } catch {
      // Persistence also works in environments without BroadcastChannel.
    }

    void restore(params, false).catch((error: unknown) => {
      if (activeSync === params) markError(error)
    })

    return {
      cleanup: () => {
        connection?.listeners.delete(retire)
        channel?.close()
        if (activeSync === params) {
          activeSync = undefined
          broadcastChannel = undefined
          versionCache.clear()
        }
      },
    }
  }

  const acceptMutations = async (transaction: {
    mutations: Array<PendingMutation<Item>>
  }): Promise<void> => {
    const mutations = transaction.mutations
      .filter((m) => m.collection === collection)
      .map((m) => ({
        type: m.type,
        key: getKey(m.modified),
        modified: m.modified,
      }))
    if (!mutations.length) return
    await persist(mutations)
    confirm(mutations)
    broadcastChange(mutations.map((m) => m.key))
  }

  // Start handlers immediately, but accept successful automatic writes in
  // invocation order. Observe rejection immediately even while a predecessor
  // is held. Each rejected decision releases its place without persisting.
  function persistInOrder(
    transaction: { mutations: Array<PendingMutation<Item>> },
    handler: () => unknown,
  ): Promise<unknown> {
    const result = acceptance.then(async () => {
      const outcome = await decision
      if (!outcome.accepted) throw outcome.error
      await acceptMutations(transaction)
      return outcome.value
    })
    acceptance = result.then(
      () => undefined,
      () => undefined,
    )
    // Reserve the position before application code can author another write.
    const decision = new Promise<unknown>((resolve) => resolve(handler())).then(
      (value) => ({ accepted: true as const, value }),
      (error: unknown) => ({ accepted: false as const, error }),
    )
    return result
  }

  const wrappedOnInsert = (params: InsertMutationFnParams<Item>) =>
    persistInOrder(params.transaction, () => onInsert?.(params))
  const wrappedOnUpdate = (params: UpdateMutationFnParams<Item>) =>
    persistInOrder(params.transaction, () => onUpdate?.(params))
  const wrappedOnDelete = (params: DeleteMutationFnParams<Item>) =>
    persistInOrder(params.transaction, () => onDelete?.(params))

  const clearObjectStore = async (): Promise<void> => {
    await persist([], true)
    confirm([], true)
    broadcastChange([], 'database-cleared')
  }

  const getDatabaseInfo = async (): Promise<DatabaseInfo> => {
    const db = dbInstance.db
    const info: DatabaseInfo = {
      name: db.name,
      version: db.version,
      objectStores: Array.from(db.objectStoreNames),
    }
    // Storage estimates are optional diagnostics, not a persistence prerequisite.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- optional browser API at runtime
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        info.estimatedSize = (await navigator.storage.estimate()).usage
      } catch {}
    }
    return info
  }

  const exportData = (): Promise<Array<Item>> =>
    executeTransaction(dbInstance.db, name, 'readonly', (_, stores) =>
      getAll<Item>(stores[name]!),
    )

  const importData = async (items: Array<Item>): Promise<void> => {
    const keys = new Set<string | number>()
    const mutations = items.map((input) => {
      let item = input
      if (config.schema) {
        const result = config.schema['~standard'].validate(input)
        if (result instanceof Promise) throw new SchemaMustBeSynchronousError()
        if (result.issues) {
          throw new SchemaValidationError(
            'insert',
            result.issues.map((issue) => ({
              message: issue.message,
              path: issue.path?.map(String),
            })),
          )
        }
        item = result.value as Item
      }
      const key = getKey(item)
      if (keys.has(key))
        throw new Error(
          devBuild() && process.env.NODE_ENV !== `production`
            ? `Duplicate imported key: ${key}`
            : codedMessage(199, { key }),
        )
      keys.add(key)
      return { type: 'insert' as const, key, modified: structuredClone(item) }
    })
    await persist(mutations, true)
    confirm(mutations, true)
    broadcastChange([], 'database-cleared')
  }

  const utils: IndexedDBCollectionUtils = {
    clearObjectStore,
    getDatabaseInfo,
    acceptMutations,
    exportData,
    importData,
  }
  const options = {
    ...baseCollectionConfig,
    id: collectionId,
    getKey,
    sync: { sync: internalSync, rowUpdateMode: 'full' as const },
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils,
  }
  return withCollectionConfigFactory(options, () =>
    (
      indexedDBCollectionOptions as (
        nextConfig: IndexedDBCollectionConfig<Item, StandardSchemaV1>,
      ) => typeof options
    )({ ...config, id: collectionId }),
  )
}
