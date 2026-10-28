/**
 * Ordinary unit tests moved out of pagination-oracle.property.test.ts. They
 * compare with values written in the test, not with the model: a teardown
 * observation, a settled empty window that a live insert fills, a stable-order
 * update that needs no reload, and a NaN public-key tie. The law they belong
 * to, ordered windows equal independent recomputation, is owned by
 * pagination-oracle.property.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import { cleanupAll } from './pagination-support.js'
import type { CleanupTarget, PageRow } from './pagination-support.js'
import type { Deferred } from '../../src/deferred.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

let collectionSequence = 0

describe(`pagination recomputation oracle`, () => {
  it.each([
    { label: `Error`, reason: new Error(`first cleanup failed`) },
    { label: `undefined`, reason: undefined },
    { label: `null`, reason: null },
    { label: `false`, reason: false },
    { label: `zero`, reason: 0 },
    { label: `NaN`, reason: Number.NaN },
    { label: `empty string`, reason: `` },
  ])(
    `observes $label cleanup failure after every teardown settles`,
    async ({ reason: firstFailure }) => {
      const secondFailure = new Error(`second cleanup failed`)
      const firstFailureRelease = createDeferred<void>()
      const lastCleanupRelease = createDeferred<void>()
      const repeatedFirstFailureRelease = createDeferred<void>()
      const repeatedLastCleanupRelease = createDeferred<void>()
      const events: Array<string> = []
      const unhandled: Array<unknown> = []
      const recordUnhandled = (reason: unknown) => unhandled.push(reason)
      const createTargets = (
        firstRelease: Deferred<void>,
        lastRelease: Deferred<void>,
      ): ReadonlyArray<CleanupTarget> => [
        {
          cleanup: async () => {
            events.push(`first`)
            await firstRelease.promise
            throw firstFailure
          },
        },
        {
          cleanup: () => {
            events.push(`second`)
            throw secondFailure
          },
        },
        {
          cleanup: async () => {
            events.push(`third`)
            await lastRelease.promise
          },
        },
      ]
      const observeFirstFailure = (cleanup: Promise<void>) =>
        cleanup.then(
          () => {
            throw new Error(`expected cleanup to reject`)
          },
          (error: unknown) => expect(error).toBe(firstFailure),
        )
      let cleanupFinished = false
      process.on(`unhandledRejection`, recordUnhandled)

      try {
        const cleanup = cleanupAll(
          ...createTargets(firstFailureRelease, lastCleanupRelease),
        ).finally(() => {
          cleanupFinished = true
        })
        const observedFailure = observeFirstFailure(cleanup)

        await flushPromises()
        expect(events).toEqual([`first`, `second`, `third`])
        expect(cleanupFinished).toBe(false)
        expect(unhandled).toEqual([])

        firstFailureRelease.resolve()
        await flushPromises()
        expect(cleanupFinished).toBe(false)
        expect(unhandled).toEqual([])

        lastCleanupRelease.resolve()
        await observedFailure
        await flushPromises()
        expect(cleanupFinished).toBe(true)
        expect(unhandled).toEqual([])

        let repeatedCleanupFinished = false
        const repeatedCleanup = cleanupAll(
          ...createTargets(
            repeatedFirstFailureRelease,
            repeatedLastCleanupRelease,
          ),
        ).finally(() => {
          repeatedCleanupFinished = true
        })
        const repeatedObservedFailure = observeFirstFailure(repeatedCleanup)
        await flushPromises()
        expect(events).toEqual([
          `first`,
          `second`,
          `third`,
          `first`,
          `second`,
          `third`,
        ])
        expect(repeatedCleanupFinished).toBe(false)
        expect(unhandled).toEqual([])

        repeatedFirstFailureRelease.resolve()
        await flushPromises()
        expect(repeatedCleanupFinished).toBe(false)
        expect(unhandled).toEqual([])

        repeatedLastCleanupRelease.resolve()
        await repeatedObservedFailure
        await flushPromises()
        expect(repeatedCleanupFinished).toBe(true)
        expect(unhandled).toEqual([])
      } finally {
        firstFailureRelease.resolve()
        lastCleanupRelease.resolve()
        repeatedFirstFailureRelease.resolve()
        repeatedLastCleanupRelease.resolve()
        process.off(`unhandledRejection`, recordUnhandled)
      }
    },
  )

  it(`does not refetch when live insertion fills a settled empty window`, async () => {
    let sync!: Parameters<SyncConfig<PageRow, number>[`sync`]>[0]
    const requests: Array<LoadSubsetOptions> = []
    const source = createCollection<PageRow, number>({
      id: `settled-empty-window`,
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
              return true
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
      expect(live.toArray).toEqual([])
      expect(requests).toHaveLength(1)

      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, rank: 1 } })
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      await flushPromises()

      expect(live.toArray.map(({ id, rank }) => ({ id, rank }))).toEqual([
        { id: 1, rank: 1 },
      ])
      expect(live.utils.lastSubsetError).toBeUndefined()
      // Correct rows alone would miss a repeated prefix and boundary fetch.
      expect(
        requests.map(({ limit, offset, orderBy, where, cursor }) => ({
          limit,
          offset,
          ordered: Boolean(orderBy),
          filtered: Boolean(where),
          cursor: Boolean(cursor),
        })),
      ).toEqual([
        { limit: 1, offset: 0, ordered: true, filtered: false, cursor: false },
      ])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it(`does not recover the full source when a visible row keeps its order`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    let begin!: () => void
    let write!: (message: { type: `insert` | `update`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-stable-order-update-${collectionSequence++}`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              loads.push(options)
              begin()
              write({
                type: `insert`,
                value: { id: 1, rank: 0, keep: true },
              })
              commit()
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .limit(1),
    )

    try {
      await live.preload()
      const loadsBeforeMutation = loads.length
      begin()
      write({ type: `update`, value: { id: 1, rank: 0, keep: false } })
      commit()
      await flushPromises()

      expect(
        live.toArray.map(({ id, rank, keep }) => ({ id, rank, keep })),
      ).toEqual([{ id: 1, rank: 0, keep: false }])
      expect(loads).toHaveLength(loadsBeforeMutation)
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each([{ ids: [1, Number.NaN] }, { ids: [Number.NaN, 1] }])(
    `keeps finite public keys before NaN across insertion order`,
    async ({ ids }) => {
      const source = createCollection(
        mockSyncCollectionOptions({
          id: `pagination-nan-key-order-${collectionSequence++}`,
          initialData: ids.map((id) => ({ id, rank: 0 })),
          getKey: (row: PageRow) => row.id,
          autoIndex: `eager`,
        }),
      )
      const live = createLiveQueryCollection((query) =>
        query
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .limit(1),
      )

      try {
        await live.preload()
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      } finally {
        await cleanupAll(live, source)
      }
    },
  )
})
