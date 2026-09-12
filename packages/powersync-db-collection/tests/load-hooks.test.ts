import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import pDefer from 'p-defer'
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

    try {
      await collection.stateWhenReady()
      expect(onLoadMock).toHaveBeenCalledOnce()
      expect(onUnloadMock).not.toHaveBeenCalled()
      await collection.cleanup()
      expect(onUnloadMock).toHaveBeenCalledOnce()
    } finally {
      await collection.cleanup()
    }
  })

  it(`eager mode: reports an initial load failure`, async () => {
    const db = await createDatabase()
    const initialError = new Error(`initial PowerSync load failed`)
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        onLoad: () => Promise.reject(initialError),
      }),
    )
    try {
      await expect(collection.preload()).rejects.toBe(initialError)
      expect(collection.status).toBe(`error`)
    } finally {
      await collection.cleanup()
    }
  })

  it(`eager mode: releases a load hook that resolves after cleanup`, async () => {
    const db = await createDatabase()
    const releaseLoad = pDefer<void>()
    const loadStarted = pDefer<void>()
    const cleanupLoad = vi.fn()
    const createDiffTrigger = vi
      .spyOn(db.triggers, `createDiffTrigger`)
      .mockResolvedValue(async () => {})
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        onLoad: async () => {
          loadStarted.resolve()
          await releaseLoad.promise
          return cleanupLoad
        },
      }),
    )

    const outcome = collection.preload().then(
      () => ({ status: `fulfilled` as const }),
      (error: unknown) => ({ status: `rejected` as const, error }),
    )
    try {
      await loadStarted.promise
      await collection.cleanup()
      expect(await outcome).toMatchObject({
        status: `rejected`,
        error: { name: `AbortError` },
      })
      releaseLoad.resolve()
      await vi.waitFor(() => expect(cleanupLoad).toHaveBeenCalledOnce())
      expect(createDiffTrigger).not.toHaveBeenCalled()
    } finally {
      releaseLoad.resolve()
      await collection.cleanup()
      await outcome
      await vi.waitFor(() => expect(cleanupLoad).toHaveBeenCalledOnce())
      createDiffTrigger.mockRestore()
    }
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
    const cleanups: Array<() => Promise<void>> = []
    try {
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
      cleanups.push(() => electronicsQuery.cleanup())

      await electronicsQuery.preload()

      await vi.waitFor(
        () => {
          expect(electronicsQuery.size).toBe(3)
        },
        { timeout: 2000 },
      )

      expect(onLoadSubsetMock).toHaveBeenCalledTimes(1)
      expect(onUnloadSubsetMock).not.toHaveBeenCalled()
      expect(
        electronicsQuery.toArray
          .map(({ name, price, category }) => ({ name, price, category }))
          .sort((a, b) => a.name!.localeCompare(b.name!)),
      ).toEqual([
        { name: `Product A`, price: 50, category: `electronics` },
        { name: `Product B`, price: 150, category: `electronics` },
        { name: `Product D`, price: 200, category: `electronics` },
      ])

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
      cleanups.push(() => clothingQuery.cleanup())

      await clothingQuery.preload()

      await vi.waitFor(
        () => {
          expect(clothingQuery.size).toBe(2)
        },
        { timeout: 2000 },
      )

      expect(onLoadSubsetMock).toHaveBeenCalledTimes(2)
      expect(onUnloadSubsetMock).not.toHaveBeenCalled()
      expect(
        clothingQuery.toArray
          .map(({ name, price, category }) => ({ name, price, category }))
          .sort((a, b) => a.name!.localeCompare(b.name!)),
      ).toEqual([
        { name: `Product C`, price: 25, category: `clothing` },
        { name: `Product E`, price: 75, category: `clothing` },
      ])

      // Cleanup LQ1 — should trigger first unload
      await electronicsQuery.cleanup()

      await vi.waitFor(
        () => {
          expect(onUnloadSubsetMock).toHaveBeenCalledTimes(1)
          expect(unloadedRequests).toEqual([1])
        },
        { timeout: 2000 },
      )

      // Cleanup LQ2 — should trigger second unload
      await clothingQuery.cleanup()

      await vi.waitFor(
        () => {
          expect(onUnloadSubsetMock).toHaveBeenCalledTimes(2)
          expect(unloadedRequests).toEqual([1, 2])
        },
        { timeout: 2000 },
      )
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup()
      await collection.cleanup()
    }
  })

  it(`disposes a subset hook that resolves after collection cleanup`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)
    const hook = pDefer<() => void>()
    const hookEntered = pDefer<void>()
    const cleanupHook = vi.fn()
    const createDiffTrigger = vi.spyOn(db.triggers, `createDiffTrigger`)

    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset: () => {
          hookEntered.resolve()
          return hook.promise
        },
      }),
    )
    await collection.stateWhenReady().catch(async (error: unknown) => {
      await collection.cleanup()
      createDiffTrigger.mockRestore()
      throw error
    })
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
    const publications: Array<unknown> = []
    const subscription = query.subscribeChanges((changes) => {
      publications.push(
        changes.map(({ type, key, value }) => ({
          type,
          key,
          value: { ...value },
        })),
      )
    })
    const preload = query.preload().then(
      () => ({ status: `fulfilled` as const }),
      (error: unknown) => ({ status: `rejected` as const, error }),
    )
    const reports = vi.spyOn(console, `error`).mockImplementation(() => {})
    const unexpected: Array<unknown> = []
    const recordUnhandled = (error: unknown) => unexpected.push(error)
    process.on(`unhandledRejection`, recordUnhandled)
    const message =
      `Source collection '${collection.id}' was manually cleaned up while live query '${query.id}' depends on it. ` +
      `Live queries prevent automatic GC, so this was likely a manual cleanup() call.`
    try {
      await hookEntered.promise
      expect(cleanupHook).not.toHaveBeenCalled()
      expect(createDiffTrigger).not.toHaveBeenCalled()
      expect(query.status).toBe(`loading`)
      await collection.cleanup()
      const expected = { status: `rejected`, error: new Error(message) }
      expect(await preload).toEqual(expected)
      hook.resolve(cleanupHook)
      await vi.waitFor(() => expect(cleanupHook).toHaveBeenCalledOnce())
      expect(createDiffTrigger).not.toHaveBeenCalled()
      expect(collection.status).toBe(`cleaned-up`)
      expect(query.status).toBe(`error`)
      expect(query.toArray).toEqual([])
      expect(collection.size).toBe(0)
      expect(publications.flat()).toEqual([])
      expect(await preload).toEqual(expected)
      expect(reports.mock.calls).toEqual([[`[Live Query Error] ${message}`]])
    } finally {
      try {
        hook.resolve(cleanupHook)
        subscription.unsubscribe()
        await query.cleanup()
        await collection.cleanup()
        await preload
        await vi.waitFor(() => expect(cleanupHook).toHaveBeenCalledOnce())
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(reports.mock.calls).toEqual([[`[Live Query Error] ${message}`]])
        expect(unexpected).toEqual([])
      } finally {
        process.off(`unhandledRejection`, recordUnhandled)
        reports.mockRestore()
        createDiffTrigger.mockRestore()
      }
    }
  })
})
