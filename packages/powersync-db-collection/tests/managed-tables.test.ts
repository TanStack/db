import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import {
  and,
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from '@tanstack/db'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'
import type { CommonPowerSyncDatabase } from '@powersync/node'

// The same table shape declared once as a managed view and once as a managed
// table, to test reopening a database across the SDK's storage migration.
const VIEW_STORAGE_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
    author: column.text,
    created_at: column.text,
  }),
})

const MANAGED_SCHEMA = new Schema({
  documents: new Table(
    {
      name: column.text,
      author: column.text,
      created_at: column.text,
    },
    {
      direct: true,
    },
  ),
  products: new Table(
    {
      name: column.text,
      price: column.integer,
      category: column.text,
    },
    {
      direct: true,
    },
  ),
})

const MIXED_SCHEMA = new Schema({
  documents: new Table(
    {
      name: column.text,
    },
    {
      direct: true,
    },
  ),
  // The same schema also holds a JSON-backed view.
  users: new Table({
    name: column.text,
  }),
})

const MANAGED_METADATA_SCHEMA = new Schema({
  documents: new Table(
    {
      name: column.text,
    },
    {
      direct: true,
      trackMetadata: true,
    },
  ),
})

const describePowerSync = TEST_DATABASE_IMPLEMENTATION
  ? describe
  : describe.skip

describePowerSync(`Managed Tables (direct)`, () => {
  async function createDatabase(schema: Schema) {
    const db = new PowerSyncDatabase({
      database: {
        dbFilename: `test-managed-${randomUUID()}.sqlite`,
        dbLocation: tmpdir(),
        implementation: TEST_DATABASE_IMPLEMENTATION,
      },
      schema,
    })
    onTestFinished(async () => {
      await db.disconnectAndClear()
      await db.close()
    })
    // Initial clear in case a test might have failed
    await db.disconnectAndClear()
    return db
  }

  async function createTestData(db: CommonPowerSyncDatabase) {
    await db.execute(`
        INSERT into documents (id, name, author)
        VALUES 
            (uuid(), 'one', 'a'),
            (uuid(), 'two', 'b'),
            (uuid(), 'three', 'c')
        `)
  }

  const sortedNames = (rows: Array<{ name?: string | null }>) =>
    rows.map((row) => row.name).sort()

  /**
   * TEMP tracking resources live on the write connection, so they are read
   * under the write lock. Returns whether the tracking table still exists and
   * which diff rows and triggers remain.
   */
  async function readTrackingState(
    db: CommonPowerSyncDatabase,
    trackedTableName: string,
  ) {
    return await db.writeLock(async (tx) => {
      const triggers = await tx.getAll<{ name: string }>(
        `SELECT name FROM sqlite_temp_master WHERE type = 'trigger' AND name LIKE ?`,
        [`%${trackedTableName}%`],
      )
      const table = await tx.getOptional<{ count: number }>(
        `SELECT COUNT(*) as count FROM sqlite_temp_master WHERE type = 'table' AND name = ?`,
        [trackedTableName],
      )
      const tableExists = table != null && table.count > 0
      const remaining = tableExists
        ? await tx.getAll(`SELECT * FROM ${trackedTableName}`)
        : []
      return {
        triggers: triggers.map((t) => t.name),
        tableExists,
        remaining,
      }
    })
  }

  describe(`sync`, () => {
    it(`should initialize and fetch initial data from real columns`, async () => {
      const db = await createDatabase(MANAGED_SCHEMA)
      await createTestData(db)
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: MANAGED_SCHEMA.props.documents,
        }),
      )
      onTestFinished(() => collection.cleanup({ dependents: true }))

      await collection.stateWhenReady()

      // Verify the collection state contains our items
      expect(collection.size).toBe(3)
      // Sort by name since keys are random UUIDs
      expect(sortedNames(collection.toArray)).deep.equals([
        `one`,
        `three`,
        `two`,
      ])
      // The rows were read from the real columns, not a JSON data column
      const withAuthors = collection.toArray
        .map((entry) => ({ name: entry.name!, author: entry.author! }))
        .sort((a, b) => a.name.localeCompare(b.name))
      expect(withAuthors.map((entry) => entry.author)).toEqual([`a`, `c`, `b`])
    })

    it(`should update when data syncs`, async () => {
      const db = await createDatabase(MANAGED_SCHEMA)
      await createTestData(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: MANAGED_SCHEMA.props.documents,
        }),
      )
      onTestFinished(() => collection.cleanup({ dependents: true }))

      await collection.stateWhenReady()

      // Verify the collection state contains our items
      expect(collection.size).toBe(3)

      // Make an insert, simulates a sync from another client
      await db.execute(`
        INSERT into documents (id, name, author)
        VALUES 
            (uuid(), 'four', 'd')
        `)

      // The collection should update
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(4)
          expect(sortedNames(collection.toArray)).deep.equals([
            `four`,
            `one`,
            `three`,
            `two`,
          ])
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
          expect(sortedNames(collection.toArray)).deep.equals([
            `four`,
            `one`,
            `three`,
          ])
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
          expect(sortedNames(collection.toArray)).deep.equals([
            `four`,
            `three`,
            `updated`,
          ])
        },
        { timeout: 1000 },
      )
    })

    it(`should propagate collection mutations to PowerSync without double writing`, async () => {
      const db = await createDatabase(MANAGED_SCHEMA)
      await createTestData(db)

      const options = powerSyncCollectionOptions({
        database: db,
        table: MANAGED_SCHEMA.props.documents,
      })
      const collection = createCollection(options)
      onTestFinished(() => collection.cleanup({ dependents: true }))
      await collection.stateWhenReady()

      expect(collection.size).toBe(3)
      const { trackedTableName } = options.utils.getMeta()

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

      await tx.when(`settled`)
      // The item should now be present in PowerSync
      const documents = await db.getAll<{ id: string; name: string }>(
        `SELECT id, name FROM documents`,
      )
      expect(documents.find((doc) => doc.id === id)!.name).toBe(`new`)
      // The optimistic mutation was observed exactly once through the
      // tracking triggers: the diff records were flushed, not re-applied.
      const trackingState = await readTrackingState(db, trackedTableName)
      expect(trackingState.remaining).toEqual([])

      // Now do an update
      await collection
        .update(id, (d) => (d.name = `updatedNew`))
        .when(`settled`)

      const updatedDoc = collection.get(id)
      expect(updatedDoc).toBeDefined()
      expect(updatedDoc!.name).toBe(`updatedNew`)
      // Only the updated field should be updated
      expect(updatedDoc!.author).toBe(`somebody`)

      await collection.delete(id).when(`settled`)

      // There should be a crud entries for this
      const crudEntries = await db.getAll<{ op: string }>(
        `SELECT data ->> 'op' AS op FROM ps_crud ORDER BY id`,
      )

      // The three seeded rows arrive as PUTs (via the SDK's managed table
      // write triggers), followed by our PUT, PATCH and DELETE.
      expect(crudEntries.length).toBe(6)
      expect(crudEntries.map((e) => e.op)).toEqual([
        `PUT`,
        `PUT`,
        `PUT`,
        `PUT`,
        `PATCH`,
        `DELETE`,
      ])
      // The deleted row is gone from SQLite and the collection
      const afterDelete = await db.getAll<{ id: string }>(
        `SELECT id FROM documents`,
      )
      expect(afterDelete.find((doc) => doc.id === id)).toBeUndefined()
      expect(collection.get(id)).toBeUndefined()
      expect(collection.size).toBe(3)
    })

    it(`should handle on-demand subsets with real column when clauses`, async () => {
      const db = await createDatabase(MANAGED_SCHEMA)
      await db.execute(`
        INSERT INTO products (id, name, price, category)
        VALUES
          (uuid(), 'Cheap A', 25, 'electronics'),
          (uuid(), 'Expensive B', 150, 'electronics'),
          (uuid(), 'Cheap C', 30, 'clothing'),
          (uuid(), 'Expensive D', 200, 'clothing')
      `)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: MANAGED_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup({ dependents: true }))

      const live = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) =>
              and(gt(product.price, 100), eq(product.category, `electronics`)),
            ),
      })

      try {
        await live.preload()
        await vi.waitFor(
          () => {
            expect(collection.size).toBe(1)
            expect(collection.toArray[0]!.name).toBe(`Expensive B`)
          },
          { timeout: 1000 },
        )

        // A row change outside the tracked when clauses must not be tracked
        await db.execute(
          `UPDATE products SET price = 300 WHERE name = 'Cheap C'`,
        )
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(collection.size).toBe(1)

        // A row change inside the tracked when clauses must arrive
        await db.execute(
          `UPDATE products SET price = 400 WHERE name = 'Expensive B'`,
        )
        await vi.waitFor(
          () => {
            const row = collection.toArray.find(
              (candidate) => candidate.name === `Expensive B`,
            )
            expect(row!.price).toBe(400)
          },
          { timeout: 1000 },
        )
      } finally {
        await live.cleanup()
      }

      // Dropping the demand evicts the rows and stops tracking
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(0)
        },
        { timeout: 1000 },
      )
    })
  })

  describe(`Lifecycle`, () => {
    it(`should cleanup tracking triggers and tables`, async () => {
      const db = await createDatabase(MANAGED_SCHEMA)
      const collectionOptions = powerSyncCollectionOptions({
        database: db,
        table: MANAGED_SCHEMA.props.documents,
      })

      const meta = collectionOptions.utils.getMeta()

      const collection = createCollection(collectionOptions)
      await collection.stateWhenReady()
      const active = await readTrackingState(db, meta.trackedTableName)
      // Three diff triggers (insert/update/delete) plus the tracking table
      expect(active.triggers.length).toBe(3)
      expect(active.tableExists).toBe(true)

      await collection.cleanup({ dependents: true })

      // It seems that even though `cleanup` is async, the sync disposer cannot be async
      // We wait for the table to be deleted
      await vi.waitFor(
        async () => {
          const disposed = await readTrackingState(db, meta.trackedTableName)
          expect(disposed.triggers.length).toBe(0)
          expect(disposed.tableExists).toBe(false)
        },
        { timeout: 1000 },
      )

      // Nothing leaked into persisted storage either
      const persisted = await db.getAll<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE name LIKE '%_tracking_%' OR name LIKE '__ps_temp_trigger_%'`,
      )
      expect(persisted).toEqual([])
    })

    it(`should reject managed tables that track metadata`, async () => {
      const db = await createDatabase(MANAGED_METADATA_SCHEMA)
      expect(() =>
        powerSyncCollectionOptions({
          database: db,
          table: MANAGED_METADATA_SCHEMA.props.documents,
        }),
      ).toThrowError(/trackMetadata/)
    })
  })

  describe(`Mixed storage`, () => {
    it(`should track managed tables and views in the same database`, async () => {
      const db = await createDatabase(MIXED_SCHEMA)

      // Seeds run before the collections are created: the eager baseline
      // load must observe them, as anything committed after it but before
      // trigger creation can be missed.
      await db.execute(
        `INSERT INTO documents (id, name) VALUES (uuid(), 'doc-one')`,
      )
      await db.execute(
        `INSERT INTO users (id, name) VALUES (uuid(), 'user-one')`,
      )

      const documentsCollection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: MIXED_SCHEMA.props.documents,
        }),
      )
      onTestFinished(() => documentsCollection.cleanup({ dependents: true }))

      const usersCollection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: MIXED_SCHEMA.props.users,
        }),
      )
      onTestFinished(() => usersCollection.cleanup({ dependents: true }))

      await documentsCollection.stateWhenReady()
      await usersCollection.stateWhenReady()

      expect(documentsCollection.size).toBe(1)
      expect(usersCollection.size).toBe(1)

      // Both tracking paths observe new writes independently
      await documentsCollection
        .insert({ id: `doc-two`, name: `doc-two` })
        .when(`settled`)
      await usersCollection
        .insert({ id: `user-two`, name: `user-two` })
        .when(`settled`)

      expect(documentsCollection.size).toBe(2)
      expect(usersCollection.size).toBe(2)

      const documentNames = await db.getAll<{ name: string }>(
        `SELECT name FROM documents ORDER BY name`,
      )
      const userNames = await db.getAll<{ name: string }>(
        `SELECT name FROM users ORDER BY name`,
      )
      expect(documentNames.map((row) => row.name)).toEqual([
        `doc-one`,
        `doc-two`,
      ])
      expect(userNames.map((row) => row.name)).toEqual([`user-one`, `user-two`])
    })

    it(`should load migrated rows when reopening a view-stored database as managed tables`, async () => {
      const dbFilename = `test-migration-${randomUUID()}.sqlite`

      // First run: the table is stored as a managed view.
      const originalDb = new PowerSyncDatabase({
        database: {
          dbFilename,
          dbLocation: tmpdir(),
          implementation: TEST_DATABASE_IMPLEMENTATION,
        },
        schema: VIEW_STORAGE_SCHEMA,
      })
      onTestFinished(async () => {
        await originalDb.disconnectAndClear().catch(() => undefined)
        await originalDb.close().catch(() => undefined)
      })
      await originalDb.disconnectAndClear()
      await originalDb.execute(`
        INSERT into documents (id, name, author)
        VALUES
          ('migrated-1', 'first', 'a'),
          ('migrated-2', 'second', 'b')
      `)
      await originalDb.close()

      // Second run: the schema marks the table as managed, so the SDK
      // migrates the storage from the JSON view to a real table.
      const migratedDb = new PowerSyncDatabase({
        database: {
          dbFilename,
          dbLocation: tmpdir(),
          implementation: TEST_DATABASE_IMPLEMENTATION,
        },
        schema: MANAGED_SCHEMA,
      })
      onTestFinished(async () => {
        await migratedDb.disconnectAndClear().catch(() => undefined)
        await migratedDb.close().catch(() => undefined)
      })
      // A clear would wipe the migrated rows, so the database is only awaited
      // for readiness here.
      await migratedDb.waitForReady()

      const storageType = await migratedDb.get<{ type: string }>(
        `SELECT type FROM sqlite_master WHERE name = 'documents'`,
      )
      expect(storageType.type).toBe(`table`)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: migratedDb,
          table: MANAGED_SCHEMA.props.documents,
        }),
      )
      onTestFinished(() => collection.cleanup({ dependents: true }))
      await collection.stateWhenReady()

      // The adapter's triggers were recreated against the now-real table and
      // the eager load read the migrated rows.
      expect(collection.size).toBe(2)
      const rows = [...collection.toArray].sort((a, b) =>
        a.id.localeCompare(b.id),
      )
      expect(rows.map((row) => row.id)).toEqual([`migrated-1`, `migrated-2`])
      expect(rows.map((row) => row.author)).toEqual([`a`, `b`])

      // The triggers track the migrated table
      await migratedDb.execute(
        `INSERT INTO documents (id, name, author) VALUES ('migrated-3', 'third', 'c')`,
      )
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(3)
        },
        { timeout: 1000 },
      )
    })
  })
})
