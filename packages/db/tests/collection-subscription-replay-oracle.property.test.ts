import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { Collection } from '../src/collection/index.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
} from '../src/types.js'

type ReplayRow = {
  id: `one` | `two`
  value: number
}

type ReplayLoad = {
  rows: ReadonlyArray<ReplayRow>
  outcome: `resolve` | `reject`
}

type ReplayAttempt = {
  loads: ReadonlyArray<ReplayLoad>
}

type SourceAction =
  | { type: `put`; row: ReplayRow }
  | { type: `delete`; id: ReplayRow[`id`] }

type ReplayChange = {
  type: `insert` | `update` | `delete`
  key: string | number
  value: ReplayRow
  previousValue?: ReplayRow
}

type ReplayScenario = {
  initialRows: ReadonlyArray<ReplayRow>
  demandCount: number
  attempts: ReadonlyArray<ReplayAttempt>
  settlementOrder: ReadonlyArray<number>
  settlementPhases: ReadonlyArray<number>
  afterSettlement: ReadonlyArray<SourceAction>
}

type SequentialReplayLoad = {
  rows: ReadonlyArray<ReplayRow>
  outcome: `return` | `throw` | `resolve` | `reject`
}

type SequentialReplayScenario = {
  initialRows: ReadonlyArray<ReplayRow>
  loads: ReadonlyArray<SequentialReplayLoad>
}

type PendingReplay = {
  attemptIndex: number
  load: ReplayLoad
  signal: AbortSignal | undefined
  deferred: ReturnType<typeof createDeferred<void>>
  error: Error
  settled: boolean
}

const rowArbitrary: fc.Arbitrary<ReplayRow> = fc.record({
  id: fc.constantFrom(`one` as const, `two` as const),
  value: fc.integer({ min: -2, max: 2 }),
})

const rowsArbitrary = fc.uniqueArray(rowArbitrary, {
  minLength: 0,
  maxLength: 2,
  selector: ({ id }) => id,
})

const replayLoadArbitrary: fc.Arbitrary<ReplayLoad> = fc.record({
  rows: rowsArbitrary,
  outcome: fc.constantFrom(`resolve` as const, `reject` as const),
})

const sourceActionArbitrary: fc.Arbitrary<SourceAction> = fc.oneof(
  rowArbitrary.map((row) => ({ type: `put` as const, row })),
  fc
    .constantFrom<ReplayRow[`id`]>(`one`, `two`)
    .map((id) => ({ type: `delete` as const, id })),
)

const replayScenarioArbitrary: fc.Arbitrary<ReplayScenario> = fc
  .integer({ min: 1, max: 2 })
  .chain((demandCount) =>
    fc
      .record({
        initialRows: rowsArbitrary,
        attempts: fc.array(
          fc.record({
            loads: fc.array(replayLoadArbitrary, {
              minLength: demandCount,
              maxLength: demandCount,
            }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        afterSettlement: fc.array(sourceActionArbitrary, {
          minLength: 0,
          maxLength: 3,
        }),
      })
      .chain(({ initialRows, attempts, afterSettlement }) => {
        const replayCount = attempts.length * demandCount
        const lastAttemptIndex = attempts.length - 1
        return fc
          .record({
            settlementOrder: fc.shuffledSubarray(
              Array.from({ length: replayCount }, (_, index) => index),
              { minLength: replayCount, maxLength: replayCount },
            ),
            rawSettlementPhases: fc.array(
              fc.integer({ min: 0, max: lastAttemptIndex }),
              { minLength: replayCount, maxLength: replayCount },
            ),
          })
          .map(({ settlementOrder, rawSettlementPhases }) => ({
            initialRows,
            demandCount,
            attempts,
            settlementOrder,
            settlementPhases: rawSettlementPhases.map((phase, replayIndex) =>
              Math.max(phase, Math.floor(replayIndex / demandCount)),
            ),
            afterSettlement,
          }))
      }),
  )

const sequentialReplayScenarioArbitrary: fc.Arbitrary<SequentialReplayScenario> =
  fc.record({
    initialRows: rowsArbitrary,
    loads: fc.array(
      fc.record({
        rows: rowsArbitrary,
        outcome: fc.constantFrom(
          `return` as const,
          `throw` as const,
          `resolve` as const,
          `reject` as const,
        ),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })

function rowsById(
  rows: ReadonlyArray<ReplayRow>,
): Map<string | number, ReplayRow> {
  return new Map(rows.map((row) => [row.id, { ...row }]))
}

function sortedRows(
  rows: ReadonlyMap<string | number, ReplayRow>,
): Array<ReplayRow> {
  return [...rows.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

function publicationDiff(
  baseline: ReadonlyMap<string | number, ReplayRow>,
  finalRows: ReadonlyMap<string | number, ReplayRow>,
): Array<ReplayChange> {
  const changes: Array<ReplayChange> = []
  for (const [key, previousValue] of baseline) {
    const value = finalRows.get(key)
    if (!value) {
      changes.push({
        type: `delete`,
        key,
        value: { ...previousValue },
      })
    } else if (value.value !== previousValue.value) {
      changes.push({
        type: `update`,
        key,
        value: { ...value },
        previousValue: { ...previousValue },
      })
    }
  }
  for (const [key, value] of finalRows) {
    if (!baseline.has(key)) {
      changes.push({ type: `insert`, key, value: { ...value } })
    }
  }
  return changes
}

function sortedChanges(
  changes: ReadonlyArray<ReplayChange>,
): Array<ReplayChange> {
  return [...changes].sort((left, right) =>
    String(left.key).localeCompare(String(right.key)),
  )
}

async function runReplayScenario(scenario: ReplayScenario): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  let loadCount = 0
  let unloadCount = 0
  const leases = new Map<
    LoadSubsetOptions,
    { acquisitions: number; releases: number }
  >()
  const queuedLoads: Array<{ attemptIndex: number; load: ReplayLoad }> = []
  const pendingReplays: Array<PendingReplay> = []
  const sourceRows = new Map<string | number, ReplayRow>()

  const applyRows = (rows: ReadonlyArray<ReplayRow>) => {
    if (rows.length === 0) return
    begin()
    for (const row of rows) {
      write({
        type: sourceRows.has(row.id) ? `update` : `insert`,
        value: { ...row },
      })
    }
    commit()
    for (const row of rows) sourceRows.set(row.id, { ...row })
  }

  const collection: Collection<ReplayRow, string | number> =
    createCollection<ReplayRow>({
      id: `subscription-replay-oracle`,
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
              const lease = leases.get(options) ?? {
                acquisitions: 0,
                releases: 0,
              }
              lease.acquisitions++
              leases.set(options, lease)
              if (loadCount <= scenario.demandCount) {
                if (loadCount === 1) applyRows(scenario.initialRows)
                return true
              }

              const queued = queuedLoads.shift()
              if (!queued) throw new Error(`Replay load was not queued`)
              const pending: PendingReplay = {
                attemptIndex: queued.attemptIndex,
                load: queued.load,
                signal: options.signal,
                deferred: createDeferred<void>(),
                error: new Error(`Replay rejected`),
                settled: false,
              }
              pendingReplays.push(pending)
              return pending.deferred.promise
            },
            unloadSubset: (options) => {
              unloadCount++
              const lease = leases.get(options) ?? {
                acquisitions: 0,
                releases: 0,
              }
              lease.releases++
              leases.set(options, lease)
            },
          }
        },
      },
    })

  const visible = new Map<string | number, ReplayRow>()
  let publicationCount = 0
  const publicationBatches: Array<Array<ReplayChange>> = []
  const subscription = collection.subscribeChanges((changes) => {
    publicationCount++
    publicationBatches.push(
      changes.map((change) => ({
        type: change.type,
        key: change.key,
        value: {
          id: change.value.id,
          value: change.value.value,
        },
        ...(change.previousValue === undefined
          ? {}
          : {
              previousValue: {
                id: change.previousValue.id,
                value: change.previousValue.value,
              },
            }),
      })),
    )
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(change.key)
      else {
        visible.set(change.key, {
          id: change.value.id,
          value: change.value.value,
        })
      }
    }
  })
  const reportedErrors: Array<unknown> = []
  subscription.on(`loadSubset:error`, ({ error }) => reportedErrors.push(error))
  let unsubscribed = false

  const assertPublished = (
    expected: ReadonlyMap<string | number, ReplayRow>,
  ) => {
    expect(sortedRows(visible)).toEqual(sortedRows(expected))
  }

  const assertSource = () => {
    const actual = rowsById(
      collection.toArray.map(({ id, value }) => ({ id, value })),
    )
    expect(sortedRows(actual)).toEqual(sortedRows(sourceRows))
  }

  const applySourceAction = (action: SourceAction): boolean => {
    if (action.type === `delete`) {
      const previous = sourceRows.get(action.id)
      if (!previous) return false
      begin()
      write({ type: `delete`, key: action.id })
      commit()
      sourceRows.delete(action.id)
      return true
    }

    const previous = sourceRows.get(action.row.id)
    if (previous?.value === action.row.value) return false
    applyRows([action.row])
    return true
  }

  try {
    for (let demand = 0; demand < scenario.demandCount; demand++) {
      const where =
        demand === 0
          ? undefined
          : new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
      subscription.requestSnapshot({ optimizedOnly: false, where })
    }
    const expectedPublished = rowsById(scenario.initialRows)
    assertPublished(expectedPublished)
    assertSource()
    let expectedPublicationCount = publicationCount
    let lastReportedError: Error | undefined
    let modelSession:
      | {
          baseline: Map<string | number, ReplayRow>
          pending: Set<number>
          currentAttemptIndex: number
          publicationCount: number
        }
      | undefined

    const settleReplay = async (replayIndex: number) => {
      const pending = pendingReplays[replayIndex]!
      const session = modelSession!
      const load = pending.load
      const isCurrent = pending.attemptIndex === session.currentAttemptIndex
      pending.settled = true
      if (load.outcome === `resolve`) {
        if (isCurrent) {
          applyRows(load.rows)
        } else {
          expect(pending.signal?.aborted).toBe(true)
        }
        pending.deferred.resolve()
      } else {
        if (isCurrent) {
          lastReportedError = pending.error
        } else {
          expect(pending.signal?.aborted).toBe(true)
        }
        pending.deferred.reject(pending.error)
      }
      session.pending.delete(replayIndex)
      await flushPromises()
      assertSource()

      const hasPendingReplay = pendingReplays.some(({ settled }) => !settled)
      expect(subscription.status).toBe(
        hasPendingReplay ? `loadingSubset` : `ready`,
      )

      if (session.pending.size === 0) {
        const currentAttempt = scenario.attempts[session.currentAttemptIndex]!
        const currentAttemptSucceeds = currentAttempt.loads.every(
          ({ outcome }) => outcome === `resolve`,
        )
        const previousPublication = new Map(expectedPublished)
        expectedPublished.clear()
        const nextRows = currentAttemptSucceeds ? sourceRows : session.baseline
        for (const [id, row] of nextRows) {
          expectedPublished.set(id, { ...row })
        }

        if (currentAttemptSucceeds) {
          const expectedBatch = publicationDiff(
            previousPublication,
            expectedPublished,
          )
          expect(publicationCount - session.publicationCount).toBe(
            Number(expectedBatch.length > 0),
          )
          if (expectedBatch.length > 0) {
            expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
              sortedChanges(expectedBatch),
            )
          }
        } else {
          expect(publicationCount).toBe(session.publicationCount)
        }
        expectedPublicationCount = publicationCount
        modelSession = undefined
      } else {
        expect(publicationCount).toBe(session.publicationCount)
      }

      assertPublished(expectedPublished)
      expect(subscription.lastError).toBe(lastReportedError)
      expect(reportedErrors.at(-1)).toBe(lastReportedError)
    }

    for (const [attemptIndex, attempt] of scenario.attempts.entries()) {
      modelSession ??= {
        baseline: new Map(expectedPublished),
        pending: new Set(),
        currentAttemptIndex: attemptIndex,
        publicationCount: expectedPublicationCount,
      }
      modelSession.currentAttemptIndex = attemptIndex

      for (const load of attempt.loads) {
        queuedLoads.push({ attemptIndex, load })
      }
      const firstReplayIndex = pendingReplays.length
      begin()
      truncate()
      commit()
      sourceRows.clear()
      await flushPromises()
      for (
        let replayIndex = firstReplayIndex;
        replayIndex < pendingReplays.length;
        replayIndex++
      ) {
        modelSession.pending.add(replayIndex)
      }
      assertSource()
      assertPublished(expectedPublished)
      expect(publicationCount).toBe(modelSession.publicationCount)
      expect(subscription.lastError).toBe(lastReportedError)
      expect(subscription.status).toBe(`loadingSubset`)

      for (const replayIndex of scenario.settlementOrder) {
        const replay = pendingReplays[replayIndex]
        if (
          replay &&
          !replay.settled &&
          scenario.settlementPhases[replayIndex] === attemptIndex
        ) {
          await settleReplay(replayIndex)
        }
      }
    }

    expect(modelSession).toBeUndefined()

    for (const action of scenario.afterSettlement) {
      const countBeforeAction = publicationCount
      const previousPublication = new Map(expectedPublished)
      const applied = applySourceAction(action)
      if (applied && action.type === `delete`) {
        expectedPublished.delete(action.id)
      } else if (applied && action.type === `put`) {
        expectedPublished.set(action.row.id, { ...action.row })
      }
      assertSource()
      assertPublished(expectedPublished)
      const expectedBatch = publicationDiff(
        previousPublication,
        expectedPublished,
      )
      expect(publicationCount).toBe(
        countBeforeAction + Number(expectedBatch.length > 0),
      )
      if (expectedBatch.length > 0) {
        expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
          sortedChanges(expectedBatch),
        )
      }
    }

    subscription.unsubscribe()
    unsubscribed = true
    expect(unloadCount).toBe(loadCount)
    for (const lease of leases.values()) {
      expect(lease).toEqual({ acquisitions: 1, releases: 1 })
    }
  } finally {
    for (const replay of pendingReplays) {
      if (!replay.settled) replay.deferred.resolve()
    }
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

async function runSequentialReplayScenario(
  scenario: SequentialReplayScenario,
): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  let nextLoad: SequentialReplayLoad | undefined
  let initialLoad = true
  const sourceRows = new Map<string | number, ReplayRow>()
  const leases = new Map<
    LoadSubsetOptions,
    { acquisitions: number; releases: number }
  >()
  const pending: Array<{
    load: SequentialReplayLoad
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []

  const applyRows = (rows: ReadonlyArray<ReplayRow>) => {
    if (rows.length === 0) return
    begin()
    for (const row of rows) {
      write({
        type: sourceRows.has(row.id) ? `update` : `insert`,
        value: { ...row },
      })
    }
    commit()
    for (const row of rows) sourceRows.set(row.id, { ...row })
  }

  const collection = createCollection<ReplayRow>({
    id: `sequential-replay-oracle`,
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
            if (initialLoad) {
              initialLoad = false
              applyRows(scenario.initialRows)
              leases.set(options, { acquisitions: 1, releases: 0 })
              return true
            }

            const load = nextLoad
            if (!load) throw new Error(`Sequential replay was not queued`)
            nextLoad = undefined
            applyRows(load.rows)
            if (load.outcome === `throw`) {
              throw new Error(`Synchronous replay failure`)
            }

            leases.set(options, { acquisitions: 1, releases: 0 })
            if (load.outcome === `return`) return true
            const deferred = createDeferred<void>()
            pending.push({ load, deferred })
            return deferred.promise
          },
          unloadSubset: (options) => {
            const lease = leases.get(options)
            if (!lease) {
              throw new Error(`Released an acquisition that never returned`)
            }
            lease.releases++
          },
        }
      },
    },
  })
  const visible = new Map<string | number, ReplayRow>()
  let publicationCount = 0
  const publicationBatches: Array<Array<ReplayChange>> = []
  const subscription = collection.subscribeChanges((changes) => {
    publicationCount++
    publicationBatches.push(
      changes.map((change) => ({
        type: change.type,
        key: change.key,
        value: { id: change.value.id, value: change.value.value },
        ...(change.previousValue === undefined
          ? {}
          : {
              previousValue: {
                id: change.previousValue.id,
                value: change.previousValue.value,
              },
            }),
      })),
    )
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(change.key)
      else {
        visible.set(change.key, {
          id: change.value.id,
          value: change.value.value,
        })
      }
    }
  })
  const reportedErrors: Array<unknown> = []
  subscription.on(`loadSubset:error`, ({ error }) => reportedErrors.push(error))
  let unsubscribed = false

  try {
    subscription.requestSnapshot({ optimizedOnly: false })
    const expectedPublished = rowsById(scenario.initialRows)
    let expectedLastError: unknown

    for (const load of scenario.loads) {
      const baseline = new Map(expectedPublished)
      const publicationBefore = publicationCount
      const pendingBefore = pending.length
      nextLoad = load
      begin()
      truncate()
      commit()
      sourceRows.clear()
      await flushPromises()

      const pendingLoad = pending[pendingBefore]
      if (load.outcome === `resolve`) pendingLoad?.deferred.resolve()
      if (load.outcome === `reject`) {
        pendingLoad?.deferred.reject(new Error(`Asynchronous replay failure`))
      }
      await flushPromises()

      const succeeded = load.outcome === `return` || load.outcome === `resolve`
      if (succeeded) {
        expectedPublished.clear()
        for (const [id, row] of sourceRows) {
          expectedPublished.set(id, { ...row })
        }
      } else {
        expectedPublished.clear()
        for (const [id, row] of baseline) expectedPublished.set(id, { ...row })
        expectedLastError = subscription.lastError
      }

      const expectedBatch = succeeded
        ? publicationDiff(baseline, expectedPublished)
        : []
      expect(publicationCount - publicationBefore).toBe(
        Number(expectedBatch.length > 0),
      )
      if (expectedBatch.length > 0) {
        expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
          sortedChanges(expectedBatch),
        )
      }
      expect(sortedRows(visible)).toEqual(sortedRows(expectedPublished))
      expect(
        sortedRows(
          rowsById(collection.toArray.map(({ id, value }) => ({ id, value }))),
        ),
      ).toEqual(sortedRows(sourceRows))
      expect(subscription.status).toBe(`ready`)
      expect(subscription.lastError).toBe(expectedLastError)
      expect(reportedErrors.at(-1)).toBe(expectedLastError)
    }

    subscription.unsubscribe()
    unsubscribed = true
    for (const lease of leases.values()) {
      expect(lease).toEqual({ acquisitions: 1, releases: 1 })
    }
  } finally {
    for (const load of pending) load.deferred.resolve()
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

const { multiplier, replaySeed } = readOracleRunConfig()
const generatedRuns = 30 * multiplier

describe(`CollectionSubscription replay oracle`, () => {
  it(`aborts an in-flight initial acquisition before its replay replaces it`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    const collection = createCollection<ReplayRow>({
      id: `initial-acquisition-replay`,
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
              const deferred = createDeferred<void>()
              loads.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads[0]?.options.signal?.aborted).toBe(true)

      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      loads[1]?.deferred.resolve()
      await flushPromises()

      if (!loads[0]?.options.signal?.aborted) {
        begin()
        write({ type: `insert`, value: { id: `one`, value: 1 } })
        commit()
      }
      loads[0]?.deferred.resolve()
      await flushPromises()

      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.status).toBe(`ready`)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`uses the published replacement as the baseline of a reentrant replay`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const replayLoads: Array<ReturnType<typeof createDeferred<void>>> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-replay`,
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
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
                commit()
                return true
              }

              const deferred = createDeferred<void>()
              replayLoads.push(deferred)
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    let startedNestedReplay = false
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }

      if (!startedNestedReplay && visible.get(`one`)?.value === 2) {
        startedNestedReplay = true
        begin()
        truncate()
        commit()
      }
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 2 } })
      commit()
      replayLoads[0]?.resolve()
      await flushPromises()
      expect(startedNestedReplay).toBe(true)

      replayLoads[1]?.reject(new Error(`nested replay failed`))
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 1 } })
      commit()

      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 1 }])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`ignores an aborted released demand while publishing the remaining replay`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replays: Array<{
      options: { signal?: AbortSignal }
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `released-demand-replay`,
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
                write({ type: `insert`, value: { id: `one`, value: 0 } })
                write({ type: `insert`, value: { id: `two`, value: 0 } })
                commit()
                return true
              }
              if (loadCount === 2) return true

              const deferred = createDeferred<void>()
              replays.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }
    })
    const demandOne = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const demandTwo = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])

    try {
      subscription.requestSnapshot({ where: demandOne })
      subscription.requestSnapshot({ where: demandTwo })
      begin()
      truncate()
      commit()
      await flushPromises()

      subscription.releaseSnapshot(demandOne)
      expect(replays[0]?.options.signal?.aborted).toBe(true)
      replays[0]?.deferred.reject(new DOMException(`obsolete`, `AbortError`))
      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      replays[1]?.deferred.resolve()
      await flushPromises()

      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.lastError).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes a same-key replacement after a failed replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandCount: 1,
      attempts: [{ loads: [{ rows: [], outcome: `reject` }] }],
      settlementOrder: [0],
      settlementPhases: [0],
      afterSettlement: [{ type: `put`, row: { id: `one`, value: 2 } }],
    })
  })

  it(`does not let an unpublished truncate delete suppress a later insert`, async () => {
    await runReplayScenario({
      initialRows: [],
      demandCount: 2,
      attempts: [
        {
          loads: [
            {
              rows: [{ id: `two`, value: -1 }],
              outcome: `resolve`,
            },
            { rows: [], outcome: `reject` },
          ],
        },
        {
          loads: [
            { rows: [], outcome: `resolve` },
            {
              rows: [{ id: `one`, value: -1 }],
              outcome: `resolve`,
            },
          ],
        },
      ],
      settlementOrder: [0, 1, 2, 3],
      settlementPhases: [0, 0, 1, 1],
      afterSettlement: [{ type: `put`, row: { id: `two`, value: 1 } }],
    })
  })

  it(`lets the newest successful replay replace an older failed replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandCount: 1,
      attempts: [
        { loads: [{ rows: [], outcome: `reject` }] },
        {
          loads: [{ rows: [{ id: `one`, value: 2 }], outcome: `resolve` }],
        },
      ],
      settlementOrder: [1, 0],
      settlementPhases: [1, 1],
      afterSettlement: [],
    })
  })

  it(`ignores an obsolete replay that settles after the newest replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 0 }],
      demandCount: 1,
      attempts: [
        {
          loads: [{ rows: [{ id: `one`, value: 1 }], outcome: `resolve` }],
        },
        {
          loads: [{ rows: [{ id: `one`, value: 2 }], outcome: `resolve` }],
        },
      ],
      settlementOrder: [1, 0],
      settlementPhases: [1, 1],
      afterSettlement: [],
    })
  })

  it(`releases every successful overlapping replay acquisition`, async () => {
    await runReplayScenario({
      initialRows: [],
      demandCount: 1,
      attempts: [
        { loads: [{ rows: [], outcome: `resolve` }] },
        { loads: [{ rows: [], outcome: `resolve` }] },
      ],
      settlementOrder: [1, 0],
      settlementPhases: [1, 1],
      afterSettlement: [],
    })
  })

  it(`uses the newest complete multi-demand replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandCount: 2,
      attempts: [
        {
          loads: [
            { rows: [{ id: `one`, value: 2 }], outcome: `resolve` },
            { rows: [], outcome: `reject` },
          ],
        },
        {
          loads: [
            { rows: [{ id: `one`, value: 3 }], outcome: `resolve` },
            { rows: [{ id: `two`, value: 4 }], outcome: `resolve` },
          ],
        },
      ],
      settlementOrder: [2, 3, 0, 1],
      settlementPhases: [1, 1, 1, 1],
      afterSettlement: [],
    })
  })

  it(`replaces a retained snapshot with a later empty replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandCount: 1,
      attempts: [
        { loads: [{ rows: [], outcome: `reject` }] },
        { loads: [{ rows: [], outcome: `resolve` }] },
      ],
      settlementOrder: [0, 1],
      settlementPhases: [0, 1],
      afterSettlement: [],
    })
  })

  fcTest.prop([replayScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1756,
  })(`matches replay and ownership laws for a fixed seed`, runReplayScenario)

  fcTest.prop(
    [replayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `matches replay and ownership laws for a random or replayed seed`,
    runReplayScenario,
  )

  fcTest.prop(
    [sequentialReplayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `matches synchronous, asynchronous, and partial-failure replay laws`,
    runSequentialReplayScenario,
  )
})
