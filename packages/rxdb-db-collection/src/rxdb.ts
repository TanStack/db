import { RxCollection, RxDocument, RxQuery, getFromMapOrCreate, lastOfArray } from "rxdb/plugins/core"


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
import { REPLICATION_STATE_BY_COLLECTION } from 'rxdb/plugins/replication'

const debug = DebugModule.debug(`ts/db:electric`)


export type RxDBCollectionConfig<
    TExplicit extends object = object,
    TSchema extends StandardSchemaV1 = never,
    /**
     * By definition, RxDB primary keys
     * must be a string
     */
    TKey extends string = string,
> = Omit<
    CollectionConfig<TExplicit, TKey, TSchema>,
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
    TSchema extends StandardSchemaV1 = never,
    TKey extends string = string
>(
    config: RxDBCollectionConfig<TExplicit, TSchema, TKey>
) {
    const { ...restConfig } = config
    const rxCollection = config.rxCollection
    debug("wrapping RxDB collection", name)


    // "getKey"
    const primaryPath = rxCollection.schema.primaryPath
    const getKey: CollectionConfig<ResolveType<TExplicit, any, any>>[`getKey`] = (item) => {
        const key: string = (item as any)[primaryPath]
        return key
    }

    /**
     * "sync"
     * Notice that this describes the Sync between the local RxDB collection
     * and the in-memory tanstack-db collection.
     * It is not about sync between a client and a server!
     */
    type SyncParams = Parameters<SyncConfig<TExplicit, TKey>[`sync`]>[0]
    const sync = {
        sync: (params: SyncParams) => {
            const { begin, write, commit, markReady } = params

            async function initialFetch() {
                /**
                 * RxDB stores a last-write-time
                 * which can be used to "sort" document writes,
                 * so for initial sync we iterate over that.
                 */
                let cursor: RxDocument<TExplicit> | undefined = undefined
                const syncBatchSize = 1000 // make this configureable
                let done = false
                begin()

                while (!done) {
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
                    cursor = lastOfArray(docs)
                    if(docs.length === 0){
                        done = true
                        break;
                    }

                    docs.forEach(d => {
                        write({
                            type: 'insert',
                            value: d.toMutableJSON()
                        })
                    })

                }

                commit()
            }


            async function start(){
                await initialFetch();

                markReady()
            }


            start()
        },
        // Expose the getSyncMetadata function
        getSyncMetadata: undefined,
    }

    const collectionConfig: CollectionConfig<ResolveType<TExplicit, TSchema, any>> = {
        ...restConfig,
        getKey,
        sync,
        onInsert: async (params: InsertMutationFnParams<TExplicit>) => {
            debug("insert", params)
            return rxCollection.insert(params.value)
        },
        update: async (params: UpdateMutationFnParams<TExplicit>) => {
            debug("update", params.id, params.value)
            const doc = await rxCollection.findOne(params.id).exec()
            if (doc) {
                await doc.patch(params.value)
            }
        },
        delete: async (params: DeleteMutationFnParams<TExplicit>) => {
            debug("delete", params.id)
            const doc = await rxCollection.findOne(params.id).exec()
            if (doc) {
                await doc.remove()
            }
        },
        // Optional: hook RxDB’s observable into TanStack/DB reactivity
        utils: {
            subscribe(listener) {
                const sub = rxCollection.$.subscribe(ev => {
                    listener({ op: ev.operation, doc: ev.documentData })
                })
                return () => sub.unsubscribe()
            },
        },
    }
    return collectionConfig;
}
