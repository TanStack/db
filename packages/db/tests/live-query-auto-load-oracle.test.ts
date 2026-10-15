/**
 * Proposed automatic-loading contract: subscribing, preloading, moving a window and
 * restarting never start source sync or acquisition. Results equal array
 * evaluation over available rows, including while source readiness is pending.
 * Authority: automatic loading in query/live/ARCHITECTURE.md.
 * The model replaces independent arrays before each settled graph checkpoint.
 * Limits: controlled adapters, numeric order, one join or inline include;
 * provider behavior and framework scheduling have separate owners.
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../src'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from './oracle-config'
import { stripVirtualProps, withOracleCleanup } from './utils'
import type { LoadSubsetRequestResult, SyncConfig } from '../src'

type Row = { id: number; rank: number; parentId: number }
function source(syncMode: `eager` | `on-demand`, indexed: boolean) {
  let writer: Parameters<SyncConfig<Row>[`sync`]>[0] | undefined
  const load = vi.fn((): LoadSubsetRequestResult => true)
  const unload = vi.fn()
  const start = vi.fn((params: Parameters<SyncConfig<Row>[`sync`]>[0]) => {
    writer = params
    return { loadSubset: load, unloadSubset: unload }
  })
  const collection = createCollection<Row>({
    getKey: (row) => row.id,
    syncMode,
    autoIndex: indexed ? `eager` : `off`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    sync: { sync: start },
  })
  if (indexed) collection.createIndex((row) => row.rank)
  return {
    collection,
    load,
    unload,
    start,
    replace(rows: Array<Row>) {
      collection.startSyncImmediate()
      writer!.begin()
      writer!.truncate()
      for (const value of rows) writer!.write({ type: `insert`, value })
      writer!.commit()
    },
  }
}
// Each step atomically replaces both independently keyed sources, then moves
// a window. IDs 1..6 exclude duplicate keys; ranks 0..3 include ties; parent IDs
// 1..3 admit matching and unmatched children; limits 0..4 cross closed, full and
// underfilled windows. Source mode changes acquisition semantics; explicit rank
// indexes check parity with and without an available index. Provider loading
// plans stay inactive with autoLoad disabled. One to five replacements admit empty,
// growing and shrinking inputs. Cleanup/restart follows every generated trace.
const rowSet = fc.uniqueArray(
  fc.record({
    id: fc.integer({ min: 1, max: 6 }),
    rank: fc.integer({ min: 0, max: 3 }),
    parentId: fc.integer({ min: 1, max: 3 }),
  }),
  { selector: (row) => row.id, maxLength: 6 },
)

describe(`live queries with automatic loading disabled`, () => {
  it(`keeps local subscription readiness when another owner starts the source`, async () => {
    const src = source(`on-demand`, false)
    const subscription = src.collection.subscribeChanges(() => {}, {
      autoLoad: false,
      includeInitialState: true,
    })
    await withOracleCleanup(() => {
      expect(subscription.status).toBe(`ready`)
      src.collection.startSyncImmediate()
      expect(subscription.status).toBe(`ready`)
      src.replace([{ id: 1, rank: 0, parentId: 1 }])
      expect(subscription.status).toBe(`ready`)
      subscription.resumeDeferredAcquisition()
      expect(src.load).not.toHaveBeenCalled()
    }, [() => subscription.unsubscribe(), () => src.collection.cleanup()])
  })
  it(`publishes local window changes while an eager source is loading or failed`, async () => {
    const src = source(`eager`, true)
    src.collection.startSyncImmediate()
    const query = createLiveQueryCollection({
      autoLoad: false,
      query: (q) =>
        q
          .from({ row: src.collection })
          .orderBy(({ row }) => row.rank)
          .limit(1),
    })
    await withOracleCleanup(async () => {
      await query.preload()
      expect(src.collection.status).toBe(`loading`)
      expect(query.isReady()).toBe(true)
      src.replace([
        { id: 1, rank: 1, parentId: 1 },
        { id: 2, rank: 2, parentId: 1 },
      ])
      const writer = src.start.mock.calls[0]![0]
      writer.begin()
      writer.write({ type: `update`, value: { id: 1, rank: 3, parentId: 1 } })
      writer.commit()
      expect([...query.values()].map((row) => row.id)).toEqual([2])
      writer.begin()
      writer.write({ type: `delete`, value: { id: 2, rank: 2, parentId: 1 } })
      writer.commit()
      expect([...query.values()].map((row) => row.id)).toEqual([1])
      writer.markError(new Error(`provider offline`))
      expect(query.isReady()).toBe(true)
      expect(src.load).not.toHaveBeenCalled()
    }, [() => query.cleanup(), () => src.collection.cleanup()])
  })
  for (const syncMode of [`eager`, `on-demand`] as const) {
    for (const indexed of [false, true]) {
      for (const shape of [`window`, `join`, `include`] as const) {
        const property = `live-query-auto-load.${syncMode}.${indexed}.${shape}`
        const replay = readOracleRunConfig()
        for (const fixed of [true, false]) {
          const selected =
            replay.replayPath === undefined ||
            (!fixed && replay.replayProperty === property)
          const options = fixed
            ? { numRuns: oracleRuns(10), seed: 112919 }
            : oraclePropertyOptions(10, property)
          it.skipIf(!selected)(
            `${syncMode}, indexed=${indexed}, ${shape}, ${fixed ? `fixed seed 112919` : `random or replayed`}: evaluates available rows without acquiring`,
            async () => {
              await fc.assert(
                fc.asyncProperty(
                  fc.array(
                    fc.tuple(rowSet, rowSet, fc.integer({ min: 0, max: 4 })),
                    { minLength: 1, maxLength: 5 },
                  ),
                  async (history) => {
                    const leftSource = source(syncMode, indexed)
                    const rightSource = source(syncMode, indexed)
                    const query = createLiveQueryCollection({
                      autoLoad: false,
                      gcTime: 0,
                      query: (q) => {
                        if (shape === `join`)
                          return q
                            .from({ left: leftSource.collection })
                            .innerJoin(
                              { right: rightSource.collection },
                              ({ left, right }) => eq(left.id, right.parentId),
                            )
                            .orderBy(({ left }) => left.rank)
                            .orderBy(({ left }) => left.id)
                            .orderBy(({ right }) => right.id)
                            .select(({ left, right }) => ({
                              id: left.id,
                              child: right.id,
                            }))
                            .limit(2)
                        if (shape === `include`)
                          return q
                            .from({ left: leftSource.collection })
                            .orderBy(({ left }) => left.rank)
                            .orderBy(({ left }) => left.id)
                            .select(({ left }) => ({
                              id: left.id,
                              children: toArray(
                                q
                                  .from({ right: rightSource.collection })
                                  .where(({ right }) =>
                                    eq(right.parentId, left.id),
                                  )
                                  .orderBy(({ right }) => right.id)
                                  .select(({ right }) => ({ id: right.id })),
                              ),
                            }))
                            .limit(2)
                        return q
                          .from({ left: leftSource.collection })
                          .orderBy(({ left }) => left.rank)
                          .orderBy(({ left }) => left.id)
                          .select(({ left }) => ({ id: left.id }))
                          .limit(2)
                      },
                    })
                    let stop = () => {}
                    await withOracleCleanup(async () => {
                      for (const src of [leftSource, rightSource]) {
                        expect(src.collection.indexes.size > 0).toBe(indexed)
                      }
                      {
                        const sub = query.subscribeChanges(() => {})
                        stop = () => sub.unsubscribe()
                      }
                      expect(query.isReady()).toBe(true)
                      expect([...query.values()]).toEqual([])
                      expect(leftSource.start).not.toHaveBeenCalled()
                      expect(rightSource.start).not.toHaveBeenCalled()
                      await query.preload()
                      for (const [parents, children, limit] of history) {
                        leftSource.replace(parents)
                        rightSource.replace(children)
                        await query.utils.setWindow({ limit, offset: 0 })
                        const ordered = [...parents].sort(
                          (a, b) => a.rank - b.rank || a.id - b.id,
                        )
                        const expected =
                          shape === `join`
                            ? ordered.flatMap((parent) =>
                                children
                                  .filter(
                                    (child) => child.parentId === parent.id,
                                  )
                                  .sort((a, b) => a.id - b.id)
                                  .map((child) => ({
                                    id: parent.id,
                                    child: child.id,
                                  })),
                              )
                            : ordered.map((parent) =>
                                shape === `include`
                                  ? {
                                      id: parent.id,
                                      children: children
                                        .filter(
                                          (child) =>
                                            child.parentId === parent.id,
                                        )
                                        .sort((a, b) => a.id - b.id)
                                        .map((child) => ({ id: child.id })),
                                    }
                                  : { id: parent.id },
                              )
                        expect(
                          [...query.values()].map(stripVirtualProps),
                        ).toEqual(expected.slice(0, limit))
                        expect(query.isReady()).toBe(true)
                        expect(leftSource.load).not.toHaveBeenCalled()
                        expect(rightSource.load).not.toHaveBeenCalled()
                        expect(leftSource.collection.subscriberCount).toBe(0)
                      }
                      stop()
                      await query.cleanup()
                      {
                        const sub = query.subscribeChanges(() => {})
                        stop = () => sub.unsubscribe()
                      }
                      await query.preload()
                      expect(query.isReady()).toBe(true)
                      expect(leftSource.load).not.toHaveBeenCalled()
                      expect(rightSource.load).not.toHaveBeenCalled()
                    }, [
                      () => stop(),
                      () => query.cleanup(),
                      () => leftSource.collection.cleanup(),
                      () => rightSource.collection.cleanup(),
                    ])
                    expect(leftSource.unload).not.toHaveBeenCalled()
                    expect(rightSource.unload).not.toHaveBeenCalled()
                  },
                ),
                options,
              )
            },
          )
        }
      }
    }
  }
  it(`coexists with a fetching consumer whose request is pending`, async () => {
    const src = source(`on-demand`, false)
    let resolve!: () => void
    src.load.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r
        }),
    )
    const local = createLiveQueryCollection({
      autoLoad: false,
      query: (q) => q.from({ row: src.collection }),
    })
    const remote = createLiveQueryCollection((q) =>
      q.from({ row: src.collection }),
    )
    let stopLocal = () => {}
    let stopRemote = () => {}
    await withOracleCleanup(async () => {
      {
        const sub = local.subscribeChanges(() => {})
        stopLocal = () => sub.unsubscribe()
      }
      expect(src.start).not.toHaveBeenCalled()
      {
        const sub = remote.subscribeChanges(() => {})
        stopRemote = () => sub.unsubscribe()
      }
      expect(src.load).toHaveBeenCalledTimes(1)
      expect(local.isReady()).toBe(true)
      expect(remote.isReady()).toBe(false)
      expect(src.collection.subscriberCount).toBe(1)
      const writer = src.start.mock.calls[0]![0]
      writer.begin()
      writer.write({ type: `insert`, value: { id: 1, rank: 0, parentId: 1 } })
      writer.commit()
      expect([...local.values()].map((row) => row.id)).toEqual([1])
      expect(local.isReady()).toBe(true)
      stopLocal()
      expect(src.unload).not.toHaveBeenCalled()
      resolve()
      await remote.preload()
      stopRemote()
      await remote.cleanup()
      expect(src.unload).toHaveBeenCalledTimes(1)
    }, [
      () => stopLocal(),
      () => stopRemote(),
      () => local.cleanup(),
      () => remote.cleanup(),
      () => src.collection.cleanup(),
    ])
  })
})
