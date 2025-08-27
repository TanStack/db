import {
    RxCollection,
    RxDocument,
    RxQuery,
    getFromMapOrCreate,
    lastOfArray
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

const debug = DebugModule.debug(`ts/db:electric`)


export type RxDBCollectionConfig<
    TExplicit extends object = object,
    TSchema extends StandardSchemaV1 = never
> = Omit<
    CollectionConfig<
        TExplicit,
        string, // because RxDB primary keys must be strings
        TSchema
    >,
    "insert" | "update" | "delete" | "getKey" | "sync"
> & {
    rxCollection: RxCollection<TExplicit, unknown, unknown, unknown>
};

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
    TExplicit extends object = object,
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
        const key: string = (item as any)[primaryPath]
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
            console.log('SYCN START!!!')
            const { begin, write, commit, markReady } = params

            let ready = false
            async function initialFetch() {
                console.log('initialFetch() START');
                /**
                 * RxDB stores a last-write-time
                 * which can be used to "sort" document writes,
                 * so for initial sync we iterate over that.
                 */
                let cursor: RxDocument<TExplicit> | undefined = undefined
                const syncBatchSize = 1000 // make this configureable
                begin()

                while (!ready) {
                    console.log('initialFetch() loooooop');
                    let query: RxQuery<TExplicit, RxDocument<TExplicit>[], unknown, unknown>
                    if (cursor) {
                        query = rxCollection.find({
                            selector: {
                                $or: [
                                    { '_meta.lwt': { $gt: cursor._data._meta.lwt } },
                                    {
                                        '_meta.lwt': cursor._data._meta.lwt,
                                        [primaryPath]: {
                                            $gt: cursor.primary
                                        },
                                    }
                                ]
                            },
                            sort: [
                                { '_meta.lwt': 'asc' },
                                { [primaryPath]: 'asc' }
                            ],
                            limit: syncBatchSize
                        })
                    } else {
                        query = rxCollection.find({
                            selector: {},
                            sort: [
                                { '_meta.lwt': 'asc' },
                                { [primaryPath]: 'asc' }
                            ],
                            limit: syncBatchSize
                        })
                    }

                    const docs = await query.exec();
                    console.dir(docs.map(d => d.toJSON()))
                    cursor = lastOfArray(docs)
                    if (docs.length === 0) {
                        ready = true
                        break;
                    }

                    docs.forEach(d => {
                        write({
                            type: 'insert',
                            value: d.toMutableJSON()
                        })
                    })

                }
                console.log('initialFetch() DONE');

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
                    const cur = ev.documentData as Row
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

            return () => sub.unsubscribe()
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
            return rxCollection.insert(params.value)
        },
        onUpdate: async (params) => {
            debug("update", params.id, params.value)
            const doc = await rxCollection.findOne(params.id).exec()
            if (doc) {
                await doc.patch(params.value)
            }
        },
        onDelete: async (params) => {
            debug("delete", params.id)
            const doc = await rxCollection.findOne(params.id).exec()
            if (doc) {
                await doc.remove()
            }
        }
    }
    return collectionConfig;
}
