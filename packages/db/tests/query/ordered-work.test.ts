// Ordinary tests for the ordered source work: fixed histories and checker
// calibrations with literal expectations. They are supplemental coverage. The
// laws they touch (ordered demand, joined-window publication, and Effect
// readiness) are owned by ordered-work-oracle.property.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { getCollectionBuilder } from '../../src/query/live/collection-registry.js'
import { Func, Value } from '../../src/query/ir.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq, gte, isUndefined } from '../../src/query/builder/functions.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { flushPromises } from '../utils.js'
import {
  expectDistinctRequests,
  expectInitialWindows,
  expectNoProviderStart,
  expectRawWindow,
  requestFingerprint,
} from './ordered-work-support.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'
import type { Marker, Row } from './ordered-work-support.js'

// Distinct collection IDs for the fixed histories in this file.
let harnessId = 0

describe(`ordered source work oracle`, () => {
  it(`rejects scrambled order and partial or regressed initial publications`, () => {
    const rows: Array<Row> = [
      { id: 1, rank: 1, eligible: true, label: `first` },
      { id: 2, rank: 2, eligible: true, label: `second` },
    ]
    expectInitialWindows([[], rows], rows, `asc`, true)
    expect(() =>
      expectRawWindow([...rows].reverse(), rows, `asc`, true),
    ).toThrow()
    expect(() =>
      expectInitialWindows([[rows[0]!], rows], rows, `asc`, true),
    ).toThrow()
    expect(() => expectInitialWindows([rows, []], rows, `asc`, true)).toThrow()
    const tied = rows.map((row) => ({ ...row, rank: 1 })).reverse()
    expectRawWindow(tied, tied, `asc`, false)
    expect(() => expectRawWindow(tied, tied, `asc`, true)).toThrow()
  })

  it(`identifies repeated finite requests without the production request key`, () => {
    const options: LoadSubsetOptions = { limit: 1 }
    const fingerprint = requestFingerprint(options)
    const requests = [
      { key: `a`, fingerprint },
      { key: `b`, fingerprint },
    ]
    expect(() => expectDistinctRequests(requests)).toThrow()
    options.limit = 2
    expectDistinctRequests([
      requests[0]!,
      { fingerprint: requestFingerprint(options) },
    ])
    expect(fingerprint).toBe(requestFingerprint({ limit: 1 }))
    expect(() =>
      requestFingerprint({
        where: new Func<boolean>(`eq`, [
          new Value(new Date()),
          new Value(new Date()),
        ]),
      }),
    ).toThrow()
  })

  it(`checks the live request recorder after disposal rather than its earlier copy`, () => {
    const requests = [{ fingerprint: requestFingerprint({ limit: 1 }) }]
    const returned = [...requests]
    const before = requests.length
    expectNoProviderStart(before, requests.length)
    requests.push({ fingerprint: requestFingerprint({ limit: 2 }) })
    expect(returned).toHaveLength(1)
    expect(() => expectNoProviderStart(before, requests.length)).toThrow()
  })

  it(`suppresses the initial joined-filter window while child demand settles`, async () => {
    type Root = { id: number; rank: number; label: string }
    const initial = { id: 1, rank: 1, label: `initial` }
    let rootSync!: Parameters<SyncConfig<Root, number>[`sync`]>[0]
    const root = createCollection<Root, number>({
      id: `ordered-skip-joined-root-${harnessId++}`,
      getKey: ({ id }) => id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rootSync = operations
          operations.begin()
          operations.write({ type: `insert`, value: initial })
          operations.commit()
          operations.markReady()
        },
      },
    })
    const childGate = createDeferred<void>()
    let childLoads = 0
    const child = createCollection<Marker, number>({
      id: `ordered-skip-joined-child-${harnessId++}`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.markReady()
          return {
            loadSubset: () => {
              childLoads++
              return childGate.promise
            },
          }
        },
      },
    })
    const events: Array<string> = []
    const effect = createEffect<{ id: number; label: string }>({
      query: (q) =>
        q
          .from({ row: root })
          .leftJoin({ marker: child }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => isUndefined(marker.rowId))
          .orderBy(({ row }) => row.rank)
          .limit(1)
          .select(({ row }) => ({ id: row.id, label: row.label })),
      skipInitial: true,
      onBatch: (batch) => {
        events.push(...batch.map((event) => event.type))
      },
    })
    await withHistoryCleanup(
      async () => {
        await vi.waitFor(() => expect(childLoads).toBeGreaterThan(0))
        await flushPromises()
        expect(events).toEqual([])
        childGate.resolve()
        await flushPromises()
        expect(events).toEqual([])

        rootSync.begin()
        rootSync.write({
          type: `update`,
          value: { ...initial, label: `later` },
        })
        const receipt = rootSync.commit()
        if (receipt !== true) await receipt
        await vi.waitFor(() => expect(events).toContain(`update`))
      },
      () => [
        () => childGate.resolve(),
        () => effect.dispose(),
        () => root.cleanup(),
        () => child.cleanup(),
      ],
    )
  })

  it(`avoids an extra joined-filter graph turn when the root becomes ready`, async () => {
    type Root = { id: number; rank: number }
    let rootSync!: Parameters<SyncConfig<Root, number>[`sync`]>[0]
    let joinedSync!: Parameters<SyncConfig<Marker, number>[`sync`]>[0]
    const root = createCollection<Root, number>({
      id: `ordered-ready-root-${harnessId++}`,
      getKey: ({ id }) => id,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: { sync: (operations) => void (rootSync = operations) },
    })
    const joined = createCollection<Marker, number>({
      id: `ordered-ready-joined-${harnessId++}`,
      getKey: ({ id }) => id,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          joinedSync = operations
          return { loadSubset: () => true }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `ordered-ready-live-${harnessId++}`,
      startSync: true,
      query: (q) =>
        q
          .from({ row: root })
          .leftJoin({ marker: joined }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => isUndefined(marker.rowId))
          .orderBy(({ row }) => row.rank)
          .limit(0)
          .select(({ row }) => ({ id: row.id })),
    })
    await withHistoryCleanup(
      () => {
        const builder = getCollectionBuilder(live)!
        expect(
          Object.values(builder.optimizableOrderByCollections).some(
            (info) => info.joinedFilterSourceId !== undefined,
          ),
        ).toBe(true)
        const scheduled = vi.spyOn(builder, `scheduleGraphRun`)
        rootSync.markReady()
        // Root readiness already schedules its ordinary graph turn.
        expect(scheduled).toHaveBeenCalledTimes(1)
        joinedSync.markReady()
        // Joined readiness also rechecks the joined-filter demand gate.
        expect(scheduled).toHaveBeenCalledTimes(3)
        return Promise.resolve()
      },
      () => [
        () => live.cleanup(),
        () => root.cleanup(),
        () => joined.cleanup(),
      ],
    )
  })

  it(`loads each source of a filtered join once`, async () => {
    type Order = {
      id: number
      scheduledAt: string
      status: string
      addressId: number
    }
    type Charge = { id: number; addressId: number }
    let orderLoads = 0
    let chargeLoads = 0
    const orders = createCollection<Order>({
      id: `ordered-filtered-join-orders`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: {
              id: 1,
              scheduledAt: `2024-01-15`,
              status: `queued`,
              addressId: 1,
            },
          })
          write({
            type: `insert`,
            value: {
              id: 2,
              scheduledAt: `2024-01-10`,
              status: `queued`,
              addressId: 2,
            },
          })
          commit()
          markReady()
          return {
            loadSubset: () => {
              orderLoads++
              return true
            },
          }
        },
      },
    })
    const charges = createCollection<Charge>({
      id: `ordered-filtered-join-charges`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 10, addressId: 1 } })
          write({ type: `insert`, value: { id: 20, addressId: 2 } })
          commit()
          markReady()
          return {
            loadSubset: () => {
              chargeLoads++
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ order: orders })
        .where(({ order }) => gte(order.scheduledAt, `2024-01-12`))
        .where(({ order }) => eq(order.status, `queued`))
        .innerJoin({ charge: charges }, ({ order, charge }) =>
          eq(order.addressId, charge.addressId),
        ),
    )

    try {
      await live.preload()
      expect(
        [...live.values()].map(({ order, charge }) => [order.id, charge.id]),
      ).toEqual([[1, 10]])
      expect(orderLoads).toBe(1)
      expect(chargeLoads).toBe(1)
    } finally {
      await Promise.all([live.cleanup(), orders.cleanup(), charges.cleanup()])
    }
  })

  it.each([`collection`, `effect`] as const)(
    `does no source work for a zero-sized %s window`,
    async (consumer) => {
      let loads = 0
      const source = createCollection<Row, number>({
        id: `ordered-zero-window`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
            }
          },
        },
      })
      const query = (q: InitialQueryBuilder) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(0)
      const live =
        consumer === `collection`
          ? createLiveQueryCollection({
              id: `ordered-zero-window-live`,
              query,
              startSync: true,
            })
          : undefined
      const effect =
        consumer === `effect`
          ? createEffect({ query, onBatch: () => {} })
          : undefined

      try {
        if (live) await live.preload()
        else await flushPromises()
        expect(loads).toBe(0)
      } finally {
        if (effect) await effect.dispose()
        if (live) await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it.each(
    ([`collection`, `effect`] as const).flatMap((consumer) =>
      ([`eager`, `off`] as const).map((autoIndex) => ({
        consumer,
        autoIndex,
      })),
    ),
  )(
    `does no source work for a joined $consumer with a zero-sized $autoIndex window`,
    async ({ consumer, autoIndex }) => {
      let rowLoads = 0
      let markerLoads = 0
      const source = createCollection<Row, number>({
        id: `ordered-zero-window-unindexed-${consumer}-source`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex,
        defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                rowLoads++
                return true
              },
            }
          },
        },
      })
      const markers = createCollection<Marker, number>({
        id: `ordered-zero-window-unindexed-${consumer}-marker`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex,
        defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                markerLoads++
                return true
              },
            }
          },
        },
      })
      const query = (q: InitialQueryBuilder) =>
        q
          .from({ row: source })
          .innerJoin({ marker: markers }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .orderBy(({ row }) => row.rank)
          .limit(0)
      const live =
        consumer === `collection`
          ? createLiveQueryCollection({ query, startSync: true })
          : undefined
      const effect =
        consumer === `effect`
          ? createEffect({ query, onBatch: () => {} })
          : undefined

      try {
        if (live) await live.preload()
        else await flushPromises()
        expect({ rowLoads, markerLoads }).toEqual({
          rowLoads: 0,
          markerLoads: 0,
        })
      } finally {
        if (effect) await effect.dispose()
        if (live) await live.cleanup()
        await Promise.all([source.cleanup(), markers.cleanup()])
      }
    },
  )

  it.each([`resolve`, `reject`, `retire`] as const)(
    `keeps a widened window aligned with existing joined demand (%s)`,
    async (outcome) => {
      type Root = { id: number; rank: number }
      type Child = { id: number; rootId: number }
      const childGate = createDeferred<void>()
      const rootContinuationGate = createDeferred<void>()
      const rootRequests: Array<LoadSubsetOptions> = []
      let childLoads = 0
      let rootSync!: Parameters<SyncConfig<Root, number>[`sync`]>[0]
      const rootCollection = createCollection<Root, number>({
        id: `ordered-held-window-root`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: (operations) => {
            rootSync = operations
            const { begin, write, commit, markReady } = operations
            markReady()
            let delivered = false
            return {
              loadSubset: async (options) => {
                rootRequests.push(options)
                if (options.cursor) await rootContinuationGate.promise
                if (!delivered && options.orderBy) {
                  delivered = true
                  begin()
                  write({ type: `insert`, value: { id: 1, rank: 1 } })
                  const receipt = commit(options.signal)
                  if (receipt !== true) await receipt
                }
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const childCollection = createCollection<Child, number>({
        id: `ordered-held-window-child`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                childLoads++
                return childGate.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const live = createLiveQueryCollection({
        id: `ordered-held-window-live`,
        startSync: false,
        query: (q) =>
          q
            .from({ root: rootCollection })
            .leftJoin({ child: childCollection }, ({ root, child }) =>
              eq(root.id, child.rootId),
            )
            .where(({ child }) => isUndefined(child.rootId))
            .orderBy(({ root }) => root.rank)
            .limit(1)
            .select(({ root }) => ({ id: root.id })),
      })

      await withHistoryCleanup(
        async () => {
          const preload = live.preload()
          void preload.catch(() => {})
          await vi.waitFor(() => {
            expect(childLoads).toBe(1)
            expect(rootRequests).toHaveLength(2)
          })

          let moveSettled = false
          const move = Promise.resolve(
            live.utils.setWindow({ offset: 0, limit: 2 }),
          ).then(() => {
            moveSettled = true
          })
          await flushPromises()
          expect(moveSettled).toBe(false)
          expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
          expect(live.toArray.map(({ id }) => id)).toEqual([])

          if (outcome === `reject`) {
            childGate.reject(new Error(`joined demand failed`))
            await expect(move).rejects.toThrow(`joined demand failed`)
            expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
            await Promise.allSettled([preload])
            return
          }

          if (outcome === `retire`) {
            rootSync.begin()
            rootSync.write({
              type: `delete`,
              value: { id: 1, rank: 1 },
            })
            const receipt = rootSync.commit()
            if (receipt !== true) await receipt
            rootContinuationGate.resolve()
            await vi.waitFor(() => expect(moveSettled).toBe(true))
            expect(rootRequests.length).toBeGreaterThan(2)
            expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
            expect(live.toArray).toEqual([])
            childGate.reject(new Error(`obsolete joined demand failed`))
            await flushPromises()
            expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
            return
          }

          childGate.resolve()
          await vi.waitFor(() =>
            expect(
              rootRequests.some(({ cursor }) => cursor !== undefined),
            ).toBe(true),
          )
          await flushPromises()
          expect(moveSettled).toBe(false)
          expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
          rootContinuationGate.resolve()
          await Promise.all([move, preload])
          expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
          expect(live.toArray.map(({ id }) => id)).toEqual([1])
          expect(rootRequests.some(({ cursor }) => cursor !== undefined)).toBe(
            true,
          )
        },
        () => [
          () => childGate.resolve(),
          () => rootContinuationGate.resolve(),
          () => live.cleanup(),
          () => rootCollection.cleanup(),
          () => childCollection.cleanup(),
        ],
      )
    },
  )

  it.each([false, true])(
    `cancels queued ordered recovery on cleanup (restart=%s)`,
    async (restart) => {
      const seedRow: Row = { id: 1, rank: 1, eligible: true, label: `retained` }
      let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      let installed = false
      const requests: Array<LoadSubsetOptions> = []
      const source = createCollection<Row, number>({
        id: `queued-recovery-cleanup-${harnessId++}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: (operations) => {
            sync = operations
            operations.markReady()
            return {
              loadSubset: (options) => {
                requests.push(options)
                if (installed) return true
                installed = true
                operations.begin()
                operations.write({ type: `insert`, value: seedRow })
                return operations.commit()
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1),
      )
      try {
        await live.preload()
        const initialRequests = requests.length
        sync.begin()
        sync.truncate()
        installed = false
        expect(sync.commit()).toBe(true)
        await live.cleanup()
        await flushPromises()
        expect(requests).toHaveLength(initialRequests)
        if (restart) {
          await live.preload()
          expect(live.toArray.map(({ id }) => id)).toEqual([1])
          expect(live.utils.lastSubsetError).toBeUndefined()
          expect(requests.length).toBeGreaterThan(initialRequests)
        }
        expect(
          requests.filter(
            ({ where, limit }) => where === undefined && limit === undefined,
          ),
        ).toEqual([])
      } finally {
        await Promise.all([live.cleanup(), source.cleanup()])
      }
    },
  )

  it(`releases held Effect changes after an empty joined replay`, async () => {
    type ReplayRow = { id: number; rank: number; label: string }
    const initialRow = { id: 1, rank: 1, label: `old` }
    let rootSync!: Parameters<SyncConfig<ReplayRow, number>[`sync`]>[0]
    const root = createCollection<ReplayRow, number>({
      id: `ordered-replay-wakeup-root-${harnessId++}`,
      getKey: ({ id }) => id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rootSync = operations
          operations.begin()
          operations.write({ type: `insert`, value: initialRow })
          operations.commit()
          operations.markReady()
        },
      },
    })
    const replayGate = createDeferred<void>()
    let joinedLoads = 0
    let joinedSync!: Parameters<
      SyncConfig<{ id: number; rowId: number }, number>[`sync`]
    >[0]
    const joined = createCollection<{ id: number; rowId: number }, number>({
      id: `ordered-replay-wakeup-joined-${harnessId++}`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          joinedSync = operations
          operations.markReady()
          return {
            loadSubset: () => {
              joinedLoads++
              return joinedLoads === 1 ? true : replayGate.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<number, string>()
    const effect = createEffect<{ id: number; label: string }>({
      query: (q) =>
        q
          .from({ row: root })
          .leftJoin({ marker: joined }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => isUndefined(marker.rowId))
          .orderBy(({ row }) => row.rank)
          .limit(1)
          .select(({ row }) => ({ id: row.id, label: row.label })),
      onBatch: (events) => {
        for (const event of events) {
          if (event.type === `exit`) visible.delete(event.value.id)
          else visible.set(event.value.id, event.value.label)
        }
      },
    })
    try {
      await vi.waitFor(() => expect(visible.get(1)).toBe(`old`))
      joinedSync.begin()
      joinedSync.truncate()
      const truncateReceipt = joinedSync.commit()
      if (truncateReceipt !== true) await truncateReceipt
      await vi.waitFor(() => expect(joinedLoads).toBeGreaterThan(1))

      rootSync.begin()
      rootSync.write({ type: `update`, value: { ...initialRow, label: `new` } })
      const updateReceipt = rootSync.commit()
      if (updateReceipt !== true) await updateReceipt
      for (let i = 0; i < 5; i++) await flushPromises()
      expect(visible.get(1)).toBe(`old`)

      replayGate.resolve()
      await vi.waitFor(() => expect(visible.get(1)).toBe(`new`))
    } finally {
      replayGate.resolve()
      await Promise.all([effect.dispose(), root.cleanup(), joined.cleanup()])
    }
  })
})
