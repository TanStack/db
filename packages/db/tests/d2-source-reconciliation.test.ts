// Ordinary tests moved out of d2-source-reconciliation-oracle.property.test.ts.
// They keep literal expectations for Effect and live-query consumers and for the
// D2 change boundary; the reconciliation laws stay in the oracle file.
import { expect, it } from 'vitest'
import { createLiveQueryCollection, eq } from '../src/index.js'
import { createEffect } from '../src/query/effect.js'
import { reconcileChangesForD2 } from '../src/query/live/utils.js'
import { flushPromises } from './utils.js'
import {
  addWeight,
  createOrderedSourceHarness,
  expectedWeightedRowIdentity,
  runWithCleanup,
} from './d2-source-reconciliation-support.js'
import type {
  SourceKey,
  SourceRow,
} from './d2-source-reconciliation-support.js'
import type { ChangeMessage } from '../src/types.js'

it(`retains a D2 mismatch and later cleanup diagnostics while releasing every resource`, async () => {
  const mismatch = new Error(`wrong D2 row`)
  const cleanupFailure = new Error(`first release failed`)
  const secondCleanupFailure = new Error(`second release failed`)
  const released: Array<string> = []
  let report: unknown
  try {
    await runWithCleanup(
      () => Promise.reject(mismatch),
      [
        {
          resource: `first resource`,
          release: () => {
            released.push(`first`)
            throw cleanupFailure
          },
        },
        {
          resource: `second resource`,
          release: () => {
            released.push(`second`)
            throw secondCleanupFailure
          },
        },
        {
          resource: `last resource`,
          release: () => {
            released.push(`last`)
          },
        },
      ],
    )
  } catch (error) {
    report = error
  }

  expect(report).toBeInstanceOf(AggregateError)
  if (!(report instanceof AggregateError)) return
  expect(report.cause).toBe(mismatch)
  expect(report.errors).toEqual([
    new Error(`D2 oracle first resource cleanup failed`, {
      cause: cleanupFailure,
    }),
    new Error(`D2 oracle second resource cleanup failed`, {
      cause: secondCleanupFailure,
    }),
  ])
  expect(released).toEqual([`first`, `second`, `last`])
})

it(`releases an initialized source when consumer setup fails`, async () => {
  const harness = createOrderedSourceHarness(`d2-setup-failure`, `eager`)
  const setupFailure = new Error(`consumer setup failed`)
  let reported: unknown
  try {
    await runWithCleanup(() => {
      harness.initialize()
      return Promise.reject(setupFailure)
    }, [
      {
        resource: `source Collection`,
        release: () => harness.source.cleanup(),
      },
    ])
  } catch (error) {
    reported = error
  }
  expect(reported).toBe(setupFailure)
  expect(harness.source.status).toBe(`cleaned-up`)
})

it(`settles held replay work after a D2 mismatch without replacing it`, async () => {
  const harness = createOrderedSourceHarness(`d2-held-replay-failure`, `eager`)
  const mismatch = new Error(`wrong row during held replay`)
  let disposeEffect: (() => void | Promise<void>) | undefined
  let reported: unknown
  try {
    await runWithCleanup(async () => {
      harness.initialize()
      const effect = createEffect<SourceRow, number>({
        query: (query) =>
          query
            .from({ row: harness.source })
            .orderBy(({ row }) => row.value)
            .limit(1),
        onBatch: () => {},
      })
      disposeEffect = () => effect.dispose()
      await flushPromises()
      harness.truncate()
      await flushPromises()
      expect(harness.pendingReplayCount()).toBeGreaterThan(0)
      throw mismatch
    }, [
      {
        resource: `held truncate replay`,
        release: () => harness.settlePendingReplay(),
      },
      { resource: `Effect`, release: () => disposeEffect?.() },
      {
        resource: `source Collection`,
        release: () => harness.source.cleanup(),
      },
    ])
  } catch (error) {
    reported = error
  }
  expect(reported).toBe(mismatch)
  expect(harness.pendingReplayCount()).toBe(0)
  expect(harness.source.status).toBe(`cleaned-up`)
})

it(`uses sent-row membership and values at the D2 change boundary`, () => {
  const sentRows = new Map<SourceKey, SourceRow>()
  const stale = { id: 1, revision: 1, value: 1 }
  const current = { id: 2, revision: 2, value: 2 }
  const replacement = { id: 2, revision: 3, value: 3 }

  expect(
    reconcileChangesForD2(
      [{ type: `delete`, key: `row`, value: stale }],
      sentRows,
    ),
  ).toEqual([])
  expect(
    reconcileChangesForD2(
      [
        {
          type: `update`,
          key: `row`,
          previousValue: stale,
          value: current,
        },
      ],
      sentRows,
    ),
  ).toEqual([{ type: `insert`, key: `row`, value: current }])
  expect(sentRows).toEqual(new Map([[`row`, current]]))

  // A known-key update and delete retract the row sent to D2, even when the
  // source reports a different previous value. These adjacent cells reject
  // both "always insert updates" and "trust the reported value" rules.
  expect(
    reconcileChangesForD2(
      [
        {
          type: `update`,
          key: `row`,
          previousValue: stale,
          value: replacement,
        },
      ],
      sentRows,
    ),
  ).toEqual([
    {
      type: `update`,
      key: `row`,
      previousValue: current,
      value: replacement,
    },
  ])
  expect(
    reconcileChangesForD2(
      [{ type: `delete`, key: `row`, value: stale }],
      sentRows,
    ),
  ).toEqual([{ type: `delete`, key: `row`, value: replacement }])
  expect(sentRows).toEqual(new Map())
})

it.each([`eager`, `off`] as const)(
  `retracts the exact Effect source row after an ordered truncate (%s index)`,
  async (autoIndex) => {
    const harness = createOrderedSourceHarness(
      `d2-effect-truncate-reconciliation-${autoIndex}`,
      autoIndex,
    )
    const { contributed, source, staleDelete } = harness
    const events: Array<{
      type: string
      value: { id: number; revision: number; value: number }
    }> = []
    let disposeEffect: (() => void | Promise<void>) | undefined
    await runWithCleanup(async () => {
      harness.initialize()
      const effect = createEffect<SourceRow, number>({
        query: (query) =>
          query
            .from({ row: source })
            .where(({ row }) => eq(row.revision, contributed.revision))
            .orderBy(({ row }) => row.value)
            .limit(1),
        onBatch: (batch) => {
          events.push(...batch)
        },
      })
      disposeEffect = () => effect.dispose()
      await flushPromises()
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: `enter`,
        key: 1,
        value: contributed,
      })
      const publishedValue = events[0]!.value

      harness.suppressSourceChanges()
      harness.truncate()
      await flushPromises()
      expect(events).toEqual([{ type: `enter`, key: 1, value: publishedValue }])

      harness.publish([{ type: `delete`, key: 1, value: staleDelete }])
      await flushPromises()
      expect(events).toEqual([{ type: `enter`, key: 1, value: publishedValue }])

      await harness.resolveReplay()
      expect(events).toEqual([
        { type: `enter`, key: 1, value: publishedValue },
        { type: `exit`, key: 1, value: publishedValue },
      ])
    }, [
      {
        resource: `held truncate replay`,
        release: () => harness.settlePendingReplay(),
      },
      { resource: `Effect`, release: () => disposeEffect?.() },
      { resource: `source Collection`, release: () => source.cleanup() },
    ])
  },
)

it.each([`eager`, `off`] as const)(
  `retracts the exact live-query source row after ordered replay settles (%s index)`,
  async (autoIndex) => {
    const harness = createOrderedSourceHarness(
      `d2-live-query-truncate-reconciliation-${autoIndex}`,
      autoIndex,
    )
    const { contributed, source, staleDelete } = harness
    let cleanupLive: (() => Promise<void>) | undefined
    await runWithCleanup(async () => {
      harness.initialize()
      const live = createLiveQueryCollection({
        id: `d2-live-query-truncate-result`,
        query: (query) =>
          query
            .from({ row: source })
            .where(({ row }) => eq(row.revision, contributed.revision))
            .orderBy(({ row }) => row.value)
            .limit(1),
        startSync: true,
      })
      cleanupLive = () => live.cleanup()
      await live.preload()
      expect(live.get(contributed.id)).toMatchObject(contributed)

      harness.suppressSourceChanges()
      harness.truncate()
      await flushPromises()
      expect(live.get(contributed.id)).toMatchObject(contributed)

      harness.publish([{ type: `delete`, key: 1, value: staleDelete }])
      await flushPromises()
      expect(live.get(contributed.id)).toMatchObject(contributed)

      await harness.resolveReplay()
      expect(live.get(contributed.id)).toBeUndefined()
    }, [
      {
        resource: `held truncate replay`,
        release: () => harness.settlePendingReplay(),
      },
      { resource: `live-query Collection`, release: () => cleanupLive?.() },
      { resource: `source Collection`, release: () => source.cleanup() },
    ])
  },
)

it.each([`eager`, `off`] as const)(
  `replaces the retained Effect source row after an ordered truncate (%s index)`,
  async (autoIndex) => {
    const harness = createOrderedSourceHarness(
      `d2-effect-truncate-replacement-${autoIndex}`,
      autoIndex,
    )
    const { contributed, replacement, source, staleDelete } = harness
    const batches: Array<
      Array<{
        type: string
        value: SourceRow
        previousValue?: SourceRow
      }>
    > = []
    let disposeEffect: (() => void | Promise<void>) | undefined
    await runWithCleanup(async () => {
      harness.initialize()
      const effect = createEffect<SourceRow, number>({
        query: (query) =>
          query
            .from({ row: source })
            .orderBy(({ row }) => row.value)
            .limit(1),
        onBatch: (batch) => {
          batches.push(batch)
        },
      })
      disposeEffect = () => effect.dispose()
      await flushPromises()
      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(1)
      expect(batches[0]![0]).toMatchObject({
        type: `enter`,
        key: 1,
        value: contributed,
      })
      const publishedValue = batches[0]![0]!.value

      harness.suppressSourceChanges()
      harness.truncate()
      await flushPromises()
      expect(batches).toHaveLength(1)

      harness.publish([
        {
          type: `update`,
          key: 1,
          previousValue: staleDelete,
          value: replacement,
        },
      ])
      await flushPromises()
      expect(batches).toHaveLength(1)

      await harness.resolveReplay()
      expect(batches).toHaveLength(2)
      expect(batches[1]).toHaveLength(1)
      expect(batches[1]![0]).toMatchObject({
        type: `update`,
        key: 1,
        value: replacement,
      })
      expect(batches[1]![0]!.previousValue).toBe(publishedValue)
    }, [
      {
        resource: `held truncate replay`,
        release: () => harness.settlePendingReplay(),
      },
      { resource: `Effect`, release: () => disposeEffect?.() },
      { resource: `source Collection`, release: () => source.cleanup() },
    ])
  },
)

it.each([`eager`, `off`] as const)(
  `replaces the retained live-query source row after ordered replay settles (%s index)`,
  async (autoIndex) => {
    const harness = createOrderedSourceHarness(
      `d2-live-query-truncate-replacement-${autoIndex}`,
      autoIndex,
    )
    const { contributed, replacement, source, staleDelete } = harness
    const batches: Array<Array<ChangeMessage<SourceRow, SourceKey>>> = []
    let unsubscribe: (() => void) | undefined
    let cleanupLive: (() => Promise<void>) | undefined
    await runWithCleanup(async () => {
      harness.initialize()
      const live = createLiveQueryCollection({
        id: `d2-live-query-truncate-replacement-result`,
        query: (query) =>
          query
            .from({ row: source })
            .orderBy(({ row }) => row.value)
            .limit(1),
        startSync: true,
      })
      cleanupLive = () => live.cleanup()
      await live.preload()
      expect(live.get(contributed.id)).toMatchObject(contributed)
      const publishedValue = live.get(contributed.id)
      const subscription = live.subscribeChanges(
        (changes) => batches.push(changes),
        { includeInitialState: false },
      )
      unsubscribe = () => subscription.unsubscribe()

      harness.suppressSourceChanges()
      harness.truncate()
      await flushPromises()
      expect(batches).toEqual([])
      expect(live.get(contributed.id)).toBe(publishedValue)

      harness.publish([
        {
          type: `update`,
          key: 1,
          previousValue: staleDelete,
          value: replacement,
        },
      ])
      await flushPromises()
      expect(batches).toEqual([])
      expect(live.get(contributed.id)).toBe(publishedValue)

      await harness.resolveReplay()
      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(1)
      expect(batches[0]![0]).toMatchObject({
        type: `update`,
        key: 1,
        value: replacement,
      })
      expect(batches[0]![0]!.previousValue).toEqual(publishedValue)
      expect(live.get(replacement.id)).toMatchObject(replacement)
    }, [
      {
        resource: `held truncate replay`,
        release: () => harness.settlePendingReplay(),
      },
      { resource: `live-query subscriber`, release: () => unsubscribe?.() },
      { resource: `live-query Collection`, release: () => cleanupLive?.() },
      { resource: `source Collection`, release: () => source.cleanup() },
    ])
  },
)

it.each([`eager`, `off`] as const)(
  `retracts the previous graph contribution after a live-query restart (%s index)`,
  async (autoIndex) => {
    const harness = createOrderedSourceHarness(
      `d2-live-query-graph-restart-${autoIndex}`,
      autoIndex,
    )
    const { contributed, replacement, source, staleDelete } = harness
    const batches: Array<Array<ChangeMessage<SourceRow, SourceKey>>> = []
    let unsubscribe: (() => void) | undefined
    let cleanupLive: (() => Promise<void>) | undefined
    await runWithCleanup(async () => {
      harness.initialize()
      const live = createLiveQueryCollection({
        id: `d2-live-query-graph-restart-result-${autoIndex}`,
        query: (query) =>
          query
            .from({ row: source })
            .orderBy(({ row }) => row.value)
            .limit(1),
        startSync: true,
      })
      cleanupLive = () => live.cleanup()
      await live.preload()
      expect(live.get(contributed.id)).toMatchObject(contributed)

      await live.cleanup()
      expect(live.status).toBe(`cleaned-up`)
      await live.preload()
      expect(live.get(contributed.id)).toMatchObject(contributed)
      const restartedValue = live.get(contributed.id)
      const subscription = live.subscribeChanges(
        (changes) => batches.push(changes),
        { includeInitialState: false },
      )
      unsubscribe = () => subscription.unsubscribe()

      harness.publish([
        {
          type: `update`,
          key: contributed.id,
          previousValue: staleDelete,
          value: replacement,
        },
      ])
      await flushPromises()
      expect(batches).toHaveLength(1)
      expect(batches[0]).toHaveLength(1)
      expect(batches[0]![0]).toMatchObject({
        type: `update`,
        key: contributed.id,
        value: replacement,
      })
      expect(batches[0]![0]!.previousValue).toEqual(restartedValue)
      expect(live.get(replacement.id)).toMatchObject(replacement)
    }, [
      { resource: `live-query subscriber`, release: () => unsubscribe?.() },
      { resource: `live-query Collection`, release: () => cleanupLive?.() },
      { resource: `source Collection`, release: () => source.cleanup() },
    ])
  },
)

it(`keeps revision and value in weighted row identity`, () => {
  const key = `row`
  const base = { id: 1, revision: 1, value: 1 }
  const differentRevision = { id: 1, revision: 2, value: 1 }
  const differentValue = { id: 1, revision: 1, value: 2 }
  const relation = new Map<string, number>()

  addWeight(relation, key, base, 1)
  addWeight(relation, key, differentRevision, 1)
  addWeight(relation, key, differentValue, 1)

  expect(relation).toEqual(
    new Map([
      [expectedWeightedRowIdentity(key, base), 1],
      [expectedWeightedRowIdentity(key, differentRevision), 1],
      [expectedWeightedRowIdentity(key, differentValue), 1],
    ]),
  )
})
