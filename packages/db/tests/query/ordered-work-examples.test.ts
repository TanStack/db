// Ordinary tests moved out of ordered-work-oracle.property.test.ts. Each
// compares production with values written in the test, or checks the oracle's
// grammar or checker without running production, so none of them is an
// oracle registration. The laws, their authority, and the oracle properties
// are in that file; the grammar, model, and checker definitions that the
// calibrations read are in ordered-work-model-oracle.ts.
import { fc } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { LoadSubsetOperationAbortedError } from '../../src/errors.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq, isUndefined, not } from '../../src/query/builder/functions.js'
import { toArray } from '../../src/query/index.js'
import { oracleFixedSeed, readOracleRunConfig } from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { copiedRow } from './ordered-work-fixtures.js'
import {
  FULL_JOIN_SEED,
  eagerFullJoinCase,
  eagerWindow,
  exhaustiveScenarios,
  fillerRows,
  optimisticWindowViolations,
} from './ordered-work-model-oracle.js'
import type { Marker, Row } from './ordered-work-support.js'
import type {
  OptimisticWindowCase,
  OptimisticWindowObservation,
} from './ordered-work-model-oracle.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { DeltaEvent } from '../../src/query/effect.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

let harnessId = 0

async function observeMutationDuringBoundedRepair(): Promise<{
  rows: Array<number>
  requests: number
  publications: Array<Array<number>>
}> {
  const truth = new Map<number, Row>([
    [1, { id: 1, rank: 1, eligible: true, label: `first` }],
    [2, { id: 2, rank: 2, eligible: true, label: `second` }],
    [3, { id: 3, rank: 3, eligible: true, label: `third` }],
  ])
  const delivered = new Set<number>()
  const repairPrefixStarted = createDeferred<void>()
  const releaseRepairPrefix = createDeferred<void>()
  const repairTieStarted = createDeferred<void>()
  const releaseRepairTie = createDeferred<void>()
  const publications: Array<Array<number>> = []
  let heldRepairPrefix = false
  let heldRepairTie = false
  let requests = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let commit!: () => true | Promise<void>

  const source = createCollection<Row, number>({
    id: `ordered-mutation-during-repair-${harnessId++}`,
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
        const apply = async (options: LoadSubsetOptions) => {
          let selected = [...truth.values()].filter(
            (row) =>
              (!options.where ||
                evaluateReferenceExpression(options.where, row) === true) &&
              (!options.cursor ||
                evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                  true),
          )
          selected.sort(
            (left, right) => left.rank - right.rank || left.id - right.id,
          )
          const offset = options.cursor ? 0 : (options.offset ?? 0)
          selected = selected.slice(
            offset,
            options.limit === undefined ? undefined : offset + options.limit,
          )
          const additions = selected.filter(({ id }) => !delivered.has(id))
          if (additions.length === 0) return
          begin()
          for (const row of additions) {
            delivered.add(row.id)
            write({ type: `insert`, value: { ...row } })
          }
          const receipt = commit()
          if (receipt !== true) await receipt
        }
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            requests++
            const isRepairPrefix =
              options.refetch === true &&
              options.orderBy !== undefined &&
              options.cursor === undefined
            if (isRepairPrefix && !heldRepairPrefix) {
              heldRepairPrefix = true
              repairPrefixStarted.resolve()
              return releaseRepairPrefix.promise.then(() => apply(options))
            }
            const isRepairTie =
              options.refetch === true &&
              options.orderBy === undefined &&
              options.where !== undefined
            if (isRepairTie && !heldRepairTie) {
              heldRepairTie = true
              repairTieStarted.resolve()
              return releaseRepairTie.promise.then(() => apply(options))
            }
            return apply(options)
          },
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
  const subscription = live.subscribeChanges(() => {
    publications.push(live.toArray.map(({ id }) => id))
  })

  return withHistoryCleanup(
    async () => {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1])
      publications.length = 0

      const first = { ...truth.get(1)!, rank: 10 }
      truth.set(1, first)
      begin()
      write({ type: `update`, value: { ...first } })
      const firstReceipt = commit()
      if (firstReceipt !== true) await firstReceipt
      await repairPrefixStarted.promise
      expect(live.toArray.map(({ id }) => id)).toEqual([1])

      releaseRepairPrefix.resolve()
      await repairTieStarted.promise

      const second = { ...truth.get(2)!, rank: 20 }
      truth.set(2, second)
      begin()
      write({ type: `update`, value: { ...second } })
      const secondReceipt = commit()
      if (secondReceipt !== true) await secondReceipt
      expect(live.toArray.map(({ id }) => id)).toEqual([1])

      releaseRepairTie.resolve()
      await vi.waitFor(() =>
        expect(live.toArray.map(({ id }) => id)).toEqual([3]),
      )
      expect(publications).toEqual([[3]])
      expect(requests).toBeGreaterThanOrEqual(6)
      return {
        rows: live.toArray.map(({ id }) => id),
        requests,
        publications: publications.map((rows) => [...rows]),
      }
    },
    () => [
      () => releaseRepairPrefix.resolve(),
      () => releaseRepairTie.resolve(),
      () => subscription.unsubscribe(),
      () => live.cleanup(),
      () => source.cleanup(),
    ],
  )
}

async function observeHeldEffectRepair(
  repairPrefix: `synchronous` | `asynchronous`,
): Promise<Array<Array<number>>> {
  const truth: Array<Row> = [
    { id: 1, rank: 1, eligible: true, label: `first` },
    { id: 2, rank: 2, eligible: true, label: `second` },
  ]
  const repairStarted = createDeferred<void>()
  const releaseRepair = createDeferred<void>()
  const effectRows = new Set<number>()
  const publications: Array<Array<number>> = []
  let recovering = false
  let loadCount = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let commit!: () => void

  const source = createCollection<Row, number>({
    id: `ordered-held-effect-repair-${harnessId++}`,
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
        const apply = (options: LoadSubsetOptions) => {
          const selected = truth
            .filter(
              (row) =>
                (!options.where ||
                  evaluateReferenceExpression(options.where, row) === true) &&
                (!options.cursor ||
                  evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                    true),
            )
            .sort((left, right) => left.rank - right.rank || left.id - right.id)
            .slice(
              options.offset ?? 0,
              options.limit === undefined
                ? undefined
                : (options.offset ?? 0) + options.limit,
            )
          begin()
          for (const row of selected) {
            write({ type: `insert`, value: { ...row } })
          }
          commit()
        }
        return {
          loadSubset: (options) => {
            loadCount++
            const isRepair =
              recovering &&
              options.orderBy !== undefined &&
              options.limit === 1 &&
              options.cursor === undefined
            if (!isRepair) {
              apply(options)
              return true
            }
            if (repairPrefix === `synchronous`) {
              apply(options)
              return true
            }
            repairStarted.resolve()
            return releaseRepair.promise.then(() => apply(options))
          },
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    onBatch: (events) => {
      for (const event of events) {
        if (event.type === `exit`) effectRows.delete(event.key)
        else effectRows.add(event.key)
      }
      publications.push([...effectRows].sort((left, right) => left - right))
    },
  })

  return withHistoryCleanup(
    async () => {
      await vi.waitFor(() => expect([...effectRows]).toEqual([1]))
      await vi.waitFor(() => expect(loadCount).toBeGreaterThanOrEqual(2))
      await flushPromises()
      publications.length = 0
      recovering = true
      const removed = truth.shift()!
      begin()
      write({ type: `delete`, value: removed })
      commit()
      if (repairPrefix === `asynchronous`) {
        await repairStarted.promise
        await flushPromises()

        expect(
          [...effectRows],
          `last complete effect result while held`,
        ).toEqual([1])
        expect(publications, `no intermediate effect publication`).toEqual([])

        releaseRepair.resolve()
      }
      await vi.waitFor(() => expect([...effectRows]).toEqual([2]))
      expect(publications).toEqual([[2]])
      return publications.map((rows) => [...rows])
    },
    () => [
      () => releaseRepair.resolve(),
      () => effect.dispose(),
      () => source.cleanup(),
    ],
  )
}

async function observeEffectAfterObsoleteRepairAbort(): Promise<{
  rows: Array<number>
  batches: Array<Array<string>>
  finalLabel: string | undefined
}> {
  const truth = new Map<number, Row>([
    [1, { id: 1, rank: 1, eligible: true, label: `first` }],
    [2, { id: 2, rank: 2, eligible: true, label: `second` }],
  ])
  const installed = new Set<number>()
  const effectRows = new Map<number, Row>()
  const batches: Array<Array<string>> = []
  let repairHeld = false
  let requests = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let truncate!: () => void
  let commit!: () => true | Promise<void>

  const source = createCollection<Row, number>({
    id: `ordered-obsolete-effect-repair-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        begin = operations.begin
        write = operations.write
        truncate = operations.truncate
        commit = operations.commit
        operations.markReady()
        const apply = async (options: LoadSubsetOptions) => {
          let selected = [...truth.values()].filter(
            (row) =>
              (!options.where ||
                evaluateReferenceExpression(options.where, row) === true) &&
              (!options.cursor ||
                evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                  true),
          )
          selected.sort(
            (left, right) => left.rank - right.rank || left.id - right.id,
          )
          const offset = options.cursor ? 0 : (options.offset ?? 0)
          selected = selected.slice(
            offset,
            options.limit === undefined ? undefined : offset + options.limit,
          )
          const additions = selected.filter(({ id }) => !installed.has(id))
          if (additions.length === 0) return
          begin()
          for (const row of additions) {
            installed.add(row.id)
            write({ type: `insert`, value: { ...row } })
          }
          const receipt = commit()
          if (receipt !== true) await receipt
        }
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            requests++
            const isRepairPrefix =
              options.refetch === true &&
              options.orderBy !== undefined &&
              options.cursor === undefined
            if (isRepairPrefix && !repairHeld) {
              repairHeld = true
              return new Promise<void>((_resolve, reject) => {
                const abort = () =>
                  reject(new LoadSubsetOperationAbortedError())
                if (options.signal?.aborted) abort()
                else {
                  options.signal?.addEventListener(`abort`, abort, {
                    once: true,
                  })
                }
              })
            }
            return apply(options)
          },
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    onBatch: (events) => {
      const labels: Array<string> = []
      for (const event of events) {
        labels.push(`${event.type}:${event.key}`)
        if (event.type === `exit`) effectRows.delete(event.key)
        else effectRows.set(event.key, copiedRow(event.value))
      }
      batches.push(labels)
    },
  })

  return withHistoryCleanup(
    async () => {
      await vi.waitFor(() => expect([...effectRows.keys()]).toEqual([1]))
      await vi.waitFor(() => expect(requests).toBeGreaterThanOrEqual(2))
      await flushPromises()
      batches.length = 0

      const removed = truth.get(1)!
      truth.delete(1)
      installed.delete(1)
      begin()
      write({ type: `delete`, value: removed })
      const deleteReceipt = commit()
      if (deleteReceipt !== true) await deleteReceipt
      await vi.waitFor(() => expect(repairHeld).toBe(true))

      installed.clear()
      begin()
      truncate()
      const truncateReceipt = commit()
      if (truncateReceipt !== true) await truncateReceipt
      await vi.waitFor(() => expect(requests).toBeGreaterThanOrEqual(5))
      await flushPromises()

      const replacement = truth.get(2)!
      const updated = { ...replacement, label: `updated after replay` }
      truth.set(2, updated)
      begin()
      write({ type: `update`, value: updated })
      const updateReceipt = commit()
      if (updateReceipt !== true) await updateReceipt
      await vi.waitFor(() =>
        expect(effectRows.get(2)?.label).toBe(`updated after replay`),
      )

      return {
        rows: [...effectRows.keys()],
        batches: batches.map((batch) => [...batch]),
        finalLabel: effectRows.get(2)?.label,
      }
    },
    () => [() => effect.dispose(), () => source.cleanup()],
  )
}

async function observeSkipInitialOrderedLoad(): Promise<{
  initialEvents: Array<string>
  laterEvents: Array<string>
}> {
  const truth: Array<Row> = [
    { id: 1, rank: 1, eligible: true, label: `first` },
    { id: 2, rank: 2, eligible: true, label: `second` },
  ]
  const firstRequest = createDeferred<void>()
  const installed = new Set<number>()
  const events: Array<string> = []
  let requests = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let commit!: () => true | Promise<void>

  const source = createCollection<Row, number>({
    id: `ordered-skip-initial-${harnessId++}`,
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
          loadSubset: async (options: LoadSubsetOptions) => {
            requests++
            if (requests === 1) await firstRequest.promise
            let selected = truth.filter(
              (row) =>
                (!options.where ||
                  evaluateReferenceExpression(options.where, row) === true) &&
                (!options.cursor ||
                  evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                    true),
            )
            selected.sort(
              (left, right) => left.rank - right.rank || left.id - right.id,
            )
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            selected = selected.slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
            const additions = selected.filter(({ id }) => !installed.has(id))
            if (additions.length === 0) return
            begin()
            for (const row of additions) {
              installed.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            if (receipt !== true) await receipt
          },
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    skipInitial: true,
    onBatch: (batch) => {
      events.push(...batch.map((event) => `${event.type}:${event.key}`))
    },
  })

  return withHistoryCleanup(
    async () => {
      await vi.waitFor(() => expect(requests).toBe(1))
      firstRequest.resolve()
      await vi.waitFor(() => expect(requests).toBeGreaterThanOrEqual(2))
      await flushPromises()
      const initialEvents = [...events]
      events.length = 0

      const inserted: Row = {
        id: 3,
        rank: 0,
        eligible: true,
        label: `later`,
      }
      truth.push(inserted)
      installed.add(inserted.id)
      begin()
      write({ type: `insert`, value: inserted })
      const receipt = commit()
      if (receipt !== true) await receipt
      await vi.waitFor(() => expect(events.length).toBeGreaterThan(0))

      return { initialEvents, laterEvents: [...events] }
    },
    () => [
      () => firstRequest.resolve(),
      () => effect.dispose(),
      () => source.cleanup(),
    ],
  )
}

async function observeHeldEffectDelta(
  history: `absent-cycle` | `present-update-exit`,
): Promise<{
  batches: Array<Array<string>>
  rows: Array<number>
  exitedValues: Map<number, Row>
}> {
  const limit = history === `absent-cycle` ? 1 : 2
  const truth = new Map<number, Row>(
    (history === `absent-cycle`
      ? [
          { id: 1, rank: 1, eligible: true, label: `first` },
          { id: 3, rank: 3, eligible: true, label: `third` },
        ]
      : [
          { id: 1, rank: 1, eligible: true, label: `first` },
          { id: 2, rank: 2, eligible: true, label: `second` },
          { id: 3, rank: 3, eligible: true, label: `third` },
          { id: 4, rank: 4, eligible: true, label: `fourth` },
        ]
    ).map((row) => [row.id, row]),
  )
  const delivered = new Set<number>()
  const repairStarted = createDeferred<void>()
  const releaseRepair = createDeferred<void>()
  const effectRows = new Map<number, Row>()
  const batches: Array<Array<string>> = []
  const exitedValues = new Map<number, Row>()
  let heldRepair = false
  let loadCount = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let commit!: () => true | Promise<void>

  const source = createCollection<Row, number>({
    id: `ordered-held-effect-delta-${history}-${harnessId++}`,
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
        const apply = async (options: LoadSubsetOptions) => {
          let selected = [...truth.values()].filter(
            (row) =>
              (!options.where ||
                evaluateReferenceExpression(options.where, row) === true) &&
              (!options.cursor ||
                evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                  true),
          )
          selected.sort(
            (left, right) => left.rank - right.rank || left.id - right.id,
          )
          const offset = options.cursor ? 0 : (options.offset ?? 0)
          selected = selected.slice(
            offset,
            options.limit === undefined ? undefined : offset + options.limit,
          )
          const additions = selected.filter(({ id }) => !delivered.has(id))
          if (additions.length === 0) return
          begin()
          for (const row of additions) {
            delivered.add(row.id)
            write({ type: `insert`, value: { ...row } })
          }
          const receipt = commit()
          if (receipt !== true) await receipt
        }
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loadCount++
            const isRepairPrefix =
              options.refetch === true &&
              options.orderBy !== undefined &&
              options.cursor === undefined
            if (isRepairPrefix && !heldRepair) {
              heldRepair = true
              repairStarted.resolve()
              return releaseRepair.promise.then(() => apply(options))
            }
            return apply(options)
          },
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(limit),
    onBatch: (events: Array<DeltaEvent<Row, number>>) => {
      const labels: Array<string> = []
      for (const event of events) {
        labels.push(`${event.type}:${String(event.key)}`)
        if (event.type === `exit`) {
          exitedValues.set(event.key, copiedRow(event.value))
          effectRows.delete(event.key)
        } else {
          effectRows.set(event.key, { ...event.value })
        }
      }
      batches.push(labels)
    },
  })

  const applySourceChange = async (
    type: `insert` | `update` | `delete`,
    row: Row,
  ) => {
    begin()
    write({ type, value: { ...row } })
    const receipt = commit()
    if (receipt !== true) await receipt
  }

  return withHistoryCleanup(
    async () => {
      const initialIds = history === `absent-cycle` ? [1] : [1, 2]
      await vi.waitFor(() =>
        expect([...effectRows.keys()].sort((a, b) => a - b)).toEqual(
          initialIds,
        ),
      )
      await vi.waitFor(() => expect(loadCount).toBeGreaterThanOrEqual(2))
      await flushPromises()
      batches.length = 0

      const first = truth.get(1)!
      truth.delete(1)
      delivered.delete(1)
      await applySourceChange(`delete`, first)
      await repairStarted.promise

      if (history === `absent-cycle`) {
        const transient: Row = {
          id: 2,
          rank: 2,
          eligible: true,
          label: `transient`,
        }
        delivered.add(transient.id)
        await applySourceChange(`insert`, transient)
        delivered.delete(transient.id)
        await applySourceChange(`delete`, transient)
      } else {
        const previous = truth.get(2)!
        const updated = { ...previous, rank: 20, label: `updated` }
        truth.set(2, updated)
        await applySourceChange(`update`, updated)
        truth.delete(2)
        delivered.delete(2)
        await applySourceChange(`delete`, updated)
      }

      expect(batches).toEqual([])
      releaseRepair.resolve()
      const expectedIds = history === `absent-cycle` ? [3] : [3, 4]
      await vi.waitFor(() =>
        expect([...effectRows.keys()].sort((a, b) => a - b)).toEqual(
          expectedIds,
        ),
      )

      expect(batches).toHaveLength(1)
      const flattened = batches.flat()
      if (history === `absent-cycle`) {
        expect(flattened).not.toContain(`update:2`)
        expect(flattened).not.toContain(`enter:2`)
        expect(flattened).not.toContain(`exit:2`)
      } else {
        expect(flattened).toContain(`exit:2`)
        expect(flattened).not.toContain(`update:2`)
        expect(exitedValues.get(2)).toEqual({
          id: 2,
          rank: 2,
          eligible: true,
          label: `second`,
        })
      }
      return {
        batches: batches.map((batch) => [...batch]),
        rows: [...effectRows.keys()].sort((a, b) => a - b),
        exitedValues,
      }
    },
    () => [
      () => releaseRepair.resolve(),
      () => effect.dispose(),
      () => source.cleanup(),
    ],
  )
}

describe(`ordered source work oracle`, () => {
  it(`reconstructs every legal small scenario exactly once`, () => {
    expect(exhaustiveScenarios).toHaveLength(64)
    expect(
      new Set(exhaustiveScenarios.map((scenario) => JSON.stringify(scenario)))
        .size,
    ).toBe(64)
  })

  it(`holds the last complete Effect result across an asynchronous prefix and synchronous tie repair`, async () => {
    await expect(observeHeldEffectRepair(`asynchronous`)).resolves.toEqual([
      [2],
    ])
  })

  it(`publishes one Effect replacement when ordered repair settles synchronously`, async () => {
    await expect(observeHeldEffectRepair(`synchronous`)).resolves.toEqual([[2]])
  })

  it(`publishes the repaired ordered Effect delta when a source changes during startup`, async () => {
    // Fixed history: the first ordered page contains row 1. Subscribing to
    // the sibling updates row 1 before the Effect can run its initial graph.
    // The independent final rank order is row 2, then row 1. At the first
    // callback checkpoint, only row 2 may enter the width-one result.
    type Sync = Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const truth = new Map<number, Row>([
      [1, { id: 1, rank: 1, eligible: true, label: `first` }],
      [2, { id: 2, rank: 2, eligible: true, label: `second` }],
    ])
    let rootSync!: Sync
    const delivered = new Set<number>()
    const requests: Array<LoadSubsetOptions> = []
    const root = createCollection<Row, number>({
      id: `ordered-effect-start-root-${harnessId++}`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rootSync = operations
          operations.markReady()
          return {
            loadSubset: (options) => {
              requests.push(options)
              const selected = [...truth.values()]
                .filter(
                  (row) =>
                    (!options.where ||
                      evaluateReferenceExpression(options.where, row) ===
                        true) &&
                    (!options.cursor ||
                      evaluateReferenceExpression(
                        options.cursor.whereFrom,
                        row,
                      ) === true),
                )
                .sort((a, b) => a.rank - b.rank || a.id - b.id)
                .slice(
                  options.offset ?? 0,
                  options.limit === undefined
                    ? undefined
                    : (options.offset ?? 0) + options.limit,
                )
              operations.begin()
              for (const row of selected) {
                if (!delivered.has(row.id)) {
                  delivered.add(row.id)
                  operations.write({ type: `insert`, value: { ...row } })
                }
              }
              expect(
                operations.commit(),
                `ordered page applies synchronously`,
              ).toBe(true)
              return true
            },
          }
        },
      },
    })
    const marker = createCollection<Marker, number>({
      id: `ordered-effect-start-marker-${harnessId++}`,
      getKey: ({ id }) => id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.markReady()
        },
      },
    })
    const originalSubscribe = marker.subscribeChanges.bind(marker)
    let changedDuringStart = false
    vi.spyOn(marker, `subscribeChanges`).mockImplementation(((...args) => {
      const subscription = originalSubscribe(...args)
      // Only the first subscription after the ordered page can drive this
      // history; other subscribers must not repeat or preempt the update.
      if (changedDuringStart || requests.length === 0) return subscription
      expect(requests[0]?.orderBy, `first request is ordered`).toBeDefined()
      expect(requests[0]?.limit, `first request loads one row`).toBe(1)
      expect(delivered.has(1), `first page installed row 1`).toBe(true)
      expect(root.get(1)?.rank, `row 1 is present before its update`).toBe(1)
      changedDuringStart = true
      const updated = { ...truth.get(1)!, rank: 3, label: `moved` }
      truth.set(1, updated)
      rootSync.begin()
      rootSync.write({ type: `update`, value: updated })
      expect(rootSync.commit(), `startup update applies synchronously`).toBe(
        true,
      )
      return subscription
    }) as typeof marker.subscribeChanges)

    const batches: Array<Array<DeltaEvent<Row, string>>> = []
    let effect: ReturnType<typeof createEffect> | undefined
    // Drain the scheduled callback queue at the assertion checkpoint. A single
    // event-loop turn can miss a later duplicate batch.
    vi.useFakeTimers()
    try {
      await withHistoryCleanup(
        async () => {
          effect = createEffect<Row, string>({
            query: (q) =>
              q
                .from({ row: root })
                .leftJoin({ marker }, ({ row, marker: child }) =>
                  eq(row.id, child.rowId),
                )
                .orderBy(({ row }) => row.rank)
                .limit(1)
                .select(({ row }) => ({
                  id: row.id,
                  rank: row.rank,
                  eligible: row.eligible,
                  label: row.label,
                })),
            onBatch: (events) => {
              batches.push(events)
            },
          })
          expect(changedDuringStart).toBe(true)
          await vi.runAllTimersAsync()
          expect(batches).toEqual([
            [{ type: `enter`, key: `[2,null]`, value: truth.get(2) }],
          ])
          expect(requests.some((options) => options.refetch === true)).toBe(
            true,
          )
        },
        () => [
          () => effect?.dispose(),
          () => root.cleanup(),
          () => marker.cleanup(),
        ],
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it(`keeps an Effect live when truncate replay aborts an obsolete repair participant`, async () => {
    await expect(
      observeEffectAfterObsoleteRepairAbort(),
    ).resolves.toMatchObject({
      rows: [2],
      finalLabel: `updated after replay`,
    })
  })

  it(`suppresses an asynchronous initial ordered window when skipInitial is set`, async () => {
    await expect(observeSkipInitialOrderedLoad()).resolves.toEqual({
      initialEvents: [],
      laterEvents: expect.arrayContaining([`enter:3`, `exit:1`]),
    })
  })

  it(`restarts bounded repair when another order mutation arrives during its tie request`, async () => {
    await expect(observeMutationDuringBoundedRepair()).resolves.toMatchObject({
      rows: [3],
      publications: [[3]],
    })
  })

  it(`emits no Effect delta for a row that enters and exits during held repair`, async () => {
    await expect(observeHeldEffectDelta(`absent-cycle`)).resolves.toMatchObject(
      {
        rows: [3],
      },
    )
  })

  it(`emits the published value when an updated row exits during held repair`, async () => {
    await expect(
      observeHeldEffectDelta(`present-update-exit`),
    ).resolves.toMatchObject({ rows: [3, 4] })
  })

  it.each([
    {
      name: `matching`,
      secondaryRows: [
        { id: `c-child`, joinKey: `c` },
        { id: `d-child`, joinKey: `d` },
      ],
      expected: [`c:c-child`, `d:d-child`],
    },
    {
      name: `empty`,
      secondaryRows: [] as Array<{ id: string; joinKey: string }>,
      expected: [] as Array<string>,
    },
  ])(
    `waits for a $name joined source after exhausting tied ordered rows`,
    async ({ name, secondaryRows, expected }) => {
      type Primary = { id: string; rank: number; joinKey: string }
      type Secondary = { id: string; joinKey: string }
      const primaryRows: Array<Primary> = [`a`, `b`, `c`, `d`].map((id) => ({
        id,
        rank: 0,
        joinKey: id,
      }))
      const deliveredPrimary = new Set<string>()
      const deliveredSecondary = new Set<string>()
      const secondaryLoads: Array<{
        options: LoadSubsetOptions
        gate: ReturnType<typeof createDeferred<void>>
      }> = []
      let primaryExhausted = false

      const primary = createCollection<Primary>({
        id: `ordered-late-join-primary-${name}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: async (options) => {
                const rows = options.orderBy
                  ? [
                      primaryRows[
                        options.cursor?.lastKey
                          ? primaryRows.findIndex(
                              ({ id }) => id === options.cursor?.lastKey,
                            ) + 1
                          : 0
                      ],
                    ].filter((row): row is Primary => row !== undefined)
                  : primaryRows.filter(
                      (row) =>
                        !options.where ||
                        evaluateReferenceExpression(options.where, row) ===
                          true,
                    )
                const fresh = rows.filter(({ id }) => !deliveredPrimary.has(id))
                if (fresh.length > 0) {
                  begin()
                  for (const row of fresh) {
                    deliveredPrimary.add(row.id)
                    write({ type: `insert`, value: row })
                  }
                  const receipt = commit(options.signal)
                  if (receipt !== true) await receipt
                }
                primaryExhausted = deliveredPrimary.size === primaryRows.length
              },
            }
          },
        },
      })
      const secondary = createCollection<Secondary>({
        id: `ordered-late-join-secondary-${name}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: async (options) => {
                const gate = createDeferred<void>()
                secondaryLoads.push({ options, gate })
                await gate.promise
                const fresh = secondaryRows.filter(
                  (row) =>
                    !deliveredSecondary.has(row.id) &&
                    (!options.where ||
                      evaluateReferenceExpression(options.where, row) === true),
                )
                for (const row of fresh) {
                  deliveredSecondary.add(row.id)
                  begin()
                  write({ type: `insert`, value: row })
                  const receipt = commit(options.signal)
                  if (receipt !== true) await receipt
                }
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection((q) =>
        q
          .from({ primaryRow: primary })
          .innerJoin(
            { secondaryRow: secondary },
            ({ primaryRow, secondaryRow }) =>
              eq(primaryRow.joinKey, secondaryRow.joinKey),
          )
          .orderBy(({ primaryRow }) => primaryRow.rank)
          .limit(2),
      )

      try {
        const preload = live.preload()
        let settled = false
        void preload.finally(() => {
          settled = true
        })
        await vi.waitFor(() =>
          expect(
            primaryExhausted,
            JSON.stringify({
              deliveredPrimary: [...deliveredPrimary],
              secondaryLoads: secondaryLoads.length,
            }),
          ).toBe(true),
        )
        expect(secondaryLoads.length).toBeGreaterThan(0)
        expect(settled).toBe(false)

        for (const load of [...secondaryLoads].reverse()) {
          load.gate.resolve()
          await flushPromises()
        }
        await preload

        expect(
          live.toArray.map(
            ({ primaryRow, secondaryRow }) =>
              `${primaryRow.id}:${secondaryRow.id}`,
          ),
        ).toEqual(expected)
        expect(live.isLoadingSubset).toBe(false)
        expect(live.utils.lastSubsetError).toBeUndefined()
      } finally {
        for (const { gate } of secondaryLoads) gate.resolve()
        await Promise.all([
          live.cleanup(),
          primary.cleanup(),
          secondary.cleanup(),
        ])
      }
    },
  )

  it(`keeps independent joined loads isolated when they settle in reverse`, async () => {
    type Primary = { id: string; rank: number; joinKey: string }
    type Secondary = { id: string; joinKey: string }
    const pending: Array<{
      options: LoadSubsetOptions
      gate: ReturnType<typeof createDeferred<void>>
    }> = []
    const completionOrder: Array<number> = []
    const primary = createCollection<Primary>({
      id: `ordered-independent-primary`,
      getKey: ({ id }) => id,
      syncMode: `eager`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `a`, rank: 1, joinKey: `a` } })
          write({ type: `insert`, value: { id: `b`, rank: 2, joinKey: `b` } })
          commit()
          markReady()
        },
      },
    })
    const secondaryRows: Array<Secondary> = [
      { id: `a-child`, joinKey: `a` },
      { id: `b-child`, joinKey: `b` },
    ]
    const delivered = new Set<string>()
    const secondary = createCollection<Secondary>({
      id: `ordered-independent-secondary`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async (options) => {
              const index = pending.length
              const gate = createDeferred<void>()
              pending.push({ options, gate })
              await gate.promise
              const rows = secondaryRows.filter(
                (candidate) =>
                  !delivered.has(candidate.id) &&
                  (!options.where ||
                    evaluateReferenceExpression(options.where, candidate) ===
                      true),
              )
              for (const row of rows) {
                delivered.add(row.id)
                begin()
                write({ type: `insert`, value: row })
                const receipt = commit(options.signal)
                if (receipt !== true) await receipt
              }
              completionOrder.push(index)
            },
          }
        },
      },
    })
    const createJoined = (id: `a` | `b`) =>
      createLiveQueryCollection((q) =>
        q
          .from({ primaryRow: primary })
          .where(({ primaryRow }) => eq(primaryRow.id, id))
          .innerJoin(
            { secondaryRow: secondary },
            ({ primaryRow, secondaryRow }) =>
              eq(primaryRow.joinKey, secondaryRow.joinKey),
          )
          .orderBy(({ primaryRow }) => primaryRow.rank)
          .limit(1),
      )
    const first = createJoined(`a`)
    const second = createJoined(`b`)

    try {
      const firstPreload = first.preload()
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      const secondPreload = second.preload()
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      let firstSettled = false
      void firstPreload.finally(() => {
        firstSettled = true
      })

      pending[1]!.gate.resolve()
      await secondPreload
      await flushPromises()
      expect(firstSettled).toBe(false)
      expect(
        second.toArray.map(
          ({ primaryRow, secondaryRow }) =>
            `${primaryRow.id}:${secondaryRow.id}`,
        ),
      ).toEqual([`b:b-child`])

      pending[0]!.gate.resolve()
      await firstPreload
      expect(completionOrder).toEqual([1, 0])
      expect(
        first.toArray.map(
          ({ primaryRow, secondaryRow }) =>
            `${primaryRow.id}:${secondaryRow.id}`,
        ),
      ).toEqual([`a:a-child`])
      expect(first.utils.lastSubsetError).toBeUndefined()
      expect(second.utils.lastSubsetError).toBeUndefined()
    } finally {
      for (const { gate } of pending) gate.resolve()
      await Promise.all([
        first.cleanup(),
        second.cleanup(),
        primary.cleanup(),
        secondary.cleanup(),
      ])
    }
  })

  it(`keeps one source's replay from suppressing another source's recovery`, async () => {
    type Primary = { id: number; rank: number }
    type Secondary = { id: number; primaryId: number }
    const primaryTruth = new Map<number, Primary>([
      [1, { id: 1, rank: 0 }],
      [2, { id: 2, rank: 1 }],
    ])
    const deliveredPrimary = new Set<number>()
    const secondaryReplay = createDeferred<void>()
    let primaryRequests = 0
    let replayingSecondary = false
    let primarySync!: Parameters<SyncConfig<Primary, number>[`sync`]>[0]
    let secondarySync!: Parameters<SyncConfig<Secondary, number>[`sync`]>[0]
    let secondaryReplayCalls = 0

    const primary = createCollection<Primary, number>({
      id: `ordered-independent-recovery-primary`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          primarySync = operations
          operations.markReady()
          return {
            loadSubset: async (options) => {
              primaryRequests++
              let selected = [...primaryTruth.values()].sort(
                (left, right) => left.rank - right.rank || left.id - right.id,
              )
              if (options.where) {
                selected = selected.filter(
                  (row) =>
                    evaluateReferenceExpression(options.where!, row) === true,
                )
              }
              if (options.cursor) {
                selected = selected.filter(
                  (row) =>
                    evaluateReferenceExpression(
                      options.cursor!.whereFrom,
                      row,
                    ) === true,
                )
              } else if (options.offset) {
                selected = selected.slice(options.offset)
              }
              if (options.limit !== undefined) {
                selected = selected.slice(0, options.limit)
              }
              const fresh = selected.filter(
                ({ id }) => !deliveredPrimary.has(id),
              )
              if (fresh.length === 0) return
              operations.begin()
              for (const row of fresh) {
                deliveredPrimary.add(row.id)
                operations.write({ type: `insert`, value: { ...row } })
              }
              const receipt = operations.commit(options.signal)
              if (receipt !== true) await receipt
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const secondary = createCollection<Secondary, number>({
      id: `ordered-independent-recovery-secondary`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          secondarySync = operations
          operations.markReady()
          return {
            loadSubset: async (options) => {
              if (replayingSecondary) {
                secondaryReplayCalls++
                await secondaryReplay.promise
              }
              operations.begin()
              operations.write({
                type: `insert`,
                value: { id: 1, primaryId: 1 },
              })
              const receipt = operations.commit(options.signal)
              if (receipt !== true) await receipt
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: primary })
        .leftJoin({ child: secondary }, ({ row, child }) =>
          eq(row.id, child.primaryId),
        )
        .orderBy(({ row }) => row.rank)
        .limit(1)
        .select(({ row, child }) => ({
          id: row.id,
          rank: row.rank,
          childId: child.id,
        })),
    )

    try {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1])

      replayingSecondary = true
      secondarySync.begin()
      secondarySync.truncate()
      const truncateReceipt = secondarySync.commit()
      if (truncateReceipt !== true) await truncateReceipt
      await vi.waitFor(() => expect(secondaryReplayCalls).toBeGreaterThan(0))

      const requestsBeforeMutation = primaryRequests
      const moved = { id: 1, rank: 10 }
      primaryTruth.set(1, moved)
      primarySync.begin()
      primarySync.write({ type: `update`, value: moved })
      const mutationReceipt = primarySync.commit()
      if (mutationReceipt !== true) await mutationReceipt
      await vi.waitFor(() =>
        expect(primaryRequests).toBeGreaterThan(requestsBeforeMutation),
      )
      expect(live.toArray.map(({ id }) => id)).toEqual([1])

      secondaryReplay.resolve()
      await vi.waitFor(() =>
        expect(live.toArray.map(({ id }) => id)).toEqual([2]),
      )
      expect(primaryRequests).toBeGreaterThan(requestsBeforeMutation)
    } finally {
      secondaryReplay.resolve()
      await Promise.all([
        live.cleanup(),
        primary.cleanup(),
        secondary.cleanup(),
      ])
    }
  })

  it(`publishes one complete batch after an indexed loader fills a window`, async () => {
    const remoteRows: ReadonlyArray<Row> = [
      { id: 1, rank: 1, eligible: true, label: `one` },
      { id: 2, rank: 2, eligible: true, label: `two` },
    ]
    const batches: Array<Array<number>> = []
    const callbackReads: Array<Array<number>> = []
    let loads = 0
    const delivered = new Set<number>()
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const source = createCollection<Row, number>({
      id: `ordered-atomic-indexed-window`,
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
              loads++
              const row = remoteRows.find(
                (candidate) =>
                  !delivered.has(candidate.id) &&
                  (!options.where ||
                    evaluateReferenceExpression(options.where, candidate) ===
                      true),
              )
              if (!row) return true
              delivered.add(row.id)
              sync.begin()
              sync.write({ type: `insert`, value: row })
              const receipt = sync.commit()
              if (receipt !== true) {
                throw new Error(`Expected synchronous source application`)
              }
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(0),
    )
    const readIds = () => live.toArray.map(({ id }) => id)
    const subscription = live.subscribeChanges(
      (changes) => {
        batches.push(changes.map(({ key }) => Number(key)).sort())
        callbackReads.push(readIds())
      },
      { includeInitialState: false },
    )

    await withHistoryCleanup(
      async () => {
        await live.preload()
        await live.utils.setWindow({ offset: 0, limit: 2 })
        await flushPromises()

        // Each page turn is followed by a tie-boundary request. The source
        // returns one row at a time while honoring both predicates.
        expect(loads).toBe(4)
        expect(readIds()).toEqual([1, 2])
        expect(batches).toEqual([[1, 2]])
        expect(callbackReads).toEqual([[1, 2]])
      },
      () => [
        () => subscription.unsubscribe(),
        () => live.cleanup(),
        () => source.cleanup(),
      ],
    )
  })

  it(`processes a synchronous root refill before joined publication`, async () => {
    type Root = { id: number; rank: number }
    type Child = { id: number; rootId: number }
    const truth: Array<Root> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
    ]
    const installed = new Set<number>()
    const rootRequests: Array<LoadSubsetOptions> = []
    const firstChildGate = createDeferred<void>()
    let childLoads = 0
    const rootCollection = createCollection<Root, number>({
      id: `ordered-synchronous-refill-root`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.markReady()
          return {
            loadSubset: (options) => {
              rootRequests.push(options)
              let selected = truth
                .filter(
                  (row) =>
                    !options.where ||
                    evaluateReferenceExpression(options.where, row) === true,
                )
                .filter(
                  (row) =>
                    !options.cursor ||
                    evaluateReferenceExpression(
                      options.cursor.whereFrom,
                      row,
                    ) === true,
                )
                .sort((left, right) => left.rank - right.rank)
              if (!options.cursor && options.offset) {
                selected = selected.slice(options.offset)
              }
              if (options.limit !== undefined) {
                selected = selected.slice(0, options.limit)
              }
              const fresh = selected.filter(({ id }) => !installed.has(id))
              if (fresh.length > 0) {
                operations.begin()
                for (const row of fresh) {
                  installed.add(row.id)
                  operations.write({ type: `insert`, value: row })
                }
                const receipt = operations.commit(options.signal)
                if (receipt !== true) {
                  throw new Error(`Expected synchronous root application`)
                }
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const childCollection = createCollection<Child, number>({
      id: `ordered-synchronous-refill-child`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.begin()
          operations.write({
            type: `insert`,
            value: { id: 20, rootId: 2 },
          })
          if (operations.commit() !== true) {
            throw new Error(`Expected synchronous child application`)
          }
          operations.markReady()
          return {
            loadSubset: () => {
              childLoads++
              return childLoads === 1 ? firstChildGate.promise : true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `ordered-synchronous-refill-live`,
      startSync: false,
      query: (q) =>
        q
          .from({ root: rootCollection })
          .leftJoin({ child: childCollection }, ({ root, child }) =>
            eq(root.id, child.rootId),
          )
          .where(({ child }) => not(isUndefined(child.rootId)))
          .orderBy(({ root }) => root.rank)
          .limit(1)
          .select(({ root }) => ({ id: root.id })),
    })

    await withHistoryCleanup(
      async () => {
        const preload = live.preload()
        await vi.waitFor(() => {
          expect(childLoads).toBe(1)
          expect(rootRequests).toHaveLength(1)
        })
        expect(live.toArray).toEqual([])

        firstChildGate.resolve()
        await preload
        expect(childLoads).toBe(2)
        expect(live.toArray.map(({ id }) => id)).toEqual([2])
        expect(rootRequests.some(({ cursor }) => cursor !== undefined)).toBe(
          true,
        )
      },
      () => [
        () => firstChildGate.resolve(),
        () => live.cleanup(),
        () => rootCollection.cleanup(),
        () => childCollection.cleanup(),
      ],
    )
  })

  it(`resumes bounded ordered repair after joined demand settles`, async () => {
    type Root = { id: number; rank: number }
    type Child = { id: number; rootId: number }
    const truth: Array<Root> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const installed = new Set<number>()
    const rootRequests: Array<LoadSubsetOptions> = []
    const secondChildGate = createDeferred<void>()
    let childLoads = 0
    let rootSync!: Parameters<SyncConfig<Root, number>[`sync`]>[0]
    const rootCollection = createCollection<Root, number>({
      id: `ordered-held-repair-root`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rootSync = operations
          operations.markReady()
          return {
            loadSubset: async (options) => {
              rootRequests.push(options)
              let selected = truth
                .filter(
                  (row) =>
                    !options.where ||
                    evaluateReferenceExpression(options.where, row) === true,
                )
                .filter(
                  (row) =>
                    !options.cursor ||
                    evaluateReferenceExpression(
                      options.cursor.whereFrom,
                      row,
                    ) === true,
                )
                .sort((left, right) => left.rank - right.rank)
              if (!options.cursor && options.offset) {
                selected = selected.slice(options.offset)
              }
              if (options.limit !== undefined) {
                selected = selected.slice(0, options.limit)
              }
              const fresh = selected.filter(({ id }) => !installed.has(id))
              if (fresh.length > 0) {
                operations.begin()
                for (const row of fresh) {
                  installed.add(row.id)
                  operations.write({ type: `insert`, value: row })
                }
                const receipt = operations.commit(options.signal)
                if (receipt !== true) await receipt
              }
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const childCollection = createCollection<Child, number>({
      id: `ordered-held-repair-child`,
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
              return childLoads === 2 ? secondChildGate.promise : true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `ordered-held-repair-live`,
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

    const deleteRoot = async (id: number) => {
      const row = truth.find((candidate) => candidate.id === id)!
      truth.splice(truth.indexOf(row), 1)
      installed.delete(id)
      rootSync.begin()
      rootSync.write({ type: `delete`, value: row })
      const receipt = rootSync.commit()
      if (receipt !== true) await receipt
    }

    await withHistoryCleanup(
      async () => {
        await live.preload()
        expect(live.toArray.map(({ id }) => id)).toEqual([1])

        await deleteRoot(1)
        await vi.waitFor(() => {
          expect(childLoads).toBe(2)
          expect(rootRequests.filter(({ refetch }) => refetch)).toHaveLength(2)
        })
        expect(live.toArray.map(({ id }) => id)).toEqual([1])

        secondChildGate.resolve()
        await vi.waitFor(() =>
          expect(live.toArray.map(({ id }) => id)).toEqual([2]),
        )

        await deleteRoot(2)
        await vi.waitFor(() =>
          expect(live.toArray.map(({ id }) => id)).toEqual([3]),
        )
        expect(
          rootRequests.filter(({ refetch }) => refetch).length,
        ).toBeGreaterThan(2)
      },
      () => [
        () => secondChildGate.resolve(),
        () => live.cleanup(),
        () => rootCollection.cleanup(),
        () => childCollection.cleanup(),
      ],
    )
  })

  it(`replaces an ordered snapshot after truncate without repeating void loads`, async () => {
    const initial: ReadonlyArray<Row> = [
      { id: 1, rank: 1, eligible: true, label: `old-one` },
      { id: 2, rank: 2, eligible: true, label: `old-two` },
    ]
    const replacement: ReadonlyArray<Row> = [
      { id: 3, rank: 3, eligible: true, label: `new-three` },
      { id: 4, rank: 4, eligible: true, label: `new-four` },
    ]
    let truth = initial
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    let loads = 0
    const installed = new Set<number>()
    const source = createCollection<Row, number>({
      id: `ordered-void-truncate`,
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
            loadSubset: async (options) => {
              loads++
              if (loads > 12) {
                throw new Error(
                  `ordered void loading did not reach a fixed point`,
                )
              }
              const matching = options.where
                ? truth.filter(
                    (row) =>
                      evaluateReferenceExpression(options.where!, row) === true,
                  )
                : truth
              const rows = matching
                .slice(
                  options.offset ?? 0,
                  options.limit === undefined
                    ? undefined
                    : (options.offset ?? 0) + options.limit,
                )
                .filter(({ id }) => !installed.has(id))
              if (rows.length === 0) return
              sync.begin()
              for (const row of rows) {
                installed.add(row.id)
                sync.write({ type: `insert`, value: row })
              }
              const receipt = sync.commit()
              if (receipt !== true) await receipt
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
        .limit(2),
    )

    try {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])

      truth = replacement
      installed.clear()
      sync.begin()
      sync.truncate()
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      await flushPromises()

      expect(live.toArray.map(({ id }) => id)).toEqual([3, 4])
      expect(loads).toBeLessThanOrEqual(8)
    } finally {
      await Promise.all([live.cleanup(), source.cleanup()])
    }
  })

  it.each([
    { name: `until full-source recovery settles`, failure: undefined },
    {
      name: `when full-source recovery throws synchronously`,
      failure: {
        mode: `sync` as const,
        attempts: 1,
        error: new Error(`full-source recovery failed`),
      },
    },
    {
      name: `after two synchronous full-source recovery failures`,
      failure: {
        mode: `sync` as const,
        attempts: 2,
        error: new Error(`full-source recovery failed twice`),
      },
    },
    {
      name: `after asynchronous full-source recovery retries`,
      failure: {
        mode: `async` as const,
        attempts: 1,
        error: new Error(`full-source recovery rejected`),
      },
    },
    {
      name: `after two asynchronous full-source recovery failures`,
      failure: {
        mode: `async` as const,
        attempts: 2,
        error: new Error(`full-source recovery rejected twice`),
      },
    },
  ])(`keeps an ordered snapshot unchanged $name`, async ({ failure }) => {
    const makeRows = (ranks: ReadonlyArray<number>): Array<Row> =>
      ranks.map((rank, index) => ({
        id: index + 1,
        rank,
        eligible: true,
        label: `row-${rank}`,
      }))
    let truth = makeRows([1, 2, 3, 4, 5])
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    let recovering = false
    let fullSourceRequests = 0
    const fullSource = createDeferred<void>()
    const installed = new Set<number>()
    const publications: Array<Array<number>> = []
    const escapedErrors: Array<unknown> = []
    const acquisitions: Array<LoadSubsetOptions> = []
    const releases: Array<LoadSubsetOptions> = []
    const enqueueMicrotask = globalThis.queueMicrotask.bind(globalThis)
    const queueMicrotaskSpy =
      failure?.mode === `sync`
        ? vi
            .spyOn(globalThis, `queueMicrotask`)
            .mockImplementation((callback) =>
              enqueueMicrotask(() => {
                try {
                  callback()
                } catch (error) {
                  escapedErrors.push(error)
                }
              }),
            )
        : undefined

    const source = createCollection<Row, number>({
      id: `delayed-full-source-recovery`,
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
              const isFullSource =
                options.where === undefined && options.limit === undefined
              if (recovering && isFullSource) {
                fullSourceRequests++
                if (failure && fullSourceRequests <= failure.attempts) {
                  // A synchronous throw is a rejection (maintainer
                  // decision): an acquisition that core releases.
                  acquisitions.push(options)
                  if (failure.mode === `sync`) throw failure.error
                  return Promise.reject(failure.error)
                }
              }
              acquisitions.push(options)

              return (async () => {
                if (recovering && isFullSource && !failure) {
                  await fullSource.promise
                }

                let selected = options.where
                  ? truth.filter(
                      (row) =>
                        evaluateReferenceExpression(options.where!, row) ===
                        true,
                    )
                  : [...truth]
                if (options.cursor) {
                  selected = selected.filter(
                    (row) =>
                      evaluateReferenceExpression(
                        options.cursor!.whereFrom,
                        row,
                      ) === true,
                  )
                }
                selected.sort((left, right) => left.rank - right.rank)
                if (!options.cursor && options.offset) {
                  selected = selected.slice(options.offset)
                }
                if (options.limit !== undefined) {
                  selected = selected.slice(0, options.limit)
                }

                const fresh = selected.filter(({ id }) => !installed.has(id))
                if (fresh.length === 0) return
                sync.begin()
                for (const row of fresh) {
                  installed.add(row.id)
                  sync.write({ type: `insert`, value: row })
                }
                const receipt = sync.commit()
                if (receipt !== true) await receipt
              })()
            },
            unloadSubset: (options) => {
              releases.push(options)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    )
    const subscription = live.subscribeChanges(() => {
      publications.push(live.toArray.map(({ rank }) => rank))
    })

    try {
      await live.preload()
      await live.utils.setWindow({ offset: 0, limit: 4 })
      await flushPromises()
      expect(live.toArray.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
      const publicationCount = publications.length

      truth = makeRows([0, 0.5, 1, 1.5, 2, 3])
      installed.clear()
      recovering = true
      sync.begin()
      sync.truncate()
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      await vi.waitFor(() => expect(fullSourceRequests).toBe(1))
      for (let index = 0; index < 4; index++) await flushPromises()

      expect(live.toArray.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
      expect(publications).toHaveLength(publicationCount)

      if (failure) {
        expect(live.utils.lastSubsetError).toBe(failure.error)
        expect(escapedErrors).toEqual([])
        truth[0] = { ...truth[0]!, label: `updated during failed recovery` }
        sync.begin()
        sync.write({ type: `update`, value: truth[0] })
        const updateReceipt = sync.commit()
        if (updateReceipt !== true) await updateReceipt
        await flushPromises()
        expect(live.toArray.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
        expect(live.get(1)?.label).toBe(`row-1`)
        expect(publications).toHaveLength(publicationCount)
        expect(fullSourceRequests).toBe(1)
        const retryCount = failure.attempts
        for (let retry = 0; retry < retryCount; retry++) {
          installed.clear()
          sync.begin()
          sync.truncate()
          const retryReceipt = sync.commit()
          if (retryReceipt !== true) await retryReceipt
          await vi.waitFor(() => expect(fullSourceRequests).toBe(retry + 2))
          if (retry + 1 < retryCount) {
            for (let index = 0; index < 4; index++) await flushPromises()
            expect(live.toArray.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
            expect(publications).toHaveLength(publicationCount)
            expect(live.utils.lastSubsetError).toBe(failure.error)
            expect(escapedErrors).toEqual([])
          }
        }
        await vi.waitFor(() =>
          expect(source.toArray.map(({ rank }) => rank).sort()).toEqual([
            0, 0.5, 1, 1.5, 2, 3,
          ]),
        )
        await vi.waitFor(() =>
          expect(live.toArray.map(({ rank }) => rank)).toEqual([
            0, 0.5, 1, 1.5,
          ]),
        )
        expect(fullSourceRequests).toBe(retryCount + 1)
        expect(live.get(1)?.label).toBe(`updated during failed recovery`)
      } else {
        fullSource.resolve()
        await flushPromises()
        expect(live.toArray.map(({ rank }) => rank)).toEqual([0, 0.5, 1, 1.5])
      }
      expect(publications.slice(publicationCount)).toEqual([[0, 0.5, 1, 1.5]])
      expect(escapedErrors).toEqual([])
      await live.utils.setWindow({ offset: 0, limit: 2 })
      expect(live.toArray.map(({ rank }) => rank)).toEqual([0, 0.5])
      const loadsBeforeReplay = fullSourceRequests
      installed.clear()
      sync.begin()
      sync.truncate()
      const nextReplay = sync.commit()
      if (nextReplay !== true) await nextReplay
      await flushPromises()
      expect(fullSourceRequests).toBeGreaterThan(loadsBeforeReplay)
      expect(live.toArray.map(({ rank }) => rank)).toEqual([0, 0.5])
    } finally {
      queueMicrotaskSpy?.mockRestore()
      fullSource.resolve()
      subscription.unsubscribe()
      await Promise.all([live.cleanup(), source.cleanup()])
    }
    expect(releases).toHaveLength(acquisitions.length)
    for (const acquisition of acquisitions) {
      expect(
        releases.filter((release) => release === acquisition),
      ).toHaveLength(1)
    }
  })

  it.each([`collection`, `effect`] as const)(
    `continues an ordered anti-join %s while an unrelated include demand is pending`,
    async (kind) => {
      const rows = [
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
        { id: 3, rank: 3 },
      ]
      const delivered = new Set<number>()
      const rootRequests: Array<{ cursor: boolean; limit?: number }> = []
      const extraGate = createDeferred<void>()
      let extraLoads = 0

      const root = createCollection({
        id: `ordered-unrelated-root-${harnessId++}`,
        getKey: (row: (typeof rows)[number]) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: async (options) => {
                rootRequests.push({
                  cursor: !!options.cursor,
                  limit: options.limit,
                })
                if (rootRequests.length > 15) throw new Error(`request loop`)
                const matching = options.where
                  ? rows.filter(
                      (row) =>
                        evaluateReferenceExpression(options.where!, row) ===
                        true,
                    )
                  : rows
                const candidates = options.cursor
                  ? matching.filter(
                      (row) =>
                        evaluateReferenceExpression(
                          options.cursor!.whereFrom,
                          row,
                        ) === true,
                    )
                  : matching.slice(options.offset ?? 0)
                const fresh = candidates
                  .slice(0, options.limit)
                  .filter((row) => !delivered.has(row.id))
                if (fresh.length === 0) return
                begin()
                for (const row of fresh) {
                  delivered.add(row.id)
                  write({ type: `insert`, value: row })
                }
                const receipt = commit()
                if (receipt !== true) await receipt
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const markerSource = createCollection({
        id: `ordered-unrelated-marker-${harnessId++}`,
        getKey: (row: { id: number; rowId: number }) => row.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: 2, rowId: 2 } })
            commit()
            markReady()
          },
        },
      })
      const extraSource = createCollection({
        id: `ordered-unrelated-extra-${harnessId++}`,
        getKey: (row: { id: number; rowId: number }) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: async () => {
                extraLoads++
                await extraGate.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const query = (q: InitialQueryBuilder) =>
        q
          .from({ row: root })
          .leftJoin({ marker: markerSource }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => isUndefined(marker.rowId))
          .orderBy(({ row }) => row.rank)
          .limit(2)
          .select(({ row }) => ({
            id: row.id,
            extras: toArray(
              q
                .from({ extra: extraSource })
                .where(({ extra }) => eq(extra.rowId, row.id)),
            ),
          }))
      const live =
        kind === `collection` ? createLiveQueryCollection(query) : undefined
      const effectRows = new Set<number>()
      const effect =
        kind === `effect`
          ? createEffect<{ id: number; extras: Array<unknown> }>({
              query,
              onBatch: (events) => {
                for (const event of events) {
                  if (event.type === `exit`) effectRows.delete(event.value.id)
                  else effectRows.add(event.value.id)
                }
              },
            })
          : undefined
      const preload = live?.preload()

      try {
        await vi.waitFor(() => expect(extraLoads).toBeGreaterThan(0))
        for (let i = 0; i < 12; i++) await flushPromises()
        expect(
          rootRequests.some((request) => request.cursor),
          JSON.stringify({
            rootRequests,
            extraLoads,
            rows: live?.toArray ?? [...effectRows],
          }),
        ).toBe(true)
        extraGate.resolve()
        await preload
        await vi.waitFor(() =>
          expect(rootRequests.some((request) => request.cursor)).toBe(true),
        )
        expect(live?.toArray.map(({ id }) => id) ?? [...effectRows]).toEqual([
          1, 3,
        ])
      } finally {
        extraGate.resolve()
        await Promise.all([
          effect?.dispose(),
          live?.cleanup(),
          root.cleanup(),
          markerSource.cleanup(),
          extraSource.cleanup(),
        ])
      }
    },
  )
})

describe(`eager indexed ordered windows`, () => {
  const { multiplier } = readOracleRunConfig()
  const runs = 40 * multiplier

  it(`rejects a hostile optimistic observation that makes no refill progress`, () => {
    const testCase: OptimisticWindowCase = {
      shape: `joined`,
      mutation: `delete`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [4, 3, 2],
      acquisition: `required`,
    }
    const observation: OptimisticWindowObservation = {
      initial: [3, 2],
      immediate: [2],
      acquiring: [2],
      answerQueued: [2],
      settled: [2, 1],
      rowsAfterFirstTurn: [2, 1],
      rowsAfterSecondTurn: [2, 1],
      immediatePublications: [{ rows: [2] }],
      preSettlementPublications: [{ rows: [2] }],
      publicationsAtSettlement: [{ rows: [2] }, { rows: [2, 1] }],
      publicationsAfterSettlement: [],
      attempts: [],
      settlementOutcome: `fulfilled`,
    }

    expect(optimisticWindowViolations(observation, testCase)).toEqual([
      `refill acquisition did not start`,
      `refill answer did not submit row 1`,
    ])
  })

  it(`rejects a delayed Collection publication`, () => {
    const testCase: OptimisticWindowCase = {
      shape: `joined`,
      mutation: `update`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [4, 3, 2],
      acquisition: `required`,
    }
    const observation: OptimisticWindowObservation = {
      initial: [3, 2],
      immediate: [2],
      acquiring: [2],
      answerQueued: [2],
      settled: [2, 1],
      rowsAfterFirstTurn: [2, 1],
      rowsAfterSecondTurn: [2, 1],
      immediatePublications: [],
      preSettlementPublications: [{ rows: [2] }],
      publicationsAtSettlement: [{ rows: [2] }, { rows: [2, 1] }],
      publicationsAfterSettlement: [],
      attempts: [
        {
          submittedRows: [1],
          limit: 2,
          direction: `desc`,
          appliedReceiptPending: true,
          providerPending: true,
        },
      ],
      settlementOutcome: `fulfilled`,
    }

    expect(optimisticWindowViolations(observation, testCase)).toEqual([
      `immediate publications: [] instead of [[2]]`,
    ])
  })

  it(`rejects a stale publication after transaction settlement`, () => {
    const testCase: OptimisticWindowCase = {
      shape: `joined`,
      mutation: `update`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [4, 3, 2],
      acquisition: `required`,
    }
    const observation: OptimisticWindowObservation = {
      initial: [3, 2],
      immediate: [2],
      acquiring: [2],
      answerQueued: [2],
      settled: [2, 1],
      rowsAfterFirstTurn: [2, 1],
      rowsAfterSecondTurn: [2],
      immediatePublications: [{ rows: [2] }],
      preSettlementPublications: [{ rows: [2] }],
      publicationsAtSettlement: [{ rows: [2] }, { rows: [2, 1] }],
      publicationsAfterSettlement: [{ rows: [2] }],
      attempts: [
        {
          submittedRows: [1],
          limit: 2,
          direction: `desc`,
          appliedReceiptPending: true,
          providerPending: true,
        },
      ],
      settlementOutcome: `fulfilled`,
    }

    expect(optimisticWindowViolations(observation, testCase)).toEqual([
      `rows after second settlement turn: [2] instead of [2,1]`,
      `post-settlement publications: [[2]] instead of []`,
    ])
  })

  it(`rejects a full-source refill disguised as useful bounded progress`, () => {
    const testCase: OptimisticWindowCase = {
      shape: `joined`,
      mutation: `delete`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [4, 3, 2],
      acquisition: `required`,
    }
    const observation: OptimisticWindowObservation = {
      initial: [3, 2],
      immediate: [2],
      acquiring: [2],
      answerQueued: [2],
      settled: [2, 1],
      rowsAfterFirstTurn: [2, 1],
      rowsAfterSecondTurn: [2, 1],
      immediatePublications: [{ rows: [2] }],
      preSettlementPublications: [{ rows: [2] }],
      publicationsAtSettlement: [{ rows: [2] }, { rows: [2, 1] }],
      publicationsAfterSettlement: [],
      attempts: [
        {
          submittedRows: [4, 3, 2, 1, 0, -1],
          limit: 6,
          direction: `desc`,
          appliedReceiptPending: true,
          providerPending: true,
        },
      ],
      settlementOutcome: `fulfilled`,
    }

    expect(optimisticWindowViolations(observation, testCase)).toEqual([
      `refill used an unbounded provider request`,
    ])
    const repeated = {
      ...observation,
      attempts: [{ ...observation.attempts[0]!, limit: 2 }],
      requestHistory: [
        { identity: `same ordered page`, newRows: 1 },
        { identity: `same ordered page`, newRows: 0 },
      ],
    }
    expect(optimisticWindowViolations(repeated, testCase)).toEqual([
      `repeated an unchanged provider request without progress`,
    ])
  })

  // Reconstruction: the fixed-seed campaign reaches the premise. Sampling
  // its arbitrary with its seed and run count yields exactly the cases it
  // executes. Their initial windows include rootless rows and, separately,
  // windows that hold a rootless row beside a root row with a null rank.
  it(`generates full-join windows that reach the null group`, () => {
    let rootless = 0
    let mixedNullGroup = 0
    for (const [testCase] of fc.sample(
      fc.tuple(eagerFullJoinCase),
      oracleFixedSeed(FULL_JOIN_SEED, { numRuns: runs }),
    )) {
      const roots = [
        ...fillerRows(testCase.direction, testCase.fillers),
        ...testCase.initial,
      ]
      const model = new Map<number, Row>()
      for (const row of roots) {
        model.set(row.id, { label: `row`, ...row, eligible: true })
      }
      for (const markerId of testCase.orphans ?? []) {
        model.set(-1 - markerId, {
          id: -1 - markerId,
          rank: null as unknown as number,
          eligible: true,
          label: `marker`,
        })
      }
      const window = eagerWindow(model, testCase)
      const hasRootless = window.some((id) => id < 0)
      if (hasRootless) rootless++
      if (
        hasRootless &&
        window.some(
          (id) => id >= 0 && (model.get(id)!.rank as number | null) == null,
        )
      ) {
        mixedNullGroup++
      }
    }
    // At one times the run count: 19 and 7 of 40 cases.
    expect(rootless).toBeGreaterThanOrEqual(10)
    expect(mixedNullGroup).toBeGreaterThanOrEqual(5)
  })
})
