import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import {
  createLiveQueryCollection,
  eq,
  isUndefined,
  not,
  toArray,
} from '../../src/query/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { createOracleReach } from '../oracle-reach.js'
import { flushPromises } from '../utils.js'
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
 * - **Retention:** a truncate replay is one publication barrier (law 9 and
 *   "Replay participants and failure"). It rises when a source truncates and
 *   falls when its replay succeeds. Every load the source starts while its
 *   replay is open joins the barrier; a load that a newer truncate aborts or
 *   whose demand retires stops participating, and work an older replay
 *   started still holds the newer one. A participant that fails fails the
 *   replay while its logical demand is held. Once that demand retires, its
 *   failure no longer counts, and demand started meanwhile joins the
 *   replacement, which publishes when it succeeds; otherwise only a later
 *   truncate of that source can replace the failed replay. While
 *   any barrier is up, the query shows exactly the rows it showed when the
 *   first one rose: partly replayed rows, rank moves, and marker changes stay
 *   private, and a failed replay keeps that result instead of ending the
 *   query. The law is checked after every command and once loading is quiet,
 *   for barriers that rise after the query first became ready; before that
 *   there is no complete publication to keep, and initial readiness governs.
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
 *   that belongs to a truncate's recovery is not fatal: the replay fails, and
 *   the query keeps its last publication until a later replay of that source
 *   (law 9). Two kinds of load belong to a recovery:
 *   - a replay load, which asks again for a demand the source held before
 *     the truncate; and
 *   - a demand load that the graph starts while the truncate commits. The
 *     commit deletes the source's rows privately, so the query can demand
 *     keys that it never published, such as a row that a LEFT join filter
 *     now keeps.
 *   A load that joins an open replay belongs to it as well, which covers a
 *   demand that the graph starts after the commit while the replay still
 *   loads. The model judges that only where the source has one subscription
 *   in the query (see Limits).
 *   A load that fails before the query first becomes ready is fatal too (an
 *   initial load failure), except on a lazy join source, which owns its
 *   demand. So a query may end in `error` only after a demand load outside a
 *   recovery failed, or a load failed while the query was still loading.
 * - **Status:** with no failed load, a quiet live query and its peer are
 *   `ready`; a release that throws does not change status.
 * - **Initial readiness:** when the history starts during the initial
 *   preload, that preload has resolved or rejected once loading is quiet. A
 *   failure before the first ready ends the query, so the preload cannot wait
 *   for a later truncate.
 * - **Reported faults:** an injected fault may surface as a rejected load, a
 *   thrown release, a window move rejected by a load failure, or an error the
 *   subscription rethrows from a microtask. A window move whose load a
 *   truncate aborts may also reject with an `AbortError`. A release failure never rejects a
 *   window move. No other error may escape.
 *
 * History grammar: rank moves, holding the next loads, settling the oldest
 * or newest held load with success or failure (optionally keeping later
 * loads held),
 * truncates (optionally arming the next unload once the replay has started),
 * and arming the next unload to throw. A history may start while the initial
 * preload's loads are held. A marker load whose request was aborted either
 * resolves without writing or rejects with `AbortError`, as the source
 * contract asks; an `AbortError` is not a failed load. The driver uses a real on-demand Collection with an index and an
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
 * answers. The adapter boundary cannot tell which subscription issued a load,
 * and each subscription has its own replay. So the retention law, and the
 * rule that a replay participant counts as recovery, apply only where each
 * recovering source has one subscription in the query: the order source
 * without a peer, and the marker source unless the query both joins and
 * includes it (or a peer reads it too). A release that throws while a replay starts may
 * fail that replay, so the retention law skips a barrier where one did.
 */
type OrderedRow = { id: number; rank: number }
type OrderedCommand =
  | { type: `move`; id: number; rank: number }
  | { type: `hold` }
  // `keepHolding` leaves later loads held, so a history can settle one load
  // while the next stays pending. `newest` settles the most recently held
  // load instead of the oldest, so a later load can settle before an earlier
  // one, as independent provider requests may.
  | { type: `settle`; ok: boolean; keepHolding?: boolean; newest?: boolean }
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
  // How a marker load whose request was aborted settles. The source contract
  // asks a source to reject it with `AbortError` once its accepted rows apply;
  // a source that cannot cancel may also resolve it without writing.
  abortedMarkerLoads: `resolve` | `reject`
  // Whether the history starts while the initial preload is still held.
  historyDuringPreload: boolean
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
  abortedMarkerLoads: fc.constantFrom(`resolve` as const, `reject` as const),
  historyDuringPreload: fc.boolean(),
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
      keepHolding: fc.boolean(),
      newest: fc.boolean(),
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
  replayLoads: number
  abortRejections: number
  preloadChecks: number
  heldPublicationChecks: number
  retainedFailedReplays: number
  participantDemandFailures: number
  includeDemandFailures: number
  preloadReplayFailures: number
  discardedReplayMoves: number
}

const ordinaryOrderedScenario: OrderedScenario = {
  direction: `asc`,
  offset: 0,
  limit: 2,
  ties: false,
  peer: false,
  joined: false,
  markerMode: `eager`,
  includes: false,
  abortedMarkerLoads: `resolve`,
  historyDuringPreload: false,
}

async function checkOrderedReplay(
  history: Array<OrderedCommand>,
  scenario: OrderedScenario = ordinaryOrderedScenario,
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
  // Retention model. Each source with an open or failed replay has a
  // barrier. `pending` holds the loads that still hold its publication: the
  // loads started while it is up, and work an older replay started. `own`
  // holds the loads this replay started, whose failure fails it. A failure
  // is scoped to its logical demand: once that demand retires, it no longer
  // fails the replay, and demand started meanwhile joins the replacement.
  type BarrierSource = `rows` | `markers`
  type Barrier = {
    failures: Map<Load, LoadSubsetOptions>
    // A release threw while this replay started, which may fail it.
    ambiguous: boolean
    pending: Map<Load, LoadSubsetOptions>
    own: Set<Load>
  }
  const barriers = new Map<BarrierSource, Barrier>()
  // The rows the query showed when the first barrier rose, if it had
  // published by then. Before the first ready there is no complete
  // publication to keep, and the initial-readiness law governs.
  let retainedRows: string | undefined
  let retainedAfterReady = false
  const raiseBarrier = (source: BarrierSource) => {
    lowerSettledBarriers()
    // A newer truncate discards the replay that a pending window move waits
    // behind.
    if (barriers.size > 0 && !settledMoves.has(latestMove)) {
      reach.discardedReplayMoves++
    }
    if (barriers.size === 0) {
      retainedRows = JSON.stringify(live.toArray)
      retainedAfterReady = live.status === `ready`
    }
    barriers.set(source, {
      failures: new Map(),
      ambiguous: false,
      pending: new Map(barriers.get(source)?.pending),
      own: new Set(),
    })
  }
  // A replay whose participants all settled without a failure publishes.
  const lowerSettledBarriers = () => {
    for (const [source, barrier] of barriers) {
      if (barrier.failures.size === 0 && barrier.pending.size === 0) {
        barriers.delete(source)
      }
    }
    if (barriers.size === 0) retainedRows = undefined
  }
  // Returns whether the load joined a replay.
  const joinBarrier = (
    source: BarrierSource,
    load: Load,
    options: LoadSubsetOptions,
  ) => {
    const barrier = barriers.get(source)
    if (!barrier) return false
    barrier.pending.set(load, options)
    barrier.own.add(load)
    return true
  }
  const settleParticipant = (
    source: BarrierSource,
    load: Load,
    options: LoadSubsetOptions,
    ok: boolean,
  ) => {
    const barrier = barriers.get(source)
    // The replay has not failed, and other participants still load.
    const replayLoading =
      barrier !== undefined &&
      barrier.failures.size === 0 &&
      barrier.pending.has(load) &&
      barrier.pending.size > 1
    // An aborted request is obsolete demand, and a released one no longer
    // participates, so neither fails the replay.
    if (
      !ok &&
      barrier?.pending.has(load) &&
      barrier.own.has(load) &&
      !options.signal?.aborted
    ) {
      barrier.failures.set(load, options)
    }
    barrier?.pending.delete(load)
    // A replay completes when its last participant settles, so demand that
    // starts after it does not join it.
    lowerSettledBarriers()
    return replayLoading
  }
  const retireParticipants = (
    source: BarrierSource,
    options: LoadSubsetOptions,
  ) => {
    const barrier = barriers.get(source)
    if (!barrier) return
    for (const owned of [barrier.pending, barrier.failures]) {
      for (const [load, held] of owned) {
        if (held === options) owned.delete(load)
      }
    }
  }
  // Each subscription has its own replay, and the adapter boundary cannot
  // tell which subscription issued a load.
  const oneSubscription = (source: BarrierSource) =>
    !scenario.peer &&
    (source === `rows` || !(scenario.joined && scenario.includes))
  const acquired = new Map<LoadSubsetOptions, number>()
  const held: Array<(ok: boolean) => void> = []
  let holding = false
  let truncates = 0
  let throwNextUnload = false
  // Window moves whose settlement waits on held loads.
  const pendingMoves: Array<Promise<void>> = []
  // The source truncate is committing.
  let truncating = false
  let anyLoadFailed = false
  let earlyThrowSinceTruncate = false
  // The marker truncate is committing, and how many marker truncates ran.
  let markerCommitting = false
  let markerTruncates = 0
  let demandFailed = false
  // A failed initial load is fatal too (error 229). The queries are created
  // below; a load can only fail after they start.
  const queries: Array<{ status: string }> = []
  let failedWhileLoading = false
  // Adapter callbacks set these flags, so read them through a call.
  const fatalLoadFailed = () => demandFailed || failedWhileLoading
  // Lazy join demand asks for keys; ordered and full-source loads do not.
  // An ordered tie request also has a `where` and no `orderBy`, but it asks
  // for rows by rank, so it is not demand.
  const readsRank = (expression: unknown): boolean =>
    Array.isArray(expression)
      ? expression.some(readsRank)
      : typeof expression === `object` && expression !== null
        ? Object.entries(expression).some(([field, value]) =>
            field === `path` && Array.isArray(value)
              ? value.includes(`rank`)
              : readsRank(value),
          )
        : false
  const isDemand = (options: LoadSubsetOptions) =>
    options.where !== undefined &&
    options.orderBy === undefined &&
    !readsRank(options.where)
  // The truncate count of its source when each request was first issued. A
  // replay asks again for a held demand with the same request data, because
  // request data is immutable (ARCHITECTURE.md), and a new demand builds a
  // new `where`. So a load whose `where` was first issued before its source's
  // latest truncate is a replay load.
  const firstIssued = new WeakMap<object, number>()
  // A load belongs to a recovery when it is a replay load, or when the graph
  // starts it while its source's truncate commits.
  const belongsToRecovery = (
    options: LoadSubsetOptions,
    sourceTruncates: number,
    committing: boolean,
  ) => {
    const where = options.where
    if (!where) return committing
    if (!firstIssued.has(where)) firstIssued.set(where, sourceTruncates)
    const replay = firstIssued.get(where)! < sourceTruncates
    // The campaigns require replay loads, so production that rebuilt request
    // data for a replay fails this witness instead of making every replay
    // load look like new demand.
    if (replay && isDemand(options)) reach.replayLoads++
    return committing || replay
  }
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
    replayLoads: 0,
    abortRejections: 0,
    preloadChecks: 0,
    heldPublicationChecks: 0,
    retainedFailedReplays: 0,
    participantDemandFailures: 0,
    includeDemandFailures: 0,
    preloadReplayFailures: 0,
    discardedReplayMoves: 0,
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
            acquired.set(options, (acquired.get(options) ?? 0) + 1)
            const load: Load = { epoch: truncates, outcome: `pending` }
            loads.push(load)
            reach.markerLoads++
            const participant = joinBarrier(`markers`, load, options)
            const recovery =
              belongsToRecovery(options, markerTruncates, markerCommitting) ||
              (participant && oneSubscription(`markers`))
            const demand = !recovery && isDemand(options)
            if (holding) {
              const ok = await new Promise<boolean>((resolve) =>
                held.push(resolve),
              )
              if (!ok) {
                const replayLoading = settleParticipant(
                  `markers`,
                  load,
                  options,
                  false,
                )
                load.outcome = `failed`
                anyLoadFailed = true
                if (demand) demandFailed = true
                // A demand the graph started after the commit, failing
                // while its replay still loads.
                if (
                  participant &&
                  replayLoading &&
                  !options.signal?.aborted &&
                  oneSubscription(`markers`) &&
                  !markerCommitting &&
                  isDemand(options)
                ) {
                  reach.participantDemandFailures++
                  if (scenario.includes) reach.includeDemandFailures++
                }
                if (queries.some(({ status }) => status === `loading`)) {
                  failedWhileLoading = true
                  // Lazy demand in a replay failed before the first ready.
                  if (participant && isDemand(options)) {
                    reach.preloadReplayFailures++
                  }
                }
                reach.failedLoads++
                throw inject(new Error(`marker load failed`))
              }
            } else await Promise.resolve()
            if (options.signal?.aborted) {
              load.outcome = `ok`
              settleParticipant(`markers`, load, options, true)
              if (scenario.abortedMarkerLoads === `resolve`) return
              reach.abortRejections++
              throw inject(
                Object.assign(new Error(`marker load aborted`), {
                  name: `AbortError`,
                }),
              )
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
            // The load settles once its rows apply.
            settleParticipant(`markers`, load, options, true)
          },
          unloadSubset: (options) => {
            retireParticipants(`markers`, options)
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
            acquired.set(options, (acquired.get(options) ?? 0) + 1)
            const load: Load = { epoch: truncates, outcome: `pending` }
            loads.push(load)
            const participant = joinBarrier(`rows`, load, options)
            const recovery =
              belongsToRecovery(options, truncates, truncating) ||
              (participant && oneSubscription(`rows`))
            const demand = !recovery && isDemand(options)
            if (holding) {
              const ok = await new Promise<boolean>((resolve) =>
                held.push(resolve),
              )
              if (!ok) {
                const replayLoading = settleParticipant(
                  `rows`,
                  load,
                  options,
                  false,
                )
                load.outcome = `failed`
                anyLoadFailed = true
                if (demand) demandFailed = true
                // A demand the graph started after the commit, failing
                // while its replay still loads.
                if (
                  participant &&
                  replayLoading &&
                  !options.signal?.aborted &&
                  oneSubscription(`rows`) &&
                  !truncating &&
                  isDemand(options)
                ) {
                  reach.participantDemandFailures++
                }
                if (queries.some(({ status }) => status === `loading`)) {
                  failedWhileLoading = true
                  // Lazy demand in a replay failed before the first ready.
                  if (participant && isDemand(options)) {
                    reach.preloadReplayFailures++
                  }
                }
                reach.failedLoads++
                throw inject(new Error(`load failed`))
              }
            } else await Promise.resolve()
            if (options.signal?.aborted) {
              load.outcome = `ok`
              settleParticipant(`rows`, load, options, true)
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
            // The load settles once its rows apply.
            settleParticipant(`rows`, load, options, true)
          },
          unloadSubset: (options) => {
            retireParticipants(`rows`, options)
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
              const barrier = barriers.get(`rows`)
              if (barrier) barrier.ambiguous = true
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
  // A history during preload starts with every load held, including the
  // loads that the first subscriber starts.
  holding = scenario.historyDuringPreload
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
  // Retention: while a barrier is up, the query shows the rows it showed when
  // the first one rose. A query in `error` is judged by the terminal-error
  // law instead.
  const checkRetention = (label: string) => {
    lowerSettledBarriers()
    if (retainedRows === undefined || !retainedAfterReady) return
    // A source with two subscriptions has two replays, which the adapter
    // boundary cannot tell apart.
    if ([...barriers.keys()].some((barrier) => !oneSubscription(barrier))) {
      return
    }
    const raised = [...barriers.values()]
    if (raised.some(({ ambiguous }) => ambiguous)) return
    if (live.status === `error`) return
    expect(JSON.parse(JSON.stringify(live.toArray)), label).toEqual(
      JSON.parse(retainedRows),
    )
    if (raised.some(({ failures }) => failures.size > 0)) {
      reach.retainedFailedReplays++
    } else reach.heldPublicationChecks++
  }
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
    truncates++
    earlyThrowSinceTruncate = false
    if (held.length > 0) reach.heldAcrossTruncate++
    installed.clear()
    raiseBarrier(`rows`)
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
    installedMarkers.clear()
    raiseBarrier(`markers`)
    markerSync.begin()
    markerSync.truncate()
    if (!onDemandMarkers) {
      for (const id of marked) {
        markerSync.write({ type: `insert`, value: { id, rowId: id } })
        installedMarkers.add(id)
      }
    }
    markerTruncates++
    markerCommitting = true
    let receipt: true | Promise<void>
    try {
      receipt = markerSync.commit()
    } finally {
      markerCommitting = false
    }
    if (receipt !== true) await receipt
  }
  // The history's commands can interleave with the initial loads.
  let preloadSettled = false
  const preload = Promise.allSettled([live.preload(), peer?.preload()]).then(
    () => (preloadSettled = true),
  )
  try {
    if (!scenario.historyDuringPreload) await preload
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
            holding = command.keepHolding === true && holding
            ;(command.newest === true ? held.pop() : held.shift())?.(command.ok)
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
      checkRetention(`retained publication after ${command.type}`)
    }
    holding = false
    throwNextUnload = false
    await settleAll()
    await Promise.all(pendingMoves.splice(0))
    await settleAll()
    await flushPromises()
    // Initial readiness: once loading is quiet, the initial preload has
    // settled. It resolves when the first window is covered and rejects when
    // an initial load fails; it does not wait for a later truncate.
    if (scenario.historyDuringPreload) {
      reach.preloadChecks++
      expect(preloadSettled, `initial preload settles`).toBe(true)
    }
    if (violation) throw new Error(`adapter release: ${violation}`)
    if (moveOrderViolation) {
      throw new Error(`newest move wins: ${moveOrderViolation}`)
    }
    if (escapedError() !== undefined) {
      throw new Error(`escaped error: only injected faults may surface`, {
        cause: escapedError(),
      })
    }
    checkRetention(`retained publication once loading is quiet`)
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
  //   the move's AbortError as an escaped fault; the move now waits for the
  //   newer replay and applies, so this replay checks the moved window);
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
      reaches: `settledWindowChecks`,
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
    {
      name: `a failed include demand that a marker truncate starts`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
    },
    {
      name: `a failed include demand started from no prior demand`,
      history: [
        { type: `mark`, id: 2, on: true },
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        joined: `none`,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
    },
    {
      name: `a failed include replay before the first ready`,
      history: [
        { type: `settle`, ok: true, keepHolding: true },
        { type: `truncateMarkers` },
        { type: `settle`, ok: true, keepHolding: true },
        { type: `settle`, ok: true, keepHolding: true },
        { type: `settle`, ok: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        markerMode: `on-demand`,
        includes: true,
        abortedMarkerLoads: `reject`,
        historyDuringPreload: true,
      },
      reaches: `abortRejections`,
    },
    {
      name: `an aborted marker load that rejects after its replay succeeds`,
      history: [
        { type: `settle`, ok: true, keepHolding: true },
        { type: `settle`, ok: true, keepHolding: false },
        { type: `truncateMarkers` },
        { type: `unloadThrows` },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        peer: true,
        joined: `some`,
        markerMode: `on-demand`,
        abortedMarkerLoads: `reject`,
        historyDuringPreload: true,
      },
      reaches: `abortRejections`,
    },
    {
      name: `a replaced include segment whose aborted load rejects`,
      history: [
        { type: `hold` },
        { type: `truncate`, armAfterStart: false },
        { type: `move`, id: 1, rank: 1 },
        { type: `move`, id: 2, rank: 31 },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        markerMode: `on-demand`,
        includes: true,
        abortedMarkerLoads: `reject`,
      },
      reaches: `abortRejections`,
    },
    {
      name: `an include demand that fails while its replay still loads`,
      history: [
        { type: `hold` },
        { type: `truncateMarkers` },
        { type: `move`, id: 3, rank: 1 },
        { type: `settle`, ok: false, newest: true },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        markerMode: `on-demand`,
        includes: true,
      },
      reaches: `failedLoads`,
      recovers: true,
    },
    {
      // A move during the initial load waits behind a marker replay that the
      // source truncate then discards. The newer move must wait for the
      // replay that still holds publication and then apply. Before the fix,
      // the discarded replay rejected it, so the older move's window won.
      name: `a newer window move deferred behind a discarded replay`,
      history: [
        { type: `move`, id: 1, rank: 1 },
        { type: `window`, offset: 0, limit: 2 },
        { type: `truncateMarkers` },
        { type: `window`, offset: 0, limit: 1 },
        { type: `truncate`, armAfterStart: false },
      ],
      scenario: {
        ...ordinaryOrderedScenario,
        limit: 1,
        markerMode: `on-demand`,
        includes: true,
        historyDuringPreload: true,
      },
      reaches: `settledWindowChecks`,
    },
  ] satisfies Array<{
    name: string
    history: Array<OrderedCommand>
    scenario?: OrderedScenario
    reaches?: keyof OrderedReach
    // A replay whose history the law places in a recovery. The pin also
    // holds where the model cannot tell which subscription issued a load
    // (see Limits).
    recovers?: true
  }>)(
    `keeps the ordered window for $name (generated replay)`,
    async ({ history, scenario, ...replay }) => {
      const reach = await checkOrderedReplay(history, scenario)
      const reaches: keyof OrderedReach | undefined =
        `reaches` in replay ? replay.reaches : undefined
      if (reaches) expect(reach[reaches], reaches).toBeGreaterThan(0)
      if (`recovers` in replay) {
        expect(reach.terminalErrors, `recovery failure ends the query`).toBe(0)
      }
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
        replayLoads: 0,
        abortRejections: 0,
        preloadChecks: 0,
        heldPublicationChecks: 0,
        retainedFailedReplays: 0,
        participantDemandFailures: 0,
        includeDemandFailures: 0,
        preloadReplayFailures: 0,
        discardedReplayMoves: 0,
      }
      await fc.assert(
        fc.asyncProperty(
          fc.array(orderedCommand, { minLength: 1, maxLength: 12 }),
          orderedScenario,
          async (history, scenario) => {
            const reach = await checkOrderedReplay(history, scenario)
            for (const key of Object.keys(total) as Array<keyof OrderedReach>) {
              total[key] += reach[key]
            }
          },
        ),
        campaign === `fixed`
          ? { seed: 20261021, numRuns: oracleRuns(300) }
          : {
              ...oraclePropertyOptions(300, orderedReplayProperty),
              ...(campaign === `replay` ? { numRuns: 1 } : {}),
            },
      )
      // Reach witnesses: releases throw without a truncate, while a replay
      // starts, and while it settles; loads fail and stay held across a
      // truncate; truncates ask again for held demand; and the settled-window
      // law is checked.
      // An aborted move needs a truncate to land inside a held move, and a
      // terminal error needs a held marker demand load to fail; the named
      // replays above reach both. A failed replay that the retention law can
      // judge, a demand that fails while its replay is open, a replay that
      // fails before the first ready, and a window move behind a discarded
      // replay are rare here; the campaigns below declare them.
      const ownedElsewhere = new Set([
        `abortedMoves`,
        `terminalErrors`,
        `retainedFailedReplays`,
        `participantDemandFailures`,
        `includeDemandFailures`,
        `preloadReplayFailures`,
        `discardedReplayMoves`,
      ])
      if (campaign !== `replay`) {
        for (const [dimension, count] of Object.entries(total)) {
          if (ownedElsewhere.has(dimension)) continue
          expect(count, dimension).toBeGreaterThan(0)
        }
      }
    },
    120_000,
  )

  // The retention law needs a replay that fails while the query holds its
  // last publication. Each history here starts by holding the next loads and
  // truncating a source, so the replay's loads stay held. It may then change
  // a rank, a marker, or the window, which starts demand while the replay is
  // open. It then fails a held load: the oldest is a replay load, and the
  // newest is the demand just started. Random commands follow, so later
  // moves, marks, window moves, and truncates act on a failed replay. Peers
  // stay out because the retention law does not judge them.
  const failedReplayTruncate = fc.constantFrom(
    { type: `truncate` as const, armAfterStart: false },
    { type: `truncateMarkers` as const },
  )
  const failedReplayHistory: fc.Arbitrary<Array<OrderedCommand>> = fc
    .tuple(
      failedReplayTruncate,
      fc.option(
        fc.oneof(
          fc.record({
            type: fc.constant(`move` as const),
            id: fc.integer({ min: 1, max: 5 }),
            rank: fc.integer({ min: 1, max: 60 }),
          }),
          fc.record({
            type: fc.constant(`mark` as const),
            id: fc.integer({ min: 1, max: 5 }),
            on: fc.boolean(),
          }),
          fc.record({
            type: fc.constant(`window` as const),
            offset: fc.constantFrom(0 as const, 1 as const),
            limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
          }),
        ),
        { nil: undefined },
      ),
      fc.boolean(),
      fc.array(orderedCommand, { maxLength: 8 }),
    )
    .map(([truncate, change, keepHolding, rest]) => [
      { type: `hold` as const },
      truncate,
      ...(change
        ? [change, { type: `settle` as const, ok: false, newest: true }]
        : [{ type: `settle` as const, ok: false, keepHolding }]),
      ...rest,
    ])
  const failedReplayScenario = orderedScenario.map((scenario) => ({
    ...scenario,
    peer: false,
  }))
  // An include demand that fails while its replay still loads needs an
  // include over on-demand markers and a move that brings a row into the
  // window during the marker replay; this branch builds that start. The
  // window starts at offset 0 without ties, and the moved row starts past
  // it, so moving it before every other row shows it.
  const includeDemandCase = failedReplayScenario.chain((scenario) => {
    const included = {
      ...scenario,
      offset: 0 as const,
      ties: false,
      joined: false as const,
      includes: true,
      markerMode: `on-demand` as const,
    }
    const ascending = included.direction === `asc`
    return fc
      .tuple(
        fc.integer({ min: 1, max: 9 }),
        fc.array(orderedCommand, { maxLength: 8 }),
      )
      .map(([rank, rest]): [Array<OrderedCommand>, OrderedScenario] => [
        [
          { type: `hold` },
          { type: `truncateMarkers` },
          {
            type: `move`,
            id: ascending ? 5 : 1,
            rank: ascending ? rank : 61 - rank,
          },
          { type: `settle`, ok: false, newest: true },
          ...rest,
        ],
        included,
      ])
  })
  const failedReplayCase = fc.oneof(
    {
      weight: 3,
      arbitrary: fc.tuple(failedReplayHistory, failedReplayScenario),
    },
    { weight: 1, arbitrary: includeDemandCase },
  )
  const failedReplayProperty = `replay.ordered-failed-replay`
  const failedReplayCampaigns =
    orderedReplayConfig.replayPath === undefined
      ? ([`fixed`, `random`] as const)
      : orderedReplayConfig.replayProperty === failedReplayProperty
        ? ([`replay`] as const)
        : ([] as const)

  // Recovery during the initial preload. A history starts while the first
  // loads are held, over on-demand markers that the query includes or joins.
  // Its grammar settles held loads one at a time, truncates either source,
  // moves the window, and fails a held load, so replays start, fail, and are
  // discarded before the query first becomes ready, with window moves
  // waiting behind them.
  const preloadCommand: fc.Arbitrary<OrderedCommand> = fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record({
        type: fc.constant(`settle` as const),
        ok: fc.oneof(
          { weight: 3, arbitrary: fc.constant(true) },
          { weight: 1, arbitrary: fc.constant(false) },
        ),
        keepHolding: fc.oneof(
          { weight: 3, arbitrary: fc.constant(true) },
          { weight: 1, arbitrary: fc.constant(false) },
        ),
        newest: fc.boolean(),
      }),
    },
    { weight: 2, arbitrary: fc.constant({ type: `truncateMarkers` as const }) },
    {
      weight: 1,
      arbitrary: fc.constant({
        type: `truncate` as const,
        armAfterStart: false,
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        type: fc.constant(`window` as const),
        offset: fc.constantFrom(0 as const, 1 as const),
        limit: fc.constantFrom(1 as const, 2 as const, 3 as const),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        type: fc.constant(`move` as const),
        id: fc.integer({ min: 1, max: 5 }),
        rank: fc.integer({ min: 1, max: 60 }),
      }),
    },
    { weight: 1, arbitrary: fc.constant({ type: `hold` as const }) },
  )
  const preloadScenario = orderedScenario.map((scenario) => ({
    ...scenario,
    markerMode: `on-demand` as const,
    includes: scenario.includes || !scenario.joined,
    historyDuringPreload: true,
  }))
  // A replay of include demand that fails before the first ready: initial
  // loads settle one at a time, so the order source delivers rows and the
  // include demands them; the marker source truncates; more held loads
  // settle; and the oldest or newest held load fails. The oldest is often
  // a load the truncate aborted, and the newest a replay load.
  const settleHeld = { type: `settle` as const, ok: true, keepHolding: true }
  const preloadDemandFailure = fc
    .tuple(
      preloadScenario,
      fc.integer({ min: 1, max: 2 }),
      fc.integer({ min: 0, max: 3 }),
      fc.boolean(),
      fc.array(preloadCommand, { maxLength: 6 }),
    )
    .map(
      ([scenario, before, after, newest, rest]): [
        Array<OrderedCommand>,
        OrderedScenario,
      ] => [
        [
          ...Array.from({ length: before }, () => settleHeld),
          { type: `truncateMarkers` },
          ...Array.from({ length: after }, () => settleHeld),
          { type: `settle`, ok: false, newest },
          ...rest,
        ],
        { ...scenario, joined: false, includes: true },
      ],
    )
  const preloadCase = fc.oneof(
    {
      weight: 2,
      arbitrary: fc.tuple(
        fc.array(preloadCommand, { minLength: 1, maxLength: 12 }),
        preloadScenario,
      ),
    },
    { weight: 1, arbitrary: preloadDemandFailure },
  )
  const preloadProperty = `replay.ordered-preload-recovery`
  const preloadCampaigns =
    orderedReplayConfig.replayPath === undefined
      ? ([`fixed`, `random`] as const)
      : orderedReplayConfig.replayProperty === preloadProperty
        ? ([`replay`] as const)
        : ([] as const)

  it.each(preloadCampaigns)(
    `recovers replays that start during the initial preload (%s campaign)`,
    async (campaign) => {
      // Declared reach: a replay participant that fails before the first
      // ready, which must end the query or let the preload settle, and a
      // window move that waits behind a replay a newer truncate discards,
      // which must still apply.
      const reach = createOracleReach(
        preloadProperty,
        [
          `preloadReplayFailures`,
          `discardedReplayMoves`,
          `preloadChecks`,
        ] as const,
        { minimum: 5 },
      )
      await fc.assert(
        fc.asyncProperty(preloadCase, async ([history, scenario]) => {
          reach.beginHistory()
          const observed = await checkOrderedReplay(history, scenario)
          for (const state of [
            `preloadReplayFailures`,
            `discardedReplayMoves`,
            `preloadChecks`,
          ] as const) {
            if (observed[state] > 0) reach.reach(state)
          }
        }),
        // The fixed seed kills both mutants that the evidence names: a
        // builder that lets a discarded replay reject a deferred window move,
        // and one that keeps a failure before the first ready non-fatal. Each
        // dies in about half of 200-run seeds.
        campaign === `fixed`
          ? { seed: 20261027, numRuns: oracleRuns(300) }
          : {
              ...oraclePropertyOptions(300, preloadProperty),
              ...(campaign === `replay` ? { numRuns: 1 } : {}),
            },
      )
      reach.assertReached()
    },
    120_000,
  )

  it.each(failedReplayCampaigns)(
    `keeps the last publication through a failed replay (%s campaign)`,
    async (campaign) => {
      // Declared reach: histories where the retention law judged a failed
      // replay, judged a replay that still held publication, and saw a
      // demand that the graph started after the commit fail while its replay
      // still loaded, on either source and for an include. An include
      // demand's rejection arrives before its replay records the failure, so
      // only there does the demand wait for the replay to decide it.
      const reach = createOracleReach(
        failedReplayProperty,
        [
          `retainedFailedReplays`,
          `heldPublicationChecks`,
          `participantDemandFailures`,
          `includeDemandFailures`,
        ] as const,
        { minimum: 5 },
      )
      await fc.assert(
        fc.asyncProperty(failedReplayCase, async ([history, scenario]) => {
          reach.beginHistory()
          const observed = await checkOrderedReplay(history, scenario)
          if (observed.retainedFailedReplays > 0) {
            reach.reach(`retainedFailedReplays`)
          }
          if (observed.heldPublicationChecks > 0) {
            reach.reach(`heldPublicationChecks`)
          }
          if (observed.participantDemandFailures > 0) {
            reach.reach(`participantDemandFailures`)
          }
          if (observed.includeDemandFailures > 0) {
            reach.reach(`includeDemandFailures`)
          }
        }),
        campaign === `fixed`
          ? { seed: 20261023, numRuns: oracleRuns(200) }
          : {
              ...oraclePropertyOptions(200, failedReplayProperty),
              ...(campaign === `replay` ? { numRuns: 1 } : {}),
            },
      )
      reach.assertReached()
    },
    120_000,
  )
})
