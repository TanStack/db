import {
    FilledMangoQuery,
    RxCollection,
    RxDocument,
    RxDocumentData,
    RxQuery,
    clone,
    ensureNotFalsy,
    getFromMapOrCreate,
    lastOfArray,
    prepareQuery,
    rxStorageWriteErrorToRxError
} from "rxdb/plugins/core"
import type { Subscription } from 'rxjs'

import { Store } from "@tanstack/store"
import DebugModule from "debug"
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
import { stripRxdbFields } from './helper'

const debug = DebugModule.debug(`ts/db:electric`)


/**
 * Used in tests to ensure proper cleanup
 */
export const OPEN_RXDB_SUBSCRIPTIONS = new WeakMap<RxCollection, Set<Subscription>>()


export type RxDBCollectionConfig<
    TExplicit extends object = Record<string, unknown>,
    TSchema extends StandardSchemaV1 = never
> = Omit<
    CollectionConfig<
        ResolveType<TExplicit, TSchema, any>, // ← use Row here
        string,                               // key is string
        TSchema
    >,
    'insert' | 'update' | 'delete' | 'getKey' | 'sync'
> & {
    rxCollection: RxCollection<TExplicit, unknown, unknown, unknown>
}

/**
 * Creates RxDB collection options for use with a standard Collection
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param config - Configuration options for the Electric collection
 * @returns Collection options with utilities
 */
export function rxdbCollectionOptions<
    TExplicit extends object = Record<string, unknown>,
    TSchema extends StandardSchemaV1 = never
>(
    config: RxDBCollectionConfig<TExplicit, TSchema>
) {
    type Row = ResolveType<TExplicit, TSchema, any>;
    type Key = string; // because RxDB primary keys must be strings

    const { ...restConfig } = config
    const rxCollection = config.rxCollection
    debug("wrapping RxDB collection", name)


    // "getKey"
    const primaryPath = rxCollection.schema.primaryPath
    const getKey: CollectionConfig<Row, Key>['getKey'] = (item) => {
        const key: string = (item as any)[primaryPath] as string
        return key
    }

    /**
     * "sync"
     * Notice that this describes the Sync between the local RxDB collection
     * and the in-memory tanstack-db collection.
     * It is not about sync between a client and a server!
     */
    type SyncParams = Parameters<SyncConfig<Row, Key>['sync']>[0]
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
                let cursor: RxDocumentData<TExplicit> | undefined = undefined
                const syncBatchSize = 1000 // make this configureable
                begin()

                while (!ready) {
                    let query: FilledMangoQuery<TExplicit>
                    if (cursor) {
                        query = {
                            selector: {
                                $or: [
                                    { '_meta.lwt': { $gt: (cursor._meta.lwt as number) } },
                                    {
                                        '_meta.lwt': cursor._meta.lwt,
                                        [primaryPath]: {
                                            $gt: cursor[primaryPath]
                                        },
                                    }
                                ]
                            } as any,
                            sort: [
                                { '_meta.lwt': 'asc' },
                                { [primaryPath]: 'asc' } as any
                            ],
                            limit: syncBatchSize,
                            skip: 0
                        }
                    } else {
                        query = {
                            selector: {},
                            sort: [
                                { '_meta.lwt': 'asc' },
                                { [primaryPath]: 'asc' } as any
                            ],
                            limit: syncBatchSize,
                            skip: 0
                        }
                    }

                    /**
                     * Instead of doing a RxCollection.query(),
                     * we directly query the storage engine of the RxCollection so we do not use the
                     * RxCollection document cache because it likely wont be used anyway
                     * since most queries will run directly on the tanstack-db side.
                     */
                    const preparedQuery = prepareQuery<TExplicit>(
                        rxCollection.storageInstance.schema,
                        query
                    );
                    const result = await rxCollection.storageInstance.query(preparedQuery)
                    const docs = result.documents

                    cursor = lastOfArray(docs)
                    if (docs.length === 0) {
                        ready = true
                        break;
                    }

                    docs.forEach(d => {
                        write({
                            type: 'insert',
                            value: stripRxdbFields(clone(d)) as any
                        })
                    })

                }
                commit()
            }

            type WriteMessage = Parameters<typeof write>[0]
            const buffer: WriteMessage[] = []
            const queue = (msg: WriteMessage) => {
                if (!ready) {
                    buffer.push(msg)
                    return
                }
                begin()
                write(msg as any)
                commit()
            }

            let sub: Subscription
            async function startOngoingFetch() {
                // Subscribe early and buffer live changes during initial load and ongoing
                sub = rxCollection.$.subscribe((ev) => {
                    const cur = stripRxdbFields(clone(ev.documentData as Row))
                    switch (ev.operation) {
                        case 'INSERT':
                            if (cur) queue({ type: 'insert', value: cur })
                            break
                        case 'UPDATE':
                            if (cur) queue({ type: 'update', value: cur })
                            break
                        case 'DELETE':
                            queue({ type: 'delete', value: cur })
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
                await initialFetch();

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

    const collectionConfig: CollectionConfig<ResolveType<TExplicit, TSchema, any>> = {
        ...restConfig,
        getKey,
        sync,
        onInsert: async (params) => {
            debug("insert", params)
            const newItems = params.transaction.mutations.map(m => m.modified)
            return rxCollection.bulkUpsert(newItems as any).then(result => {
                if (result.error.length > 0) {
                    throw rxStorageWriteErrorToRxError(ensureNotFalsy(result.error[0]))
                }
                return result.success
            })
        },
        onUpdate: async (params) => {
            debug("update", params)
            const mutations = params.transaction.mutations.filter(m => m.type === 'update')

            for (const mutation of mutations) {
                const newValue = stripRxdbFields(mutation.modified)
                const id = (newValue as any)[primaryPath]
                const doc = await rxCollection.findOne(id).exec()
                if (!doc) {
                    continue
                }
                await doc.incrementalPatch(newValue as any)
            }
        },
        onDelete: async (params) => {
            debug("delete", params)
            const mutations = params.transaction.mutations.filter(m => m.type === 'delete')
            const ids = mutations.map(mutation => (mutation.original as any)[primaryPath])
            return rxCollection.bulkRemove(ids).then(result => {
                if (result.error.length > 0) {
                    throw result.error
                }
                return result.success
            })
        }
    }
    return collectionConfig;
}
