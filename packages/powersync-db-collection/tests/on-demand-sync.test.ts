import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import {
  and,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  eq,
  gt,
  gte,
  lt,
  or,
} from '@tanstack/db'
import pDefer from 'p-defer'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'
import type { LoadSubsetOptions } from '@tanstack/db'

const APP_SCHEMA = new Schema({
  products: new Table({
    name: column.text,
    price: column.integer,
    category: column.text,
  }),
})

describe(`On-Demand Sync Mode`, () => {
  async function createDatabase() {
    const db = new PowerSyncDatabase({
      database: {
        dbFilename: `test-on-demand-${randomUUID()}.sqlite`,
        dbLocation: tmpdir(),
        implementation: { type: `node:sqlite` },
      },
      schema: APP_SCHEMA,
    })
    onTestFinished(async () => {
      // Wait a moment for any pending cleanup operations to complete
      // before closing the database to prevent "operation on closed remote" errors
      await new Promise((resolve) => setTimeout(resolve, 100))
      await db.disconnectAndClear()
      await db.close()
    })
    await db.disconnectAndClear()
    return db
  }

  async function createTestProducts(db: PowerSyncDatabase) {
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES
        (uuid(), 'Product A', 50, 'electronics'),
        (uuid(), 'Product B', 150, 'electronics'),
        (uuid(), 'Product C', 25, 'clothing'),
        (uuid(), 'Product D', 200, 'electronics'),
        (uuid(), 'Product E', 75, 'clothing')
    `)
  }

  it(`should not load any data initially in on-demand mode`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    // Verify data exists in SQLite
    const sqliteCount = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM products`,
    )
    expect(sqliteCount.count).toBe(5)

    // Create collection with on-demand sync mode
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      }),
    )
    onTestFinished(() => collection.cleanup())

    // Wait for collection to be ready
    await collection.stateWhenReady()

    // Verify NO data was loaded into the collection
    expect(collection.size).toBe(0)
  })

  it(`should load only matching data when live query is created`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    // Create collection with on-demand sync mode
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      }),
    )
    onTestFinished(() => collection.cleanup())

    await collection.stateWhenReady()

    // Verify collection is empty initially
    expect(collection.size).toBe(0)

    // Create a live query that filters for electronics over $100
    const expensiveElectronics = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `electronics`))
          .where(({ product }) => gt(product.price, 100))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })
    onTestFinished(() => expensiveElectronics.cleanup())

    // Preload triggers the live query to request data via loadSubset
    await expensiveElectronics.preload()

    // Wait for loadSubset to complete and data to appear
    await vi.waitFor(
      () => {
        // The live query should have triggered loadSubset
        // Only electronics with price > 100 should match: Product B (150), Product D (200)
        expect(expensiveElectronics.size).toBe(2)
      },
      { timeout: 2000 },
    )

    // Verify the correct products were loaded
    const loadedProducts = expensiveElectronics.toArray
    const names = loadedProducts.map((p) => p.name).sort()
    expect(names).toEqual([`Product B`, `Product D`])

    // Verify prices are correct
    const prices = loadedProducts.map((p) => p.price).sort((a, b) => a! - b!)
    expect(prices).toEqual([150, 200])
  })

  it(`resolves subset readiness only after its rows are applied`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    let resolvePersistence!: () => void
    const persistence = new Promise<void>((resolve) => {
      resolvePersistence = resolve
    })
    const transaction = createTransaction({
      mutationFn: () => persistence,
    })
    const options = powerSyncCollectionOptions({
      database: db,
      table: APP_SCHEMA.props.products,
      syncMode: `on-demand`,
      onLoadSubset: () => {
        transaction.mutate(() =>
          collection.insert({
            id: `local`,
            name: `Local product`,
            price: 1,
            category: `local`,
          }),
        )
      },
    })
    const collection = createCollection(options)
    onTestFinished(() => collection.cleanup())
    await collection.stateWhenReady()

    const electronics = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `electronics`)),
    })
    onTestFinished(() => electronics.cleanup())
    const preload = electronics.preload()
    let settled = false
    void preload.then(() => {
      settled = true
    })

    try {
      const { trackedTableName } = options.utils.getMeta()
      await vi.waitFor(
        async () => {
          const table = await db.writeLock((context) =>
            context.get<{ count: number }>(
              `SELECT COUNT(*) as count FROM sqlite_temp_master WHERE type = 'table' AND name = ?`,
              [trackedTableName],
            ),
          )
          expect(table.count).toBe(1)
        },
        { timeout: 2_000 },
      )

      expect(transaction.state).toBe(`persisting`)
      expect(settled).toBe(false)
      expect(electronics.size).toBe(0)

      resolvePersistence()
      await transaction.isPersisted.promise
      await preload

      expect(electronics.toArray.map((product) => product.name).sort()).toEqual(
        [`Product A`, `Product B`, `Product D`],
      )
    } finally {
      resolvePersistence()
      await transaction.isPersisted.promise.catch(() => undefined)
      await Promise.allSettled([preload])
    }
  })

  it(`should reactively update live query when new matching data is inserted into SQLite`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    // Create collection with on-demand sync mode
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      }),
    )
    onTestFinished(() => collection.cleanup())

    await collection.stateWhenReady()

    // Create a live query that filters for electronics over $100
    const expensiveElectronics = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `electronics`))
          .where(({ product }) => gt(product.price, 100))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })

    onTestFinished(() => expensiveElectronics.cleanup())

    // Preload triggers the live query to request data via loadSubset
    await expensiveElectronics.preload()

    // Wait for initial data to load
    await vi.waitFor(
      () => {
        expect(expensiveElectronics.size).toBe(2)
      },
      { timeout: 2000 },
    )

    // Verify initial products
    let names = expensiveElectronics.toArray.map((p) => p.name).sort()
    expect(names).toEqual([`Product B`, `Product D`])

    // Now insert a new matching product directly into SQLite
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'Product F', 300, 'electronics')
    `)

    // Wait for the diff trigger to propagate the change to the live query
    await vi.waitFor(
      () => {
        // Should now have 3 products: B, D, and F
        expect(expensiveElectronics.size).toBe(3)
      },
      { timeout: 2000 },
    )

    // Verify all products including the new one
    names = expensiveElectronics.toArray.map((p) => p.name).sort()
    expect(names).toEqual([`Product B`, `Product D`, `Product F`])

    // Verify the new product's price
    const productF = expensiveElectronics.toArray.find(
      (p) => p.name === `Product F`,
    )
    expect(productF?.price).toBe(300)
  })

  it(`should not include non-matching data inserted into SQLite`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    // Create collection with on-demand sync mode
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      }),
    )
    onTestFinished(() => collection.cleanup())

    await collection.stateWhenReady()

    // Create a live query that filters for electronics over $100
    const expensiveElectronics = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `electronics`))
          .where(({ product }) => gt(product.price, 100))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })
    onTestFinished(() => expensiveElectronics.cleanup())

    // Preload triggers the live query to request data via loadSubset
    await expensiveElectronics.preload()

    // Wait for initial data to load
    await vi.waitFor(
      () => {
        expect(expensiveElectronics.size).toBe(2)
      },
      { timeout: 2000 },
    )

    // Verify initial products
    const initialNames = expensiveElectronics.toArray.map((p) => p.name).sort()
    expect(initialNames).toEqual([`Product B`, `Product D`])

    // Insert a non-matching product: electronics but too cheap
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'Cheap Electronics', 50, 'electronics')
    `)

    // Insert another non-matching product: expensive but wrong category
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'Expensive Clothing', 500, 'clothing')
    `)

    // Wait a bit to allow any potential (incorrect) updates to propagate
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Verify the live query still has only the original 2 products
    expect(expensiveElectronics.size).toBe(2)

    // Verify the names haven't changed
    const finalNames = expensiveElectronics.toArray.map((p) => p.name).sort()
    expect(finalNames).toEqual([`Product B`, `Product D`])

    // Verify the base collection only contains items matching active predicates
    // Non-matching diff trigger items are filtered out in on-demand mode
    expect(collection.size).toBe(2) // Only the 2 matching items from loadSubset
  })

  it(`should handle multiple live queries without losing predicate coverage`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    // Create collection with on-demand sync mode
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      }),
    )
    onTestFinished(() => collection.cleanup())

    await collection.stateWhenReady()

    // LQ1: electronics category
    const electronicsQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `electronics`))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })
    onTestFinished(() => electronicsQuery.cleanup())

    await electronicsQuery.preload()

    await vi.waitFor(
      () => {
        // Products A(50), B(150), D(200) are electronics
        expect(electronicsQuery.size).toBe(3)
      },
      { timeout: 2000 },
    )

    // LQ2: price > 100 (different predicate on same collection)
    const expensiveQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => gt(product.price, 100))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })

    onTestFinished(() => expensiveQuery.cleanup())

    await expensiveQuery.preload()

    await vi.waitFor(
      () => {
        // Products B(150) and D(200) have price > 100
        expect(expensiveQuery.size).toBe(2)
      },
      { timeout: 2000 },
    )

    // Now insert a new product that matches LQ1 (electronics) but NOT LQ2 (price <= 100)
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'Cheap Gadget', 30, 'electronics')
    `)

    // The diff trigger should use the OR of both active predicates:
    // (category = 'electronics') OR (price > 100)
    // 'Cheap Gadget' (electronics, price=30) matches the first predicate,
    // so it should reach the base collection and appear in electronicsQuery.
    await vi.waitFor(
      () => {
        expect(electronicsQuery.size).toBe(4) // 3 original + Cheap Gadget
      },
      { timeout: 2000 },
    )
  })

  it(`should handle three live queries with combined predicate coverage`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      }),
    )
    onTestFinished(() => collection.cleanup())

    await collection.stateWhenReady()

    // LQ1: electronics category
    const electronicsQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `electronics`))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })
    onTestFinished(() => electronicsQuery.cleanup())

    await electronicsQuery.preload()

    await vi.waitFor(
      () => {
        // Products A(50), B(150), D(200) are electronics
        expect(electronicsQuery.size).toBe(3)
      },
      { timeout: 2000 },
    )

    // LQ2: price > 100
    const expensiveQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => gt(product.price, 100))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })

    onTestFinished(() => expensiveQuery.cleanup())

    await expensiveQuery.preload()

    await vi.waitFor(
      () => {
        // Products B(150) and D(200) have price > 100
        expect(expensiveQuery.size).toBe(2)
      },
      { timeout: 2000 },
    )

    // LQ3: clothing category — a third predicate to exercise the 3-arg OR path
    const clothingQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `clothing`))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })

    onTestFinished(() => clothingQuery.cleanup())

    await clothingQuery.preload()

    await vi.waitFor(
      () => {
        // Products C(25) and E(75) are clothing
        expect(clothingQuery.size).toBe(2)
      },
      { timeout: 2000 },
    )

    // Insert a product that only matches LQ3 (clothing, cheap)
    // Diff trigger must OR all three predicates to catch this
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'New Shirt', 40, 'clothing')
    `)

    await vi.waitFor(
      () => {
        expect(clothingQuery.size).toBe(3) // C, E + New Shirt
      },
      { timeout: 2000 },
    )

    // Verify the other queries are unaffected
    expect(electronicsQuery.size).toBe(3)
    expect(expensiveQuery.size).toBe(2)
  })

  it(`should stop loading data for a predicate after its live query is cleaned up`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      }),
    )
    onTestFinished(() => collection.cleanup())

    await collection.stateWhenReady()

    // LQ1: electronics category
    const electronicsQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `electronics`))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })

    onTestFinished(() => electronicsQuery.cleanup())

    await electronicsQuery.preload()

    await vi.waitFor(
      () => {
        expect(electronicsQuery.size).toBe(3)
      },
      { timeout: 2000 },
    )

    // LQ2: clothing category
    const clothingQuery = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ product: collection })
          .where(({ product }) => eq(product.category, `clothing`))
          .select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
    })

    await clothingQuery.preload()

    await vi.waitFor(
      () => {
        expect(clothingQuery.size).toBe(2)
      },
      { timeout: 2000 },
    )

    const electronicsCount = electronicsQuery.size // 3

    // Kill LQ2 — its predicate should be removed and its rows evicted
    clothingQuery.cleanup()

    // Wait for clothing rows to be evicted; collection shrinks to electronics-only
    await vi.waitFor(
      () => {
        expect(collection.size).toBe(electronicsCount)
      },
      { timeout: 2000 },
    )

    // Insert a new clothing item — should NOT be picked up since LQ2 is gone
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'New Shirt', 40, 'clothing')
    `)

    // Wait to allow any (incorrect) propagation
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Collection should not have grown — clothing predicate is no longer active
    expect(collection.size).toBe(electronicsCount)

    // Insert a new electronics item — should still be picked up by LQ1
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'New Gadget', 99, 'electronics')
    `)

    await vi.waitFor(
      () => {
        expect(electronicsQuery.size).toBe(4) // 3 original + New Gadget
      },
      { timeout: 2000 },
    )

    // Kill LQ1 — no active predicates remain; electronics rows should be evicted
    electronicsQuery.cleanup()

    await vi.waitFor(
      () => {
        expect(collection.size).toBe(0)
      },
      { timeout: 2000 },
    )

    // Insert items matching both former predicates — neither should be picked up
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'Another Gadget', 120, 'electronics')
    `)
    await db.execute(`
      INSERT INTO products (id, name, price, category)
      VALUES (uuid(), 'Another Shirt', 15, 'clothing')
    `)

    await new Promise((resolve) => setTimeout(resolve, 200))

    // Collection should remain empty — no active predicates
    expect(collection.size).toBe(0)
  })

  describe(`Basic loadSubset behavior`, () => {
    it(`should pass correct WHERE clause from live query filters to loadSubset`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Query using lt — only products with price < 50: Product C (25)
      const cheapQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => lt(product.price, 50))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })

      onTestFinished(() => cheapQuery.cleanup())

      await cheapQuery.preload()

      await vi.waitFor(
        () => {
          expect(cheapQuery.size).toBe(1)
        },
        { timeout: 2000 },
      )

      const names = cheapQuery.toArray.map((p) => p.name)
      expect(names).toEqual([`Product C`])
    })

    it(`should pass ORDER BY and LIMIT to loadSubset`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Top 2 most expensive products, ordered by price descending
      const top2Query = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .orderBy(({ product }) => product.price, `desc`)
            .limit(2)
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => top2Query.cleanup())

      await top2Query.preload()

      await vi.waitFor(
        () => {
          expect(top2Query.size).toBe(2)
        },
        { timeout: 2000 },
      )

      const prices = top2Query.toArray.map((p) => p.price)
      // Product D (200) and Product B (150) are the top 2
      expect(prices).toEqual([200, 150])
    })

    it(`should handle complex filters (AND, OR) in loadSubset`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Complex filter: (electronics AND price >= 150) OR (clothing AND price < 50)
      // Matches: Product B (electronics, 150), Product D (electronics, 200), Product C (clothing, 25)
      const complexQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) =>
              or(
                and(
                  eq(product.category, `electronics`),
                  gte(product.price, 150),
                ),
                and(eq(product.category, `clothing`), lt(product.price, 50)),
              ),
            )
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => complexQuery.cleanup())

      await complexQuery.preload()

      await vi.waitFor(
        () => {
          expect(complexQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      const names = complexQuery.toArray.map((p) => p.name).sort()
      expect(names).toEqual([`Product B`, `Product C`, `Product D`])
    })

    it(`should handle empty result from loadSubset`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Query for a category that doesn't exist — no matching rows
      const emptyQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `furniture`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => emptyQuery.cleanup())

      await emptyQuery.preload()

      // Give it time to process
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(emptyQuery.size).toBe(0)
      expect(collection.size).toBe(0)
    })
  })

  describe(`Reactive updates via diff trigger`, () => {
    it(`should handle UPDATE to an existing row that still matches the predicate`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          // Products A(50), B(150), D(200) are electronics
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Update Product A's price — still electronics, still matches
      const productA = electronicsQuery.toArray.find(
        (p) => p.name === `Product A`,
      )
      await db.execute(`UPDATE products SET price = 99 WHERE id = ?`, [
        productA!.id,
      ])

      await vi.waitFor(
        () => {
          const updated = electronicsQuery.toArray.find(
            (p) => p.name === `Product A`,
          )
          expect(updated?.price).toBe(99)
        },
        { timeout: 2000 },
      )

      // Size unchanged — same row, just updated
      expect(electronicsQuery.size).toBe(3)
    })

    it(`should handle UPDATE that causes a row to no longer match the predicate`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Change Product A from electronics to clothing — no longer matches
      const productA = electronicsQuery.toArray.find(
        (p) => p.name === `Product A`,
      )
      await db.execute(
        `UPDATE products SET category = 'clothing' WHERE id = ?`,
        [productA!.id],
      )

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(2)
        },
        { timeout: 2000 },
      )

      const names = electronicsQuery.toArray.map((p) => p.name).sort()
      expect(names).toEqual([`Product B`, `Product D`])
    })

    it(`should handle UPDATE that causes a row to start matching the predicate`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          // Products A(50), B(150), D(200) are electronics
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Change Product C from clothing to electronics — now matches
      // Product C has id we need to look up from SQLite directly
      const productC = await db.get<{ id: string }>(
        `SELECT id FROM products WHERE name = 'Product C'`,
      )
      await db.execute(
        `UPDATE products SET category = 'electronics' WHERE id = ?`,
        [productC.id],
      )

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(4)
        },
        { timeout: 2000 },
      )

      const names = electronicsQuery.toArray.map((p) => p.name).sort()
      expect(names).toEqual([
        `Product A`,
        `Product B`,
        `Product C`,
        `Product D`,
      ])
    })

    it(`should handle DELETE of a matching row`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Delete Product A
      const productA = electronicsQuery.toArray.find(
        (p) => p.name === `Product A`,
      )

      const tx = collection.delete(productA!.id)
      await tx.isPersisted.promise

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(2)
        },
        { timeout: 2000 },
      )

      const names = electronicsQuery.toArray.map((p) => p.name).sort()
      expect(names).toEqual([`Product B`, `Product D`])

      // Verify the delete operation was recorded in the ps_crud table
      const crud = await db.getAll<{ id: number; data: string; tx_id: number }>(
        `SELECT * FROM ps_crud`,
      )

      const lastEntry = crud[crud.length - 1]!
      const parsed = JSON.parse(lastEntry.data)
      expect(parsed.op).toBe(`DELETE`)
      expect(parsed.id).toBe(productA!.id)
    })

    it(`should handle INSERT of a matching row`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Insert a new electronics product via the collection
      const newId = randomUUID()
      const tx = collection.insert({
        id: newId,
        name: `New Gadget`,
        price: 99,
        category: `electronics`,
      })
      await tx.isPersisted.promise

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(4)
        },
        { timeout: 2000 },
      )

      const names = electronicsQuery.toArray.map((p) => p.name).sort()
      expect(names).toContain(`New Gadget`)

      // Verify the insert operation was recorded in the ps_crud table
      const crud = await db.getAll<{ id: number; data: string; tx_id: number }>(
        `SELECT * FROM ps_crud`,
      )

      const lastEntry = crud[crud.length - 1]!
      const parsed = JSON.parse(lastEntry.data)
      expect(parsed.op).toBe(`PUT`)
      expect(parsed.id).toBe(newId)
    })

    it(`should handle UPDATE of a matching row`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Update Product A via the collection
      const productA = electronicsQuery.toArray.find(
        (p) => p.name === `Product A`,
      )

      const tx = collection.update(productA!.id, (d) => {
        d.price = 999
      })
      await tx.isPersisted.promise

      await vi.waitFor(
        () => {
          const product = electronicsQuery.toArray.find(
            (p) => p.name === `Product A`,
          )
          expect(product).toBeDefined()
          expect(product!.price).toBe(999)
        },
        { timeout: 2000 },
      )

      // Verify the update operation was recorded in the ps_crud table
      const crud = await db.getAll<{ id: number; data: string; tx_id: number }>(
        `SELECT * FROM ps_crud`,
      )

      const lastEntry = crud[crud.length - 1]!
      const parsed = JSON.parse(lastEntry.data)
      expect(parsed.op).toBe(`PATCH`)
      expect(parsed.id).toBe(productA!.id)
    })

    it(`should handle DELETE when read from collection by id`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const productA = await db.get<{ id: string }>(
        `SELECT id FROM products WHERE name = 'Product A'`,
      )

      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.id, productA.id))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(1)
        },
        { timeout: 2000 },
      )

      // Delete Product A
      const tx = collection.delete(productA.id)
      await tx.isPersisted.promise

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(0)
        },
        { timeout: 2000 },
      )

      const names = electronicsQuery.toArray.map((p) => p.name).sort()
      expect(names).toEqual([])

      // Verify the delete operation was recorded in the ps_crud table
      const crud = await db.getAll<{ id: number; data: string; tx_id: number }>(
        `SELECT * FROM ps_crud`,
      )

      const lastEntry = crud[crud.length - 1]!
      const parsed = JSON.parse(lastEntry.data)
      expect(parsed.op).toBe(`DELETE`)
      expect(parsed.id).toBe(productA.id)
    })

    it(`should handle INSERT when loaded by id`, async () => {
      const db = await createDatabase()

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const newId = randomUUID()

      const idQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.id, newId))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => idQuery.cleanup())

      await idQuery.preload()

      await vi.waitFor(
        () => {
          expect(idQuery.size).toBe(0)
        },
        { timeout: 2000 },
      )

      // Insert a new product via the collection
      const tx = collection.insert({
        id: newId,
        name: `New Product`,
        price: 99,
        category: `electronics`,
      })
      await tx.isPersisted.promise

      await vi.waitFor(
        () => {
          expect(idQuery.size).toBe(1)
        },
        { timeout: 2000 },
      )

      // Verify the insert operation was recorded in the ps_crud table
      const crud = await db.getAll<{ id: number; data: string; tx_id: number }>(
        `SELECT * FROM ps_crud`,
      )

      const lastEntry = crud[crud.length - 1]!
      const parsed = JSON.parse(lastEntry.data)
      expect(parsed.op).toBe(`PUT`)
      expect(parsed.id).toBe(newId)
    })

    it(`should handle UPDATE when read from collection by id`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const productA = await db.get<{ id: string }>(
        `SELECT id FROM products WHERE name = 'Product A'`,
      )

      const idQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.id, productA.id))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => idQuery.cleanup())

      await idQuery.preload()

      await vi.waitFor(
        () => {
          expect(idQuery.size).toBe(1)
        },
        { timeout: 2000 },
      )

      // Update Product A via the collection
      const tx = collection.update(productA.id, (d) => {
        d.price = 999
      })
      await tx.isPersisted.promise

      await vi.waitFor(
        () => {
          const product = idQuery.toArray[0]
          expect(product).toBeDefined()
          expect(product!.price).toBe(999)
        },
        { timeout: 2000 },
      )

      // Verify the update operation was recorded in the ps_crud table
      const crud = await db.getAll<{ id: number; data: string; tx_id: number }>(
        `SELECT * FROM ps_crud`,
      )

      const lastEntry = crud[crud.length - 1]!
      const parsed = JSON.parse(lastEntry.data)
      expect(parsed.op).toBe(`PATCH`)
      expect(parsed.id).toBe(productA.id)
    })
  })

  describe(`Unload / cleanup`, () => {
    it(`should handle rapid create-and-destroy of live queries without errors`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Rapidly create and destroy 5 live queries
      for (let i = 0; i < 5; i++) {
        const query = createLiveQueryCollection({
          query: (q) =>
            q
              .from({ product: collection })
              .where(({ product }) => eq(product.category, `electronics`))
              .select(({ product }) => ({
                id: product.id,
                name: product.name,
                price: product.price,
                category: product.category,
              })),
        })
        query.cleanup()
      }

      // Give time for any async cleanup to settle
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Collection should still be functional — create one more and verify it works
      const finalQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => finalQuery.cleanup())

      await finalQuery.preload()

      await vi.waitFor(
        () => {
          expect(finalQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )
    })

    it(`should handle re-creating a live query with the same predicate after cleanup`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Create first query
      const query1 = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })

      await query1.preload()

      await vi.waitFor(
        () => {
          expect(query1.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Destroy it
      query1.cleanup()

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Re-create with same predicate
      const query2 = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => query2.cleanup())

      await query2.preload()

      await vi.waitFor(
        () => {
          expect(query2.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Verify reactive updates still work on the re-created query
      await db.execute(`
        INSERT INTO products (id, name, price, category)
        VALUES (uuid(), 'Product F', 300, 'electronics')
      `)

      await vi.waitFor(
        () => {
          expect(query2.size).toBe(4)
        },
        { timeout: 2000 },
      )
    })

    it(`should evict rows from collection but preserve them in the SQLite database`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Clean up the live query — triggers unload/eviction
      electronicsQuery.cleanup()

      // Wait for eviction to complete
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(0)
        },
        { timeout: 2000 },
      )

      // Verify the rows still exist in the underlying SQLite database
      const sqliteRows = await db.getAll(
        `SELECT * FROM products WHERE category = 'electronics'`,
      )
      expect(sqliteRows).toHaveLength(3)
    })
  })

  describe(`Edge cases`, () => {
    it(`should handle loadSubset with no WHERE clause (load all data)`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Query with no WHERE — selects all products
      const allQuery = createLiveQueryCollection({
        query: (q) =>
          q.from({ product: collection }).select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
      })
      onTestFinished(() => allQuery.cleanup())

      await allQuery.preload()

      await vi.waitFor(
        () => {
          expect(allQuery.size).toBe(5)
        },
        { timeout: 2000 },
      )
    })

    it(`should handle empty result from loadSubset (no matching rows in SQLite)`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      const emptyQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `furniture`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => emptyQuery.cleanup())

      await emptyQuery.preload()

      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(emptyQuery.size).toBe(0)
      expect(collection.size).toBe(0)
    })

    it(`should handle concurrent loadSubset calls (multiple queries preloading simultaneously)`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Create three queries but don't await preload individually
      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      const clothingQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `clothing`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => clothingQuery.cleanup())

      const expensiveQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => gt(product.price, 100))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })

      onTestFinished(() => expensiveQuery.cleanup())

      // Preload all concurrently
      await Promise.all([
        electronicsQuery.preload(),
        clothingQuery.preload(),
        expensiveQuery.preload(),
      ])

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3) // A, B, D
          expect(clothingQuery.size).toBe(2) // C, E
          expect(expensiveQuery.size).toBe(2) // B, D
        },
        { timeout: 2000 },
      )
    })
  })

  describe(`Overlapping data across queries`, () => {
    it(`should deduplicate rows when multiple live queries load the same data`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // LQ1: electronics category — matches A(50), B(150), D(200)
      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })

      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // LQ2: price > 100 — matches B(150), D(200)
      // Products B and D overlap with LQ1
      const expensiveQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => gt(product.price, 100))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })

      onTestFinished(() => expensiveQuery.cleanup())

      await expensiveQuery.preload()

      await vi.waitFor(
        () => {
          expect(expensiveQuery.size).toBe(2)
        },
        { timeout: 2000 },
      )

      // Both loadSubset calls inserted rows B and D — base collection should have no duplicates
      // Union of both subsets: A, B, D (B and D are shared)
      const baseNames = collection.toArray.map((p: any) => p.name).sort()
      expect(baseNames).toEqual([`Product A`, `Product B`, `Product D`])

      // Both live queries return correct results over the shared data
      const electronicsNames = electronicsQuery.toArray
        .map((p) => p.name)
        .sort()
      expect(electronicsNames).toEqual([`Product A`, `Product B`, `Product D`])

      const expensiveNames = expensiveQuery.toArray.map((p) => p.name).sort()
      expect(expensiveNames).toEqual([`Product B`, `Product D`])

      // Update a shared row — both queries should see the change
      const productB = expensiveQuery.toArray.find(
        (p) => p.name === `Product B`,
      )
      await db.execute(`UPDATE products SET price = 175 WHERE id = ?`, [
        productB!.id,
      ])

      await vi.waitFor(
        () => {
          const inElectronics = electronicsQuery.toArray.find(
            (p) => p.name === `Product B`,
          )
          const inExpensive = expensiveQuery.toArray.find(
            (p) => p.name === `Product B`,
          )
          expect(inElectronics?.price).toBe(175)
          expect(inExpensive?.price).toBe(175)
        },
        { timeout: 2000 },
      )
    })

    it(`should handle changing a live query's predicate by replacing the collection`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Start with all products (no WHERE)
      let liveQuery = createLiveQueryCollection({
        query: (q) =>
          q.from({ product: collection }).select(({ product }) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            category: product.category,
          })),
      })

      await liveQuery.preload()

      await vi.waitFor(
        () => {
          expect(liveQuery.size).toBe(5)
        },
        { timeout: 2000 },
      )

      // Switch to only electronics
      liveQuery.cleanup()

      liveQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => liveQuery.cleanup())

      await liveQuery.preload()

      await vi.waitFor(
        () => {
          expect(liveQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      const names = liveQuery.toArray.map((p) => p.name).sort()
      expect(names).toEqual([`Product A`, `Product B`, `Product D`])

      // Verify reactive updates work on the new query
      await db.execute(`
        INSERT INTO products (id, name, price, category)
        VALUES (uuid(), 'Product F', 99, 'electronics')
      `)

      await vi.waitFor(
        () => {
          expect(liveQuery.size).toBe(4)
        },
        { timeout: 2000 },
      )
    })
  })

  describe(`Pending mutations during filter changes`, () => {
    it(`should resolve isPersisted when loadSubset is called during a pending mutation`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // LQ1: electronics category
      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Insert a new electronics product — creates a pending mutation
      const insertResult = collection.insert({
        id: randomUUID(),
        name: `New Gadget`,
        price: 99,
        category: `electronics`,
      })

      // Immediately create a second live query for clothing — triggers loadSubset
      // which rebuilds the diff trigger, potentially dropping unprocessed diff records
      const clothingQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `clothing`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => clothingQuery.cleanup())

      await clothingQuery.preload()

      // isPersisted.promise should resolve — if the bug is present, this hangs forever
      await vi.waitFor(
        async () => {
          await insertResult.isPersisted.promise
        },
        { timeout: 5000 },
      )
    })

    it(`should resolve isPersisted when unloadSubset is called during a pending mutation`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // LQ1: electronics category
      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
      onTestFinished(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // LQ2: clothing category
      const clothingQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `clothing`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })

      await clothingQuery.preload()

      await vi.waitFor(
        () => {
          expect(clothingQuery.size).toBe(2)
        },
        { timeout: 2000 },
      )

      // Insert a new electronics product — creates a pending mutation
      const insertResult = collection.insert({
        id: randomUUID(),
        name: `New Gadget`,
        price: 99,
        category: `electronics`,
      })

      // Immediately clean up the clothing query — triggers unloadSubset → loadSubset
      // which rebuilds the diff trigger, potentially dropping unprocessed diff records
      clothingQuery.cleanup()

      // isPersisted.promise should resolve — if the bug is present, this hangs forever
      await vi.waitFor(
        async () => {
          await insertResult.isPersisted.promise
        },
        { timeout: 5000 },
      )
    })

    it(`should resolve isPersisted when all live queries are cleaned up during a pending mutation`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Start with 1 live query (electronics)
      const electronicsQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      // Insert a new electronics product — creates a pending mutation
      const insertResult = collection.insert({
        id: randomUUID(),
        name: `New Gadget`,
        price: 99,
        category: `electronics`,
      })

      // Immediately clean up the only live query — triggers unloadSubset → loadSubset
      // with 0 predicates (early-return path), which must still call resolveAllPendingFor
      electronicsQuery.cleanup()

      // isPersisted.promise should resolve — if the bug is present, this hangs forever
      await vi.waitFor(
        async () => {
          await insertResult.isPersisted.promise
        },
        { timeout: 5000 },
      )
    })
  })

  describe(`Tracking lifecycle`, () => {
    // The sync handler catches its own errors and surfaces them only through the
    // logger, so captured errors are how these tests assert it stayed healthy.
    function captureSyncErrors(db: PowerSyncDatabase) {
      const errors: Array<string> = []
      vi.spyOn(db.logger, `error`).mockImplementation((...args: Array<any>) => {
        errors.push(args.map(String).join(` `))
      })
      return () => errors
    }

    function makeCollection(db: PowerSyncDatabase) {
      return createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
        }),
      )
    }

    function categoryQuery(
      collection: ReturnType<typeof makeCollection>,
      category: string,
    ) {
      return createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, category))
            .select(({ product }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
            })),
      })
    }

    function startOnDemandSync(
      db: PowerSyncDatabase,
      settings: {
        onLoadSubset?: (
          options: LoadSubsetOptions,
        ) => void | (() => void) | Promise<void | (() => void)>
        syncBatchSize?: number
      } = {},
      overrides: Partial<{
        begin: ReturnType<typeof vi.fn>
        write: ReturnType<typeof vi.fn>
        commit: ReturnType<typeof vi.fn>
      }> = {},
    ) {
      const begin = overrides.begin ?? vi.fn()
      const write = overrides.write ?? vi.fn()
      const commit = overrides.commit ?? vi.fn(() => true)
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset: settings.onLoadSubset,
        syncBatchSize: settings.syncBatchSize,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin,
        write,
        commit,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      const loadSubset =
        sync && typeof sync !== `function` ? sync.loadSubset : undefined
      const unloadSubset =
        sync && typeof sync !== `function` ? sync.unloadSubset : undefined
      if (!sync || typeof sync === `function` || !loadSubset || !unloadSubset) {
        throw new Error(`Expected on-demand sync controls`)
      }
      return { sync, loadSubset, unloadSubset, begin, write, commit }
    }

    it(`does not publish a provisional or rejected subset`, async () => {
      const db = await createDatabase()
      const firstHook = pDefer<void>()
      const hookFailure = new Error(`subset hook failed`)
      const onLoadSubset = vi
        .fn()
        .mockReturnValueOnce(firstHook.promise)
        .mockRejectedValueOnce(hookFailure)
        .mockResolvedValueOnce(undefined)
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockResolvedValue(vi.fn())
      const { sync, loadSubset } = startOnDemandSync(db, { onLoadSubset })

      try {
        const provisional = loadSubset({
          where: eq(`category`, `electronics`),
        })
        await vi.waitFor(() => expect(onLoadSubset).toHaveBeenCalledOnce())
        await expect(
          loadSubset({ where: eq(`category`, `outdoors`) }),
        ).rejects.toBe(hookFailure)
        await loadSubset({ where: eq(`category`, `clothing`) })

        const when = createDiffTrigger.mock.calls.at(-1)?.[0].when
        expect(when?.INSERT).toContain(`clothing`)
        expect(when?.INSERT).not.toContain(`electronics`)
        expect(when?.INSERT).not.toContain(`outdoors`)

        firstHook.resolve()
        await provisional
      } finally {
        firstHook.resolve()
        sync.cleanup?.()
      }
    })

    it(`does not acquire a subset released during startup`, async () => {
      const db = await createDatabase()
      const onLoadSubset = vi.fn()
      const createDiffTrigger = vi.spyOn(db.triggers, `createDiffTrigger`)
      const { sync, loadSubset, unloadSubset } = startOnDemandSync(db, {
        onLoadSubset,
      })
      const controller = new AbortController()
      const request = {
        where: eq(`category`, `electronics`),
        signal: controller.signal,
      }

      const load = loadSubset(request)
      controller.abort()
      unloadSubset(request)

      try {
        await load
        expect(onLoadSubset).not.toHaveBeenCalled()
        expect(createDiffTrigger).not.toHaveBeenCalled()
      } finally {
        sync.cleanup?.()
      }
    })

    it(`settles concurrent loads only after the latest trigger is live`, async () => {
      const db = await createDatabase()
      const locks: Array<() => Promise<void>> = []
      vi.spyOn(db, `writeLock`).mockImplementation(
        (callback) =>
          new Promise((resolve, reject) => {
            locks.push(async () => {
              try {
                await callback({} as never)
                resolve(undefined as never)
              } catch (error) {
                reject(error)
              }
            })
          }) as never,
      )
      vi.spyOn(db, `getAll`).mockResolvedValue([])
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockResolvedValue(vi.fn())
      const { sync, loadSubset } = startOnDemandSync(db)
      let firstSettled = false
      let secondSettled = false

      const first = Promise.resolve(
        loadSubset({ where: eq(`category`, `electronics`) }),
      ).then(() => {
        firstSettled = true
      })
      await vi.waitFor(() => expect(locks).toHaveLength(1))
      const second = Promise.resolve(
        loadSubset({ where: eq(`category`, `clothing`) }),
      ).then(() => {
        secondSettled = true
      })

      try {
        await locks[0]!()
        expect(firstSettled).toBe(false)
        expect(secondSettled).toBe(false)
        expect(createDiffTrigger).not.toHaveBeenCalled()

        await vi.waitFor(() => expect(locks).toHaveLength(2))
        await locks[1]!()
        await Promise.all([first, second])

        expect(createDiffTrigger).toHaveBeenCalledOnce()
        const when = createDiffTrigger.mock.calls[0]?.[0].when
        expect(when?.INSERT).toContain(`electronics`)
        expect(when?.INSERT).toContain(`clothing`)
      } finally {
        sync.cleanup?.()
        await Promise.all(locks.map((run) => run()))
        await Promise.allSettled([first, second])
      }
    })

    it(`disposes a trigger superseded while it is being created`, async () => {
      const db = await createDatabase()
      const triggerStarted = pDefer<void>()
      const finishTrigger = pDefer<void>()
      const staleDispose = vi.fn(async () => {})
      const currentDispose = vi.fn(async () => {})
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockImplementationOnce(async () => {
          triggerStarted.resolve()
          await finishTrigger.promise
          return staleDispose
        })
        .mockResolvedValueOnce(currentDispose)
      const { sync, loadSubset } = startOnDemandSync(db)
      const first = Promise.resolve(
        loadSubset({ where: eq(`category`, `electronics`) }),
      )

      try {
        await triggerStarted.promise
        const second = Promise.resolve(
          loadSubset({ where: eq(`category`, `clothing`) }),
        )
        finishTrigger.resolve()
        await Promise.all([first, second])

        expect(createDiffTrigger).toHaveBeenCalledTimes(2)
        expect(staleDispose).toHaveBeenCalledOnce()
        expect(currentDispose).not.toHaveBeenCalled()
      } finally {
        finishTrigger.resolve()
        sync.cleanup?.()
        await first
      }
    })

    it(`waits for every applied batch before settling a subset`, async () => {
      const db = await createDatabase()
      const receipts: Array<ReturnType<typeof pDefer<void>>> = []
      const rows = [
        { id: `a`, name: `A`, price: 1, category: `electronics` },
        { id: `b`, name: `B`, price: 2, category: `electronics` },
      ]
      vi.spyOn(db.triggers, `createDiffTrigger`).mockImplementation(
        async (options) => {
          let cursor = 0
          await options.hooks?.beforeCreate?.({
            getAll: async () => rows.slice(cursor, ++cursor),
          } as never)
          return vi.fn()
        },
      )
      const commit = vi.fn(() => {
        const receipt = pDefer<void>()
        receipts.push(receipt)
        return receipt.promise
      })
      const { sync, loadSubset } = startOnDemandSync(
        db,
        { syncBatchSize: 1 },
        { commit },
      )
      let settled = false
      const load = Promise.resolve(
        loadSubset({ where: eq(`category`, `electronics`) }),
      ).then(() => {
        settled = true
      })

      try {
        await vi.waitFor(() => expect(receipts).toHaveLength(3))
        receipts[0]!.resolve()
        receipts[1]!.resolve()
        await Promise.resolve()
        expect(settled).toBe(false)

        receipts[2]!.resolve()
        await load
        expect(settled).toBe(true)
      } finally {
        receipts.forEach((receipt) => receipt.resolve())
        sync.cleanup?.()
        await load
      }
    })

    it(`does not start queued tracking after cleanup`, async () => {
      const db = await createDatabase()
      const lockQueued = pDefer<void>()
      let runLock!: () => Promise<void>
      vi.spyOn(db, `writeLock`).mockImplementation(
        (callback) =>
          new Promise((resolve, reject) => {
            runLock = async () => {
              try {
                await callback({} as never)
                resolve(undefined as never)
              } catch (error) {
                reject(error)
              }
            }
            lockQueued.resolve()
          }) as never,
      )
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockResolvedValue(vi.fn())
      const { sync, loadSubset } = startOnDemandSync(db)

      const load = loadSubset({ where: eq(`category`, `electronics`) })
      await lockQueued.promise
      sync.cleanup?.()
      await runLock()
      await load

      expect(createDiffTrigger).not.toHaveBeenCalled()
    })

    it(`cleans each acquired subset at most once during reentrant cleanup`, async () => {
      const db = await createDatabase()
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(vi.fn())
      const first = { where: eq(`category`, `electronics`) }
      const second = { where: eq(`category`, `clothing`) }
      const firstCleanup = vi.fn()
      let unloadSubset!: (options: LoadSubsetOptions) => void
      const secondCleanup = vi.fn(() => unloadSubset(first))
      const onLoadSubset = vi.fn((options: LoadSubsetOptions) =>
        options === first ? firstCleanup : secondCleanup,
      )
      const started = startOnDemandSync(db, { onLoadSubset })
      unloadSubset = started.unloadSubset

      await Promise.all([started.loadSubset(first), started.loadSubset(second)])
      started.sync.cleanup?.()

      expect(firstCleanup).toHaveBeenCalledOnce()
      expect(secondCleanup).toHaveBeenCalledOnce()
    })

    it(`does not repeat release work started by a reentrant cleanup`, async () => {
      const db = await createDatabase()
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(vi.fn())
      const getAll = vi.spyOn(db, `getAll`).mockResolvedValue([])
      const first = { where: eq(`category`, `electronics`) }
      const second = { where: eq(`category`, `clothing`) }
      let unloadSubset!: (options: LoadSubsetOptions) => void
      const onLoadSubset = vi.fn((options: LoadSubsetOptions) =>
        options === first ? () => unloadSubset(second) : undefined,
      )
      const started = startOnDemandSync(db, { onLoadSubset })
      unloadSubset = started.unloadSubset

      try {
        await Promise.all([
          started.loadSubset(first),
          started.loadSubset(second),
        ])
        unloadSubset(first)
        await vi.waitFor(() =>
          expect(
            getAll.mock.calls.some(([sql]) =>
              String(sql).includes(`electronics`),
            ),
          ).toBe(true),
        )

        expect(
          getAll.mock.calls.filter(([sql]) => String(sql).includes(`clothing`)),
        ).toHaveLength(1)
      } finally {
        started.sync.cleanup?.()
      }
    })

    it(`does not create tracking when change observation cannot start`, async () => {
      const db = await createDatabase()
      const startupError = new Error(`change observation failed`)
      vi.spyOn(db.logger, `error`).mockImplementation(() => {})
      vi.spyOn(db, `onChangeWithCallback`).mockImplementation(() => {
        throw startupError
      })
      const createDiffTrigger = vi.spyOn(db.triggers, `createDiffTrigger`)
      const collection = makeCollection(db)
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()
      const query = categoryQuery(collection, `electronics`)
      onTestFinished(() => query.cleanup())

      await expect(query.preload()).rejects.toBe(startupError)
      expect(createDiffTrigger).not.toHaveBeenCalled()
    })

    it(`flushes a change observed while eager tracking starts`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)
      let flush:
        | ((event: { changedTables: Array<string> }) => Promise<void> | void)
        | undefined
      vi.spyOn(db, `onChangeWithCallback`).mockImplementation((handler) => {
        flush = handler?.onChange
        return () => {}
      })
      const triggerCreated = pDefer<void>()
      const publishTrigger = pDefer<void>()
      const createDiffTrigger = db.triggers.createDiffTrigger.bind(db.triggers)
      vi.spyOn(db.triggers, `createDiffTrigger`).mockImplementation(
        async (options) => {
          const dispose = await createDiffTrigger(options)
          triggerCreated.resolve()
          await publishTrigger.promise
          return dispose
        },
      )
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
        }),
      )
      onTestFinished(() => collection.cleanup())

      await triggerCreated.promise
      await db.execute(`
        INSERT INTO products (id, name, price, category)
        VALUES ('during-startup', 'During startup', 300, 'electronics')
      `)
      const observed = Promise.resolve(
        flush?.({
          changedTables: [collection.utils.getMeta().trackedTableName],
        }),
      )
      publishTrigger.resolve()
      await Promise.all([observed, collection.stateWhenReady()])

      expect(collection.get(`during-startup`)?.name).toBe(`During startup`)
    })

    it(`disposes eager tracking that finishes after cleanup`, async () => {
      const db = await createDatabase()
      vi.spyOn(db, `onChangeWithCallback`).mockImplementation(() => () => {})
      const triggerStarted = pDefer<void>()
      const finishTrigger = pDefer<void>()
      const dispose = vi.fn(async () => {})
      vi.spyOn(db.triggers, `createDiffTrigger`).mockImplementation(
        async () => {
          triggerStarted.resolve()
          await finishTrigger.promise
          return dispose
        },
      )
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
        }),
      )

      await triggerStarted.promise
      collection.cleanup()
      finishTrigger.resolve()

      await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
    })

    it(`retries a failed physical release`, async () => {
      vi.useFakeTimers()
      const db = await createDatabase()
      vi.spyOn(db.logger, `error`).mockImplementation(() => {})
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(vi.fn())
      const getAll = vi
        .spyOn(db, `getAll`)
        .mockRejectedValueOnce(new Error(`transient eviction failure`))
        .mockResolvedValueOnce([])
      const { sync, loadSubset, unloadSubset } = startOnDemandSync(db)
      const request = { where: eq(`category`, `electronics`) }

      try {
        await loadSubset(request)
        expect(unloadSubset(request)).toBeUndefined()
        await vi.waitFor(() => expect(getAll).toHaveBeenCalledOnce())
        await vi.advanceTimersByTimeAsync(1_000)
        await vi.waitFor(() => expect(getAll).toHaveBeenCalledTimes(2))
      } finally {
        sync.cleanup?.()
        await vi.runOnlyPendingTimersAsync()
        vi.useRealTimers()
      }
    })

    it(`does not let one failed release block another`, async () => {
      vi.useFakeTimers()
      const db = await createDatabase()
      vi.spyOn(db.logger, `error`).mockImplementation(() => {})
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(vi.fn())
      const getAll = vi
        .spyOn(db, `getAll`)
        .mockImplementation((sql) =>
          String(sql).includes(`electronics`)
            ? Promise.reject(new Error(`persistent eviction failure`))
            : Promise.resolve([]),
        )
      const { sync, loadSubset, unloadSubset } = startOnDemandSync(db)
      const failing = { where: eq(`category`, `electronics`) }
      const succeeding = { where: eq(`category`, `clothing`) }

      try {
        await Promise.all([loadSubset(failing), loadSubset(succeeding)])
        unloadSubset(failing)
        unloadSubset(succeeding)
        await vi.waitFor(() => expect(getAll).toHaveBeenCalled())
        await vi.advanceTimersByTimeAsync(1_000)

        expect(
          getAll.mock.calls.some(([sql]) => {
            const query = String(sql)
            return query.includes(`clothing`) && !query.includes(`electronics`)
          }),
        ).toBe(true)
      } finally {
        sync.cleanup?.()
        await vi.runOnlyPendingTimersAsync()
        vi.useRealTimers()
      }
    })

    it(`rechecks active demand before evicting released rows`, async () => {
      const db = await createDatabase()
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(vi.fn())
      const firstEviction = pDefer<Array<{ id: string }>>()
      const getAll = vi
        .spyOn(db, `getAll`)
        .mockReturnValueOnce(firstEviction.promise)
        .mockResolvedValueOnce([])
      const write = vi.fn()
      const { sync, loadSubset, unloadSubset } = startOnDemandSync(
        db,
        {},
        { write },
      )
      const departing = { where: eq(`category`, `electronics`) }

      try {
        await loadSubset(departing)
        unloadSubset(departing)
        await vi.waitFor(() => expect(getAll).toHaveBeenCalledOnce())

        await loadSubset({ where: eq(`category`, `clothing`) })
        firstEviction.resolve([{ id: `now-owned` }])

        await vi.waitFor(() => expect(getAll).toHaveBeenCalledTimes(2))
        expect(write).not.toHaveBeenCalledWith({
          type: `delete`,
          key: `now-owned`,
        })
      } finally {
        firstEviction.resolve([])
        sync.cleanup?.()
      }
    })

    it(`should start tracking again when a subset is loaded after every subset was unloaded`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)
      const syncErrors = captureSyncErrors(db)

      const collection = makeCollection(db)
      onTestFinished(() => collection.cleanup())
      await collection.stateWhenReady()

      // Load a subset, then unload it so no predicates remain. Tracking stops and
      // the tracking table is dropped.
      const electronicsQuery = categoryQuery(collection, `electronics`)
      await electronicsQuery.preload()
      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      electronicsQuery.cleanup()
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(0)
        },
        { timeout: 2000 },
      )

      // A new subset gets a freshly created tracking table and syncs normally.
      const clothingQuery = categoryQuery(collection, `clothing`)
      onTestFinished(() => clothingQuery.cleanup())
      await clothingQuery.preload()

      await vi.waitFor(
        () => {
          expect(clothingQuery.size).toBe(2)
        },
        { timeout: 2000 },
      )

      expect(syncErrors()).toEqual([])
    })

    it(`should stop tracking cleanly when every subset is unloaded and the collection is cleaned up`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)
      const syncErrors = captureSyncErrors(db)

      const collection = makeCollection(db)
      await collection.stateWhenReady()

      const electronicsQuery = categoryQuery(collection, `electronics`)
      const clothingQuery = categoryQuery(collection, `clothing`)
      await electronicsQuery.preload()
      await clothingQuery.preload()

      await vi.waitFor(
        () => {
          expect(collection.size).toBe(5)
        },
        { timeout: 2000 },
      )

      // Unload every predicate, then tear the collection down.
      clothingQuery.cleanup()
      electronicsQuery.cleanup()
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(0)
        },
        { timeout: 2000 },
      )

      // Allow any flush queued by the tracking table's onChange watcher to run.
      await new Promise((resolve) => setTimeout(resolve, 200))

      collection.cleanup()
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(syncErrors()).toEqual([])
    })

    it(`should dispose each diff trigger exactly once`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      // Count dispose calls per created trigger. The collection should release its
      // reference to a trigger once disposed, so no trigger is disposed twice.
      const disposeCounts: Array<number> = []
      const createDiffTrigger = db.triggers.createDiffTrigger.bind(db.triggers)
      vi.spyOn(db.triggers, `createDiffTrigger`).mockImplementation(
        async (options) => {
          const dispose = await createDiffTrigger(options)
          const index = disposeCounts.push(0) - 1
          return async (disposeOptions) => {
            disposeCounts[index]! += 1
            return dispose(disposeOptions)
          }
        },
      )

      const collection = makeCollection(db)
      await collection.stateWhenReady()

      const electronicsQuery = categoryQuery(collection, `electronics`)
      await electronicsQuery.preload()
      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      electronicsQuery.cleanup()
      await vi.waitFor(
        () => {
          expect(collection.size).toBe(0)
        },
        { timeout: 2000 },
      )

      collection.cleanup()
      await new Promise((resolve) => setTimeout(resolve, 200))

      // One trigger is created for the electronics subset and disposed when that
      // subset unloads. Cleaning up the collection must not dispose it again.
      expect(disposeCounts).toEqual([1])
    })
  })
})
