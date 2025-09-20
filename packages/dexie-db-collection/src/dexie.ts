import Dexie, { liveQuery } from "dexie"
import DebugModule from "debug"
import { addDexieMetadata, stripDexieFields } from "./helper"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InferSchemaOutput,
  InsertMutationFnParams,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"
import type { Subscription, Table } from "dexie"

const debug = DebugModule.debug(`ts/db:dexie`)

// Optional codec interface for data transformation
export interface DexieCodec<TItem, TStored = TItem> {
  parse?: (raw: TStored) => TItem
  serialize?: (item: TItem) => TStored
}

/**
 * Configuration interface for Dexie collection options
 * @template TItem - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 *
 * @remarks
 * Type resolution follows a priority order:
 * 1. If you provide an explicit type via generic parameter, it will be used
 * 2. If no explicit type is provided but a schema is, the schema's output type will be inferred
 *
 * You should provide EITHER an explicit type OR a schema, but not both, as they would conflict.
 * Notice that primary keys in Dexie can be string or number.
 */
export interface DexieCollectionConfig<
  TItem extends object = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
> extends Omit<
    CollectionConfig<TItem, string | number, TSchema>,
    `onInsert` | `onUpdate` | `onDelete` | `getKey` | `sync`
  > {
  dbName?: string
  tableName?: string
  storeName?: string
  codec?: DexieCodec<TItem>
  schema?: TSchema
  rowUpdateMode?: `partial` | `full`
  syncBatchSize?: number
  ackTimeoutMs?: number
  awaitTimeoutMs?: number
  getKey: (item: TItem) => string | number
}

// Enhanced utils interface
export interface DexieUtils extends UtilsRecord {
  getTable: () => Table<Record<string, unknown>, string | number>

  awaitIds: (ids: Array<string | number>) => Promise<void>

  refresh: () => void

  refetch: () => Promise<void>
}

/**
 * Creates Dexie collection options for use with a standard Collection
 *
 * @template TItem - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @param config - Configuration options for the Dexie collection
 * @returns Collection options with utilities
 */
export function dexieCollectionOptions<T extends StandardSchemaV1>(
  config: DexieCollectionConfig<InferSchemaOutput<T>, T>
): CollectionConfig<InferSchemaOutput<T>, string | number, T> & {
  schema: T
  utils: DexieUtils
}

export function dexieCollectionOptions<T extends object>(
  config: DexieCollectionConfig<T> & { schema?: never }
): CollectionConfig<T, string | number> & {
  schema?: never
  utils: DexieUtils
}

export function dexieCollectionOptions<
  TItem extends object = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
>(
  config: DexieCollectionConfig<TItem, TSchema>
): CollectionConfig<TItem, string | number, TSchema> & { utils: DexieUtils } {
  // Track IDs seen by the reactive layer (timestamp as value) - per collection instance
  const seenIds = new Map<string | number, number>()

  // Ack helpers: `ackedIds` = acknowledged IDs, `pendingAcks` = waiters - per collection instance
  const ackedIds = new Set<string | number>()
  const pendingAcks = new Map<
    string | number,
    {
      promise: Promise<void>
      resolve: () => void
      reject: (err: unknown) => void
    }
  >()

  const dbName = config.dbName || `app-db`
  const tableName =
    config.tableName || config.storeName || config.id || `collection`

  // Initialize Dexie database
  const db = new Dexie(dbName)
  db.version(1).stores({
    [tableName]: `&id, _updatedAt, _createdAt`, // Include our metadata fields for efficient sorting
  })

  const table = db.table(tableName)

  const awaitAckedIds = async (
    ids: Array<string | number>,
    timeoutMs = config.ackTimeoutMs || 2000
  ) => {
    const results: Array<Promise<void>> = []
    const timedOutIds: Array<string | number> = []

    for (const id of ids) {
      if (ackedIds.has(id)) {
        results.push(Promise.resolve())
        continue
      }

      const existing = pendingAcks.get(id)
      if (existing) {
        results.push(existing.promise)
        continue
      }

      let resolve!: () => void
      let reject!: (err: unknown) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })

      void promise.catch(() => {})

      pendingAcks.set(id, { promise, resolve, reject })

      const t = setTimeout(() => {
        if (!pendingAcks.has(id)) return
        pendingAcks.delete(id)
        debug(`awaitAckedIds:timeout`, { id: String(id) })
        timedOutIds.push(id)
        resolve()
      }, timeoutMs)

      void promise.finally(() => clearTimeout(t))

      results.push(promise)
    }

    await Promise.all(results)

    if (timedOutIds.length > 0) {
      throw new Error(
        `Timeout waiting for acked ids: ${timedOutIds.join(`, `)}`
      )
    }
  }

  const awaitIds = async (
    ids: Array<string | number>,
    timeoutMs = config.awaitTimeoutMs || 10000
  ): Promise<void> => {
    try {
      await awaitAckedIds(ids, config.ackTimeoutMs || 2000)
      return
    } catch {
      try {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
          const allSeen = ids.every((id) => seenIds.has(id))
          if (allSeen) return

          // Instead of checking database directly, check if data exists in DB
          // and give the reactive layer a chance to process it
          try {
            const bulkFn = table.bulkGet
            let rows: unknown
            if (typeof bulkFn === `function`) {
              rows = await bulkFn.call(table, ids)
            } else {
              rows = await Promise.all(ids.map((id) => table.get(id)))
            }
            const present = Array.isArray(rows) && rows.every((r) => r != null)
            if (present) {
              // Data exists in DB, trigger a refresh to ensure reactive layer processes it
              triggerRefresh()
              // Give the reactive layer a bit more time to process
              await new Promise((r) => setTimeout(r, 100))

              // Check again if the reactive layer has processed it
              const allSeenAfterRefresh = ids.every((id) => seenIds.has(id))
              if (allSeenAfterRefresh) return
            }
          } catch {}

          await new Promise((r) => setTimeout(r, 50))
        }
      } catch {}

      throw new Error(`Timeout waiting for IDs: ${ids.join(`, `)}`)
    }
  }

  // Schema validation helper following create-collection.md patterns
  const validateSchema = (item: unknown): TItem => {
    if (config.schema) {
      // Handle different schema validation patterns (Zod, etc.)
      const schema = config.schema as unknown as {
        parse?: (data: unknown) => TItem
        safeParse?: (data: unknown) => {
          success: boolean
          data?: TItem
          error?: unknown
        }
      }

      if (schema.parse) {
        try {
          return schema.parse(item)
        } catch (error) {
          throw new Error(
            `Schema validation failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      } else if (schema.safeParse) {
        const result = schema.safeParse(item)
        if (!result.success) {
          throw new Error(
            `Schema validation failed: ${JSON.stringify(result.error)}`
          )
        }
        return result.data!
      }
    }
    return item as TItem
  }

  // Data transformation helpers
  const parse = (raw: Record<string, unknown>): TItem => {
    // First strip our internal metadata fields
    const cleanedRaw = stripDexieFields(raw)

    let parsed: unknown = cleanedRaw

    // Apply codec parse if provided
    if (config.codec?.parse) {
      parsed = config.codec.parse(cleanedRaw as never)
    }

    // Then validate against schema - this is where TanStack DB handles validation
    // Schema validation is handled automatically by TanStack DB during insert/update operations
    // The schema is primarily used for type inference and automatic validation
    const validated = validateSchema(parsed)

    return validated
  }

  const serialize = (
    item: TItem,
    isUpdate = false
  ): Record<string, unknown> => {
    let serialized: unknown = item

    // Apply codec serialize
    if (config.codec?.serialize) {
      serialized = config.codec.serialize(item)
    } else {
      serialized = item
    }

    // Add our metadata for efficient syncing and conflict resolution
    return addDexieMetadata(serialized as Record<string, unknown>, isUpdate)
  }

  // Track refresh triggers for manual refresh capability
  let refreshTrigger = 0
  const triggerRefresh = () => {
    refreshTrigger++
  }

  // Shallow comparison helper for efficient change detection
  const shallowEqual = (obj1: any, obj2: any): boolean => {
    if (obj1 === obj2) return true
    if (!obj1 || !obj2) return false
    if (typeof obj1 !== `object` || typeof obj2 !== `object`) return false

    const keys1 = Object.keys(obj1)
    const keys2 = Object.keys(obj2)

    if (keys1.length !== keys2.length) return false

    for (const key of keys1) {
      if (obj1[key] !== obj2[key]) return false
    }

    return true
  }

  /**
   * "sync"
   * Sync between the local Dexie table and the in-memory TanStack DB
   * collection. Not a remote/server sync — keeps local reactive state
   * and in-memory collection consistent.
   */
  const sync = (params: Parameters<SyncConfig<TItem>[`sync`]>[0]) => {
    const { begin, write, commit, markReady } = params

    // Track the previous snapshot to implement proper diffing
    let previousSnapshot = new Map<string | number, TItem>()

    // Batched initial sync configuration
    const syncBatchSize = config.syncBatchSize || 1000

    // Initial sync state
    let isInitialSyncComplete = false
    let lastUpdatedAt: number | undefined
    let hasMarkedReady = false
    let subscription: Subscription | null = null

    const performInitialSync = async () => {
      // initial sync started

      begin()
      let totalProcessed = 0

      for (;;) {
        // Query next batch using _updatedAt for efficient pagination
        let batchRecords: Array<any>

        if (lastUpdatedAt) {
          // Continue from where we left off using where().above()
          batchRecords = await table
            .where(`_updatedAt`)
            .above(lastUpdatedAt)
            .limit(syncBatchSize)
            .toArray()
        } else {
          // First batch - get oldest records, or all records if no _updatedAt exists
          try {
            batchRecords = await table
              .orderBy(`_updatedAt`)
              .limit(syncBatchSize)
              .toArray()
          } catch {
            // Fallback for records without _updatedAt (pre-existing data)
            batchRecords = await table.limit(syncBatchSize).toArray()
          }
        }

        if (batchRecords.length === 0) {
          // No more records, initial sync is complete
          break
        }

        // Process this batch
        const batchSnapshot = new Map<string | number, TItem>()

        for (const record of batchRecords) {
          const item = parse(record)

          const key = config.getKey(item)

          // Track this ID as seen (for optimistic state management)
          seenIds.set(key, Date.now())

          // Mark ack for this id (reactive layer has observed it)
          ackedIds.add(key)
          const pending = pendingAcks.get(key)
          if (pending) {
            try {
              pending.resolve()
            } catch {}
            pendingAcks.delete(key)
          }

          batchSnapshot.set(key, item)

          // Update lastUpdatedAt for next batch (use our metadata field)
          const updatedAt = record._updatedAt
          if (updatedAt && (!lastUpdatedAt || updatedAt > lastUpdatedAt)) {
            lastUpdatedAt = updatedAt
          }
        }

        // Write this batch to TanStack DB
        for (const [, item] of batchSnapshot) {
          write({
            type: `insert`,
            value: item,
          })
          previousSnapshot.set(config.getKey(item), item)
        }

        totalProcessed += batchRecords.length

        // If we got less than batch size, we're done
        if (batchRecords.length < syncBatchSize) {
          break
        }
      }

      commit()
      isInitialSyncComplete = true

      debug(`sync:initial-complete`, { totalProcessed })

      // Add memory usage warning for large collections
      if (totalProcessed > 5000) {
        debug(`sync:large-collection`, { totalProcessed })
      }
    }

    // Start the sync process
    const startSync = async () => {
      // Perform initial sync first, outside of liveQuery
      await performInitialSync()

      // Start the liveQuery subscription to monitor ongoing changes
      startLiveQuery()

      // Mark as ready after initial sync completes
      if (!hasMarkedReady) {
        try {
          markReady()
        } finally {
          hasMarkedReady = true
        }
      }
    }

    // Start live monitoring of changes (after initial sync)
    const startLiveQuery = () => {
      subscription = liveQuery(async () => {
        void refreshTrigger

        if (!isInitialSyncComplete) {
          return previousSnapshot
        }

        const records = await table.toArray()

        const snapshot = new Map<string | number, TItem>()

        for (const record of records) {
          let item: TItem
          try {
            item = parse(record)
          } catch (err) {
            // Skip invalid records instead of letting liveQuery throw

            debug(`parse:skip`, { id: record?.id, error: err })

            continue
          }

          const key = config.getKey(item)

          // Track this ID as seen (for optimistic state management)
          seenIds.set(key, Date.now())

          // Mark ack for this id (reactive layer has observed it)
          ackedIds.add(key)
          const pending = pendingAcks.get(key)
          if (pending) {
            try {
              pending.resolve()
            } catch {}
            pendingAcks.delete(key)
          }

          snapshot.set(key, item)
        }

        return snapshot
      }).subscribe({
        next: (currentSnapshot) => {
          // Skip processing during initial sync - it's handled separately
          if (!isInitialSyncComplete) {
            // Mark ready after initial sync
            if (!hasMarkedReady) {
              try {
                markReady()
              } finally {
                hasMarkedReady = true
              }
            }
            return
          }

          begin()

          for (const [key, item] of currentSnapshot) {
            if (previousSnapshot.has(key)) {
              const previousItem = previousSnapshot.get(key)
              // NOTE : we are using any because we are attatching meta fields for dexie similar to rxdb
              const currentUpdatedAt = (item as any)._updatedAt
              const previousUpdatedAt = (previousItem as any)._updatedAt

              let hasChanged = false
              if (currentUpdatedAt && previousUpdatedAt) {
                hasChanged = currentUpdatedAt !== previousUpdatedAt
              } else {
                hasChanged = !shallowEqual(previousItem, item)
              }

              if (hasChanged) {
                write({
                  type: `update`,
                  value: item,
                })
              }
            } else {
              // New item, this is an insert
              write({
                type: `insert`,
                value: item,
              })
            }
          }

          // Process deletions - items that were in previous but not in current
          for (const [key, item] of previousSnapshot) {
            if (!currentSnapshot.has(key)) {
              write({
                type: `delete`,
                value: item, // Use the full item for deletion
              })
            }
          }

          // Update our snapshot for the next comparison
          previousSnapshot = new Map(currentSnapshot)

          commit()

          // live commit completed

          // After the first emission/commit, mark the collection as ready so
          // callers awaiting stateWhenReady() observe the initial data.
          if (!hasMarkedReady) {
            try {
              markReady()
            } finally {
              hasMarkedReady = true
            }
          }
        },
        error: (error) => {
          debug(`sync:live-error`, { error })
          // Still mark ready even on error (as per create-collection.md)
          if (!hasMarkedReady) {
            try {
              markReady()
            } finally {
              hasMarkedReady = true
            }
          }
        },
      })
    }

    // Start the sync process
    startSync()

    // Return cleanup function (critical requirement from create-collection.md)
    return () => {
      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }

  // Built-in mutation handlers (Pattern B) - we implement these directly using Dexie APIs
  const onInsert = async (insertParams: InsertMutationFnParams<TItem>) => {
    // Ensure the collection's sync is running so the reactive layer
    // (liveQuery) can observe writes and ack them. Use the public
    // startSyncImmediate() helper to avoid accessing internals.
    insertParams.collection.startSyncImmediate()

    const mutations = insertParams.transaction.mutations

    const items = mutations.map((mutation) => {
      const item = serialize(mutation.modified, false) // false = not an update
      return {
        ...item,
        id: mutation.key,
      } as Record<string, unknown> & { id: string | number }
    })

    // bulk insert

    // Perform bulk operation using Dexie transaction
    await db.transaction(`rw`, table, async () => {
      await table.bulkPut(items)
    })
    await db.table(tableName).count()

    // Optimistically mark IDs as seen immediately after write so callers
    // waiting with `awaitIds` don't have to wait for the reactive layer
    // to observe the change. Do not block the insert handler on the reactive
    // layer ack — awaiting here can cause races between multiple instances
    // where a second insert observes the first insert and throws a DuplicateKey
    // error. The reactive layer will still ack and update synced state.
    const ids = mutations.map((m) => m.key)

    const now = Date.now()
    for (const id of ids) seenIds.set(id, now)
    triggerRefresh()

    return ids
  }

  const onUpdate = async (updateParams: UpdateMutationFnParams<TItem>) => {
    updateParams.collection.startSyncImmediate()
    const mutations = updateParams.transaction.mutations
    await db.transaction(`rw`, table, async () => {
      for (const mutation of mutations) {
        const key = mutation.key
        if (config.rowUpdateMode === `full`) {
          const item = serialize(mutation.modified, true)
          const updateItem = {
            ...item,
            id: key,
          } as Record<string, unknown> & { id: string | number }
          await table.put(updateItem)
        } else {
          const changes = serialize(mutation.changes as TItem, true)
          await table.update(key, changes)
        }
      }
    })
    const ids = mutations.map((m) => m.key)
    const now = Date.now()
    for (const id of ids) seenIds.set(id, now)
    triggerRefresh()
    return ids
  }

  const onDelete = async (deleteParams: DeleteMutationFnParams<TItem>) => {
    // Ensure sync is started so deletions are observed by liveQuery
    deleteParams.collection.startSyncImmediate()

    const mutations = deleteParams.transaction.mutations
    const ids = mutations.map((m) => m.key)

    // bulk delete

    await db.transaction(`rw`, table, async () => {
      await table.bulkDelete(ids)
    })

    ids.forEach((id) => seenIds.delete(id))

    return ids
  }

  const utils: DexieUtils = {
    getTable: () => table as Table<Record<string, unknown>, string | number>,
    awaitIds,
    refresh: triggerRefresh,
    refetch: async () => {
      triggerRefresh()
      await new Promise((r) => setTimeout(r, 20))
    },
  }

  return {
    id: config.id,
    schema: config.schema,
    getKey: config.getKey,
    rowUpdateMode: config.rowUpdateMode ?? `partial`,
    sync: { sync },
    onInsert,
    onUpdate,
    onDelete,
    utils,
  } as CollectionConfig<TItem, string | number> & { utils: DexieUtils }
}

export default dexieCollectionOptions
