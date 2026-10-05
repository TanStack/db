import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
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
