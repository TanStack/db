import { beforeEach, describe, expect, it, vi } from "vitest"
import {
    CollectionImpl,
    createCollection,
    createTransaction,
} from "@tanstack/db"
import { RxDBCollectionConfig, rxdbCollectionOptions } from "../src/rxdb"
import type {
    Collection,
    InsertMutationFnParams,
    MutationFnParams,
    PendingMutation,
    Transaction,
    TransactionWithMutations,
    UtilsRecord,
} from "@tanstack/db"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import { RxCollection, addRxPlugin, createRxDatabase } from 'rxdb/plugins/core'
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv'

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockStream = {
    subscribe: mockSubscribe,
}

type TestDocType = {
    id: string
    name: string
}
type RxCollections = { test: RxCollection<TestDocType> };

// Helper to advance timers and allow microtasks to flush
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`RxDB Integration`, () => {
    addRxPlugin(RxDBDevModePlugin)
    let collection: Collection<
        any,
        string | number,
        UtilsRecord,
        StandardSchemaV1<unknown, unknown>,
        any
    >;

    let dbNameId = 0;
    async function createTestState(
        initialDocs: TestDocType[] = [],
        config: Partial<RxDBCollectionConfig<TestDocType, any>> = {}
    ) {
        const db = await createRxDatabase<RxCollections, unknown, unknown, unknown>({
            name: 'my-rxdb-' + (dbNameId++),
            storage: wrappedValidateAjvStorage({
                storage: getRxStorageMemory()
            })
        });
        const collections = await db.addCollections<RxCollections>({
            test: {
                schema: {
                    version: 0,
                    type: 'object',
                    primaryKey: 'id',
                    properties: {
                        id: {
                            type: 'string',
                            maxLength: 100
                        },
                        name: {
                            type: 'string'
                        }
                    }
                }
            }
        });
        const rxCollection: RxCollection<TestDocType> = collections.test;
        if (initialDocs.length > 0) {
            const insertResult = await rxCollection.bulkInsert(initialDocs)
            expect(insertResult.error.length).toBe(0)
        }

        const options = rxdbCollectionOptions({
            rxCollection: rxCollection,
            startSync: true,
            ...config
        })

        collection = createCollection(options)
        await collection.stateWhenReady()

        return {
            collection,
            rxCollection,
            db
        }
    }


    it(`should initialize and fetch initial data`, async () => {
        const initialItems: Array<TestDocType> = [
            { id: `1`, name: `Item 1` },
            { id: `2`, name: `Item 2` },
        ]

        const { collection, db } = await createTestState(initialItems);

        // Verify the collection state contains our items
        expect(collection.size).toBe(initialItems.length)
        expect(collection.get(`1`)).toEqual(initialItems[0])
        expect(collection.get(`2`)).toEqual(initialItems[1])

        // Verify the synced data
        expect(collection.syncedData.size).toBe(initialItems.length)
        expect(collection.syncedData.get(`1`)).toEqual(initialItems[0])
        expect(collection.syncedData.get(`2`)).toEqual(initialItems[1])

        await db.remove()
    })

    it(`should update the collection when RxDB changes data`, async () => {
        const initialItems: Array<TestDocType> = [
            { id: `1`, name: `Item 1` },
            { id: `2`, name: `Item 2` },
        ]

        const { collection, rxCollection, db } = await createTestState(initialItems);


        // inserts
        const doc = await rxCollection.insert({ id: '3', name: 'inserted' })
        expect(collection.get(`3`).name).toEqual('inserted')

        // updates
        await doc.getLatest().patch({ name: 'updated' })
        expect(collection.get(`3`).name).toEqual('updated')


        // deletes
        await doc.getLatest().remove()
        console.log(':::::::::::::::::::::::::::::::::1')
        console.dir(collection.get(`3`))
        expect(collection.get(`3`)).toEqual(undefined)


        await db.remove()
    })
});
