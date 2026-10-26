import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  isUndefined,
  not,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
import { createOracleReach } from '../oracle-reach.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
  SyncConfig,
} from '../../src/types.js'

/**
 * # Which replay may replace a loadSubset publication?
 *
 * Contract: The replay-participant rules and normative publication law 9 in
 * packages/db/src/query/live/ARCHITECTURE.md require a complete participating
 * source set before a truncate replay publishes. A failed replay keeps the
 * prior public snapshot and later partial source changes private. A retired
 * logical demand stops participating. Source cleanup terminates dependent
 * live queries. A direct subscriber can acquire again after restart.
 *
 * Model: the expected public rows are the last complete public snapshot until
 * every current replay participant succeeds or retires and any older
 * overlapping work that still participates settles. A completed replacement
 * supplies the next public rows.
 * The literal expected row sets below instantiate this rule independently of
 * the Collection's replay bookkeeping.
 *
 * History grammar: fixed one-row and multi-row source replacements, failed
 * work, later writes, overlapping attempts, retired include routes, joined
 * sources, and cleanup/restart. Deferred loadSubset results control settlement.
 * The driver uses real Collections and live queries. At each held or settled
 * checkpoint, it compares exact public rows and callback reads with the model;
 * selected histories also compare batches, readiness, and acquisition release.
 * These controlled adapter promises do not establish real-provider cancellation
 * or every legal replay interleaving.
 */

type Row = { id: string; version: number }
type ObservedRow = { sourceId: string; rowKey: string; version: number }

type CleanupTask = { name: string; run: () => unknown | Promise<unknown> }

async function finishCleanup(
  primaryFailure: { error: unknown } | undefined,
  phases: ReadonlyArray<ReadonlyArray<CleanupTask>>,
): Promise<void> {
  const cleanupErrors: Array<Error> = []
  for (const phase of phases) {
    const results = await Promise.allSettled(
      phase.map(({ run }) => Promise.resolve().then(run)),
    )
    for (const [index, result] of results.entries()) {
      if (result.status === `rejected`) {
        cleanupErrors.push(
          new Error(`${phase[index]!.name} cleanup failed`, {
            cause: result.reason,
          }),
        )
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `Replay oracle cleanup failed`,
      primaryFailure && { cause: primaryFailure.error },
    )
  }
}

describe(`loadSubset replay refinement`, () => {
  it(`preserves a replay mismatch and separate cleanup failures`, async () => {
    const mismatch = new Error(`public snapshot mismatch after failed replay`)
    const unloadFailure = new Error(`unload failed`)
    const sourceFailure = new Error(`source cleanup failed`)
    const completed: Array<string> = []
    let reported: unknown

    try {
      await finishCleanup({ error: mismatch }, [
        [
          {
            name: `acquisition unload`,
            run: () => {
              completed.push(`unload`)
              throw unloadFailure
            },
          },
          {
            name: `subscription`,
            run: () => completed.push(`subscription`),
          },
        ],
        [
          {
            name: `source`,
            run: () => {
              completed.push(`source`)
              throw sourceFailure
            },
          },
        ],
      ])
    } catch (error) {
      reported = error
    }

    expect(completed).toEqual([`unload`, `subscription`, `source`])
    expect(reported).toBeInstanceOf(AggregateError)
    const failure = reported as AggregateError
    expect(failure.cause).toBe(mismatch)
    expect(failure.errors).toHaveLength(2)
    expect((failure.errors[0] as Error).message).toBe(
      `acquisition unload cleanup failed`,
    )
    expect((failure.errors[0] as Error).cause).toBe(unloadFailure)
    expect((failure.errors[1] as Error).message).toBe(`source cleanup failed`)
    expect((failure.errors[1] as Error).cause).toBe(sourceFailure)
  })

  // A direct subscriber survives source Collection cleanup. A dependent live
  // query enters
  // a terminal error instead; restarting only its source must not revive it.
  it.each(
    ([`direct`, `live`] as const).flatMap((consumer) =>
      ([`resolve`, `reject`] as const).map((outcome) => ({
        consumer,
        outcome,
      })),
    ),
  )(
    `separates direct restart from fatal source Collection cleanup for a live query: %j`,
    async ({ consumer, outcome }) => {
      let operations!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
      let loads = 0
      const pending = createDeferred<void>()
      void pending.promise.catch(() => undefined)
      const initial = [{ id: `row`, version: 1 }]
      const replacement = [{ id: `row`, version: 2 }]
      const source = createCollection<Row, string>({
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (next) => {
            operations = next
            next.markReady()
            return {
              loadSubset: () => {
                if (++loads > 1) return pending.promise
                next.begin()
                next.write({ type: `insert`, value: initial[0]! })
                next.commit()
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const live =
        consumer === `live`
          ? createLiveQueryCollection((q) => q.from({ row: source }))
          : undefined
      const visible = new Map<string, Row>()
      const rows = (values: ReadonlyArray<Row>) =>
        values.map(({ id, version }) => ({ id, version }))
      const readEvents = () => rows([...visible.values()])
      const read = () => (live ? rows(live.toArray) : readEvents())
      const publications: Array<Array<Row>> = []
      const subscription = (live ?? source).subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(String(change.key))
            else visible.set(String(change.key), { ...change.value })
          }
          publications.push(readEvents())
        },
        { includeInitialState: consumer === `live` },
      )

      let primaryFailure: { error: unknown } | undefined
      try {
        if (live) await live.preload()
        else subscription.requestSnapshot({})
        await flushPromises()
        expect(loads).toBe(1)
        expect(read()).toEqual(initial)
        expect(readEvents()).toEqual(initial)
        publications.length = 0

        await source.cleanup()
        if (live) expect(live.status).toBe(`error`)
        source.startSyncImmediate()
        await flushPromises()
        expect(loads).toBe(2)
        expect(read()).toEqual(initial)
        // Cleanup may change row metadata without changing the public data.
        for (const publication of publications)
          expect(publication).toEqual(initial)

        operations.begin()
        operations.write({ type: `insert`, value: replacement[0]! })
        await operations.commit()
        await flushPromises()
        expect(rows(source.toArray)).toEqual(replacement)
        expect(read()).toEqual(initial)
        expect(readEvents()).toEqual(initial)
        for (const publication of publications)
          expect(publication).toEqual(initial)
        publications.length = 0

        if (outcome === `resolve`) pending.resolve()
        else pending.reject(new Error(`restart failed`))
        await flushPromises()
        const publishes = consumer === `direct` && outcome === `resolve`
        const expected = publishes ? replacement : initial
        expect(read()).toEqual(expected)
        expect(readEvents()).toEqual(expected)
        expect(publications).toEqual(publishes ? [replacement] : [])
        if (live) expect(live.status).toBe(`error`)
      } catch (error) {
        primaryFailure = { error }
        throw error
      } finally {
        await finishCleanup(primaryFailure, [
          [
            { name: `pending replay`, run: () => pending.resolve() },
            { name: `subscription`, run: () => subscription.unsubscribe() },
          ],
          [{ name: `live query`, run: () => live?.cleanup() }],
          [{ name: `source`, run: () => source.cleanup() }],
        ])
      }
    },
  )

  it(`publishes a successful sibling after a settled failed include route retires`, async () => {
    type Parent = { id: string; left: number | null; right: number }
    type Child = { id: number; version: number }
    let parentSync!: Parameters<SyncConfig<Parent, string>[`sync`]>[0]
    let childSync!: Parameters<SyncConfig<Child, number>[`sync`]>[0]
    const failed = createDeferred<void>()
    const successful = createDeferred<void>()
    const loads: Array<{ options: LoadSubsetOptions; ids: Array<number> }> = []
    const unloads: Array<LoadSubsetOptions> = []
    const parents = createCollection<Parent, string>({
      id: `settled-peer-parent`,
      getKey: ({ id }) => id,
      sync: {
        sync: (operations) => {
          parentSync = operations
          operations.begin()
          operations.write({
            type: `insert`,
            value: { id: `parent`, left: 1, right: 2 },
          })
          operations.commit()
          operations.markReady()
        },
      },
    })
    const children = createCollection<Child, number>({
      id: `settled-peer-children`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: (operations) => {
          childSync = operations
          operations.markReady()
          return {
            loadSubset: (options) => {
              const rows = [1, 2]
                .map((id) => ({ id, version: loads.length < 2 ? 1 : 2 }))
                .filter(
                  (row) =>
                    !options.where ||
                    evaluateReferenceExpression(options.where, row) === true,
                )
              loads.push({ options, ids: rows.map(({ id }) => id) })
              operations.begin()
              for (const value of rows)
                operations.write({ type: `insert`, value })
              operations.commit()
              if (loads.length <= 2) return true
              return rows.some(({ id }) => id === 1)
                ? failed.promise
                : successful.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents }).select(({ parent }) => ({
        id: parent.id,
        left: toArray(
          q
            .from({ leftChild: children })
            .where(({ leftChild }) => eq(leftChild.id, parent.left)),
        ),
        right: toArray(
          q
            .from({ rightChild: children })
            .where(({ rightChild }) => eq(rightChild.id, parent.right)),
        ),
      })),
    )
    const read = () =>
      live.toArray.map(({ id, left, right }) => ({
        id,
        left: left.map(({ id: key, version }) => ({ id: key, version })),
        right: right.map(({ id: key, version }) => ({ id: key, version })),
      }))
    const publications: Array<ReturnType<typeof read>> = []
    const subscription = live.subscribeChanges(
      () => publications.push(read()),
      { includeInitialState: false },
    )
    let primaryFailure: { error: unknown } | undefined
    try {
      await live.preload()
      expect(loads.map(({ ids }) => ids)).toEqual([[1], [2]])
      const initial = [
        {
          id: `parent`,
          left: [{ id: 1, version: 1 }],
          right: [{ id: 2, version: 1 }],
        },
      ]
      expect(read()).toEqual(initial)
      publications.length = 0
      childSync.begin()
      childSync.truncate()
      childSync.commit()
      await flushPromises()
      expect(loads.slice(2).map(({ ids }) => ids)).toEqual([[1], [2]])
      failed.reject(new Error(`left replay failed`))
      successful.resolve()
      await flushPromises()
      expect(read()).toEqual(initial)
      expect(publications).toEqual([])
      parentSync.begin()
      parentSync.write({
        type: `update`,
        value: { id: `parent`, left: null, right: 2 },
      })
      parentSync.commit()
      await flushPromises()
      expect(read()).toEqual([
        { id: `parent`, left: [], right: [{ id: 2, version: 2 }] },
      ])
      expect(publications).toEqual([
        [{ id: `parent`, left: [], right: [{ id: 2, version: 2 }] }],
      ])
      expect(loads).toHaveLength(4)
      expect(unloads).toContain(loads[2]!.options)
      expect(loads[2]!.options.signal?.aborted).toBe(true)
      expect(loads[3]!.options.signal?.aborted).toBe(false)
      childSync.begin()
      childSync.write({ type: `update`, value: { id: 2, version: 3 } })
      childSync.commit()
      await flushPromises()
      expect(read()).toEqual([
        { id: `parent`, left: [], right: [{ id: 2, version: 3 }] },
      ])
      expect(publications).toHaveLength(2)
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await finishCleanup(primaryFailure, [
        [
          { name: `failed replay`, run: () => failed.resolve() },
          { name: `successful replay`, run: () => successful.resolve() },
          { name: `subscription`, run: () => subscription.unsubscribe() },
        ],
        [{ name: `live query`, run: () => live.cleanup() }],
        [
          { name: `parents`, run: () => parents.cleanup() },
          { name: `children`, run: () => children.cleanup() },
        ],
      ])
    }
    expect(unloads).toHaveLength(loads.length)
    for (const { options } of loads) {
      expect(unloads.filter((unloaded) => unloaded === options)).toHaveLength(1)
    }
  })

  function createHarness(
    sourceId: string,
    initialRows: ReadonlyArray<Row> = [{ id: `row`, version: 1 }],
  ) {
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const pending: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    const batches: Array<
      Array<{
        type: `insert` | `update` | `delete`
        row: { sourceId: string; rowKey: string; version: number }
        previousVersion?: number
      }>
    > = []
    const source = createCollection<Row>({
      id: sourceId,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              if (loadCount === 1) {
                begin()
                for (const value of initialRows) {
                  write({ type: `insert`, value })
                }
                commit()
                return true
              }
              const deferred = createDeferred<void>()
              pending.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const downstream = createLiveQueryCollection({
      id: `${sourceId}-downstream`,
      query: (q) =>
        q.from({ row: source }).select(({ row }) => ({
          id: row.id,
          version: row.version,
        })),
      startSync: true,
    })
    const callbackReads: Array<Array<ObservedRow>> = []
    const subscription = downstream.subscribeChanges(
      (changes) => {
        const batch = changes.map((change) => ({
          type: change.type,
          row: {
            sourceId,
            rowKey: String(change.key),
            version: change.value.version,
          },
          ...(change.previousValue === undefined
            ? {}
            : { previousVersion: change.previousValue.version }),
        }))
        if (batch.length > 0) {
          batches.push(batch)
          callbackReads.push(
            downstream.toArray.map(({ id, version }) => ({
              sourceId,
              rowKey: id,
              version,
            })),
          )
        }
      },
      { includeInitialState: true },
    )

    const replaceCore = (version: number) => {
      begin()
      write({ type: `insert`, value: { id: `row`, version } })
      commit()
    }
    const updateCore = (previousVersion: number, version: number) => {
      begin()
      write({
        type: `update`,
        value: { id: `row`, version },
        previousValue: { id: `row`, version: previousVersion },
      })
      commit()
    }
    const applyCore = (
      changes: ReadonlyArray<ChangeMessageOrDeleteKeyMessage<Row, string>>,
    ) => {
      begin()
      for (const change of changes) write(change)
      commit()
    }
    const startReplay = async () => {
      begin()
      truncate()
      commit()
      await flushPromises()
    }
    const coreRows = () =>
      source.toArray.map(({ id, version }) => ({
        sourceId,
        rowKey: id,
        version,
      }))
    const visibleRows = () =>
      downstream.toArray.map(({ id, version }) => ({
        sourceId,
        rowKey: id,
        version,
      }))

    return {
      source,
      downstream,
      subscription,
      pending,
      batches,
      callbackReads,
      replaceCore,
      updateCore,
      applyCore,
      startReplay,
      coreRows,
      visibleRows,
    }
  }

  async function finishHarnessCleanup(
    primaryFailure: { error: unknown } | undefined,
    harness: ReturnType<typeof createHarness>,
  ): Promise<void> {
    await finishCleanup(primaryFailure, [
      [
        ...harness.pending.map(({ deferred }, index) => ({
          name: `replay ${index}`,
          run: () => deferred.resolve(),
        })),
        { name: `subscription`, run: () => harness.subscription.unsubscribe() },
      ],
      [
        { name: `downstream`, run: () => harness.downstream.cleanup() },
        { name: `source`, run: () => harness.source.cleanup() },
      ],
    ])
  }

  it(`retains the last complete publication when replay fails after writing`, async () => {
    const sourceId = `replay-refinement-failure`
    const row = (version: number) => ({
      sourceId,
      rowKey: `row`,
      version,
    })
    const harness = createHarness(sourceId)

    let primaryFailure: { error: unknown } | undefined
    try {
      await harness.downstream.preload()
      await harness.startReplay()
      expect(harness.pending).toHaveLength(1)

      harness.replaceCore(2)
      harness.pending[0]!.deferred.reject(new Error(`replay failed`))
      await flushPromises()

      expect(harness.coreRows()).toEqual([row(2)])
      expect(harness.visibleRows()).toEqual([row(1)])
      expect(harness.batches).toEqual([[{ type: `insert`, row: row(1) }]])
      expect(harness.callbackReads).toEqual([[row(1)]])
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await finishHarnessCleanup(primaryFailure, harness)
    }
  })

  it(`publishes a truncate-replay replacement before its source subscription reports ready`, async () => {
    const replay = createDeferred<void>()
    let loadCount = 0
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let sourceSubscription: LoadSubsetOptions[`subscription`]
    const source = createCollection<Row>({
      id: `replay-ready-publication-source`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              sourceSubscription = options.subscription
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `row`, version: 1 } })
                commit()
                return true
              }
              return replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q.from({ row: source }).select(({ row }) => ({
        id: row.id,
        version: row.version,
      })),
    )
    const readVersions = () => live.toArray.map(({ version }) => version)
    const readyReads: Array<Array<number>> = []

    let primaryFailure: { error: unknown } | undefined
    try {
      await live.preload()
      expect(readVersions()).toEqual([1])
      sourceSubscription!.on(`status:ready`, () => {
        readyReads.push(readVersions())
      })

      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `row`, version: 2 } })
      commit()

      replay.resolve()
      await flushPromises()

      expect(readyReads).toEqual([[2]])
      expect(readVersions()).toEqual([2])
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await finishCleanup(primaryFailure, [
        [{ name: `replay`, run: () => replay.resolve() }],
        [
          { name: `live query`, run: () => live.cleanup() },
          { name: `source`, run: () => source.cleanup() },
        ],
      ])
    }
  })

  it(`keeps a failed replay private until a later authoritative replay`, async () => {
    const sourceId = `replay-refinement-failure-liveness`
    const row = (version: number) => ({ sourceId, rowKey: `row`, version })
    const harness = createHarness(sourceId)

    let primaryFailure: { error: unknown } | undefined
    try {
      await harness.downstream.preload()
      expect(harness.visibleRows().map(({ version }) => version)).toEqual([1])

      await harness.startReplay()
      expect(harness.pending).toHaveLength(1)
      harness.replaceCore(2)
      harness.pending[0]!.deferred.reject(new Error(`replay failed`))
      await flushPromises()

      expect(harness.visibleRows()).toEqual([row(1)])
      expect(harness.downstream.status).toBe(`ready`)
      expect(harness.batches).toEqual([[{ type: `insert`, row: row(1) }]])

      harness.updateCore(2, 3)
      await flushPromises()

      expect(harness.visibleRows()).toEqual([row(1)])
      expect(harness.batches).toEqual([[{ type: `insert`, row: row(1) }]])
      expect(harness.callbackReads).toEqual([[row(1)]])

      await harness.startReplay()
      expect(harness.pending).toHaveLength(2)
      harness.replaceCore(4)
      harness.pending[1]!.deferred.resolve()
      await flushPromises()

      expect(harness.visibleRows()).toEqual([row(4)])
      expect(harness.batches).toEqual([
        [{ type: `insert`, row: row(1) }],
        [{ type: `update`, row: row(4), previousVersion: 1 }],
      ])
      expect(harness.callbackReads).toEqual([[row(1)], [row(4)]])
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await finishHarnessCleanup(primaryFailure, harness)
    }
  })

  it(`replaces a multi-row failed replay only with later authoritative state`, async () => {
    const sourceId = `replay-refinement-multi-row-failure`
    const observed = (id: string, version: number) => ({
      sourceId,
      rowKey: id,
      version,
    })
    const harness = createHarness(sourceId, [
      { id: `a`, version: 1 },
      { id: `b`, version: 1 },
      { id: `c`, version: 1 },
    ])
    const sortedVisible = () =>
      harness
        .visibleRows()
        .sort((left, right) => left.rowKey.localeCompare(right.rowKey))
    const sortedCore = () =>
      harness
        .coreRows()
        .sort((left, right) => left.rowKey.localeCompare(right.rowKey))

    let primaryFailure: { error: unknown } | undefined
    try {
      await harness.downstream.preload()
      expect(sortedVisible()).toEqual([
        observed(`a`, 1),
        observed(`b`, 1),
        observed(`c`, 1),
      ])
      const publishedBatches = harness.batches.length

      await harness.startReplay()
      expect(harness.pending).toHaveLength(1)
      harness.applyCore([
        { type: `insert`, value: { id: `a`, version: 2 } },
        { type: `insert`, value: { id: `d`, version: 1 } },
      ])
      harness.pending[0]!.deferred.reject(new Error(`partial replay failed`))
      await flushPromises()

      harness.applyCore([
        {
          type: `update`,
          value: { id: `a`, version: 3 },
          previousValue: { id: `a`, version: 2 },
        },
        { type: `delete`, key: `d` },
        { type: `insert`, value: { id: `e`, version: 1 } },
      ])
      await flushPromises()

      expect(sortedCore()).toEqual([observed(`a`, 3), observed(`e`, 1)])
      expect(sortedVisible()).toEqual([
        observed(`a`, 1),
        observed(`b`, 1),
        observed(`c`, 1),
      ])
      expect(harness.batches).toHaveLength(publishedBatches)

      await harness.startReplay()
      expect(harness.pending).toHaveLength(2)
      harness.applyCore([
        { type: `insert`, value: { id: `a`, version: 4 } },
        { type: `insert`, value: { id: `b`, version: 1 } },
        { type: `insert`, value: { id: `e`, version: 2 } },
      ])
      harness.pending[1]!.deferred.resolve()
      await flushPromises()

      expect(sortedVisible()).toEqual([
        observed(`a`, 4),
        observed(`b`, 1),
        observed(`e`, 2),
      ])
      expect(harness.batches).toHaveLength(publishedBatches + 1)
      expect(harness.batches.at(-1)).toEqual([
        {
          type: `update`,
          row: observed(`a`, 4),
          previousVersion: 1,
        },
        { type: `delete`, row: observed(`c`, 1) },
        { type: `insert`, row: observed(`e`, 2) },
      ])
      expect(
        harness.callbackReads
          .at(-1)
          ?.sort((left, right) => left.rowKey.localeCompare(right.rowKey)),
      ).toEqual([observed(`a`, 4), observed(`b`, 1), observed(`e`, 2)])
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await finishHarnessCleanup(primaryFailure, harness)
    }
  })

  it(`waits for every overlapping replay before publishing the newest success`, async () => {
    const sourceId = `replay-refinement-overlap`
    const row = (version: number) => ({
      sourceId,
      rowKey: `row`,
      version,
    })
    const harness = createHarness(sourceId)

    let primaryFailure: { error: unknown } | undefined
    try {
      await harness.downstream.preload()
      await harness.startReplay()
      await harness.startReplay()
      expect(harness.pending).toHaveLength(2)

      expect(harness.pending[0]!.options.signal?.aborted).toBe(true)
      harness.replaceCore(3)
      harness.pending[1]!.deferred.resolve()
      await flushPromises()

      expect(harness.visibleRows()).toEqual([row(1)])
      expect(harness.batches).toEqual([[{ type: `insert`, row: row(1) }]])
      expect(harness.callbackReads).toEqual([[row(1)]])

      harness.pending[0]!.deferred.reject(
        new DOMException(`obsolete`, `AbortError`),
      )
      await flushPromises()

      expect(harness.coreRows()).toEqual([row(3)])
      expect(harness.visibleRows()).toEqual([row(3)])
      expect(harness.batches).toEqual([
        [{ type: `insert`, row: row(1) }],
        [{ type: `update`, row: row(3), previousVersion: 1 }],
      ])
      expect(harness.callbackReads).toEqual([[row(1)], [row(3)]])
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await finishHarnessCleanup(primaryFailure, harness)
    }
  })

  it(`waits for every recovering source before publishing a joined replacement`, async () => {
    type Primary = { id: string; joinKey: string; version: number }
    type Secondary = { id: string; joinKey: string; version: number }

    const createSource = <T extends { id: string }>(id: string) => {
      let begin!: () => void
      let write!: (message: { type: `insert`; value: T }) => void
      let commit!: () => true | Promise<void>
      let truncate!: () => void
      const pending: Array<ReturnType<typeof createDeferred<void>>> = []
      const collection = createCollection<T>({
        id,
        getKey: ({ id: key }) => key,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: () => {
                const request = createDeferred<void>()
                pending.push(request)
                return request.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      return {
        collection,
        pending,
        async apply(row: T) {
          begin()
          write({ type: `insert`, value: row })
          const receipt = commit()
          if (receipt !== true) await receipt
        },
        replay() {
          begin()
          truncate()
          return commit()
        },
      }
    }

    const primary = createSource<Primary>(`joined-replay-primary`)
    const secondary = createSource<Secondary>(`joined-replay-secondary`)
    const live = createLiveQueryCollection((q) =>
      q
        .from({ primary: primary.collection })
        .innerJoin(
          { secondary: secondary.collection },
          ({ primary: left, secondary: right }) =>
            eq(left.joinKey, right.joinKey),
        )
        .orderBy(({ primary: row }) => row.version)
        .limit(1)
        .select(({ primary: left, secondary: right }) => ({
          id: left.id,
          secondaryId: right.id,
          primaryVersion: left.version,
          secondaryVersion: right.version,
        })),
    )
    const read = () =>
      live.toArray.map(
        ({ id, secondaryId, primaryVersion, secondaryVersion }) => ({
          id,
          secondaryId,
          primaryVersion,
          secondaryVersion,
        }),
      )
    const publications: Array<ReturnType<typeof read>> = []
    let subscription: ReturnType<typeof live.subscribeChanges> | undefined
    let primaryReplay: true | Promise<void> = true
    let secondaryReplay: true | Promise<void> = true

    let primaryFailure: { error: unknown } | undefined
    try {
      const preload = live.preload()
      await flushPromises()
      expect(primary.pending).toHaveLength(1)
      await primary.apply({ id: `p`, joinKey: `shared`, version: 1 })
      primary.pending[0]!.resolve()
      await flushPromises()
      expect(secondary.pending).toHaveLength(1)
      await secondary.apply({ id: `s`, joinKey: `shared`, version: 1 })
      secondary.pending[0]!.resolve()
      await flushPromises()
      for (const request of primary.pending.slice(1)) request.resolve()
      await preload
      expect(read()).toEqual([
        {
          id: `p`,
          secondaryId: `s`,
          primaryVersion: 1,
          secondaryVersion: 1,
        },
      ])

      subscription = live.subscribeChanges(() => publications.push(read()), {
        includeInitialState: false,
      })
      const initialPrimaryLoads = primary.pending.length
      const initialSecondaryLoads = secondary.pending.length
      primaryReplay = primary.replay()
      secondaryReplay = secondary.replay()
      await flushPromises()
      expect(primary.pending.length).toBeGreaterThan(initialPrimaryLoads)
      expect(secondary.pending.length).toBeGreaterThan(initialSecondaryLoads)

      await primary.apply({ id: `p`, joinKey: `shared`, version: 2 })
      await secondary.apply({ id: `s`, joinKey: `shared`, version: 2 })
      for (const request of primary.pending.slice(initialPrimaryLoads)) {
        request.resolve()
      }
      await flushPromises()

      expect(read()).toEqual([
        {
          id: `p`,
          secondaryId: `s`,
          primaryVersion: 1,
          secondaryVersion: 1,
        },
      ])
      expect(publications).toEqual([])

      for (const request of secondary.pending.slice(initialSecondaryLoads)) {
        request.resolve()
      }
      await Promise.all([primaryReplay, secondaryReplay])
      await flushPromises()

      expect(read()).toEqual([
        {
          id: `p`,
          secondaryId: `s`,
          primaryVersion: 2,
          secondaryVersion: 2,
        },
      ])
      expect(publications).toEqual([
        [
          {
            id: `p`,
            secondaryId: `s`,
            primaryVersion: 2,
            secondaryVersion: 2,
          },
        ],
      ])
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      await finishCleanup(primaryFailure, [
        [
          ...[...primary.pending, ...secondary.pending].map(
            (request, index) => ({
              name: `source request ${index}`,
              run: () => request.resolve(),
            }),
          ),
          { name: `subscription`, run: () => subscription?.unsubscribe() },
        ],
        [
          { name: `primary replay`, run: () => primaryReplay },
          { name: `secondary replay`, run: () => secondaryReplay },
          { name: `live query`, run: () => live.cleanup() },
          { name: `primary source`, run: () => primary.collection.cleanup() },
          {
            name: `secondary source`,
            run: () => secondary.collection.cleanup(),
          },
        ],
      ])
    }
  })
})

/**
 * # Ordered windows across truncate replays with adapter faults
 *
 * Contract: ARCHITECTURE.md, "Ordered requests, continuation, and recovery"
 * and the truncate-replay rules. An ordered live query shows the source's
 * first `limit` rows by rank. A truncate replays the demands its subscription
 * holds, and a failed replay keeps the prior public rows (law 9). A lease
 * release that throws reports its error, but it does not undo an acquisition
 * and it does not hold back the graph run that publishes a replay.
 *
 * Model: the source rows, with distinct ranks. The expected window sorts them
 * by rank and keeps the first `limit`.
 *
 * Laws, checked once loading is quiet:
 * - **Adapter release:** `unloadSubset` releases only a demand that
 *   `loadSubset` acquired, and no more often than it was acquired.
 * - **Settled window:** when no load failed, and no unload threw while a load
 *   issued after the last truncate was still unsettled, the window equals the
 *   model. An unload that throws after those loads settle is inside this law:
 *   it is a settlement-phase release, which must not hold back publication.
 *   An unload that throws while the replay starts can fail the replay, which
 *   law 9 allows, so the law does not judge that case.
 * - **Convergence:** after a final truncate with no faults, and an explicit
 *   window move that revalidates a window whose own move failed, the window
 *   equals the model.
 * - **Newest move wins:** a superseded window move resolves only after the
 *   newest move has settled, so an awaited move reflects the window that
 *   won. A superseded move that fails still rejects with its own error.
 * - **Include children:** wherever the window law holds, each shown row's
 *   included markers equal the model's: its own marker if it is marked, and
 *   none otherwise. A windowed query routes child demand only from the rows
 *   it shows (ARCHITECTURE.md), so this also judges child loads through
 *   holds, failures, and marker truncates.
 * - **Terminal error:** a failed lazy join demand load is fatal, because the
 *   join side can no longer be complete, so the query stays in `error` and
 *   convergence does not apply. Either side can be the lazy one: the planner
 *   loads an inner join's root by key when the marker source is eager. A
 *   demand load asks for keys (a `where` with no `orderBy`). A failed load
 *   that a truncate's replay issued is not fatal: it keeps the last
 *   publication until the next replay. A load that fails before the query
 *   first becomes ready is fatal too (an initial load failure), except on
 *   a lazy join source, which owns its demand. So a query may end in
 *   `error` only after a demand load issued outside a replay failed, or a
 *   load failed while the query was still loading. Replay renews demand held
 *   by that subscription before the truncate. A new subscription's first
 *   demand remains ordinary even if another subscription is replaying.
 * - **Status:** with no failed load, a quiet live query and its peer are
 *   `ready`; a release that throws does not change status.
 * - **Reported faults:** an injected fault may surface as a rejected load, a
 *   thrown release, a window move rejected by a load failure, or an error the
 *   subscription rethrows from a microtask. A window move whose load a
 *   truncate aborts may also reject with an `AbortError`. A release failure never rejects a
 *   window move. No other error may escape.
 *
 * History grammar: rank moves, holding the next loads, settling the oldest
 * held load with success or failure, truncates (optionally arming the next
 * unload once the replay has started), and arming the next unload to throw. The driver uses a real on-demand Collection with an index and an
 * ordered live query. At the end, every held load succeeds in order.
 *
 * The joined scenarios cross a LEFT join that keeps marked or unmarked rows
 * and an inner join, over an eager marker source or one that loads markers on
 * demand through the same held and failing loads; markers change and truncate
 * through sync.
 *
 * The include scenarios add a `toArray` child that reads the marker source
 * for each shown row.
 *
 * Limits: one ordered source; no full joins (the ordered-work oracle owns
 * them); includes one level deep; and a provider that reads its rows at the time it
 * answers.
 */
type OrderedRow = { id: number; rank: number }
type OrderedCommand =
  | { type: `move`; id: number; rank: number }
  | { type: `hold` }
  | { type: `settle`; ok: boolean }
  | { type: `truncate`; armAfterStart: boolean }
  | { type: `unloadThrows` }
  | { type: `window`; offset: 0 | 1; limit: 1 | 2 | 3 }
  | { type: `mark`; id: number; on: boolean }
  | { type: `truncateMarkers` }

// The query's order and window, whether ranks may tie, and whether a second
// live query reads the same source.
type OrderedScenario = {
  direction: `asc` | `desc`
  offset: 0 | 1
  limit: 1 | 2 | 3
  ties: boolean
  peer: boolean
  // How the query joins a marker source: none, a LEFT join that keeps marked
  // rows (`some`) or unmarked rows (`none`), or an inner join. A LEFT join
  // filter makes the order source filtered by a joined source.
  joined: false | `some` | `none` | `inner`
  // Whether the marker source holds every marker or loads them on demand,
  // sharing the history's held and failing loads.
  markerMode: `eager` | `on-demand`
  // Whether each shown row includes its markers as a `toArray` child.
  includes: boolean
}

const orderedScenario: fc.Arbitrary<OrderedScenario> = fc.record({
  direction: fc.constantFrom(`asc` as const, `desc` as const),
  offset: fc.constantFrom(0 as const, 1 as const),
  limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
  ties: fc.boolean(),
  peer: fc.boolean(),
  joined: fc.constantFrom(
    false as const,
    `some` as const,
    `none` as const,
    `inner` as const,
  ),
  markerMode: fc.constantFrom(`eager` as const, `on-demand` as const),
  includes: fc.boolean(),
})

const orderedCommand: fc.Arbitrary<OrderedCommand> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant(`move` as const),
      id: fc.integer({ min: 1, max: 5 }),
      rank: fc.integer({ min: 1, max: 60 }),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ type: `hold` as const }) },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant(`settle` as const),
      ok: fc.oneof(
        { weight: 3, arbitrary: fc.constant(true) },
        { weight: 1, arbitrary: fc.constant(false) },
      ),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`truncate` as const),
      // Arm the next unload once the replay has started, so it can throw
      // while the replay settles.
      armAfterStart: fc.boolean(),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ type: `unloadThrows` as const }) },
  {
    weight: 1,
    arbitrary: fc.constant({ type: `truncateMarkers` as const }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`mark` as const),
      id: fc.integer({ min: 1, max: 5 }),
      on: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`window` as const),
      offset: fc.constantFrom(0 as const, 1 as const),
      limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
    }),
  },
)

type OrderedReach = {
  settlementThrows: number
  throwsAfterReplay: number
  replayStartThrows: number
  heldAcrossTruncate: number
  failedLoads: number
  settledWindowChecks: number
  tiedWindows: number
  peerChecks: number
  windowMoves: number
  descendingRuns: number
  joinedRuns: number
  includeChecks: number
  markChanges: number
  antiJoinedRuns: number
  innerJoinedRuns: number
  markerLoads: number
  markerTruncates: number
  abortedMoves: number
  terminalErrors: number
}

const replayDemandStates = [
  `new-demand-failed-during-marker-replay`,
  `settled-marker-demand-replay-failed`,
] as const
type ReplayDemandState = (typeof replayDemandStates)[number]

const ordinaryOrderedScenario: OrderedScenario = {
  direction: `asc`,
  offset: 0,
  limit: 2,
  ties: false,
  peer: false,
  joined: false,
  markerMode: `eager`,
  includes: false,
}

async function checkOrderedReplay(
  history: Array<OrderedCommand>,
  scenario: OrderedScenario = ordinaryOrderedScenario,
  recordReach: (state: ReplayDemandState) => void = () => {},
): Promise<OrderedReach> {
  const sign = scenario.direction === `asc` ? 1 : -1
  let window = { offset: scenario.offset, limit: scenario.limit }
  // The newest window move wins: an older move that settles later does not
  // restore its window.
  let latestMove = 0
  // The newest call wins, so a superseded move resolves only after the
  // newest move settles: it then reflects the window that won. A superseded
  // move that fails still rejects with its own error.
  const settledMoves = new Set<number>([0])
  // A failed move leaves the window where it was, so the newest move that
  // resolved sets it.
  const failedMoves = new Set<number>()
  const newerMoveResolved = (move: number) => {
    for (let newer = move + 1; newer <= latestMove; newer++) {
      if (settledMoves.has(newer) && !failedMoves.has(newer)) return true
    }
    return false
  }
  let moveOrderViolation: string | undefined
  const settleMove = (move: number) => {
    if (move !== latestMove && !settledMoves.has(latestMove)) {
      moveOrderViolation ??= `window move ${move} settled before the newest move ${latestMove}`
    }
    settledMoves.add(move)
  }
  const peerWindow = { offset: scenario.offset, limit: scenario.limit }
  const truth = new Map<number, OrderedRow>(
    [1, 2, 3, 4, 5].map((id) => [id, { id, rank: id * 10 }]),
  )
  // With a joined source, only marked rows qualify; row 2 starts unmarked.
  const marked = new Set([1, 3, 4, 5])
  // Ties leave the order among equal ranks open, so the model predicts the
  // window's rank sequence. Each shown row must also carry its current rank.
  const expectedRanks = (shown: { offset: number; limit: number }) =>
    [...truth.values()]
      .filter(
        ({ id }) =>
          !scenario.joined ||
          (scenario.joined === `none` ? !marked.has(id) : marked.has(id)),
      )
      .map(({ rank }) => rank)
      .sort((left, right) => sign * (left - right))
      .slice(shown.offset, shown.offset + shown.limit)
  const checkWindow = (
    label: string,
    rows: Array<OrderedRow>,
    shown: { offset: number; limit: number },
  ) => {
    expect(
      rows.map(({ rank }) => rank),
      label,
    ).toEqual(expectedRanks(shown))
    for (const row of rows) {
      expect(row.rank, `${label}: row ${row.id} rank`).toBe(
        truth.get(row.id)?.rank,
      )
    }
    if (new Set(rows.map(({ rank }) => rank)).size < rows.length) {
      reach.tiedWindows++
    }
    if (!scenario.includes) return
    for (const row of rows as Array<OrderedRow & { markers?: Array<number> }>) {
      expect(row.markers, `${label}: row ${row.id} markers`).toEqual(
        marked.has(row.id) ? [row.id] : [],
      )
    }
    reach.includeChecks++
  }
  const installed = new Map<number, OrderedRow>()
  // Each load records the truncate count it was issued after, so a fault can
  // be placed before or after the replay's loads settle.
  type Load = { epoch: number; outcome: `pending` | `ok` | `failed` }
  const loads: Array<Load> = []
  const acquired = new Map<LoadSubsetOptions, number>()
  const markerRequests = new WeakSet<LoadSubsetOptions>()
  const held: Array<(ok: boolean) => void> = []
  let holding = false
  let truncates = 0
  let throwNextUnload = false
  // Window moves whose settlement waits on held loads.
  const pendingMoves: Array<Promise<void>> = []
  // The truncate starts its replay while it commits.
  let truncating = false
  let anyLoadFailed = false
  let earlyThrowSinceTruncate = false
  // Replay renews the leases held at its boundary. The adapter's subscription
  // token identifies an owner; evaluating its immutable predicate on this
  // finite key domain identifies the demand independently of production replay
  // state. Consume each captured lease once, so a new owner or different keys
  // cannot inherit another demand's replay classification.
  const demandKey = (options: LoadSubsetOptions, marker: boolean) =>
    JSON.stringify(
      [1, 2, 3, 4, 5].filter((id) =>
        options.where
          ? evaluateReferenceExpression(
              options.where,
              marker ? { id, rowId: id } : truth.get(id)!,
            ) === true
          : true,
      ),
    )
  const replayDemands = {
    source: [] as Array<LoadSubsetOptions>,
    marker: [] as Array<LoadSubsetOptions>,
  }
  let markerTruncating = false
  let hadMarkerDemand = false
  const isReplayDemand = (options: LoadSubsetOptions, marker: boolean) => {
    const previous = marker ? replayDemands.marker : replayDemands.source
    const index = previous.findIndex(
      (previousOptions) =>
        previousOptions.subscription === options.subscription &&
        demandKey(previousOptions, marker) === demandKey(options, marker),
    )
    if (index < 0) return false
    previous.splice(index, 1)
    return true
  }
  let demandFailed = false
  // A failed initial load is fatal too (error 229). The queries are created
  // below; a load can only fail after they start.
  const queries: Array<{ status: string }> = []
  let failedWhileLoading = false
  // Adapter callbacks set these flags, so read them through a call.
  const fatalLoadFailed = () => demandFailed || failedWhileLoading
  // Lazy join demand asks for keys; ordered and full-source loads do not.
  const isDemand = (options: LoadSubsetOptions) =>
    options.where !== undefined && options.orderBy === undefined
  let violation: string | undefined
  // The faults this history injects. They may surface as rejected loads, as
  // thrown releases, or as errors the subscription rethrows from a microtask,
  // which is how it reports async subscriber errors. Any other escaped error
  // is a broken law.
  const injected = new WeakSet<Error>()
  // Release faults. A cleanup failure does not fail the load it follows
  // (ARCHITECTURE.md), so a window move rejected only by one still moved.
  const cleanupFaults = new WeakSet<Error>()
  const inject = (error: Error) => {
    injected.add(error)
    return error
  }
  let escaped: unknown
  const escapedError = () => escaped
  // Adapter callbacks set these flags, so read them through a call.
  const faultExcusesWindow = () => anyLoadFailed || earlyThrowSinceTruncate
  const anyLoadFailedNow = () => anyLoadFailed
  const reach: OrderedReach = {
    settlementThrows: 0,
    throwsAfterReplay: 0,
    replayStartThrows: 0,
    heldAcrossTruncate: 0,
    failedLoads: 0,
    settledWindowChecks: 0,
    tiedWindows: 0,
    peerChecks: 0,
    windowMoves: 0,
    descendingRuns: scenario.direction === `desc` ? 1 : 0,
    joinedRuns: scenario.joined ? 1 : 0,
    includeChecks: 0,
    markChanges: 0,
    antiJoinedRuns: scenario.joined === `none` ? 1 : 0,
    innerJoinedRuns: scenario.joined === `inner` ? 1 : 0,
    markerLoads: 0,
    markerTruncates: 0,
    abortedMoves: 0,
    terminalErrors: 0,
  }
  type Marker = { id: number; rowId: number }
  let markerSync!: Parameters<SyncConfig<Marker, number>[`sync`]>[0]
  const installedMarkers = new Set<number>()
  // The query reads the marker source through a join, an include, or both.
  const readsMarkers = scenario.joined !== false || scenario.includes
  const onDemandMarkers = readsMarkers && scenario.markerMode === `on-demand`
  const markers = createCollection<Marker, number>({
    getKey: (marker) => marker.id,
    ...(onDemandMarkers
      ? { syncMode: `on-demand` as const, autoIndex: `eager` as const }
      : {}),
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        markerSync = operations
        if (!onDemandMarkers) {
          operations.begin()
          for (const id of marked) {
            operations.write({ type: `insert`, value: { id, rowId: id } })
            installedMarkers.add(id)
          }
          operations.commit()
          operations.markReady()
          return
        }
        operations.markReady()
        return {
          // Marker loads share the history's held and failing loads, so
          // joined work can stay pending or fail.
          loadSubset: async (options) => {
            const replay = isReplayDemand(options, true)
            // These are adapter-entry witnesses, independent of the expected
            // terminal status. A new logical demand cannot renew a captured
            // demand merely because both use the same source or subscription.
            const newDemandDuringReplay =
              !replay &&
              isDemand(options) &&
              markerTruncating &&
              hadMarkerDemand
            const settledReplay =
              replay &&
              queries.length > 0 &&
              queries.every(({ status }) => status === `ready`)
            markerRequests.add(options)
            acquired.set(options, (acquired.get(options) ?? 0) + 1)
            const load: Load = { epoch: truncates, outcome: `pending` }
            loads.push(load)
            reach.markerLoads++
            const demand = !replay && isDemand(options)
            if (holding) {
              const ok = await new Promise<boolean>((resolve) =>
                held.push(resolve),
              )
              if (!ok) {
                if (!options.signal?.aborted) {
                  if (newDemandDuringReplay)
                    recordReach(`new-demand-failed-during-marker-replay`)
                  if (settledReplay)
                    recordReach(`settled-marker-demand-replay-failed`)
                }
                load.outcome = `failed`
                anyLoadFailed = true
                if (demand) demandFailed = true
                if (queries.some(({ status }) => status === `loading`)) {
                  failedWhileLoading = true
                }
                reach.failedLoads++
                throw inject(new Error(`marker load failed`))
              }
            } else await Promise.resolve()
            if (options.signal?.aborted) {
              load.outcome = `ok`
              return
            }
            operations.begin()
            for (const id of marked) {
              const value = { id, rowId: id }
              if (
                options.where &&
                evaluateReferenceExpression(options.where, value) !== true
              ) {
                continue
              }
              operations.write({
                type: markers.has(id) ? `update` : `insert`,
                value,
              })
              installedMarkers.add(id)
            }
            await operations.commit()
            load.outcome = `ok`
          },
          unloadSubset: (options) => {
            const count = acquired.get(options) ?? 0
            if (count === 0) {
              violation ??= `marker unloadSubset released a demand it did not hold`
            }
            acquired.set(options, count - 1)
          },
        }
      },
    },
  })
  let sync!: Parameters<SyncConfig<OrderedRow, number>[`sync`]>[0]
  const source = createCollection<OrderedRow, number>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        sync.markReady()
        return {
          loadSubset: async (options) => {
            const replay = isReplayDemand(options, false)
            acquired.set(options, (acquired.get(options) ?? 0) + 1)
            const load: Load = { epoch: truncates, outcome: `pending` }
            loads.push(load)
            const demand = !replay && isDemand(options)
            if (holding) {
              const ok = await new Promise<boolean>((resolve) =>
                held.push(resolve),
              )
              if (!ok) {
                load.outcome = `failed`
                anyLoadFailed = true
                if (demand) demandFailed = true
                if (queries.some(({ status }) => status === `loading`)) {
                  failedWhileLoading = true
                }
                reach.failedLoads++
                throw inject(new Error(`load failed`))
              }
            } else await Promise.resolve()
            if (options.signal?.aborted) {
              load.outcome = `ok`
              return
            }
            const rows = [...truth.values()]
              .filter(
                (row) =>
                  (!options.where ||
                    evaluateReferenceExpression(options.where, row) === true) &&
                  (!options.cursor ||
                    evaluateReferenceExpression(
                      options.cursor.whereFrom,
                      row,
                    ) === true),
              )
              .sort((left, right) => {
                const direction =
                  options.orderBy?.[0]?.compareOptions.direction === `desc`
                    ? -1
                    : 1
                return (
                  direction * (left.rank - right.rank) || left.id - right.id
                )
              })
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            const selected = rows.slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
            sync.begin()
            // A provider answers a load with every row it selects; a replay
            // after a truncate must redeliver them.
            for (const value of selected) {
              sync.write({
                type: source.has(value.id) ? `update` : `insert`,
                value,
              })
              installed.set(value.id, value)
            }
            await sync.commit()
            load.outcome = `ok`
          },
          unloadSubset: (options) => {
            const count = acquired.get(options) ?? 0
            if (count === 0) {
              violation ??= `unloadSubset released a demand it did not hold`
            }
            acquired.set(options, count - 1)
            if (!throwNextUnload) return
            throwNextUnload = false
            // A release during the replay's start, while one of its loads is
            // unsettled, may fail the replay; one after they settle may not.
            const replayUnsettled =
              truncating ||
              (truncates > 0 &&
                loads.some(
                  ({ epoch, outcome }) =>
                    epoch === truncates && outcome === `pending`,
                ))
            if (replayUnsettled) {
              earlyThrowSinceTruncate = true
              reach.replayStartThrows++
            } else if (truncates > 0) reach.throwsAfterReplay++
            else reach.settlementThrows++
            const failure = inject(new Error(`unload failed`))
            // One during a replay's start fails that replay instead.
            if (!replayUnsettled) cleanupFaults.add(failure)
            throw failure
          },
        }
      },
    },
  })
  const query = () =>
    createLiveQueryCollection((q) => {
      const from = q.from({ row: source })
      const filtered =
        scenario.joined === `inner`
          ? from.innerJoin({ marker: markers }, ({ row, marker }) =>
              eq(row.id, marker.rowId),
            )
          : scenario.joined
            ? from
                .leftJoin({ marker: markers }, ({ row, marker }) =>
                  eq(row.id, marker.rowId),
                )
                .where(({ marker }) =>
                  scenario.joined === `none`
                    ? isUndefined(marker.rowId)
                    : not(isUndefined(marker.rowId)),
                )
            : from
      return filtered
        .orderBy(({ row }) => row.rank, scenario.direction)
        .offset(scenario.offset)
        .limit(scenario.limit)
        .select(({ row }) =>
          scenario.includes
            ? {
                id: row.id,
                rank: row.rank,
                markers: toArray(
                  q
                    .from({ child: markers })
                    .where(({ child }) => eq(child.rowId, row.id))
                    .select(({ child }) => child.id),
                ),
              }
            : { id: row.id, rank: row.rank },
        )
    })
  const live = query()
  queries.push(live)
  // A peer reads the same source; its leases must survive the first
  // query's retirements, so its window obeys the same law.
  const peer = scenario.peer ? query() : undefined
  if (peer) queries.push(peer)
  // A subscriber keeps each live query from garbage collection while a
  // history waits on held loads.
  const subscriptions = [live, peer].flatMap((collection) =>
    collection ? [collection.subscribeChanges(() => {})] : [],
  )
  const swallow = (error: unknown) => {
    if (!(error instanceof Error && injected.has(error))) escaped ??= error
  }
  process.on(`unhandledRejection`, swallow)
  const queueMicrotask = globalThis.queueMicrotask.bind(globalThis)
  const microtasks = vi
    .spyOn(globalThis, `queueMicrotask`)
    .mockImplementation((callback) =>
      queueMicrotask(() => {
        try {
          callback()
        } catch (error) {
          swallow(error)
        }
      }),
    )
  const settleAll = async () => {
    // Each truncate replays every retained demand of each query, so a long
    // held history can hold hundreds of loads. A load that starts another
    // without end still fails.
    for (let round = 0; round < 1000; round++) {
      await flushPromises()
      const next = held.shift()
      if (!next) return
      next(true)
    }
    throw new Error(`held loads did not drain`)
  }
  const truncate = async () => {
    replayDemands.source = [...acquired].flatMap(([options, count]) =>
      count > 0 && !markerRequests.has(options)
        ? Array.from({ length: count }, () => options)
        : [],
    )
    truncates++
    earlyThrowSinceTruncate = false
    if (held.length > 0) reach.heldAcrossTruncate++
    installed.clear()
    truncating = true
    try {
      sync.begin()
      sync.truncate()
      await sync.commit()
    } catch (error) {
      swallow(error)
    } finally {
      truncating = false
    }
  }
  // An eager marker source rewrites its rows; an on-demand one replays the
  // demand it retains.
  const truncateMarkers = async () => {
    replayDemands.marker = [...acquired].flatMap(([options, count]) =>
      count > 0 && markerRequests.has(options)
        ? Array.from({ length: count }, () => options)
        : [],
    )
    hadMarkerDemand = replayDemands.marker.length > 0
    installedMarkers.clear()
    markerSync.begin()
    markerSync.truncate()
    if (!onDemandMarkers) {
      for (const id of marked) {
        markerSync.write({ type: `insert`, value: { id, rowId: id } })
        installedMarkers.add(id)
      }
    }
    markerTruncating = true
    let receipt: true | Promise<void>
    try {
      receipt = markerSync.commit()
    } finally {
      markerTruncating = false
    }
    if (receipt !== true) await receipt
  }
  try {
    await live.preload()
    await peer?.preload()
    for (const command of history) {
      try {
        switch (command.type) {
          case `move`: {
            const ranks = new Set(
              [...truth.values()]
                .filter(({ id }) => id !== command.id)
                .map(({ rank }) => rank),
            )
            if (!scenario.ties && ranks.has(command.rank)) break
            // With ties, ranks come from the five starting ranks, so moved
            // rows often tie with others.
            const rank = scenario.ties
              ? 10 * (1 + (command.rank % 5))
              : command.rank
            const value = { id: command.id, rank }
            // The provider delivers every source change, as a live sync does.
            truth.set(command.id, value)
            sync.begin()
            sync.write({
              type: installed.has(command.id) ? `update` : `insert`,
              value,
            })
            installed.set(command.id, value)
            await sync.commit()
            break
          }
          case `hold`:
            holding = true
            break
          case `settle`: {
            holding = false
            held.shift()?.(command.ok)
            break
          }
          case `truncate`:
            await truncate()
            if (command.armAfterStart) throwNextUnload = true
            break
          case `unloadThrows`:
            throwNextUnload = true
            break
          // A row gains or loses its marker in the joined source.
          case `mark`: {
            if (!readsMarkers || marked.has(command.id) === command.on) {
              break
            }
            reach.markChanges++
            if (command.on) marked.add(command.id)
            else marked.delete(command.id)
            // The marker provider delivers every change, as a live sync does.
            markerSync.begin()
            if (command.on) {
              markerSync.write({
                type: `insert`,
                value: { id: command.id, rowId: command.id },
              })
              installedMarkers.add(command.id)
            } else if (installedMarkers.delete(command.id)) {
              markerSync.write({ type: `delete`, key: command.id })
            }
            markerSync.commit()
            break
          }
          // The joined source truncates. An eager source redelivers every
          // marker; an on-demand one replays its loaded demands.
          case `truncateMarkers`: {
            if (!readsMarkers) break
            reach.markerTruncates++
            await truncateMarkers()
            break
          }
          // An explicit window move on the first query, which also retries
          // its failed requests.
          // A move that rejects, as one does after a failed source recovery,
          // leaves the window where it was. A release failure never rejects
          // a move.
          case `window`: {
            const requested = { offset: command.offset, limit: command.limit }
            reach.windowMoves++
            const move = ++latestMove
            const settled = live.utils.setWindow(requested)
            if (settled === true) {
              settleMove(move)
              window = requested
              break
            }
            const applied = settled.then(
              () => {
                settleMove(move)
                if (!newerMoveResolved(move)) window = requested
              },
              (error: unknown) => {
                settledMoves.add(move)
                failedMoves.add(move)
                // A release failure does not fail the move, so it must not
                // reject it either.
                if (error instanceof Error && cleanupFaults.has(error)) {
                  escaped ??= error
                }
                // A truncate aborts the load a move waits on (ARCHITECTURE.md);
                // the move then rejects and the window stays where it was.
                if (error instanceof Error && error.name === `AbortError`) {
                  reach.abortedMoves++
                  return
                }
                swallow(error)
              },
            )
            // A held load holds the move's settlement; the end settles it.
            if (!holding && held.length === 0) await applied
            else pendingMoves.push(applied)
            break
          }
        }
      } catch (error) {
        swallow(error)
      }
      await flushPromises()
      replayDemands.source = []
      replayDemands.marker = []
      // Classify terminal errors at the failing history cut, before final
      // recovery can hide an incorrect transition.
      for (const shown of queries) {
        if (shown.status === `error`) {
          expect(fatalLoadFailed(), `history: terminal error`).toBe(true)
        }
      }
    }
    holding = false
    throwNextUnload = false
    await settleAll()
    await Promise.all(pendingMoves.splice(0))
    await settleAll()
    await flushPromises()
    if (violation) throw new Error(`adapter release: ${violation}`)
    if (moveOrderViolation) {
      throw new Error(`newest move wins: ${moveOrderViolation}`)
    }
    if (escapedError() !== undefined) {
      throw new Error(`escaped error: only injected faults may surface`, {
        cause: escapedError(),
      })
    }
    // Status: a release that throws is reported, but it fails no load, so a
    // quiet query with no failed load stays ready.
    if (!anyLoadFailedNow()) {
      expect(live.status, `status`).toBe(`ready`)
      if (peer) expect(peer.status, `peer status`).toBe(`ready`)
    }
    if (!faultExcusesWindow()) {
      reach.settledWindowChecks++
      checkWindow(`settled window`, live.toArray, window)
      if (peer) {
        reach.peerChecks++
        checkWindow(`settled peer window`, peer.toArray, peerWindow)
      }
    }
    // A failed replay keeps the last complete publication until a later
    // authoritative replay of that source (ARCHITECTURE.md), so recovery
    // replays every source.
    await truncate()
    if (readsMarkers) await truncateMarkers()
    await settleAll()
    await flushPromises()
    if (violation) throw new Error(`adapter release: ${violation}`)
    if (escapedError() !== undefined) {
      throw new Error(`escaped error: only injected faults may surface`, {
        cause: escapedError(),
      })
    }
    // A failed window operation stays private until a later explicit move
    // revalidates it (ARCHITECTURE.md), so recovery ends with one.
    const revalidated = live.utils.setWindow(window)
    if (revalidated !== true) await revalidated.catch(swallow)
    await settleAll()
    for (const [shown, label, expected] of [
      [live, `convergence`, window],
      ...(peer ? [[peer, `peer convergence`, peerWindow] as const] : []),
    ] as const) {
      if (shown.status === `error`) {
        expect(fatalLoadFailed(), `${label}: terminal error`).toBe(true)
        reach.terminalErrors++
      } else checkWindow(label, shown.toArray, expected)
    }
  } finally {
    holding = false
    for (const resolve of held.splice(0)) resolve(true)
    for (const subscription of subscriptions) subscription.unsubscribe()
    await live.cleanup().catch(swallow)
    await peer?.cleanup().catch(swallow)
    await markers.cleanup().catch(swallow)
    await flushPromises()
    process.off(`unhandledRejection`, swallow)
    microtasks.mockRestore()
  }
  return reach
}

const orderedReplayProperty = `replay.ordered-window-faults`
const orderedReplayConfig = readOracleRunConfig()
const orderedReplayCampaigns =
  orderedReplayConfig.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : orderedReplayConfig.replayProperty === orderedReplayProperty
      ? ([`replay`] as const)
      : ([] as const)

describe(`Ordered windows across truncate replays`, () => {
  // Traces the campaigns found, kept as replays. Each failed before its fix:
  // - an unload that throws while a successful repair retires an older
  //   lease (the rejected participant counted as a failed load, so the
  //   builder held the window on the old rows);
  // - an unload that throws while a truncate replay settles (the replay's
  //   graph run was never scheduled, so the window kept the old rows);
  // - an unload that throws during a window move whose load succeeded (the
  //   builder recorded the cleanup error as the move's failure, so the
  //   window stayed private until another move);
  // - an on-demand joined source that truncates while a marker load is held
  //   (its loads finished without delivering a new row, and nothing ran the
  //   graph that the pending joined work had held, so the window stayed on
  //   old rows until an unrelated write);
  // - a window move whose joined load a truncate aborts (the model counted
  //   the move's AbortError as an escaped fault; it is a legal rejection, and
  //   this replay keeps the branch reached);
  // - a window move that retires lazy joined demand whose release throws (the
  //   subscription reported the release failure as a load error, so the move
  //   rejected with it; core now reports it uncaught);
  // - a held marker demand load that fails (the model expected convergence,
  //   but a failed lazy join demand is fatal by design; this replay keeps the
  //   terminal-error branch reached);
  // - two window moves while a load is held (the model let the older move,
  //   which settled later, restore its window; the newest move wins);
  // - an inner join whose lazy root demand load fails (the model allowed a
  //   terminal error only for marker loads; either side can be lazy);
  // - a window move that a deferred newer move supersedes (it resolved when
  //   its own load settled, before the newer move resumed, so awaiting it
  //   showed neither window);
  // - two window moves that a pending source recovery defers (both resumed
  //   after recovery, the older one last, so it replaced the newer window).
  it.each([
    {
      name: `a release that throws after a successful repair`,
      history: [
        { type: `unloadThrows` },
        { type: `move`, id: 2, rank: 1 },
        { type: `unloadThrows` },
      ],
    },
    {
      name: `a release that throws while a replay settles`,
      history: [
        { type: `unloadThrows` },
        { type: `truncate`, armAfterStart: false },
        { type: `move`, id: 1, rank: 21 },
        { type: `truncate`, armAfterStart: true },
      ],
    },
    {
      name: `a release that throws during a successful window move`,
      history: [
        { type: `unloadThrows` },
        { type: `hold` },
        { type: `move`, id: 1, rank: 1 },
        { type: `window`, offset: 0, limit: 1 },
        { type: `settle`, ok: true },
        { type: `move`, id: 1, rank: 41 },
        { type: `settle`, ok: true },
      ],
      scenario: { ...ordinaryOrderedScenario, limit: 1 },
    },
    {
      name: `an on-demand joined source that truncates while a marker load is held`,
      history: [
        { type: `hold` },
        { type: `move`, id: 3, rank: 1 },
        { type: `truncateMarkers` },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `some`,
        markerMode: `on-demand`,
      },
    },
    {
      name: `a window move whose joined load a truncate aborts`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
        { type: `move`, id: 1, rank: 1 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
      },
      reaches: `abortedMoves`,
    },
    {
      name: `a window move that retires lazy joined demand whose release throws`,
      history: [
        { type: `unloadThrows` },
        { type: `truncate`, armAfterStart: true },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `inner`,
        markerMode: `on-demand`,
      },
    },
    {
      name: `a held marker demand load that fails`,
      history: [
        { type: `hold` },
        { type: `move`, id: 1, rank: 1 },
        { type: `move`, id: 5, rank: 1 },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        direction: `desc`,
        limit: 1,
        ties: true,
        joined: `some`,
        markerMode: `on-demand`,
      },
      reaches: `terminalErrors`,
    },
    {
      name: `a new include demand during another subscription's replay`,
      history: [
        { type: `hold` },
        { type: `move`, id: 1, rank: 1 },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      terminal: true,
    },
    {
      name: `a failed replay of settled joined demand`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `some`,
        markerMode: `on-demand`,
      },
      terminal: false,
    },
    {
      name: `two window moves while a load is held`,
      history: [
        { type: `hold` },
        { type: `window`, offset: 1, limit: 2 },
        { type: `window`, offset: 0, limit: 1 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        offset: 1,
        limit: 1,
        joined: `none`,
      },
    },
    {
      name: `an inner join whose lazy root demand load fails`,
      history: [
        { type: `hold` },
        { type: `mark`, id: 2, on: true },
        { type: `settle`, ok: false },
        { type: `move`, id: 1, rank: 1 },
      ],
      scenario: { ...ordinaryOrderedScenario, limit: 1, joined: `inner` },
      reaches: `terminalErrors`,
    },
    {
      name: `a window move that a deferred newer move supersedes`,
      history: [
        { type: `hold` },
        { type: `move`, id: 1, rank: 1 },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
        { type: `window`, offset: 0, limit: 1 },
      ],
      scenario: { ...ordinaryOrderedScenario, limit: 1 },
    },
    {
      name: `two window moves that a pending source recovery defers`,
      history: [
        { type: `hold` },
        { type: `truncate`, armAfterStart: false },
        { type: `window`, offset: 1, limit: 1 },
        { type: `move`, id: 1, rank: 1 },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncateMarkers` },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
      },
    },
  ] satisfies Array<{
    name: string
    history: Array<OrderedCommand>
    scenario?: OrderedScenario
    reaches?: keyof OrderedReach
    terminal?: boolean
  }>)(
    `keeps the ordered window for $name (generated replay)`,
    async ({ history, scenario, ...replay }) => {
      const entered = new Set<ReplayDemandState>()
      const reach = await checkOrderedReplay(history, scenario, (state) =>
        entered.add(state),
      )
      if (`terminal` in replay) {
        expect(reach.terminalErrors > 0).toBe(replay.terminal)
        expect(entered).toContain(
          replay.terminal ? replayDemandStates[0] : replayDemandStates[1],
        )
      }
      const reaches: keyof OrderedReach | undefined =
        `reaches` in replay ? replay.reaches : undefined
      if (reaches) expect(reach[reaches], reaches).toBeGreaterThan(0)
    },
  )

  it.each(orderedReplayCampaigns)(
    `keeps the ordered window under load and release faults (%s campaign)`,
    async (campaign) => {
      const total: OrderedReach = {
        settlementThrows: 0,
        throwsAfterReplay: 0,
        replayStartThrows: 0,
        heldAcrossTruncate: 0,
        failedLoads: 0,
        settledWindowChecks: 0,
        tiedWindows: 0,
        peerChecks: 0,
        windowMoves: 0,
        descendingRuns: 0,
        joinedRuns: 0,
        includeChecks: 0,
        markChanges: 0,
        antiJoinedRuns: 0,
        innerJoinedRuns: 0,
        markerLoads: 0,
        markerTruncates: 0,
        abortedMoves: 0,
        terminalErrors: 0,
      }
      // The broad property claims these dimensions, not the rare terminal
      // interaction owned by the subscription-specific property below.
      const dimensions = (
        Object.keys(total) as Array<keyof OrderedReach>
      ).filter(
        (dimension) =>
          dimension !== `abortedMoves` && dimension !== `terminalErrors`,
      )
      const declared = createOracleReach(orderedReplayProperty, dimensions)
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderedCommand, { minLength: 1, maxLength: 12 }),
          orderedScenario,
          async (history, scenario) => {
            declared.beginHistory()
            const reach = await checkOrderedReplay(history, scenario)
            for (const key of dimensions) {
              if (reach[key] > 0) declared.reach(key)
            }
          },
        ),
        campaign === `fixed`
          ? { seed: 20261021, numRuns: oracleRuns(300) }
          : oraclePropertyOptions(300, orderedReplayProperty),
      )
      console.info(
        orderedReplayProperty,
        campaign,
        Object.fromEntries(declared.counts()),
      )
      declared.assertReached()
      // Reach witnesses: releases throw without a truncate, while a replay
      // starts, and while it settles; loads fail and stay held across a
      // truncate; and the settled-window law is checked.
      // An aborted move needs a truncate to land inside a held move, and a
      // terminal error needs a held marker demand load to fail; the named
      // replays above reach both.
      // Counts above are histories, rather than repeated events in one trace.
    },
    120_000,
  )
})

/**
 * The broad grammar can legally reach these states, but its normal campaigns
 * did not each reach both states in the audit. This process grammar keeps marker replay
 * and held failure adjacent while varying prior replay count, the moved row,
 * its rank and the failure origin. It uses the same driver,
 * independent classification and observation cuts as the broad property.
 *
 * An include may start new ordinary demand during another owner's
 * replacement; a settled joined owner renews its own demand. The adapter must
 * witness each failed acquisition in normal fixed and random campaigns.
 * Aborted work does not count. Named neighbors above calibrate both witnesses.
 */
const replayDemandProperty = `replay.subscription-demand-origin`
const replayDemandCampaigns =
  orderedReplayConfig.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : orderedReplayConfig.replayProperty === replayDemandProperty
      ? ([`replay`] as const)
      : ([] as const)
const replayDemandHistory = fc.record({
  origin: fc.constantFrom(`new-demand` as const, `renewal` as const),
  previousReplays: fc.integer({ min: 0, max: 3 }),
  move: fc.record({
    id: fc.constantFrom(1, 3, 4, 5),
    rank: fc.integer({ min: 1, max: 9 }),
  }),
})

describe(`subscription-specific replay demand`, () => {
  it.each(replayDemandCampaigns)(
    `distinguishes failed demand origins (%s campaign)`,
    async (campaign) => {
      const declared = createOracleReach(
        replayDemandProperty,
        replayDemandStates,
      )
      await fc.assert(
        fc.asyncProperty(replayDemandHistory, async (generated) => {
          declared.beginHistory()
          const history: Array<OrderedCommand> = [
            ...Array.from({ length: generated.previousReplays }, () => ({
              type: `truncateMarkers` as const,
            })),
            { type: `hold` },
            ...(generated.origin === `new-demand`
              ? [{ type: `move` as const, ...generated.move }]
              : []),
            { type: `truncateMarkers` },
            ...Array.from(
              { length: generated.origin === `new-demand` ? 1 : 0 },
              () => ({
                type: `settle` as const,
                ok: true,
              }),
            ),
            { type: `settle`, ok: false },
          ]
          const entered = new Set<ReplayDemandState>()
          const reach = await checkOrderedReplay(
            history,
            {
              ...ordinaryOrderedScenario,
              limit: 1,
              joined: generated.origin === `new-demand` ? `none` : `some`,
              markerMode: `on-demand`,
              includes: generated.origin === `new-demand`,
            },
            (state) => {
              entered.add(state)
              declared.reach(state)
            },
          )
          // Ordinary failure must become terminal, not merely be permitted to.
          // A settled renewal must keep the query available for later replay.
          if (entered.has(replayDemandStates[0]))
            expect(reach.terminalErrors, `ordinary failure is terminal`).toBe(1)
          if (entered.has(replayDemandStates[1]))
            expect(reach.terminalErrors, `replay failure is nonterminal`).toBe(
              0,
            )
        }),
        campaign === `fixed`
          ? { seed: 2233, numRuns: oracleRuns(75) }
          : oraclePropertyOptions(75, replayDemandProperty),
      )
      console.info(
        replayDemandProperty,
        campaign,
        Object.fromEntries(declared.counts()),
      )
      declared.assertReached()
    },
    120_000,
  )
})
