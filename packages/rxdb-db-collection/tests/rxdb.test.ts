import { beforeEach, describe, expect, it, vi } from "vitest"
import {
    CollectionImpl,
    createCollection,
    createTransaction,
} from "@tanstack/db"
import { rxdbCollectionOptions } from "../src/rxdb"
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
import { RxCollection, RxDatabase, createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockStream = {
    subscribe: mockSubscribe,
}

type TestDocType = {
    id: string
    name: string
}

// Helper to advance timers and allow microtasks to flush
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`RxDB Integration`, () => {
    let collection: Collection<
        any,
        string | number,
        UtilsRecord,
        StandardSchemaV1<unknown, unknown>,
        any
    >;
    type RxCollections = { test: RxCollection<TestDocType> };
    let db: RxDatabase<RxCollections>;

    beforeEach(async () => {
        if (db) {
            await db.remove();
        }
        db = await createRxDatabase({
            name: 'my-rxdb',
            storage: getRxStorageMemory()
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

        const options = rxdbCollectionOptions({
            rxCollection: rxCollection
        })

        collection = createCollection(options)
    });



    it(`should initialize and fetch initial data`, async () => {
        const queryKey = [`testItems`]
        const initialItems: Array<TestDocType> = [
            { id: `1`, name: `Item 1` },
            { id: `2`, name: `Item 2` },
        ]

        const queryFn = vi.fn().mockResolvedValue(initialItems)

        // Wait for the query to complete and collection to update
        await vi.waitFor(
            () => {
                expect(queryFn).toHaveBeenCalledTimes(1)
                expect(collection.size).toBeGreaterThan(0)
            },
            {
                timeout: 1000, // Give it a reasonable timeout
                interval: 50, // Check frequently
            }
        )

        // Additional wait for internal processing if necessary
        await flushPromises()

        // Verify the collection state contains our items
        expect(collection.size).toBe(initialItems.length)
        expect(collection.get(`1`)).toEqual(initialItems[0])
        expect(collection.get(`2`)).toEqual(initialItems[1])

        // Verify the synced data
        expect(collection.syncedData.size).toBe(initialItems.length)
        expect(collection.syncedData.get(`1`)).toEqual(initialItems[0])
        expect(collection.syncedData.get(`2`)).toEqual(initialItems[1])
    })
});
