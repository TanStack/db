import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import {
  and,
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
  gte,
  lt,
  or,
} from '@tanstack/db'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'

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
})
