import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  IR,
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
import {
  projectRetainedRowKeys,
  projectTransportLoads,
} from '../../db/tests/load-subset-full-flow-model'
import type { LoadSubsetFullFlowEvent } from '../../db/tests/load-subset-full-flow-model'
import type { Scheduler } from 'fast-check'

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

  type ProductRow = {
    id: string
    name: string
    price: number
    category: string
  }

  type StagedChange = {
    type: `insert` | `update` | `delete`
    value?: ProductRow
    key?: string
  }

  type ControlledReceipt = {
    promise: Promise<void>
    resolve: () => void
    reject: (reason: unknown) => void
  }

  async function startAppliedOutcomeLoad(
    source: `rows` | `empty`,
    syncBatchSize?: number,
    receiptMode: `controlled` | `immediate` = `controlled`,
  ) {
    const db = await createDatabase()
    await createTestProducts(db)
    const category = source === `rows` ? `electronics` : `furniture`
    const authoritativeRows = await db.getAll<ProductRow>(
      `SELECT id, name, price, category FROM products WHERE category = ?`,
      [category],
    )
    const receipts: Array<ControlledReceipt> = []
    const readableRows = new Map<string, ProductRow>()
    let stagedChanges: Array<StagedChange> = []
    const applyChanges = (changes: Array<StagedChange>) => {
      for (const change of changes) {
        if (change.type === `delete`) {
          if (!change.key) throw new Error(`Delete requires a key`)
          readableRows.delete(change.key)
        } else {
          if (!change.value) throw new Error(`Write requires a value`)
          readableRows.set(change.value.id, change.value)
        }
      }
    }
    const commit = vi.fn(() => {
      const changes = stagedChanges
      stagedChanges = []
      if (receiptMode === `immediate`) {
        applyChanges(changes)
        return true
      }
      const receipt = pDefer<void>()
      receipts.push(receipt)
      return receipt.promise.then(() => applyChanges(changes))
    })
    const config = powerSyncCollectionOptions({
      database: db,
      table: APP_SCHEMA.props.products,
      syncMode: `on-demand`,
      ...(syncBatchSize === undefined ? {} : { syncBatchSize }),
    })
    const sync = config.sync.sync({
      collection: {
        status: `ready`,
        has: (key: string) => readableRows.has(key),
      },
      begin: vi.fn(() => {
        stagedChanges = []
      }),
      write: vi.fn((change: StagedChange) => {
        stagedChanges.push(change)
      }),
      commit,
      markReady: vi.fn(),
      markError: vi.fn(),
      truncate: vi.fn(),
    } as never)
    if (!sync || typeof sync === `function` || !sync.loadSubset) {
      throw new Error(`Expected on-demand sync controls`)
    }

    let settled = false
    const where = new IR.Func<boolean>(`eq`, [
      new IR.PropRef([`category`]),
      new IR.Value(category),
    ])
    const observed = Promise.resolve(sync.loadSubset({ where })).then(
      () => {
        settled = true
        return { status: `fulfilled` } as const
      },
      (reason: unknown) => {
        settled = true
        return { status: `rejected`, reason } as const
      },
    )

    return {
      authoritativeRows,
      readableRows,
      receipts,
      observed,
      isSettled: () => settled,
      cleanup: async () => {
        receipts.forEach((receipt) => receipt.resolve())
        sync.cleanup?.()
        await observed
      },
    }
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

  it.each([
    { source: `rows`, settlement: `fulfill` },
    { source: `empty`, settlement: `fulfill` },
    { source: `rows`, settlement: `reject` },
    { source: `empty`, settlement: `reject` },
  ] as const)(
    `settles a $source subset only through an applied $settlement outcome`,
    async ({ source, settlement }) => {
      const harness = await startAppliedOutcomeLoad(source)
      const receiptFailure = new Error(`applied receipt failed`)
      expect(harness.authoritativeRows.length > 0).toBe(source === `rows`)

      try {
        await vi.waitFor(() => expect(harness.receipts).toHaveLength(1))
        expect(harness.isSettled()).toBe(false)
        expect(harness.readableRows.size).toBe(0)

        if (settlement === `reject`) {
          harness.receipts[0]!.reject(receiptFailure)
        } else {
          harness.receipts[0]!.resolve()
        }

        const result = await harness.observed
        if (settlement === `reject`) {
          expect(result).toEqual({
            status: `rejected`,
            reason: receiptFailure,
          })
          expect(harness.readableRows.size).toBe(0)
        } else {
          expect(result).toEqual({ status: `fulfilled` })
          expect(
            Array.from(harness.readableRows.values(), (row) => row.name).sort(),
          ).toEqual(harness.authoritativeRows.map((row) => row.name).sort())
        }
      } finally {
        await harness.cleanup()
      }
    },
  )

  it(`waits for every applied receipt before fulfilling a multi-batch subset`, async () => {
    const harness = await startAppliedOutcomeLoad(`rows`, 1)

    try {
      await vi.waitFor(() =>
        expect(harness.receipts).toHaveLength(
          harness.authoritativeRows.length + 1,
        ),
      )

      for (const [index, receipt] of harness.receipts.entries()) {
        receipt.resolve()
        await vi.waitFor(() =>
          expect(harness.readableRows.size).toBe(
            Math.min(index + 1, harness.authoritativeRows.length),
          ),
        )
        if (index < harness.receipts.length - 1) {
          expect(harness.isSettled()).toBe(false)
        }
      }
      await expect(harness.observed).resolves.toEqual({
        status: `fulfilled`,
      })
      expect(
        Array.from(harness.readableRows.values(), (row) => row.name).sort(),
      ).toEqual(harness.authoritativeRows.map((row) => row.name).sort())
    } finally {
      await harness.cleanup()
    }
  })

  it.each([
    { receiptIndex: 0 },
    { receiptIndex: 1 },
    { receiptIndex: 2 },
    { receiptIndex: 3 },
  ])(
    `keeps applied receipt $receiptIndex independent in a multi-batch subset`,
    async ({ receiptIndex }) => {
      const harness = await startAppliedOutcomeLoad(`rows`, 1)
      const receiptFailure = new Error(`applied receipt ${receiptIndex} failed`)

      try {
        await vi.waitFor(() =>
          expect(harness.receipts).toHaveLength(
            harness.authoritativeRows.length + 1,
          ),
        )
        expect(receiptIndex).toBeLessThan(harness.receipts.length)

        harness.receipts.forEach((receipt, index) => {
          if (index !== receiptIndex) receipt.resolve()
        })
        const expectedRows = harness.authoritativeRows.filter(
          (_row, index) => index !== receiptIndex,
        )
        await vi.waitFor(() =>
          expect(harness.readableRows.size).toBe(expectedRows.length),
        )
        expect(
          Array.from(harness.readableRows.values(), (row) => row.name).sort(),
        ).toEqual(expectedRows.map((row) => row.name).sort())
        expect(harness.isSettled()).toBe(false)

        harness.receipts[receiptIndex]!.reject(receiptFailure)
        await expect(harness.observed).resolves.toEqual({
          status: `rejected`,
          reason: receiptFailure,
        })
        expect(
          Array.from(harness.readableRows.values(), (row) => row.name).sort(),
        ).toEqual(expectedRows.map((row) => row.name).sort())
      } finally {
        await harness.cleanup()
      }
    },
  )

  it.each([
    { receiptIndex: 0 },
    { receiptIndex: 1 },
    { receiptIndex: 2 },
    { receiptIndex: 3 },
  ])(
    `fails fast at applied receipt $receiptIndex while later receipts remain pending`,
    async ({ receiptIndex }) => {
      const harness = await startAppliedOutcomeLoad(`rows`, 1)
      const receiptFailure = new Error(
        `applied receipt ${receiptIndex} failed before its suffix settled`,
      )

      try {
        await vi.waitFor(() =>
          expect(harness.receipts).toHaveLength(
            harness.authoritativeRows.length + 1,
          ),
        )
        expect(receiptIndex).toBeLessThan(harness.receipts.length)

        harness.receipts
          .slice(0, receiptIndex)
          .forEach((receipt) => receipt.resolve())
        const expectedRows = harness.authoritativeRows.slice(0, receiptIndex)
        await vi.waitFor(() =>
          expect(harness.readableRows.size).toBe(expectedRows.length),
        )

        harness.receipts[receiptIndex]!.reject(receiptFailure)
        await expect(harness.observed).resolves.toEqual({
          status: `rejected`,
          reason: receiptFailure,
        })
        expect(
          Array.from(harness.readableRows.values(), (row) => row.name).sort(),
        ).toEqual(expectedRows.map((row) => row.name).sort())
      } finally {
        await harness.cleanup()
      }
    },
  )

  it.each([`rows`, `empty`] as const)(
    `accepts an immediate applied outcome for a %s subset`,
    async (source) => {
      const harness = await startAppliedOutcomeLoad(
        source,
        undefined,
        `immediate`,
      )

      try {
        expect(harness.authoritativeRows.length > 0).toBe(source === `rows`)
        await expect(harness.observed).resolves.toEqual({
          status: `fulfilled`,
        })
        expect(harness.receipts).toHaveLength(0)
        expect(
          Array.from(harness.readableRows.values(), (row) => row.name).sort(),
        ).toEqual(harness.authoritativeRows.map((row) => row.name).sort())
      } finally {
        await harness.cleanup()
      }
    },
  )

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

    it(`matches the shared remount history after final-owner release`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)
      const expectedRowKeys = (
        await db.getAll<{ id: string }>(
          `SELECT id FROM products WHERE category = 'electronics'`,
        )
      )
        .map(({ id }) => String(id))
        .sort()
      expect(expectedRowKeys).toHaveLength(3)
      let transportLoads = 0
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
          onLoadSubset: () => {
            transportLoads++
          },
        }),
      )
      await collection.stateWhenReady()
      const createLive = () =>
        createLiveQueryCollection({
          query: (q) =>
            q
              .from({ product: collection })
              .where(({ product }) => eq(product.category, `electronics`)),
        })
      const first = createLive()
      let second: ReturnType<typeof createLive> | undefined
      const history: Array<LoadSubsetFullFlowEvent> = [
        {
          type: `requestDemand`,
          ownerId: `owner-1`,
          sessionId: `session-1`,
          sourceId: `powersync-products`,
          demandId: `electronics`,
          attemptId: `attempt-1`,
          alreadyAborted: false,
        },
      ]

      try {
        await first.preload()
        history.push({
          type: `applyAuthoritativeRows`,
          ownerId: `owner-1`,
          sourceId: `powersync-products`,
          demandId: `electronics`,
          attemptId: `attempt-1`,
          rowKeys: expectedRowKeys,
        })
        expect(first.toArray.map(({ id }) => String(id)).sort()).toEqual(
          projectRetainedRowKeys(history),
        )

        await first.cleanup()
        history.push(
          {
            type: `releaseDemand`,
            ownerId: `owner-1`,
            sourceId: `powersync-products`,
            demandId: `electronics`,
            attemptId: `attempt-1`,
          },
          {
            type: `restartSession`,
            previousSessionId: `session-1`,
            nextSessionId: `session-2`,
          },
          {
            type: `requestDemand`,
            ownerId: `owner-2`,
            sessionId: `session-2`,
            sourceId: `powersync-products`,
            demandId: `electronics`,
            attemptId: `attempt-2`,
            alreadyAborted: false,
          },
        )
        await vi.waitFor(() => expect(collection.size).toBe(0))

        second = createLive()
        await second.preload()
        const reloadedKeys = second.toArray.map(({ id }) => String(id)).sort()
        history.push({
          type: `applyAuthoritativeRows`,
          ownerId: `owner-2`,
          sourceId: `powersync-products`,
          demandId: `electronics`,
          attemptId: `attempt-2`,
          rowKeys: expectedRowKeys,
        })

        expect(transportLoads).toBe(projectTransportLoads(history))
        expect(reloadedKeys).toEqual(projectRetainedRowKeys(history))
      } finally {
        await Promise.all([
          first.cleanup(),
          second?.cleanup(),
          collection.cleanup(),
        ])
      }
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

    function queueWriteLocks(
      db: PowerSyncDatabase,
      scheduler?: Scheduler,
      invocationOrder?: Array<string>,
    ) {
      const queued: Array<() => Promise<void>> = []
      vi.spyOn(db, `writeLock`).mockImplementation(
        (callback) =>
          new Promise((resolve, reject) => {
            let started = false
            const label = `write-lock-${queued.length + 1}`
            const run = async () => {
              if (started) return
              started = true
              invocationOrder?.push(label)
              try {
                const result = await callback({} as never)
                resolve(result as never)
              } catch (error) {
                reject(error)
              }
            }
            queued.push(run)
            if (scheduler) {
              void scheduler.schedule(Promise.resolve(), label).then(run)
            }
          }) as never,
      )
      return queued
    }

    async function startConcurrentLifecycleHarness(scheduler?: Scheduler) {
      const db = await createDatabase()
      const hooks: Array<ReturnType<typeof pDefer<void>>> = []
      const hookCleanups: Array<ReturnType<typeof vi.fn>> = []
      const onLoadSubset = vi.fn(() => {
        const hook = pDefer<void>()
        hooks.push(hook)
        const cleanup = vi.fn()
        hookCleanups.push(cleanup)
        return hook.promise.then(() => cleanup)
      })
      const queuedLocks = queueWriteLocks(db, scheduler)
      vi.spyOn(db, `getAll`).mockResolvedValue([])
      const trackingHandles: Array<{
        when: Record<`INSERT` | `UPDATE` | `DELETE`, string>
        dispose: ReturnType<typeof vi.fn>
      }> = []
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockImplementation(({ when }) => {
          const dispose = vi.fn(() => Promise.resolve())
          trackingHandles.push({
            when: when as Record<`INSERT` | `UPDATE` | `DELETE`, string>,
            dispose,
          })
          return Promise.resolve(dispose)
        })
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write: vi.fn(),
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      if (
        !sync ||
        typeof sync === `function` ||
        !sync.loadSubset ||
        !sync.unloadSubset
      ) {
        throw new Error(`Expected on-demand sync controls`)
      }
      const first = { where: eq(`category`, `electronics`) }
      const second = { where: eq(`category`, `clothing`) }
      const loadSubset = sync.loadSubset
      const unloadSubset = sync.unloadSubset

      return {
        sync,
        loadSubset,
        unloadSubset,
        first,
        second,
        hooks,
        hookCleanups,
        queuedLocks,
        createDiffTrigger,
        trackingHandles,
        cleanup: async () => {
          hooks.forEach((hook) => hook.resolve())
          sync.cleanup?.()
          await Promise.all(queuedLocks.map((run) => run()))
        },
      }
    }

    type ScheduledSecondOutcome =
      | `activate`
      | `reject`
      | `release-during-hook`
      | `release-after-publication`
      | `cleanup-during-hook`
      | `cleanup-after-publication`

    async function drainScheduledLifecycle(scheduler: Scheduler) {
      let quietTurns = 0
      while (quietTurns < 2) {
        if (scheduler.count() > 0) {
          quietTurns = 0
          await scheduler.waitAll()
        } else {
          quietTurns++
          await Promise.resolve()
        }
      }
    }

    async function expectScheduledLifecycleMatches(
      scheduler: Scheduler,
      secondOutcome: ScheduledSecondOutcome,
      expectedActionOrder?: ReadonlyArray<string>,
    ) {
      const harness = await startConcurrentLifecycleHarness(scheduler)
      const hookFailure = new Error(`scheduled hook failure`)
      const actionOrder: Array<string> = []
      let firstError: unknown
      let secondError: unknown

      const firstLoad = Promise.resolve(harness.loadSubset(harness.first))
        .then(() => undefined)
        .catch((error: unknown) => {
          firstError = error
        })
      let secondLoad: Promise<void> | undefined

      try {
        await vi.waitFor(() => expect(harness.hooks).toHaveLength(1))
        harness.hooks[0]!.resolve()
        await vi.waitFor(() => expect(harness.queuedLocks).toHaveLength(1))

        secondLoad = Promise.resolve(harness.loadSubset(harness.second))
          .then(() => undefined)
          .catch((error: unknown) => {
            secondError = error
          })
        await vi.waitFor(() => expect(harness.hooks).toHaveLength(2))

        const schedule = (label: string, action: () => void) => {
          void scheduler.schedule(Promise.resolve(), label).then(() => {
            actionOrder.push(label)
            action()
          })
        }
        const endsInRelease = secondOutcome.startsWith(`release-`)
        const endsInCleanup = secondOutcome.startsWith(`cleanup-`)
        const actsAfterPublication = secondOutcome.endsWith(`after-publication`)

        if (secondOutcome === `reject`) {
          schedule(`reject-second-hook`, () =>
            harness.hooks[1]!.reject(hookFailure),
          )
        } else {
          schedule(`resolve-second-hook`, () => harness.hooks[1]!.resolve())
          if (secondOutcome === `release-during-hook`) {
            schedule(`release-second-demand`, () =>
              harness.unloadSubset(harness.second),
            )
          } else if (secondOutcome === `cleanup-during-hook`) {
            schedule(`cleanup-sync`, () => harness.sync.cleanup?.())
          }
        }

        await scheduler.waitFor(Promise.all([firstLoad, secondLoad]))
        await drainScheduledLifecycle(scheduler)
        if (actsAfterPublication) {
          if (endsInRelease) {
            harness.unloadSubset(harness.second)
          } else {
            harness.sync.cleanup?.()
          }
          await drainScheduledLifecycle(scheduler)
        }

        if (expectedActionOrder) {
          expect(actionOrder).toEqual(expectedActionOrder)
        }

        expect(firstError).toBeUndefined()
        expect(secondError).toBe(
          secondOutcome === `reject` ? hookFailure : undefined,
        )
        expect(harness.hookCleanups[0]).toHaveBeenCalledTimes(
          endsInCleanup ? 1 : 0,
        )
        expect(harness.hookCleanups[1]).toHaveBeenCalledTimes(
          endsInRelease || endsInCleanup ? 1 : 0,
        )

        const liveTracking = harness.trackingHandles.filter(
          ({ dispose }) => dispose.mock.calls.length === 0,
        )
        if (endsInCleanup) {
          expect(liveTracking).toEqual([])
          return
        }

        expect(liveTracking).toHaveLength(1)
        for (const operation of [`INSERT`, `UPDATE`, `DELETE`] as const) {
          const finalClause = liveTracking[0]!.when[operation]
          expect(finalClause).toContain(`electronics`)
          if (secondOutcome === `activate`) {
            expect(finalClause).toContain(`clothing`)
          } else {
            expect(finalClause).not.toContain(`clothing`)
          }
        }
        if (secondOutcome === `reject`) {
          expect(
            harness.trackingHandles.every(({ when }) =>
              ([`INSERT`, `UPDATE`, `DELETE`] as const).every(
                (operation) => !when[operation].includes(`clothing`),
              ),
            ),
          ).toBe(true)
        }
      } finally {
        await harness.cleanup()
        if (scheduler.count() > 0) await scheduler.waitAll()
        await Promise.allSettled([firstLoad, secondLoad])
      }
    }

    it(`does not acquire a subset released while tracking startup is suspended`, async () => {
      const db = await createDatabase()
      const onLoadSubset = vi.fn()
      const createDiffTrigger = vi.spyOn(db.triggers, `createDiffTrigger`)
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write: vi.fn(),
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)

      if (!sync || typeof sync === `function` || !sync.loadSubset) {
        throw new Error(`Expected on-demand sync controls`)
      }

      const abortController = new AbortController()
      const request = {
        where: eq(`category`, `electronics`),
        signal: abortController.signal,
      }
      const load = sync.loadSubset(request)

      // Release the request before start() crosses its first async boundary.
      abortController.abort()
      sync.unloadSubset?.(request)

      try {
        await load

        expect(onLoadSubset).not.toHaveBeenCalled()
        expect(createDiffTrigger).not.toHaveBeenCalled()
      } finally {
        sync.cleanup?.()
      }
    })

    it.each([`reject`, `release`] as const)(
      `keeps an active rebuild current when a provisional hook will %s`,
      async (secondOutcome) => {
        const harness = await startConcurrentLifecycleHarness()
        const hookFailure = new Error(`second hook failed`)
        let firstSettled = false
        let secondLoad: Promise<void> | undefined

        try {
          const firstLoad = Promise.resolve(
            harness.loadSubset(harness.first),
          ).then(() => {
            firstSettled = true
          })
          await vi.waitFor(() => expect(harness.hooks).toHaveLength(1))
          harness.hooks[0]!.resolve()
          await vi.waitFor(() => expect(harness.queuedLocks).toHaveLength(1))

          secondLoad = Promise.resolve(harness.loadSubset(harness.second)).then(
            () => undefined,
          )
          await vi.waitFor(() => expect(harness.hooks).toHaveLength(2))

          await harness.queuedLocks[0]!()
          await new Promise((resolve) => setTimeout(resolve, 0))
          expect(firstSettled).toBe(true)
          expect(harness.createDiffTrigger).toHaveBeenCalledOnce()
          const when = harness.createDiffTrigger.mock.calls[0]?.[0].when
          expect(when?.INSERT).toContain(`electronics`)
          expect(when?.INSERT).not.toContain(`clothing`)

          if (secondOutcome === `reject`) {
            harness.hooks[1]!.reject(hookFailure)
            await expect(secondLoad).rejects.toBe(hookFailure)
          } else {
            harness.unloadSubset(harness.second)
            harness.hooks[1]!.resolve()
            await secondLoad
          }

          await firstLoad
          expect(harness.queuedLocks).toHaveLength(1)
          expect(harness.hookCleanups[1]).toHaveBeenCalledTimes(
            secondOutcome === `release` ? 1 : 0,
          )
        } finally {
          await harness.cleanup()
          await secondLoad?.catch(() => undefined)
        }
      },
    )

    it(`does not settle a superseded rebuild before its replacement publishes`, async () => {
      const harness = await startConcurrentLifecycleHarness()
      let firstSettled = false
      let secondSettled = false
      let firstLoad: Promise<void> | undefined
      let secondLoad: Promise<void> | undefined

      try {
        firstLoad = Promise.resolve(harness.loadSubset(harness.first)).then(
          () => {
            firstSettled = true
          },
        )
        await vi.waitFor(() => expect(harness.hooks).toHaveLength(1))
        harness.hooks[0]!.resolve()
        await vi.waitFor(() => expect(harness.queuedLocks).toHaveLength(1))

        secondLoad = Promise.resolve(harness.loadSubset(harness.second)).then(
          () => {
            secondSettled = true
          },
        )
        await vi.waitFor(() => expect(harness.hooks).toHaveLength(2))
        harness.hooks[1]!.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(secondSettled).toBe(false)

        await harness.queuedLocks[0]!()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(firstSettled).toBe(false)
        expect(secondSettled).toBe(false)
        expect(harness.createDiffTrigger).not.toHaveBeenCalled()

        await vi.waitFor(() => expect(harness.queuedLocks).toHaveLength(2))
        await harness.queuedLocks[1]!()
        await Promise.all([firstLoad, secondLoad])

        expect(harness.queuedLocks).toHaveLength(2)
        expect(harness.createDiffTrigger).toHaveBeenCalledOnce()
        const when = harness.createDiffTrigger.mock.calls[0]?.[0].when
        expect(when?.INSERT).toContain(`electronics`)
        expect(when?.INSERT).toContain(`clothing`)
      } finally {
        await harness.cleanup()
        await Promise.all([
          firstLoad?.catch(() => undefined),
          secondLoad?.catch(() => undefined),
        ])
      }
    })

    it(`disposes superseded tracking before its replacement starts`, async () => {
      const db = await createDatabase()
      const hooks: Array<ReturnType<typeof pDefer<void>>> = []
      const onLoadSubset = vi.fn(() => {
        const hook = pDefer<void>()
        hooks.push(hook)
        return hook.promise.then(() => vi.fn())
      })
      const queuedLocks = queueWriteLocks(db)
      vi.spyOn(db, `getAll`).mockResolvedValue([])

      const triggerStarted = pDefer<void>()
      const finishTrigger = pDefer<void>()
      const staleDispose = vi.fn(() => Promise.resolve())
      const currentDispose = vi.fn(() => Promise.resolve())
      const triggerClauses: Array<
        Record<`INSERT` | `UPDATE` | `DELETE`, string>
      > = []
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockImplementation(async ({ when }) => {
          triggerClauses.push(
            when as Record<`INSERT` | `UPDATE` | `DELETE`, string>,
          )
          if (triggerClauses.length === 1) {
            triggerStarted.resolve()
            await finishTrigger.promise
            return staleDispose
          }
          return currentDispose
        })

      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write: vi.fn(),
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      if (!sync || typeof sync === `function` || !sync.loadSubset) {
        throw new Error(`Expected on-demand sync controls`)
      }

      const first = { where: eq(`category`, `electronics`) }
      const second = { where: eq(`category`, `clothing`) }
      let firstLoad: Promise<void> | undefined
      let secondLoad: Promise<void> | undefined

      try {
        firstLoad = Promise.resolve(sync.loadSubset(first)).then(
          () => undefined,
        )
        await vi.waitFor(() => expect(hooks).toHaveLength(1))
        hooks[0]!.resolve()
        await vi.waitFor(() => expect(queuedLocks).toHaveLength(1))

        const staleRebuild = queuedLocks[0]!()
        await triggerStarted.promise

        secondLoad = Promise.resolve(sync.loadSubset(second)).then(
          () => undefined,
        )
        await vi.waitFor(() => expect(hooks).toHaveLength(2))
        hooks[1]!.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))

        finishTrigger.resolve()
        await staleRebuild

        expect(staleDispose).toHaveBeenCalledOnce()
        expect(createDiffTrigger).toHaveBeenCalledOnce()

        await vi.waitFor(() => expect(queuedLocks).toHaveLength(2))
        await queuedLocks[1]!()
        await Promise.all([firstLoad, secondLoad])

        expect(createDiffTrigger).toHaveBeenCalledTimes(2)
        expect(currentDispose).not.toHaveBeenCalled()
        for (const operation of [`INSERT`, `UPDATE`, `DELETE`] as const) {
          expect(triggerClauses[1]![operation]).toContain(`electronics`)
          expect(triggerClauses[1]![operation]).toContain(`clothing`)
        }
      } finally {
        hooks.forEach((hook) => hook.resolve())
        sync.cleanup?.()
        await Promise.all(queuedLocks.map((run) => run()))
        await Promise.allSettled([firstLoad, secondLoad])
      }
    })

    for (const secondOutcome of [
      `activate`,
      `reject`,
      `release-during-hook`,
      `release-after-publication`,
      `cleanup-during-hook`,
      `cleanup-after-publication`,
    ] as const) {
      fcTest.prop([fc.scheduler()], { numRuns: 8 })(
        `keeps tracking coherent when concurrent lifecycle tasks end in ${secondOutcome}`,
        async (scheduler) => {
          await expectScheduledLifecycleMatches(scheduler, secondOutcome)
        },
      )
    }

    it.each([
      {
        name: `release before hook resolution`,
        outcome: `release-during-hook` as const,
        order: [3, 2, 1],
        expectedActionOrder: [`release-second-demand`, `resolve-second-hook`],
      },
      {
        name: `hook resolution before release`,
        outcome: `release-during-hook` as const,
        order: [2, 3, 1, 4],
        expectedActionOrder: [`resolve-second-hook`, `release-second-demand`],
      },
      {
        name: `cleanup before hook resolution`,
        outcome: `cleanup-during-hook` as const,
        order: [3, 2, 1],
        expectedActionOrder: [`cleanup-sync`, `resolve-second-hook`],
      },
      {
        name: `hook resolution before cleanup`,
        outcome: `cleanup-during-hook` as const,
        order: [2, 3, 1],
        expectedActionOrder: [`resolve-second-hook`, `cleanup-sync`],
      },
    ])(
      `keeps tracking coherent when $name`,
      async ({ outcome, order, expectedActionOrder }) => {
        await expectScheduledLifecycleMatches(
          fc.schedulerFor(order),
          outcome,
          expectedActionOrder,
        )
      },
    )

    it.each([
      {
        name: `the stopped callback runs before the restarted callback`,
        order: [1, 2],
        expectedInvocationOrder: [`write-lock-1`, `write-lock-2`],
      },
      {
        name: `the restarted callback runs before the stopped callback`,
        order: [2, 1],
        expectedInvocationOrder: [`write-lock-2`, `write-lock-1`],
      },
    ])(
      `keeps a restarted sync isolated when $name`,
      async ({ order, expectedInvocationOrder }) => {
        const scheduler = fc.schedulerFor(order)
        const db = await createDatabase()
        const invocationOrder: Array<string> = []
        queueWriteLocks(db, scheduler, invocationOrder)
        vi.spyOn(db, `getAll`).mockResolvedValue([])

        const hookCleanups: Array<ReturnType<typeof vi.fn>> = []
        const onLoadSubset = vi.fn(() => {
          const cleanup = vi.fn()
          hookCleanups.push(cleanup)
          return cleanup
        })
        const trackingHandles: Array<{
          when: Record<`INSERT` | `UPDATE` | `DELETE`, string>
          dispose: ReturnType<typeof vi.fn>
        }> = []
        const createDiffTrigger = vi
          .spyOn(db.triggers, `createDiffTrigger`)
          .mockImplementation(({ when }) => {
            const dispose = vi.fn(() => Promise.resolve())
            trackingHandles.push({
              when: when as Record<`INSERT` | `UPDATE` | `DELETE`, string>,
              dispose,
            })
            return Promise.resolve(dispose)
          })
        const config = powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
          onLoadSubset,
        })
        const startSync = () => {
          const started = config.sync.sync({
            collection: { status: `ready`, has: () => false },
            begin: vi.fn(),
            write: vi.fn(),
            commit: () => true,
            markReady: vi.fn(),
            markError: vi.fn(),
            truncate: vi.fn(),
          } as never)
          if (
            !started ||
            typeof started === `function` ||
            !started.loadSubset
          ) {
            throw new Error(`Expected on-demand sync controls`)
          }
          return started
        }

        const stoppedSync = startSync()
        let stoppedSettled = false
        let restartedSettled = false
        const stoppedLoad = Promise.resolve(
          stoppedSync.loadSubset!({
            where: eq(`category`, `electronics`),
          }),
        ).then(() => {
          stoppedSettled = true
        })
        let restartedSync: ReturnType<typeof startSync> | undefined
        let restartedLoad: Promise<void> | undefined
        let restartedCleaned = false
        let usingFakeTimers = false

        try {
          await vi.waitFor(() => expect(scheduler.count()).toBe(1))
          stoppedSync.cleanup?.()

          restartedSync = startSync()
          restartedLoad = Promise.resolve(
            restartedSync.loadSubset!({
              where: eq(`category`, `clothing`),
            }),
          ).then(() => {
            restartedSettled = true
          })
          await vi.waitFor(() => expect(scheduler.count()).toBe(2))
          expect(stoppedSettled).toBe(false)
          expect(restartedSettled).toBe(false)

          await scheduler.waitOne()
          const stoppedRunsFirst = order[0] === 1
          await vi.waitFor(() => {
            expect(stoppedSettled).toBe(stoppedRunsFirst)
            expect(restartedSettled).toBe(!stoppedRunsFirst)
          })

          await scheduler.waitFor(Promise.all([stoppedLoad, restartedLoad]))
          await drainScheduledLifecycle(scheduler)

          expect(invocationOrder).toEqual(expectedInvocationOrder)
          expect(hookCleanups[0]).toHaveBeenCalledOnce()
          expect(hookCleanups[1]).not.toHaveBeenCalled()
          expect(createDiffTrigger).toHaveBeenCalledOnce()
          expect(trackingHandles).toHaveLength(1)
          expect(trackingHandles[0]!.dispose).not.toHaveBeenCalled()
          for (const operation of [`INSERT`, `UPDATE`, `DELETE`] as const) {
            expect(trackingHandles[0]!.when[operation]).toContain(`clothing`)
            expect(trackingHandles[0]!.when[operation]).not.toContain(
              `electronics`,
            )
          }

          vi.useFakeTimers()
          usingFakeTimers = true
          restartedSync.cleanup?.()
          restartedSync.cleanup?.()
          restartedCleaned = true
          await vi.runAllTimersAsync()
          expect(hookCleanups[1]).toHaveBeenCalledOnce()
          expect(trackingHandles[0]!.dispose).toHaveBeenCalledOnce()
          vi.useRealTimers()
          usingFakeTimers = false
        } finally {
          if (usingFakeTimers) vi.useRealTimers()
          stoppedSync.cleanup?.()
          if (!restartedCleaned) restartedSync?.cleanup?.()
          if (scheduler.count() > 0) await scheduler.waitAll()
          await Promise.allSettled([stoppedLoad, restartedLoad])
        }
      },
    )

    it(`does not start queued tracking after collection cleanup`, async () => {
      const db = await createDatabase()
      const queued = pDefer<void>()
      let runQueuedWriteLock!: () => Promise<void>
      vi.spyOn(db, `writeLock`).mockImplementation(
        (callback) =>
          new Promise((resolve, reject) => {
            runQueuedWriteLock = async () => {
              try {
                await callback({} as never)
                resolve(undefined as never)
              } catch (error) {
                reject(error)
              }
            }
            queued.resolve()
          }) as never,
      )
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockResolvedValue(vi.fn())
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write: vi.fn(),
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      if (!sync || typeof sync === `function` || !sync.loadSubset) {
        throw new Error(`Expected on-demand sync controls`)
      }

      const load = sync.loadSubset({ where: eq(`category`, `electronics`) })
      await queued.promise
      sync.cleanup?.()
      await runQueuedWriteLock()
      await load

      expect(createDiffTrigger).not.toHaveBeenCalled()
    })

    it(`does not retain a predicate whose load hook rejects`, async () => {
      const db = await createDatabase()
      const hookFailure = new Error(`subset hook failed`)
      const onLoadSubset = vi
        .fn()
        .mockRejectedValueOnce(hookFailure)
        .mockResolvedValueOnce(undefined)
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockResolvedValue(vi.fn())
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write: vi.fn(),
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      if (!sync || typeof sync === `function` || !sync.loadSubset) {
        throw new Error(`Expected on-demand sync controls`)
      }

      try {
        await expect(
          sync.loadSubset({ where: eq(`category`, `electronics`) }),
        ).rejects.toBe(hookFailure)
        await sync.loadSubset({ where: eq(`category`, `clothing`) })

        const when = createDiffTrigger.mock.calls.at(-1)?.[0].when
        expect(when?.INSERT).toContain(`clothing`)
        expect(when?.INSERT).not.toContain(`electronics`)
      } finally {
        sync.cleanup?.()
      }
    })

    it(`does not publish a provisional hook through another active demand`, async () => {
      const db = await createDatabase()
      const firstHook = pDefer<void>()
      const onLoadSubset = vi
        .fn()
        .mockReturnValueOnce(firstHook.promise)
        .mockResolvedValueOnce(undefined)
      const createDiffTrigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockResolvedValue(vi.fn())
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write: vi.fn(),
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      if (!sync || typeof sync === `function` || !sync.loadSubset) {
        throw new Error(`Expected on-demand sync controls`)
      }

      const provisional = sync.loadSubset({
        where: eq(`category`, `electronics`),
      })
      await vi.waitFor(() => expect(onLoadSubset).toHaveBeenCalledTimes(1))
      await sync.loadSubset({ where: eq(`category`, `clothing`) })

      const when = createDiffTrigger.mock.calls.at(-1)?.[0].when
      expect(when?.INSERT).toContain(`clothing`)
      expect(when?.INSERT).not.toContain(`electronics`)

      firstHook.resolve()
      await provisional
      sync.cleanup?.()
    })

    it(`hands subset release to the adapter without returning a promise`, async () => {
      const db = await createDatabase()
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(vi.fn())
      vi.spyOn(db, `getAll`).mockResolvedValue([])
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write: vi.fn(),
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      if (
        !sync ||
        typeof sync === `function` ||
        !sync.loadSubset ||
        !sync.unloadSubset
      ) {
        throw new Error(`Expected on-demand sync controls`)
      }
      const request = { where: eq(`category`, `electronics`) }

      await sync.loadSubset(request)
      const release = (
        sync.unloadSubset as (options: typeof request) => unknown
      )(request)
      try {
        expect(release).toBeUndefined()
      } finally {
        await Promise.resolve(release)
        sync.cleanup?.()
      }
    })

    it(`retries physical subset release after asynchronous adapter failure`, async () => {
      vi.useFakeTimers()
      const db = await createDatabase()
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(vi.fn())
      const getAll = vi
        .spyOn(db, `getAll`)
        .mockRejectedValueOnce(new Error(`transient eviction failure`))
        .mockResolvedValueOnce([])
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write: vi.fn(),
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      if (
        !sync ||
        typeof sync === `function` ||
        !sync.loadSubset ||
        !sync.unloadSubset
      ) {
        throw new Error(`Expected on-demand sync controls`)
      }
      const request = { where: eq(`category`, `electronics`) }

      try {
        await sync.loadSubset(request)
        expect(sync.unloadSubset(request)).toBeUndefined()
        await vi.waitFor(() => expect(getAll).toHaveBeenCalledTimes(1))

        await vi.advanceTimersByTimeAsync(1000)
        await vi.waitFor(() => expect(getAll).toHaveBeenCalledTimes(2))
      } finally {
        sync.cleanup?.()
        await vi.runOnlyPendingTimersAsync()
        vi.useRealTimers()
      }
    })

    it(`recomputes eviction when another demand activates during release`, async () => {
      const db = await createDatabase()
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(vi.fn())
      const firstEviction = pDefer<Array<{ id: string }>>()
      const getAll = vi
        .spyOn(db, `getAll`)
        .mockReturnValueOnce(firstEviction.promise)
        .mockResolvedValueOnce([])
      const write = vi.fn()
      const config = powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
      })
      const sync = config.sync.sync({
        collection: { status: `ready`, has: () => false },
        begin: vi.fn(),
        write,
        commit: () => true,
        markReady: vi.fn(),
        markError: vi.fn(),
        truncate: vi.fn(),
      } as never)
      if (
        !sync ||
        typeof sync === `function` ||
        !sync.loadSubset ||
        !sync.unloadSubset
      ) {
        throw new Error(`Expected on-demand sync controls`)
      }
      const departing = { where: eq(`category`, `electronics`) }

      try {
        await sync.loadSubset(departing)
        sync.unloadSubset(departing)
        await vi.waitFor(() => expect(getAll).toHaveBeenCalledTimes(1))

        await sync.loadSubset({ where: eq(`category`, `clothing`) })
        firstEviction.resolve([{ id: `row-now-owned-by-clothing` }])

        await vi.waitFor(() => expect(getAll).toHaveBeenCalledTimes(2))
        expect(write).not.toHaveBeenCalledWith({
          type: `delete`,
          key: `row-now-owned-by-clothing`,
        })
      } finally {
        firstEviction.resolve([])
        sync.cleanup?.()
      }
    })

    it(`flushes eager changes that arrive before the tracking handle is published`, async () => {
      const db = await createDatabase()
      await createTestProducts(db)

      let flushTrackingChanges:
        | ((event: { changedTables: Array<string> }) => Promise<void> | void)
        | undefined
      vi.spyOn(db, `onChangeWithCallback`).mockImplementation((handler) => {
        flushTrackingChanges = handler?.onChange
        return () => {}
      })

      const triggerCreated = pDefer<void>()
      const publishTrackingHandle = pDefer<void>()
      const createDiffTrigger = db.triggers.createDiffTrigger.bind(db.triggers)
      vi.spyOn(db.triggers, `createDiffTrigger`).mockImplementation(
        async (options) => {
          const dispose = await createDiffTrigger(options)
          triggerCreated.resolve()
          await publishTrackingHandle.promise
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

      expect(flushTrackingChanges).toBeDefined()
      const flush = Promise.resolve(
        flushTrackingChanges!({
          changedTables: [collection.utils.getMeta().trackedTableName],
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))

      publishTrackingHandle.resolve()
      await Promise.all([flush, collection.stateWhenReady()])

      expect(collection.get(`during-startup`)?.name).toBe(`During startup`)
    })

    it(`does not create tracking when change observation fails to start`, async () => {
      const db = await createDatabase()
      const startupError = new Error(`change observation failed`)
      vi.spyOn(db.logger, `error`).mockImplementation(() => {})
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      onTestFinished(() => consoleError.mockRestore())
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

    it(`disposes tracking that finishes starting during collection cleanup`, async () => {
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

      await vi.waitFor(() => {
        expect(dispose).toHaveBeenCalledTimes(1)
      })
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
