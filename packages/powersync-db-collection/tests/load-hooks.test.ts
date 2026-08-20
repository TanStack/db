import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'

const APP_SCHEMA = new Schema({
  products: new Table({
    name: column.text,
    price: column.integer,
    category: column.text,
  }),
})

describe(`Sync Streams`, () => {
  async function createDatabase() {
    const db = new PowerSyncDatabase({
      database: {
        dbFilename: `test-sync-streams-${randomUUID()}.sqlite`,
        dbLocation: tmpdir(),
        implementation: { type: `node:sqlite` },
      },
      schema: APP_SCHEMA,
    })
    onTestFinished(async () => {
      await db.disconnectAndClear()
      await new Promise((resolve) => setTimeout(resolve, 100))
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

  it(`eager mode: should call onLoad on sync start and onUnload on cleanup`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    const onLoadMock = vi.fn()
    const onUnloadMock = vi.fn()

    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        onLoad: async () => {
          await onLoadMock()

          return () => {
            onUnloadMock()
          }
        },
      }),
    )

    await collection.stateWhenReady()

    expect(onLoadMock).toHaveBeenCalledOnce()
    expect(onUnloadMock).not.toHaveBeenCalled()

    collection.cleanup()

    expect(onUnloadMock).toHaveBeenCalledOnce()
  })

  it(`on-demand mode: should call onLoadSubset/onUnloadSubset for each live query`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)

    const onLoadSubsetMock = vi.fn()
    const onUnloadSubsetMock = vi.fn()
    const unloadedRequests: Array<number> = []
    let nextRequest = 0

    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset: () => {
          onLoadSubsetMock()
          nextRequest += 1
          const request = nextRequest

          return () => {
            onUnloadSubsetMock()
            unloadedRequests.push(request)
          }
        },
      }),
    )
    onTestFinished(() => collection.cleanup())

    await collection.stateWhenReady()

    // LQ1: electronics
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

    expect(onLoadSubsetMock).toHaveBeenCalledTimes(1)
    expect(onUnloadSubsetMock).not.toHaveBeenCalled()

    // LQ2: clothing
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

    expect(onLoadSubsetMock).toHaveBeenCalledTimes(2)
    expect(onUnloadSubsetMock).not.toHaveBeenCalled()

    // Cleanup LQ1 — should trigger first unload
    electronicsQuery.cleanup()

    await vi.waitFor(
      () => {
        expect(onUnloadSubsetMock).toHaveBeenCalledTimes(1)
        expect(unloadedRequests).toEqual([1])
      },
      { timeout: 2000 },
    )

    // Cleanup LQ2 — should trigger second unload
    clothingQuery.cleanup()

    await vi.waitFor(
      () => {
        expect(onUnloadSubsetMock).toHaveBeenCalledTimes(2)
        expect(unloadedRequests).toEqual([1, 2])
      },
      { timeout: 2000 },
    )
  })

  it(`disposes a subset hook that resolves after collection cleanup`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)
    let resolveHook!: (cleanup: () => void) => void
    const hook = new Promise<() => void>((resolve) => {
      resolveHook = resolve
    })
    const cleanupHook = vi.fn()

    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset: () => hook,
      }),
    )
    await collection.stateWhenReady()
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
    const preload = query.preload()
    void preload.catch(() => {})

    await vi.waitFor(() => expect(resolveHook).toBeTypeOf(`function`))
    const collectionCleanup = collection.cleanup()
    resolveHook(cleanupHook)
    await collectionCleanup

    await vi.waitFor(() => expect(cleanupHook).toHaveBeenCalledOnce())
    await query.cleanup()
  })
})
