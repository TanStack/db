import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { LogLevels } from '@powersync/common'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import pDefer from 'p-defer'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'
import { withTestCleanup } from './with-test-cleanup'

const APP_SCHEMA = new Schema({
  products: new Table({
    name: column.text,
    price: column.integer,
    category: column.text,
  }),
})

it.each([new Error(`primary mismatch`), undefined])(
  `preserves a primary failure and attempts every resource cleanup (%s)`,
  async (primary) => {
    const secondary = new Error(`cleanup failure`)
    const attempted: Array<string> = []
    const outcome = await withTestCleanup(() => {
      throw primary
    }, [
      () => {
        attempted.push(`first`)
        throw secondary
      },
      async () => {
        attempted.push(`second`)
        await Promise.reject(secondary)
      },
      () => {
        attempted.push(`last`)
      },
    ]).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(attempted).toEqual([`first`, `second`, `last`])
    expect(outcome).toBeInstanceOf(AggregateError)
    expect((outcome as AggregateError).cause).toBe(primary)
    expect((outcome as AggregateError).errors).toEqual([
      primary,
      secondary,
      secondary,
    ])
  },
)

it(`preserves a lone failure and permits successful teardown`, async () => {
  const sentinel = new Error(`only failure`)
  await expect(
    withTestCleanup(() => {
      throw sentinel
    }, [() => {}]),
  ).rejects.toBe(sentinel)
  await expect(
    withTestCleanup(() => {}, [
      () => {
        throw sentinel
      },
    ]),
  ).rejects.toBe(sentinel)
  await expect(withTestCleanup(() => {}, [() => {}])).resolves.toBeUndefined()
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
    const unloaded: Array<string> = []

    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        onLoad: async () => {
          await onLoadMock()

          return () => {
            onUnloadMock()
            return unloaded.push(`done`)
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
      expect(unloaded).toEqual([`done`])
    } finally {
      await collection.cleanup()
    }
  })

  it.each([`fulfill`, `reject`] as const)(
    `eager mode: awaits asynchronous hook cleanup: %s`,
    async (outcome) => {
      const db = await createDatabase()
      const cleanupGate = pDefer<void>()
      const cleanupError = new Error(`eager hook cleanup failed`)
      const cleanupHook = vi.fn(() =>
        cleanupGate.promise.then(() => {
          if (outcome === `reject`) throw cleanupError
        }),
      )
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          onLoad: () => cleanupHook,
        }),
      )

      try {
        await collection.stateWhenReady()
        let cleanupSettled = false
        const cleanupOutcome = collection.cleanup().then(
          () => {
            cleanupSettled = true
            return { status: `fulfilled` as const }
          },
          (error: unknown) => {
            cleanupSettled = true
            return { status: `rejected` as const, error }
          },
        )
        await Promise.resolve()

        expect(cleanupHook).toHaveBeenCalledOnce()
        expect(cleanupSettled).toBe(false)
        expect(collection.status).toBe(`ready`)

        cleanupGate.resolve()
        const cleanupResult = await cleanupOutcome
        if (outcome === `reject`) {
          expect(cleanupResult).toMatchObject({
            status: `rejected`,
            error: { name: `SyncCleanupError`, cause: cleanupError },
          })
        } else {
          expect(cleanupResult).toEqual({ status: `fulfilled` })
        }
        expect(collection.status).toBe(`cleaned-up`)
      } finally {
        cleanupGate.resolve()
        await collection.cleanup()
      }
    },
  )

  it.each([`fulfill`, `reject`] as const)(
    `eager mode: awaits asynchronous trigger disposal: %s`,
    async (outcome) => {
      const db = await createDatabase()
      const disposeGate = pDefer<void>()
      const disposeError = new Error(`eager trigger disposal failed`)
      const disposeTracking = vi.fn(() =>
        disposeGate.promise.then(() => {
          if (outcome === `reject`) throw disposeError
        }),
      )
      vi.spyOn(db.triggers, `createDiffTrigger`).mockResolvedValue(
        disposeTracking,
      )
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
        }),
      )
      const unhandled: Array<unknown> = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, onUnhandled)

      try {
        await collection.stateWhenReady()
        let cleanupSettled = false
        const cleanupOutcome = collection.cleanup().then(
          () => {
            cleanupSettled = true
            return { status: `fulfilled` as const }
          },
          (error: unknown) => {
            cleanupSettled = true
            return { status: `rejected` as const, error }
          },
        )

        // Abort and local disposer ownership transfer remain same-stack.
        expect(disposeTracking).toHaveBeenCalledOnce()
        await new Promise((resolve) => setImmediate(resolve))
        expect(cleanupSettled).toBe(false)
        expect(collection.status).toBe(`ready`)

        disposeGate.resolve()
        const cleanupResult = await cleanupOutcome
        if (outcome === `reject`) {
          expect(cleanupResult).toMatchObject({
            status: `rejected`,
            error: { name: `SyncCleanupError`, cause: disposeError },
          })
        } else {
          expect(cleanupResult).toEqual({ status: `fulfilled` })
        }
        await new Promise((resolve) => setImmediate(resolve))
        expect(unhandled).toEqual([])
        expect(collection.status).toBe(`cleaned-up`)
        expect(disposeTracking).toHaveBeenCalledOnce()
      } finally {
        disposeGate.resolve()
        process.removeListener(`unhandledRejection`, onUnhandled)
        await collection.cleanup()
      }
    },
  )

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
    const releaseCleanup = pDefer<void>()
    const loadStarted = pDefer<void>()
    const cleanupLoad = vi.fn(() => releaseCleanup.promise)
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
    let cleanupSettled = false
    try {
      await loadStarted.promise
      const cleanup = collection.cleanup().then(() => {
        cleanupSettled = true
      })
      await Promise.resolve()
      expect(cleanupSettled).toBe(false)
      expect(await outcome).toMatchObject({
        status: `rejected`,
        error: { name: `AbortError` },
      })
      releaseLoad.resolve()
      await vi.waitFor(() => expect(cleanupLoad).toHaveBeenCalledOnce())
      expect(cleanupSettled).toBe(false)
      expect(createDiffTrigger).not.toHaveBeenCalled()
      releaseCleanup.resolve()
      await cleanup
      expect(cleanupSettled).toBe(true)
    } finally {
      releaseLoad.resolve()
      releaseCleanup.resolve()
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

  it.each([`fulfill`, `reject`, `throw`] as const)(
    `on-demand mode: settles acquired hook cleanup with collection cleanup: %s`,
    async (outcome) => {
      const db = await createDatabase()
      await createTestProducts(db)
      const cleanupGate = pDefer<void>()
      const cleanupError = new Error(`on-demand hook cleanup failed`)
      const cleanupHook = vi.fn(() => {
        if (outcome === `throw`) throw cleanupError
        return cleanupGate.promise.then(() => {
          if (outcome === `reject`) throw cleanupError
        })
      })
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: db,
          table: APP_SCHEMA.props.products,
          syncMode: `on-demand`,
          onLoadSubset: () => cleanupHook,
        }),
      )
      const query = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, `electronics`)),
      })
      const unhandled: Array<unknown> = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, onUnhandled)

      try {
        await query.preload()
        let cleanupSettled = false
        const cleanupOutcome = collection.cleanup().then(
          () => {
            cleanupSettled = true
            return { status: `fulfilled` as const }
          },
          (error: unknown) => {
            cleanupSettled = true
            return { status: `rejected` as const, error }
          },
        )

        expect(cleanupHook).toHaveBeenCalledOnce()
        if (outcome !== `throw`) {
          await new Promise((resolve) => setImmediate(resolve))
          const settledBeforeRelease = cleanupSettled
          cleanupGate.resolve()
          const cleanupResult = await cleanupOutcome
          expect(settledBeforeRelease).toBe(false)
          if (outcome === `reject`) {
            expect(cleanupResult).toMatchObject({
              status: `rejected`,
              error: { name: `SyncCleanupError`, cause: cleanupError },
            })
          } else {
            expect(cleanupResult).toEqual({ status: `fulfilled` })
          }
        } else {
          expect(await cleanupOutcome).toMatchObject({
            status: `rejected`,
            error: { name: `SyncCleanupError`, cause: cleanupError },
          })
        }
        await new Promise((resolve) => setImmediate(resolve))
        expect(unhandled).toEqual([])
        expect(collection.status).toBe(`cleaned-up`)
        expect(cleanupHook).toHaveBeenCalledOnce()
      } finally {
        cleanupGate.resolve()
        process.removeListener(`unhandledRejection`, onUnhandled)
        await query.cleanup()
        await collection.cleanup()
      }
    },
  )

  it(`on-demand mode: classifies acquired cleanup by its runtime promise shape`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)
    const hiddenPromiseGate = pDefer<void>()
    const calls: Array<string> = []
    const incidentalCleanup = () => calls.push(`incidental`)
    const hiddenPromiseCleanup: () => void = async () => {
      calls.push(`hidden-promise`)
      await hiddenPromiseGate.promise
    }
    let acquisition = 0
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset: () =>
          acquisition++ === 0 ? incidentalCleanup : hiddenPromiseCleanup,
      }),
    )
    const categoryQuery = (category: string) =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, category)),
      })
    const firstQuery = categoryQuery(`electronics`)
    const secondQuery = categoryQuery(`clothing`)

    try {
      await firstQuery.preload()
      await secondQuery.preload()
      let settled = false
      const cleanup = collection.cleanup().then(() => {
        settled = true
      })

      expect(calls).toEqual([`incidental`, `hidden-promise`])
      await new Promise((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)

      hiddenPromiseGate.resolve()
      await cleanup
      expect(settled).toBe(true)
    } finally {
      hiddenPromiseGate.resolve()
      await firstQuery.cleanup()
      await secondQuery.cleanup()
      await collection.cleanup()
    }
  })

  it(`on-demand mode: awaits every acquired hook once during reentrant cleanup`, async () => {
    const db = await createDatabase()
    await createTestProducts(db)
    const firstGate = pDefer<void>()
    const secondGate = pDefer<void>()
    let nestedCleanup: Promise<void> | undefined
    const firstCleanup = vi.fn(() => {
      nestedCleanup = collection.cleanup()
      return firstGate.promise
    })
    const secondCleanup = vi.fn(() => secondGate.promise)
    let acquisition = 0
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        syncMode: `on-demand`,
        onLoadSubset: () =>
          acquisition++ === 0 ? firstCleanup : secondCleanup,
      }),
    )
    const categoryQuery = (category: string) =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ product: collection })
            .where(({ product }) => eq(product.category, category)),
      })
    const firstQuery = categoryQuery(`electronics`)
    const secondQuery = categoryQuery(`clothing`)

    try {
      await firstQuery.preload()
      await secondQuery.preload()
      const cleanup = collection.cleanup()

      expect(nestedCleanup).toBe(cleanup)
      expect(firstCleanup).toHaveBeenCalledOnce()
      expect(secondCleanup).toHaveBeenCalledOnce()
      let settled = false
      void cleanup.then(() => {
        settled = true
      })
      secondGate.resolve()
      await new Promise((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)

      firstGate.resolve()
      await cleanup
      expect(settled).toBe(true)
      expect(firstCleanup).toHaveBeenCalledOnce()
      expect(secondCleanup).toHaveBeenCalledOnce()
    } finally {
      firstGate.resolve()
      secondGate.resolve()
      await firstQuery.cleanup()
      await secondQuery.cleanup()
      await collection.cleanup()
    }
  })

  it.each([`fulfill`, `reject`, `throw`] as const)(
    `disposes a subset hook that resolves after collection cleanup: %s`,
    async (outcome) => {
      const db = await createDatabase()
      await createTestProducts(db)
      const hook = pDefer<() => void>()
      const hookEntered = pDefer<void>()
      const cleanupFailure = new Error(`late subset cleanup failed`)
      const cleanupHook = vi.fn(() => {
        if (outcome === `throw`) throw cleanupFailure
        if (outcome === `reject`) return Promise.reject(cleanupFailure)
        return undefined
      })
      const createDiffTrigger = vi.spyOn(db.triggers, `createDiffTrigger`)
      const cleanupReports = vi.spyOn(db.logger, `log`)

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
      const expectedReports: Array<Array<unknown>> = [
        [`[Live Query Error] ${message}`],
      ]
      if (outcome !== `fulfill`) {
        expectedReports.push([
          `[PowerSync]: Could not clean up subset hook for products`,
          cleanupFailure,
        ])
      }
      await withTestCleanup(async () => {
        await hookEntered.promise
        expect(cleanupHook).not.toHaveBeenCalled()
        expect(createDiffTrigger).not.toHaveBeenCalled()
        expect(query.status).toBe(`loading`)
        await collection.cleanup()
        const expected = { status: `rejected`, error: new Error(message) }
        expect(await preload).toEqual(expected)
        hook.resolve(cleanupHook)
        await vi.waitFor(() => expect(cleanupHook).toHaveBeenCalledOnce())
        await new Promise((resolve) => setImmediate(resolve))
        if (outcome === `fulfill`) {
          expect(cleanupReports).not.toHaveBeenCalledWith(
            expect.objectContaining({ error: cleanupFailure }),
          )
        } else {
          expect(cleanupReports).toHaveBeenCalledWith({
            level: LogLevels.error,
            message: expect.stringContaining(`Could not clean up subset hook`),
            error: cleanupFailure,
          })
        }
        expect(createDiffTrigger).not.toHaveBeenCalled()
        expect(collection.status).toBe(`cleaned-up`)
        expect(query.status).toBe(`error`)
        expect(query.toArray).toEqual([])
        expect(collection.size).toBe(0)
        expect(publications.flat()).toEqual([])
        expect(reports.mock.calls).toEqual(expectedReports)
      }, [
        () => hook.resolve(cleanupHook),
        () => subscription.unsubscribe(),
        () => query.cleanup(),
        () => collection.cleanup(),
        () => preload,
        () => vi.waitFor(() => expect(cleanupHook).toHaveBeenCalledOnce()),
        () => new Promise((resolve) => setTimeout(resolve, 0)),
        () => expect(reports.mock.calls).toEqual(expectedReports),
        () => expect(unexpected).toEqual([]),
        () => process.off(`unhandledRejection`, recordUnhandled),
        () => reports.mockRestore(),
        () => cleanupReports.mockRestore(),
        () => createDiffTrigger.mockRestore(),
      ])
    },
  )
})
