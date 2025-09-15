import {
  clone,
  ensureNotFalsy,
  getFromMapOrCreate,
  lastOfArray,
  prepareQuery,
  rxStorageWriteErrorToRxError,
} from "rxdb/plugins/core"
import DebugModule from "debug"
import { stripRxdbFields } from "./helper"
import type {
  FilledMangoQuery,
  RxCollection,
  RxDocumentData,
} from "rxdb/plugins/core"

import type {
  CollectionConfig,
  InferSchemaOutput,
  SyncConfig,
} from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"

const debug = DebugModule.debug(`ts/db:rxdb`)

/**
 * Used in tests to ensure proper cleanup
 */
export const OPEN_RXDB_SUBSCRIPTIONS = new WeakMap<RxCollection, Set<any>>()

/**
 * Configuration interface for RxDB collection options
 * @template T - The explicit type of items in the collection (highest priority). Use the document type of your RxCollection here.
 * @template TSchema - The schema type for validation and type inference (second priority)
 *
 * @remarks
 * Type resolution follows a priority order:
 * 1. If you provide an explicit type via generic parameter, it will be used
 * 2. If no explicit type is provided but a schema is, the schema's output type will be inferred
 *
 * You should provide EITHER an explicit type OR a schema, but not both, as they would conflict.
 * Notice that primary keys in RxDB must always be a string.
 */
export type RxDBCollectionConfig<
  T extends object = Record<string, unknown>,
  TSchema extends StandardSchemaV1 = never,
> = Omit<
  CollectionConfig<T, string, TSchema>,
  `insert` | `update` | `delete` | `getKey` | `sync`
> & {
  /**
   * The RxCollection from a RxDB Database instance.
   */
  rxCollection: RxCollection<T, unknown, unknown, unknown>

  /**
   * The maximum number of documents to read from the RxDB collection
   * in a single batch during the initial sync between RxDB and the
   * in-memory TanStack DB collection.
   *
   * @remarks
   * - Defaults to `1000` if not specified.
   * - Larger values reduce the number of round trips to the storage
   *   engine but increase memory usage per batch.
   * - Smaller values may lower memory usage and allow earlier
   *   streaming of initial results, at the cost of more query calls.
   *
   * Adjust this depending on your expected collection size and
   * performance characteristics of the chosen RxDB storage adapter.
   */
  syncBatchSize?: number
}

/**
 * Creates RxDB collection options for use with a standard Collection
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @param config - Configuration options for the RxDB collection
 * @returns Collection options with utilities
 */

// Overload for when schema is provided
export function rxdbCollectionOptions<T extends StandardSchemaV1>(
  config: RxDBCollectionConfig<InferSchemaOutput<T>, T>
): CollectionConfig<InferSchemaOutput<T>, string, T> & {
  schema: T
}

// Overload for when no schema is provided
export function rxdbCollectionOptions<T extends object>(
  config: RxDBCollectionConfig<T> & {
    schema?: never // prohibit schema
  }
): CollectionConfig<T, string> & {
  schema?: never // no schema in the result
}

export function rxdbCollectionOptions(config: RxDBCollectionConfig<any, any>) {
  type Row = Record<string, unknown>
  type Key = string // because RxDB primary keys must be strings

  const { ...restConfig } = config
  const rxCollection = config.rxCollection

  // "getKey"
  const primaryPath = rxCollection.schema.primaryPath
  function getKey(item: any): string {
    const key: string = item[primaryPath] as string
    return key
  }

  /**
   * "sync"
   * Notice that this describes the Sync between the local RxDB collection
   * and the in-memory tanstack-db collection.
   * It is not about sync between a client and a server!
   */
  type SyncParams = Parameters<SyncConfig<Row, string>[`sync`]>[0]
  const sync: SyncConfig<Row, Key> = {
    sync: (params: SyncParams) => {
      const { begin, write, commit, markReady } = params

      let ready = false
      async function initialFetch() {
        /**
         * RxDB stores a last-write-time
         * which can be used to "sort" document writes,
         * so for initial sync we iterate over that.
         */
        let cursor: RxDocumentData<Row> | undefined = undefined
        const syncBatchSize = config.syncBatchSize ? config.syncBatchSize : 1000
        begin()

        while (!ready) {
          let query: FilledMangoQuery<Row>
          if (cursor) {
            query = {
              selector: {
                $or: [
                  { "_meta.lwt": { $gt: cursor._meta.lwt } },
                  {
                    "_meta.lwt": cursor._meta.lwt,
                    [primaryPath]: {
                      $gt: getKey(cursor),
                    },
                  },
                ],
              } as any,
              sort: [{ "_meta.lwt": `asc` }, { [primaryPath]: `asc` } as any],
              limit: syncBatchSize,
              skip: 0,
            }
          } else {
            query = {
              selector: {},
              sort: [{ "_meta.lwt": `asc` }, { [primaryPath]: `asc` } as any],
              limit: syncBatchSize,
              skip: 0,
            }
          }

          /**
           * Instead of doing a RxCollection.query(),
           * we directly query the storage engine of the RxCollection so we do not use the
           * RxCollection document cache because it likely wont be used anyway
           * since most queries will run directly on the tanstack-db side.
           */
          const preparedQuery = prepareQuery<Row>(
            rxCollection.storageInstance.schema,
            query
          )
          const result = await rxCollection.storageInstance.query(preparedQuery)
          const docs = result.documents

          cursor = lastOfArray(docs)
          if (docs.length === 0) {
            ready = true
            break
          }

          docs.forEach((d) => {
            write({
              type: `insert`,
              value: stripRxdbFields(clone(d)),
            })
          })
        }
        commit()
      }

      type WriteMessage = Parameters<typeof write>[0]
      const buffer: Array<WriteMessage> = []
      const queue = (msg: WriteMessage) => {
        if (!ready) {
          buffer.push(msg)
          return
        }
        begin()
        write(msg as any)
        commit()
      }

      let sub: any
      function startOngoingFetch() {
        // Subscribe early and buffer live changes during initial load and ongoing
        sub = rxCollection.$.subscribe((ev) => {
          const cur: Row = stripRxdbFields(clone(ev.documentData as Row))
          switch (ev.operation) {
            case `INSERT`:
              queue({ type: `insert`, value: cur })
              break
            case `UPDATE`:
              queue({ type: `update`, value: cur })
              break
            case `DELETE`:
              queue({ type: `delete`, value: cur })
              break
          }
        })

        const subs = getFromMapOrCreate(
          OPEN_RXDB_SUBSCRIPTIONS,
          rxCollection,
          () => new Set()
        )
        subs.add(sub)
      }

      async function start() {
        startOngoingFetch()
        await initialFetch()

        if (buffer.length) {
          begin()
          for (const msg of buffer) write(msg as any)
          commit()
          buffer.length = 0
        }

        markReady()
      }

      start()

      return () => {
        const subs = getFromMapOrCreate(
          OPEN_RXDB_SUBSCRIPTIONS,
          rxCollection,
          () => new Set()
        )
        subs.delete(sub)
        sub.unsubscribe()
      }
    },
    // Expose the getSyncMetadata function
    getSyncMetadata: undefined,
  }

  const collectionConfig: CollectionConfig<Row, string, any> = {
    ...restConfig,
    getKey: getKey as any,
    sync,
    onInsert: async (params) => {
      debug(`insert`, params)
      const newItems = params.transaction.mutations.map((m) => m.modified)
      return rxCollection.bulkUpsert(newItems as Array<any>).then((result) => {
        if (result.error.length > 0) {
          throw rxStorageWriteErrorToRxError(ensureNotFalsy(result.error[0]))
        }
        return result.success
      })
    },
    onUpdate: async (params) => {
      debug(`update`, params)
      const mutations = params.transaction.mutations.filter(
        (m) => m.type === `update`
      )

      for (const mutation of mutations) {
        const newValue = stripRxdbFields(mutation.modified)
        const id = getKey(newValue)
        const doc = await rxCollection.findOne(id).exec()
        if (!doc) {
          continue
        }
        await doc.incrementalPatch(newValue as any)
      }
    },
    onDelete: async (params) => {
      debug(`delete`, params)
      const mutations = params.transaction.mutations.filter(
        (m) => m.type === `delete`
      )
      const ids = mutations.map((mutation: any) => getKey(mutation.original))
      return rxCollection.bulkRemove(ids).then((result) => {
        if (result.error.length > 0) {
          throw result.error
        }
        return result.success
      })
    },
  }
  return collectionConfig
}
