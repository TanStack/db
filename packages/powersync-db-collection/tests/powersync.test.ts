import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  CrudEntry,
  PowerSyncDatabase,
  Schema,
  Table,
  column,
} from '@powersync/node'
import {
  createCollection,
  createTransaction,
  eq,
  liveQueryCollectionOptions,
} from '@tanstack/db'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'
import { PowerSyncTransactor } from '../src/PowerSyncTransactor'
import type { AbstractPowerSyncDatabase } from '@powersync/node'

const APP_SCHEMA = new Schema({
  users: new Table({
    name: column.text,
    active: column.integer, // Will be mapped to Boolean
  }),
  documents: new Table(
    {
      name: column.text,
      author: column.text,
      created_at: column.text, // Will be mapped to Date
    },
    {
      trackMetadata: true,
    },
  ),
})

describe(`PowerSync Integration`, () => {
  async function createDatabase() {
    const db = new PowerSyncDatabase({
      database: {
        dbFilename: `test-${randomUUID()}.sqlite`,
        dbLocation: tmpdir(),
        implementation: { type: `node:sqlite` },
      },
      schema: APP_SCHEMA,
    })
    onTestFinished(async () => {
      await db.disconnectAndClear()
      await db.close()
    })
    // Initial clear in case a test might have failed
    await db.disconnectAndClear()
    return db
  }

  function createDocumentsCollection(db: PowerSyncDatabase) {
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        // We get typing and a default validator from this
        table: APP_SCHEMA.props.documents,
      }),
    )
    onTestFinished(() => collection.cleanup())
    return collection
  }

  async function createTestData(db: AbstractPowerSyncDatabase) {
    await db.execute(`
        INSERT into documents (id, name)
        VALUES 
            (uuid(), 'one'),
            (uuid(), 'two'),
            (uuid(), 'three')
        `)
  }

  describe(`sync`, () => {
    it(`should initialize and fetch initial data`, async () => {
      const db = await createDatabase()
      await createTestData(db)
      const collection = createDocumentsCollection(db)

      await collection.stateWhenReady()

      // Verify the collection state contains our items
      expect(collection.size).toBe(3)
      // Sort by name since keys are random UUIDs
      expect(collection.toArray.map((entry) => entry.name).sort()).deep.equals([
        `one`,
        `three`,
        `two`,
      ])
    })

    it(`should update when data syncs`, async () => {
      const db = await createDatabase()
      await createTestData(db)

      const collection = createDocumentsCollection(db)

      await collection.stateWhenReady()

      // Verify the collection state contains our items
      expect(collection.size).toBe(3)

      // Make an update, simulates a sync from another client
      await db.execute(`
        INSERT into documents (id, name)
        VALUES 
            (uuid(), 'four')
        `)

      // The collection should update
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(4)
          // Sort by name since keys are random UUIDs
          expect(
            collection.toArray.map((entry) => entry.name).sort(),
          ).deep.equals([`four`, `one`, `three`, `two`])
        },
        { timeout: 1000 },
      )

      await db.execute(`
        DELETE from documents
        WHERE name = 'two'
        `)

      // The collection should update
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(3)
          // Sort by name since keys are random UUIDs
          expect(
            collection.toArray.map((entry) => entry.name).sort(),
          ).deep.equals([`four`, `one`, `three`])
        },
        { timeout: 1000 },
      )

      await db.execute(`
        UPDATE documents
        SET name = 'updated'
        WHERE name = 'one'
        `)

      // The collection should update
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(3)
          // Sort by name since keys are random UUIDs
          expect(
            collection.toArray.map((entry) => entry.name).sort(),
          ).deep.equals([`four`, `three`, `updated`])
        },
        { timeout: 1000 },
      )
    })

    it(`should propagate collection mutations to PowerSync`, async () => {
      const db = await createDatabase()
      await createTestData(db)

      const collection = createDocumentsCollection(db)
      await collection.stateWhenReady()

      // Verify the collection state contains our items
      expect(collection.size).toBe(3)

      const id = randomUUID()
      const tx = collection.insert({
        id,
        name: `new`,
        author: `somebody`,
      })

      // The insert should optimistically update the collection
      const newDoc = collection.get(id)
      expect(newDoc).toBeDefined()
      expect(newDoc!.name).toBe(`new`)
      expect(newDoc!.author).toBe(`somebody`)

      await tx.isPersisted.promise
      // The item should now be present in PowerSync
      // We should also have patched it back in to Tanstack DB (removing the optimistic state)

      // Now do an update
      await collection.update(id, (d) => (d.name = `updatedNew`)).isPersisted
        .promise

      const updatedDoc = collection.get(id)
      expect(updatedDoc).toBeDefined()
      expect(updatedDoc!.name).toBe(`updatedNew`)
      // Only the updated field should be updated
      expect(updatedDoc!.author).toBe(`somebody`)

      await collection.delete(id).isPersisted.promise

      // There should be a crud entries for this
      const _crudEntries = await db.getAll(`
        SELECT * FROM ps_crud ORDER BY id`)

      const crudEntries = _crudEntries.map((r) =>
        CrudEntry.fromRow(r as Parameters<typeof CrudEntry.fromRow>[0]),
      )

      expect(crudEntries.length).toBe(6)
      // We can only group transactions for similar operations
      expect(crudEntries.map((e) => e.op)).toEqual([
        `PUT`,
        `PUT`,
        `PUT`,
        `PUT`,
        `PATCH`,
        `DELETE`,
      ])
    })

    it(`should handle transactions`, async () => {
      const db = await createDatabase()
      await createTestData(db)

      const collection = createDocumentsCollection(db)
      await collection.stateWhenReady()

      expect(collection.size).toBe(3)

      const addTx = createTransaction({
        autoCommit: false,
        mutationFn: async ({ transaction }) => {
          await new PowerSyncTransactor({ database: db }).applyTransaction(
            transaction,
          )
        },
      })

      addTx.mutate(() => {
        for (let i = 0; i < 5; i++) {
          collection.insert({ id: randomUUID(), name: `tx-${i}` })
        }
      })

      await addTx.commit()
      await addTx.isPersisted.promise

      expect(collection.size).toBe(8)

      // fetch the ps_crud items
      // There should be a crud entries for this
      const _crudEntries = await db.getAll(`
        SELECT * FROM ps_crud ORDER BY id`)
      const crudEntries = _crudEntries.map((r) =>
        CrudEntry.fromRow(r as Parameters<typeof CrudEntry.fromRow>[0]),
      )

      const lastTransactionId =
        crudEntries[crudEntries.length - 1]?.transactionId
      /**
       * The last items, created in the same transaction, should be in the same
       * PowerSync transaction.
       */
      expect(
        crudEntries
          .reverse()
          .slice(0, 5)
          .every((crudEntry) => crudEntry.transactionId == lastTransactionId),
      ).true
    })

    it(`should handle transactions with multiple collections`, async () => {
      const db = await createDatabase()
      await createTestData(db)

      const documentsCollection = createDocumentsCollection(db)

      const usersCollection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.users,
        }),
      )
      onTestFinished(() => usersCollection.cleanup())

      await documentsCollection.stateWhenReady()
      await usersCollection.stateWhenReady()

      expect(documentsCollection.size).toBe(3)
      expect(usersCollection.size).toBe(0)

      const addTx = createTransaction({
        autoCommit: false,
        mutationFn: async ({ transaction }) => {
          await new PowerSyncTransactor({ database: db }).applyTransaction(
            transaction,
          )
        },
      })

      addTx.mutate(() => {
        for (let i = 0; i < 5; i++) {
          documentsCollection.insert({ id: randomUUID(), name: `tx-${i}` })
          usersCollection.insert({ id: randomUUID(), name: `user` })
        }
      })

      await addTx.commit()
      await addTx.isPersisted.promise

      expect(documentsCollection.size).toBe(8)
      expect(usersCollection.size).toBe(5)

      // fetch the ps_crud items
      // There should be a crud entries for this
      const _crudEntries = await db.getAll(`
        SELECT * FROM ps_crud ORDER BY id`)
      const crudEntries = _crudEntries.map((r) =>
        CrudEntry.fromRow(r as Parameters<typeof CrudEntry.fromRow>[0]),
      )

      const lastTransactionId =
        crudEntries[crudEntries.length - 1]?.transactionId
      /**
       * The last items, created in the same transaction, should be in the same
       * PowerSync transaction.
       */
      expect(
        crudEntries
          .reverse()
          .slice(0, 10)
          .every((crudEntry) => crudEntry.transactionId == lastTransactionId),
      ).true
    })

    /**
     * Metadata provided by the collection operation should be persisted to the database if supported by the SQLite table.
     */
    it(`should persist collection operation metadata`, async () => {
      const db = await createDatabase()

      const collection = createDocumentsCollection(db)
      await collection.stateWhenReady()

      const metadata = {
        text: `some text`,
        number: 123,
        boolean: true,
      }
      const id = randomUUID()
      await collection.insert(
        {
          id,
          name: `new`,
          author: `somebody`,
        },
        {
          metadata,
        },
      ).isPersisted.promise

      // Now do an update
      await collection.update(
        id,
        { metadata: metadata },
        (d) => (d.name = `updatedNew`),
      ).isPersisted.promise

      await collection.delete(id, { metadata }).isPersisted.promise

      // There should be a crud entries for this
      const crudBatch = await db.getCrudBatch(100)
      expect(crudBatch).toBeDefined()
      const crudEntries = crudBatch!.crud

      // The metadata should be available in the CRUD entries for upload
      const stringifiedMetadata = JSON.stringify(metadata)
      expect(crudEntries.length).toBe(3)
      expect(crudEntries[0]!.metadata).toEqual(stringifiedMetadata)
      expect(crudEntries[1]!.metadata).toEqual(stringifiedMetadata)
      expect(crudEntries[2]!.metadata).toEqual(stringifiedMetadata)

      // Verify the item is deleted from SQLite
      const documents = await db.getAll(`
        SELECT * FROM documents`)
      expect(documents.length).toBe(0)
    })
  })

  describe(`General use`, () => {
    it(`should rollback transactions on error`, async () => {
      const db = await createDatabase()

      const options = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.documents,
      })

      // This will cause the transactor to fail when writing to SQLite
      vi.spyOn(options.utils, `getMeta`).mockImplementation(() => ({
        tableName: `fakeTable`,
        trackedTableName: `error`,
        metadataIsTracked: true,
        serializeValue: () => ({}) as any,
      }))
      // Create two collections for the same table
      const collection = createCollection(options)

      onTestFinished(() => collection.cleanup())
      const addTx = createTransaction({
        autoCommit: false,
        mutationFn: async ({ transaction }) => {
          await new PowerSyncTransactor({ database: db }).applyTransaction(
            transaction,
          )
        },
      })

      expect(collection.size).eq(0)
      await collection.stateWhenReady()

      const id = randomUUID()
      addTx.mutate(() => {
        collection.insert({
          id,
          name: `aname`,
        })
      })

      // This should be present in the optimistic state, but should be reverted when attempting to persist
      expect(collection.size).eq(1)

      try {
        await addTx.commit()
        await addTx.isPersisted.promise
        expect.fail(`Should have thrown an error`)
      } catch (error) {
        expect(error).toBeDefined()
        // The collection should be in a clean state
        expect(collection.size).toBe(0)
      }
    })

    it(`should work with live queries`, async () => {
      const db = await createDatabase()

      // Create two collections for the same table
      const collection = createDocumentsCollection(db)

      await collection.stateWhenReady()

      const liveDocuments = createCollection(
        liveQueryCollectionOptions({
          query: (q) =>
            q
              .from({ document: collection })
              .where(({ document }) => eq(document.name, `book`))
              .select(({ document }) => ({
                id: document.id,
                name: document.name,
              })),
        }),
      )

      expect(liveDocuments.size).eq(0)

      const bookNames = new Set<string>()

      liveDocuments.subscribeChanges((changes) => {
        changes
          .map((change) => change.value.name)
          .filter((name): name is string => name !== undefined)
          .forEach((change) => bookNames.add(change))
      })

      await collection.insert({
        id: randomUUID(),
        name: `notabook`,
      }).isPersisted.promise
      await collection.insert({
        id: randomUUID(),
        name: `book`,
      }).isPersisted.promise

      expect(collection.size).eq(2)
      await vi.waitFor(
        () => {
          expect(Array.from(bookNames)).deep.equals([`book`])
        },
        { timeout: 1000 },
      )
    })
  })

  describe(`Multiple Clients`, () => {
    it(`should sync updates between multiple clients`, async () => {
      const db = await createDatabase()

      // Create two collections for the same table
      const collectionA = createDocumentsCollection(db)
      await collectionA.stateWhenReady()

      const collectionB = createDocumentsCollection(db)
      await collectionB.stateWhenReady()

      await createTestData(db)

      // Both collections should have the data present after insertion
      await vi.waitFor(
        () => {
          expect(collectionA.size).eq(3)
          expect(collectionB.size).eq(3)
        },
        { timeout: 1000 },
      )
    })
  })

  describe(`Lifecycle`, () => {
    it(`should cleanup resources`, async () => {
      const db = await createDatabase()
      const collectionOptions = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.documents,
      })

      const meta = collectionOptions.utils.getMeta()

      const tableExists = async (): Promise<boolean> => {
        const result = await db.writeLock(async (tx) => {
          return tx.get<{ count: number }>(
            `
              SELECT COUNT(*) as count 
              FROM sqlite_temp_master 
              WHERE type='table' AND name = ?
            `,
            [meta.trackedTableName],
          )
        })
        return result.count > 0
      }

      const collection = createCollection(collectionOptions)
      await collection.stateWhenReady()
      expect(await tableExists()).true

      await collection.cleanup()

      // It seems that even though `cleanup` is async, the sync disposer cannot be async
      // We wait for the table to be deleted
      await vi.waitFor(
        async () => {
          expect(await tableExists()).false
        },
        { timeout: 1000 },
      )
    })
  })
})
