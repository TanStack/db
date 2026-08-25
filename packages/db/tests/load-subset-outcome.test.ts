import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DeduplicatedLoadSubset } from '../src/query/subset-dedupe.js'
import { SubsetDemandController } from '../src/query/live/subset-demand-controller.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { LIVE_QUERY_INTERNAL } from '../src/query/live/internal.js'
import { createLiveQueryWindowController } from '../src/live-query-window-controller.js'
import type { LazyDemandPlan } from '../src/query/compiler/joins.js'

describe(`loadSubset outcomes`, () => {
  it(`publishes exact applied coverage through the collection sync boundary`, async () => {
    const unloadError = new Error(`unload failed`)
    let unloadShouldFail = true
    const unloadSubset = vi.fn(() => {
      if (unloadShouldFail) throw unloadError
    })
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-coverage-registry`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async () => {
              begin()
              write({ type: `insert`, value: { id: `a` } })
              write({ type: `insert`, value: { id: `b` } })
              const applied = commit()
              if (applied !== true) await applied
              return {
                hasMore: true,
                appliedRowKeys: [`a`, `b`],
              }
            },
            unloadSubset,
          }
        },
      },
    })

    try {
      const options = { limit: 2 }
      await collection._sync.loadSubset(options)

      expect(Array.from(collection.keys()).sort()).toEqual([`a`, `b`])
      expect(collection._sync.getLoadSubsetCoverage()).toEqual([
        {
          collectionId: collection.id,
          demand: { limit: 2 },
          extent: `continues`,
          rowKeys: [`a`, `b`],
        },
      ])

      expect(() => collection._sync.unloadSubset(options)).toThrow(unloadError)
      expect(collection._sync.getLoadSubsetCoverage()).toHaveLength(1)

      unloadShouldFail = false
      collection._sync.unloadSubset(options)
      expect(collection._sync.getLoadSubsetCoverage()).toEqual([])
      expect(unloadSubset).toHaveBeenCalledTimes(2)
    } finally {
      await collection.cleanup()
    }
  })

  it(`does not publish a continuing prefix without applied rows`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-rowless-coverage`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () =>
              Promise.resolve({ hasMore: true, appliedRowKeys: [] }),
          }
        },
      },
    })

    try {
      await collection._sync.loadSubset({ limit: 2 })
      expect(collection._sync.getLoadSubsetCoverage()).toEqual([])
    } finally {
      await collection.cleanup()
    }
  })

  it.each([
    [{ hasMore: true }, `continues`],
    [{ hasMore: false }, `exhausted`],
    [{ hasMore: undefined }, `unknown`],
    [undefined, `unknown`],
  ] as const)(
    `normalizes an applied %o result to %s for its exact demand`,
    async (sourceResult, extent) => {
      const hasMore =
        sourceResult && `hasMore` in sourceResult
          ? sourceResult.hasMore
          : undefined
      const resultKind =
        sourceResult === undefined ? `omitted` : String(hasMore)
      const collection = createCollection<{ id: string }>({
        id: `load-subset-outcome-${extent}-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => Promise.resolve(sourceResult),
            }
          },
        },
      })

      try {
        const options = { limit: 1 }
        const result = collection._sync.loadSubset(options)

        expect(result).toBeInstanceOf(Promise)
        await expect(result).resolves.toEqual({
          collectionId: collection.id,
          demand: options,
          generation: 1,
          extent,
        })
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`preserves the adapter result through request deduplication`, async () => {
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => Promise.resolve({ hasMore: false }),
    })

    const result = deduplicated.loadSubset({ limit: 2 })

    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toEqual({ hasMore: false })
  })

  it(`does not leak a covering acquisition's extent into a narrower demand`, async () => {
    let resolveLoad!: (result: { hasMore: boolean }) => void
    const load = new Promise<{ hasMore: boolean }>((resolve) => {
      resolveLoad = resolve
    })
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => load,
    })
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-covering-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: deduplicated.loadSubset }
        },
      },
    })

    try {
      const covering = collection._sync.loadSubset({ limit: 10 })
      const exactPeer = collection._sync.loadSubset({ limit: 10 })
      const narrower = collection._sync.loadSubset({ limit: 5 })

      resolveLoad({ hasMore: false })

      await expect(covering).resolves.toMatchObject({ extent: `exhausted` })
      await expect(exactPeer).resolves.toMatchObject({ extent: `exhausted` })
      await expect(narrower).resolves.toMatchObject({ extent: `unknown` })
    } finally {
      await collection.cleanup()
    }
  })

  it(`assigns a fresh generation to each logical demand`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-generations`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: () => Promise.resolve() }
        },
      },
    })

    try {
      const first = collection._sync.loadSubset({ limit: 1 })
      const second = collection._sync.loadSubset({ limit: 2 })

      expect(first).toBeInstanceOf(Promise)
      expect(second).toBeInstanceOf(Promise)
      await expect(first).resolves.toMatchObject({ generation: 1 })
      await expect(second).resolves.toMatchObject({ generation: 2 })
    } finally {
      await collection.cleanup()
    }
  })

  it(`preserves the outcome when a request waits for deferred sync start`, async () => {
    let loadedLimit: number | undefined
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-deferred-start`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: false,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loadedLimit = options.limit
              return Promise.resolve({ hasMore: false })
            },
          }
        },
      },
    })

    try {
      expect(collection._deferSyncStart()).toBe(true)
      const options = { limit: 3 }
      const result = collection._sync.loadSubset(options)
      expect(result).toBeInstanceOf(Promise)
      options.limit = 30

      collection._resumeSyncStart()

      expect(loadedLimit).toBe(3)
      await expect(result).resolves.toEqual({
        collectionId: collection.id,
        demand: { limit: 3 },
        generation: 1,
        extent: `exhausted`,
      })
    } finally {
      await collection.cleanup()
    }
  })

  it(`keeps deferred covering-source extent scoped to its exact demand`, async () => {
    let resolveLoad!: (result: { hasMore: boolean }) => void
    const load = new Promise<{ hasMore: boolean }>((resolve) => {
      resolveLoad = resolve
    })
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => load,
    })
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-deferred-covering-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: false,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: deduplicated.loadSubset }
        },
      },
    })

    try {
      expect(collection._deferSyncStart()).toBe(true)
      const covering = collection._sync.loadSubset({ limit: 10 })
      const narrower = collection._sync.loadSubset({ limit: 5 })

      collection._resumeSyncStart()
      resolveLoad({ hasMore: false })

      await expect(covering).resolves.toMatchObject({ extent: `exhausted` })
      await expect(narrower).resolves.toMatchObject({ extent: `unknown` })
    } finally {
      await collection.cleanup()
    }
  })

  it(`preserves outcomes through lazy demand aggregation`, async () => {
    type Row = { id: string; groupId: number }
    const collection = createCollection<Row>({
      id: `load-subset-outcome-lazy-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => Promise.resolve({ hasMore: true }),
          }
        },
      },
    })
    collection.createIndex((row) => row.groupId)
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const controller = new SubsetDemandController()
    const plan: LazyDemandPlan = {
      id: `lazy-demand-outcome`,
      path: [`groupId`],
      collectionId: collection.id,
      initialKeys: new Set(),
    }

    try {
      const update = controller.setDemand(subscription, plan, new Set([1]))
      expect(update.ready).toBeInstanceOf(Promise)
      if (!(update.ready instanceof Promise)) {
        throw new Error(`Expected asynchronous lazy demand`)
      }
      await expect(update.ready).resolves.toEqual([
        expect.objectContaining({ generation: 1, extent: `continues` }),
      ])
    } finally {
      controller.clear()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retains source-scoped outcomes at the live-query window boundary`, async () => {
    type Row = { id: number; rank: number }
    let nextId = 1
    const source = createCollection<Row>({
      id: `load-subset-outcome-live-source`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async () => {
              begin()
              write({
                type: `insert`,
                value: { id: nextId, rank: nextId++ },
              })
              const applied = commit()
              if (applied !== true) await applied
              return { hasMore: false }
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .limit(1),
      startSync: true,
    })
    const controller = createLiveQueryWindowController(live, { pageSize: 2 })

    try {
      await live.preload()
      const internal = live.utils[LIVE_QUERY_INTERNAL]
      expect(internal.getLatestSubsetOutcomes()).toEqual([
        expect.objectContaining({
          collectionId: source.id,
          sourceId: expect.any(String),
          extent: `exhausted`,
        }),
      ])

      await controller.preload()
      expect(internal.getLastWindowOutcomes()).toEqual([
        expect.objectContaining({
          collectionId: source.id,
          sourceId: expect.any(String),
          extent: `exhausted`,
        }),
      ])
      expect(
        controller[LIVE_QUERY_INTERNAL].getLatestAppliedOutcomes(),
      ).toEqual(internal.getLastWindowOutcomes())
    } finally {
      controller.dispose()
      await Promise.all([live.cleanup(), source.cleanup()])
    }
  })

  it(`retains same-generation outcomes from every source in one operation`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-operation-sources`,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const operation = collection._sync.beginLoadSubsetOperation()
    const left = Promise.resolve({
      collectionId: `left-collection`,
      sourceId: `left`,
      demand: { limit: 1 },
      generation: 1,
      extent: `continues` as const,
    })
    const right = Promise.resolve({
      collectionId: `right-collection`,
      sourceId: `right`,
      demand: { limit: 1 },
      generation: 1,
      extent: `exhausted` as const,
    })

    collection._sync.trackLoadSubsetOperationPromise(left)
    collection._sync.trackLoadSubsetOperationPromise(right)

    try {
      await operation.wait()
      expect(operation.getOutcomes()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceId: `left`, generation: 1 }),
          expect.objectContaining({ sourceId: `right`, generation: 1 }),
        ]),
      )
      expect(operation.getOutcomes()).toHaveLength(2)
    } finally {
      await collection.cleanup()
    }
  })
})
