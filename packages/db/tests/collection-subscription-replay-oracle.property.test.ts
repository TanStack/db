import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../src/query/subset-dedupe.js'
import { createTransaction } from '../src/transactions.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { Collection } from '../src/collection/index.js'
import type { OrderBy } from '../src/query/ir.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
} from '../src/types.js'
import type { Scheduler } from 'fast-check'

type ReplayRow = {
  id: `one` | `two`
  value: number
}

type ReplayDemandId = ReplayRow[`id`]

type ReplayLoad = {
  demandId: ReplayDemandId
  rows: ReadonlyArray<ReplayRow>
  outcome: `resolve` | `reject`
  writeBeforeSettlement?: boolean
}

type ReplayAttempt = {
  loads: ReadonlyArray<ReplayLoad>
}

type SourceAction =
  | { type: `put`; row: ReplayRow }
  | { type: `delete`; id: ReplayRow[`id`] }
  | { type: `request`; demandId: ReplayDemandId }

type SourceWriteOrigin =
  | { type: `initial`; demandId: ReplayDemandId }
  | { type: `replay`; demandId: ReplayDemandId; attemptIndex: number }
  | { type: `ordinary` }

type SourceWrite = {
  origin: SourceWriteOrigin
  installed: boolean
  rows: ReadonlyArray<ReplayRow>
}

type ReplayChange = {
  type: `insert` | `update` | `delete`
  key: string | number
  value: ReplayRow
  previousValue?: ReplayRow
}

type ReplayScenario = {
  initialRows: ReadonlyArray<ReplayRow>
  demandIds: ReadonlyArray<ReplayDemandId>
  attempts: ReadonlyArray<ReplayAttempt>
  settlementOrder: ReadonlyArray<number>
  settlementPhases: ReadonlyArray<number>
  releaseOnLastAttempt?: ReplayDemandId
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

type CleanupRestartScenario = {
  oldOutcome: `resolve` | `reject`
  newOutcome: `resolve` | `reject`
  settleOldFirst: boolean
}

type SharedSubscriptionScenario = {
  outcome: `resolve` | `reject`
  releaseCountBeforeSettlement: 0 | 1 | 2
}

type OptimisticReplayScenario = {
  operation: `insert` | `update` | `delete`
  outcome: `resolve` | `reject`
  serverRetainsTarget: boolean
  initialValue: number
  optimisticValue: number
  serverValue: number
}

type PendingReplay = {
  attemptIndex: number
  load: ReplayLoad
  signal: AbortSignal | undefined
  deferred: ReturnType<typeof createDeferred<void>>
  error: Error
  wroteRows: boolean
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

function replayLoadArbitrary(
  demandId: ReplayDemandId,
): fc.Arbitrary<ReplayLoad> {
  return fc.record({
    demandId: fc.constant(demandId),
    rows: fc
      .option(fc.integer({ min: -2, max: 2 }), { nil: undefined })
      .map((value) => (value === undefined ? [] : [{ id: demandId, value }])),
    outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    writeBeforeSettlement: fc.boolean(),
  })
}

function sourceActionArbitrary(
  demandIds: ReadonlyArray<ReplayDemandId>,
): fc.Arbitrary<SourceAction> {
  return fc.oneof(
    fc
      .tuple(fc.constantFrom(...demandIds), fc.integer({ min: -2, max: 2 }))
      .map(([id, value]) => ({ type: `put` as const, row: { id, value } })),
    fc
      .constantFrom(...demandIds)
      .map((id) => ({ type: `delete` as const, id })),
  )
}

const replayScenarioArbitrary: fc.Arbitrary<ReplayScenario> = fc
  .uniqueArray(fc.constantFrom<ReplayDemandId>(`one`, `two`), {
    minLength: 1,
    maxLength: 2,
  })
  .chain((demandIds) =>
    fc
      .record({
        initialRows: rowsArbitrary,
        attempts: fc.array(
          fc
            .tuple(
              ...demandIds.map((demandId) => replayLoadArbitrary(demandId)),
            )
            .map((loads) => ({ loads })),
          { minLength: 1, maxLength: 3 },
        ),
        releaseOnLastAttempt: fc.option(fc.constantFrom(...demandIds), {
          nil: undefined,
        }),
      })
      .chain(({ initialRows, attempts, releaseOnLastAttempt }) => {
        const replayCount = attempts.length * demandIds.length
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
            afterSettlement:
              releaseOnLastAttempt === undefined
                ? fc.array(sourceActionArbitrary(demandIds), {
                    minLength: 0,
                    maxLength: 3,
                  })
                : fc
                    .tuple(
                      fc.constant<SourceAction>({
                        type: `request`,
                        demandId: releaseOnLastAttempt,
                      }),
                      fc.array(sourceActionArbitrary(demandIds), {
                        minLength: 0,
                        maxLength: 2,
                      }),
                    )
                    .map(([request, actions]) => [request, ...actions]),
          })
          .map(({ settlementOrder, rawSettlementPhases, afterSettlement }) => ({
            initialRows,
            demandIds,
            attempts,
            settlementOrder,
            settlementPhases: rawSettlementPhases.map((phase, replayIndex) =>
              Math.max(phase, Math.floor(replayIndex / demandIds.length)),
            ),
            releaseOnLastAttempt,
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

const cleanupRestartScenarioArbitrary: fc.Arbitrary<CleanupRestartScenario> =
  fc.record({
    oldOutcome: fc.constantFrom(`resolve` as const, `reject` as const),
    newOutcome: fc.constantFrom(`resolve` as const, `reject` as const),
    settleOldFirst: fc.boolean(),
  })

const sharedSubscriptionScenarioArbitrary: fc.Arbitrary<SharedSubscriptionScenario> =
  fc.record({
    outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    releaseCountBeforeSettlement: fc.constantFrom(
      0 as const,
      1 as const,
      2 as const,
    ),
  })

const optimisticReplayScenarioArbitrary: fc.Arbitrary<OptimisticReplayScenario> =
  fc
    .record({
      operation: fc.constantFrom(
        `insert` as const,
        `update` as const,
        `delete` as const,
      ),
      outcome: fc.constantFrom(`resolve` as const, `reject` as const),
      serverRetainsTarget: fc.boolean(),
      values: fc.uniqueArray(fc.integer({ min: -3, max: 3 }), {
        minLength: 3,
        maxLength: 3,
      }),
    })
    .map(({ operation, outcome, serverRetainsTarget, values }) => ({
      operation,
      outcome,
      serverRetainsTarget,
      initialValue: values[0]!,
      optimisticValue: values[1]!,
      serverValue: values[2]!,
    }))

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

function recordPublishedChanges(
  visible: Map<string | number, ReplayRow>,
  changes: ReadonlyArray<ReplayChange>,
): Array<ReplayChange> {
  const recorded = changes.map((change) => ({
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
  }))
  for (const change of recorded) {
    if (change.type === `delete`) visible.delete(change.key)
    else visible.set(change.key, { ...change.value })
  }
  return recorded
}

function expectSameSubsetRequest(
  actual: LoadSubsetOptions,
  expected: LoadSubsetOptions,
): void {
  expect(actual.where).toBe(expected.where)
  expect(actual.orderBy).toBe(expected.orderBy)
  expect(actual.limit).toBe(expected.limit)
  expect(actual.cursor).toEqual(expected.cursor)
  expect(actual.offset).toBe(expected.offset)
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
  const queuedReacquisitions = new Set<ReplayDemandId>()
  const pendingReplays: Array<PendingReplay> = []
  const sourceRows = new Map<string | number, ReplayRow>()
  const sourceWrites: Array<SourceWrite> = []
  const expectedSourceWrites: Array<SourceWrite> = []
  const demandWheres = new Map(
    scenario.demandIds.map((demandId) => [
      demandId,
      new Func(`eq`, [new PropRef([`id`]), new Value(demandId)]),
    ]),
  )
  const demandIdByWhere = new Map<
    NonNullable<LoadSubsetOptions[`where`]>,
    ReplayDemandId
  >([...demandWheres].map(([demandId, where]) => [where, demandId]))
  const requestByDemand = new Map<ReplayDemandId, LoadSubsetOptions>()
  const activeDemandIds = new Set(scenario.demandIds)

  const recordExpectedSourceWrite = (
    rows: ReadonlyArray<ReplayRow>,
    origin: SourceWriteOrigin,
    installed: boolean,
  ) => {
    expectedSourceWrites.push({
      origin,
      installed,
      rows: rows.map((row) => ({ ...row })),
    })
  }

  const assertSourceWrites = () => {
    expect(sourceWrites).toEqual(expectedSourceWrites)
  }

  const applyRows = (
    rows: ReadonlyArray<ReplayRow>,
    origin: SourceWriteOrigin,
    signal?: AbortSignal,
  ): boolean => {
    const installed = !signal?.aborted
    sourceWrites.push({
      origin,
      installed,
      rows: rows.map((row) => ({ ...row })),
    })
    if (!installed || rows.length === 0) return installed
    begin()
    for (const row of rows) {
      write({
        type: sourceRows.has(row.id) ? `update` : `insert`,
        value: { ...row },
      })
    }
    commit()
    for (const row of rows) sourceRows.set(row.id, { ...row })
    return true
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
              const demandId =
                options.where === undefined
                  ? undefined
                  : demandIdByWhere.get(options.where)
              if (demandId === undefined) {
                throw new Error(`Subset request did not preserve its demand`)
              }

              if (!requestByDemand.has(demandId)) {
                requestByDemand.set(demandId, options)
                applyRows(
                  scenario.initialRows.filter(({ id }) => id === demandId),
                  { type: `initial`, demandId },
                )
                return true
              }

              const queuedIndex = queuedLoads.findIndex(
                ({ load }) => load.demandId === demandId,
              )
              if (queuedIndex === -1) {
                if (queuedReacquisitions.delete(demandId)) {
                  expectSameSubsetRequest(
                    options,
                    requestByDemand.get(demandId)!,
                  )
                  return true
                }
                throw new Error(`Replay load was not queued for ${demandId}`)
              }
              const [queued] = queuedLoads.splice(queuedIndex, 1)
              if (!queued) throw new Error(`Replay queue changed unexpectedly`)
              expectSameSubsetRequest(options, requestByDemand.get(demandId)!)
              const pending: PendingReplay = {
                attemptIndex: queued.attemptIndex,
                load: queued.load,
                signal: options.signal,
                deferred: createDeferred<void>(),
                error: new Error(`Replay rejected`),
                wroteRows: false,
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
    publicationBatches.push(recordPublishedChanges(visible, changes))
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
    if (action.type === `request`) return false
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
    applyRows([action.row], { type: `ordinary` })
    return true
  }

  try {
    for (const demandId of scenario.demandIds) {
      subscription.requestSnapshot({
        optimizedOnly: false,
        where: demandWheres.get(demandId),
      })
      recordExpectedSourceWrite(
        scenario.initialRows.filter(({ id }) => id === demandId),
        { type: `initial`, demandId },
        true,
      )
      assertSourceWrites()
    }
    const expectedPublished = rowsById(
      scenario.initialRows.filter(({ id }) => activeDemandIds.has(id)),
    )
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

    const writeReplayRows = (
      pending: PendingReplay,
      isCurrent: boolean,
    ): void => {
      if (pending.wroteRows) return
      const load = pending.load
      recordExpectedSourceWrite(
        load.rows,
        {
          type: `replay`,
          demandId: load.demandId,
          attemptIndex: pending.attemptIndex,
        },
        isCurrent,
      )
      const installed = applyRows(
        load.rows,
        {
          type: `replay`,
          demandId: load.demandId,
          attemptIndex: pending.attemptIndex,
        },
        pending.signal,
      )
      pending.wroteRows = true
      expect(installed).toBe(isCurrent)
      assertSourceWrites()
    }

    const settleReplay = async (replayIndex: number) => {
      const pending = pendingReplays[replayIndex]!
      const session = modelSession
      const load = pending.load
      const isCurrent =
        session !== undefined &&
        pending.attemptIndex === session.currentAttemptIndex &&
        activeDemandIds.has(load.demandId)
      pending.settled = true
      if (load.outcome === `resolve`) {
        writeReplayRows(pending, isCurrent)
        pending.deferred.resolve()
      } else {
        if (isCurrent) {
          lastReportedError = pending.error
        } else {
          expect(pending.signal?.aborted).toBe(true)
        }
        pending.deferred.reject(pending.error)
      }
      session?.pending.delete(replayIndex)
      await flushPromises()
      assertSource()

      if (!session) {
        expect(subscription.status).toBe(`ready`)
        assertPublished(expectedPublished)
        expect(subscription.lastError).toBe(lastReportedError)
        return
      }

      const hasPendingReplay = session.pending.size > 0
      expect(subscription.status).toBe(
        hasPendingReplay ? `loadingSubset` : `ready`,
      )

      if (session.pending.size === 0) {
        const currentAttempt = scenario.attempts[session.currentAttemptIndex]!
        const currentAttemptSucceeds = currentAttempt.loads.every(
          ({ demandId, outcome }) =>
            !activeDemandIds.has(demandId) || outcome === `resolve`,
        )
        const previousPublication = new Map(expectedPublished)
        expectedPublished.clear()
        const nextRows = currentAttemptSucceeds
          ? rowsById(
              currentAttempt.loads.flatMap(({ demandId, rows }) =>
                activeDemandIds.has(demandId) ? rows : [],
              ),
            )
          : session.baseline
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
          modelSession = undefined
        } else {
          expect(publicationCount).toBe(session.publicationCount)
        }
        expectedPublicationCount = publicationCount
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
        const pending = pendingReplays[replayIndex]!
        if (pending.load.writeBeforeSettlement) {
          writeReplayRows(pending, true)
        }
      }
      if (
        attemptIndex === scenario.attempts.length - 1 &&
        scenario.releaseOnLastAttempt !== undefined
      ) {
        const releasedDemand = scenario.releaseOnLastAttempt
        const previous = expectedPublished.get(releasedDemand)
        subscription.releaseSnapshot(demandWheres.get(releasedDemand)!)
        activeDemandIds.delete(releasedDemand)
        for (const replayIndex of modelSession.pending) {
          if (pendingReplays[replayIndex]?.load.demandId === releasedDemand) {
            modelSession.pending.delete(replayIndex)
          }
        }
        expectedPublished.delete(releasedDemand)
        modelSession.baseline.delete(releasedDemand)
        if (previous) {
          modelSession.publicationCount++
          expectedPublicationCount++
          expect(sortedChanges(publicationBatches.at(-1)!)).toEqual([
            {
              type: `delete`,
              key: releasedDemand,
              value: previous,
            },
          ])
        }
        if (modelSession.pending.size === 0 && activeDemandIds.size === 0) {
          expectedPublicationCount = publicationCount
          modelSession = undefined
        }
      }
      assertSource()
      assertPublished(expectedPublished)
      expect(publicationCount).toBe(
        modelSession?.publicationCount ?? expectedPublicationCount,
      )
      expect(subscription.lastError).toBe(lastReportedError)
      expect(subscription.status).toBe(
        modelSession && modelSession.pending.size > 0
          ? `loadingSubset`
          : `ready`,
      )

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

    expect(modelSession?.pending.size ?? 0).toBe(0)

    for (const action of scenario.afterSettlement) {
      const countBeforeAction = publicationCount
      const previousPublication = new Map(expectedPublished)
      if (action.type === `request`) {
        queuedReacquisitions.add(action.demandId)
        activeDemandIds.add(action.demandId)
        subscription.requestSnapshot({
          optimizedOnly: false,
          where: demandWheres.get(action.demandId),
        })
        const row = sourceRows.get(action.demandId)
        if (!modelSession && row) {
          expectedPublished.set(action.demandId, { ...row })
        }
      }
      const applied = applySourceAction(action)
      if (applied && action.type === `delete`) {
        if (!modelSession) expectedPublished.delete(action.id)
      } else if (applied && action.type === `put`) {
        recordExpectedSourceWrite([action.row], { type: `ordinary` }, true)
        assertSourceWrites()
        if (!modelSession) {
          expectedPublished.set(action.row.id, { ...action.row })
        }
      }
      assertSource()
      assertPublished(expectedPublished)
      const expectedBatch = publicationDiff(
        previousPublication,
        expectedPublished,
      )
      const expectsPublication =
        !modelSession && (action.type === `request` || expectedBatch.length > 0)
      expect(publicationCount).toBe(
        countBeforeAction + Number(expectsPublication),
      )
      if (expectsPublication) {
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
    assertSourceWrites()
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
  let nextError: Error | undefined
  let initialLoad = true
  const sourceRows = new Map<string | number, ReplayRow>()
  const leases = new Map<
    LoadSubsetOptions,
    { acquisitions: number; releases: number }
  >()
  const pending: Array<{
    load: SequentialReplayLoad
    deferred: ReturnType<typeof createDeferred<void>>
    error: Error
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
            const error = nextError
            if (!error)
              throw new Error(`Sequential replay error was not queued`)
            nextLoad = undefined
            nextError = undefined
            applyRows(load.rows)
            if (load.outcome === `throw`) {
              throw error
            }

            leases.set(options, { acquisitions: 1, releases: 0 })
            if (load.outcome === `return`) return true
            const deferred = createDeferred<void>()
            pending.push({ load, deferred, error })
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
    publicationBatches.push(recordPublishedChanges(visible, changes))
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
      const expectedError = new Error(
        load.outcome === `throw`
          ? `Synchronous replay failure`
          : `Asynchronous replay failure`,
      )
      nextLoad = load
      nextError = expectedError
      begin()
      truncate()
      commit()
      sourceRows.clear()
      await flushPromises()

      const pendingLoad = pending[pendingBefore]
      if (load.outcome === `resolve`) pendingLoad?.deferred.resolve()
      if (load.outcome === `reject`) {
        pendingLoad?.deferred.reject(pendingLoad.error)
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
        expectedLastError = expectedError
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

async function runCleanupRestartScenario(
  scenario: CleanupRestartScenario,
): Promise<void> {
  const sessions: Array<{
    begin: () => void
    write: (message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>) => void
    commit: () => void
  }> = []
  const loads: Array<{
    session: number
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []
  let session = 0
  const collection = createCollection<ReplayRow>({
    id: `cleanup-restart-oracle`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const currentSession = session++
        sessions.push({ begin, write, commit })
        markReady()
        return {
          loadSubset: () => {
            const deferred = createDeferred<void>()
            loads.push({ session: currentSession, deferred })
            return deferred.promise
          },
        }
      },
    },
  })

  const settle = async (loadIndex: number, outcome: `resolve` | `reject`) => {
    const load = loads[loadIndex]!
    if (outcome === `resolve`) load.deferred.resolve()
    else load.deferred.reject(new Error(`session ${load.session} failed`))
    await flushPromises()
  }

  try {
    const oldResult = collection._sync.loadSubset({})
    expect(oldResult).toBeInstanceOf(Promise)
    if (oldResult instanceof Promise) void oldResult.catch(() => {})
    expect(collection.isLoadingSubset).toBe(true)

    await collection.cleanup()
    expect(collection.isLoadingSubset).toBe(false)

    collection.startSyncImmediate()
    const newResult = collection._sync.loadSubset({})
    expect(newResult).toBeInstanceOf(Promise)
    if (newResult instanceof Promise) void newResult.catch(() => {})
    expect(loads.map(({ session: loadSession }) => loadSession)).toEqual([0, 1])
    expect(collection.isLoadingSubset).toBe(true)

    const oldSession = sessions[0]!
    oldSession.begin()
    oldSession.write({ type: `insert`, value: { id: `one`, value: 1 } })
    oldSession.commit()
    expect(collection.toArray).toEqual([])

    const currentSession = sessions[1]!
    currentSession.begin()
    currentSession.write({ type: `insert`, value: { id: `two`, value: 2 } })
    currentSession.commit()
    expect(collection.toArray.map(({ id, value }) => ({ id, value }))).toEqual([
      { id: `two`, value: 2 },
    ])

    const settlementOrder = scenario.settleOldFirst ? [0, 1] : [1, 0]
    const outcomes = [scenario.oldOutcome, scenario.newOutcome] as const
    let newSettled = false
    for (const loadIndex of settlementOrder) {
      await settle(loadIndex, outcomes[loadIndex]!)
      if (loadIndex === 1) newSettled = true
      expect(collection.isLoadingSubset).toBe(!newSettled)
      expect(
        collection.toArray.map(({ id, value }) => ({ id, value })),
      ).toEqual([{ id: `two`, value: 2 }])
    }
  } finally {
    for (const { deferred } of loads) deferred.resolve()
    await flushPromises()
    await collection.cleanup()
  }
}

async function expectScheduledReplaySettlementIsGenerationSafe(
  scheduler: Scheduler,
): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  const loads: Array<{
    signal: AbortSignal | undefined
    outcome: Promise<void>
  }> = []
  const collection = createCollection<ReplayRow>({
    id: `scheduled-replay-settlement`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (actions) => {
        begin = actions.begin
        write = actions.write
        commit = actions.commit
        truncate = actions.truncate
        actions.markReady()
        return {
          loadSubset: ({ signal }) => {
            const generation = loads.length + 1
            const outcome = scheduler
              .schedule(Promise.resolve(), `generation-${generation}`)
              .then(() => {
                if (signal?.aborted) return
                begin()
                write({
                  type: `insert`,
                  value: { id: `one`, value: generation },
                })
                commit()
              })
            loads.push({ signal, outcome })
            return outcome
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const visible = new Map<string | number, ReplayRow>()
  const subscription = collection.subscribeChanges((changes) => {
    recordPublishedChanges(visible, changes)
  })

  try {
    subscription.requestSnapshot({ optimizedOnly: false })
    begin()
    truncate()
    commit()
    await flushPromises()

    expect(loads).toHaveLength(2)
    expect(loads[0]!.signal?.aborted).toBe(true)

    await scheduler.waitAll()
    await Promise.all(loads.map(({ outcome }) => outcome))
    await flushPromises()

    expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
    expect(subscription.status).toBe(`ready`)
    expect(subscription.lastError).toBeUndefined()
  } finally {
    if (scheduler.count() > 0) await scheduler.waitAll()
    await Promise.allSettled(loads.map(({ outcome }) => outcome))
    subscription.unsubscribe()
    await collection.cleanup()
  }
}

async function runSharedSubscriptionScenario(
  scenario: SharedSubscriptionScenario,
): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  const transports = [createDeferred<void>(), createDeferred<void>()] as const
  const transportOptions: Array<LoadSubsetOptions> = []
  const unloads: Array<LoadSubsetOptions> = []
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: (options) => {
      const transport = transports[transportOptions.length]
      if (!transport) throw new Error(`unexpected transport`)
      transportOptions.push(options)
      return transport.promise
    },
  })
  const collection = createCollection<ReplayRow>({
    id: `shared-subscription-oracle`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: dedupe.loadSubset,
          unloadSubset: (options) => unloads.push(options),
        }
      },
    },
  })
  const visible = [
    new Map<string | number, ReplayRow>(),
    new Map<string | number, ReplayRow>(),
  ] as const
  const subscribe = (rows: Map<string | number, ReplayRow>) =>
    collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) rows.delete(change.key)
        else {
          rows.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }
    })
  const subscriptions = [subscribe(visible[0]), subscribe(visible[1])] as const
  const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
  let firstUnsubscribed = false
  let secondUnsubscribed = false

  try {
    subscriptions[0].requestSnapshot({ where })
    subscriptions[1].requestSnapshot({ where })
    expect(transportOptions).toHaveLength(2)
    expect(subscriptions[0].status).toBe(`loadingSubset`)
    expect(subscriptions[1].status).toBe(`loadingSubset`)

    if (scenario.releaseCountBeforeSettlement >= 1) {
      subscriptions[0].unsubscribe()
      firstUnsubscribed = true
      expect(transportOptions[0]?.signal?.aborted).toBe(true)
      expect(transportOptions[1]?.signal?.aborted).toBe(false)
    }
    if (scenario.releaseCountBeforeSettlement === 2) {
      subscriptions[1].unsubscribe()
      secondUnsubscribed = true
      expect(transportOptions[1]?.signal?.aborted).toBe(true)
    }

    const failure = new Error(`shared transport failed`)
    if (scenario.outcome === `resolve`) {
      if (transportOptions.some(({ signal }) => !signal?.aborted)) {
        begin()
        write({ type: `insert`, value: { id: `one`, value: 1 } })
        commit()
      }
      for (const transport of transports) transport.resolve()
    } else {
      transports.forEach((transport, index) =>
        transport.reject(
          transportOptions[index]?.signal?.aborted
            ? new DOMException(`obsolete`, `AbortError`)
            : failure,
        ),
      )
    }
    await flushPromises()

    if (!secondUnsubscribed) {
      expect(subscriptions[1].status).toBe(`ready`)
      expect(subscriptions[1].lastError).toBe(
        scenario.outcome === `reject` ? failure : undefined,
      )
      expect([...visible[1].values()]).toEqual(
        scenario.outcome === `resolve` ? [{ id: `one`, value: 1 }] : [],
      )
    } else {
      expect(subscriptions[1].lastError).toBeUndefined()
      expect([...visible[1].values()]).toEqual([])
    }
    if (firstUnsubscribed) {
      expect(subscriptions[0].lastError).toBeUndefined()
    } else {
      expect(subscriptions[0].lastError).toBe(
        scenario.outcome === `reject` ? failure : undefined,
      )
    }

    if (!firstUnsubscribed) {
      subscriptions[0].unsubscribe()
      firstUnsubscribed = true
    }
    if (!secondUnsubscribed) {
      subscriptions[1].unsubscribe()
      secondUnsubscribed = true
    }
    expect(unloads).toHaveLength(2)
    expect(new Set(unloads).size).toBe(2)
  } finally {
    for (const transport of transports) transport.resolve()
    await flushPromises()
    if (!firstUnsubscribed) subscriptions[0].unsubscribe()
    if (!secondUnsubscribed) subscriptions[1].unsubscribe()
    await collection.cleanup()
  }
}

function applyOptimisticOperation(
  source: ReadonlyMap<string | number, ReplayRow>,
  scenario: OptimisticReplayScenario,
): Map<string | number, ReplayRow> {
  const result = new Map(
    [...source].map(([key, row]) => [key, { ...row }] as const),
  )
  if (scenario.operation === `insert`) {
    result.set(`two`, { id: `two`, value: scenario.optimisticValue })
  } else if (scenario.operation === `update`) {
    result.set(`one`, { id: `one`, value: scenario.optimisticValue })
  } else {
    result.delete(`one`)
  }
  return result
}

async function runOptimisticReplayScenario(
  scenario: OptimisticReplayScenario,
): Promise<void> {
  let begin!: (options?: { immediate?: boolean }) => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  let loadCount = 0
  const replay = createDeferred<void>()
  const replayFailure = new Error(`optimistic replay failed`)
  const mutation = createDeferred<void>()
  const initialSource = rowsById([{ id: `one`, value: scenario.initialValue }])
  const replayRows =
    scenario.operation === `insert`
      ? [
          { id: `one` as const, value: scenario.serverValue },
          ...(scenario.serverRetainsTarget
            ? [{ id: `two` as const, value: scenario.serverValue }]
            : []),
        ]
      : scenario.serverRetainsTarget
        ? [{ id: `one` as const, value: scenario.serverValue }]
        : []
  const replaySource = rowsById(replayRows)
  const collection = createCollection<ReplayRow>({
    id: `optimistic-replay-${scenario.operation}-${scenario.outcome}`,
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
              for (const row of initialSource.values()) {
                write({ type: `insert`, value: { ...row } })
              }
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
  const visible = new Map<string | number, ReplayRow>()
  const batches: Array<Array<ReplayChange>> = []
  const subscription = collection.subscribeChanges((changes) => {
    batches.push(recordPublishedChanges(visible, changes))
  })
  const transaction = createTransaction({
    mutationFn: () => mutation.promise,
  })
  void transaction.isPersisted.promise.catch(() => {})
  let unsubscribed = false

  try {
    subscription.requestSnapshot({ optimizedOnly: false })
    expect(sortedRows(visible)).toEqual(sortedRows(initialSource))

    transaction.mutate(() => {
      if (scenario.operation === `insert`) {
        collection.insert({ id: `two`, value: scenario.optimisticValue })
      } else if (scenario.operation === `update`) {
        collection.update(`one`, (draft) => {
          draft.value = scenario.optimisticValue
        })
      } else {
        collection.delete(`one`)
      }
    })
    const optimisticBaseline = applyOptimisticOperation(initialSource, scenario)
    expect(sortedRows(visible)).toEqual(sortedRows(optimisticBaseline))
    expect(
      sortedRows(
        rowsById(collection.toArray.map(({ id, value }) => ({ id, value }))),
      ),
    ).toEqual(sortedRows(optimisticBaseline))
    batches.length = 0

    begin()
    truncate()
    commit()
    await flushPromises()
    // A loadSubset adapter must install its request-scoped rows before its
    // promise settles, even while a user mutation is still persisting.
    begin({ immediate: true })
    for (const row of replayRows) {
      write({ type: `insert`, value: { ...row } })
    }
    commit()
    if (scenario.outcome === `resolve`) replay.resolve()
    else replay.reject(replayFailure)
    await flushPromises()

    const expected = applyOptimisticOperation(
      scenario.outcome === `resolve` ? replaySource : initialSource,
      scenario,
    )
    const expectedBatch =
      scenario.outcome === `resolve`
        ? publicationDiff(optimisticBaseline, expected)
        : []
    expect(sortedRows(visible)).toEqual(sortedRows(expected))
    expect(batches.map(sortedChanges)).toEqual(
      expectedBatch.length > 0 ? [sortedChanges(expectedBatch)] : [],
    )
    expect(subscription.lastError).toBe(
      scenario.outcome === `reject` ? replayFailure : undefined,
    )

    subscription.unsubscribe()
    unsubscribed = true
  } finally {
    replay.resolve()
    mutation.resolve()
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

const { multiplier, ...replay } = readOracleRunConfig()
const generatedRuns = 30 * multiplier

describe(`CollectionSubscription replay oracle`, () => {
  it(`generates shared, failed, stale, released, and post-replay histories`, () => {
    const scenarios = fc.sample(replayScenarioArbitrary, {
      seed: 1755,
      numRuns: 300,
    })

    expect(scenarios.some(({ demandIds }) => demandIds.length > 1)).toBe(true)
    expect(scenarios.some(({ attempts }) => attempts.length > 1)).toBe(true)
    expect(
      scenarios.some(({ attempts }) =>
        attempts.some(({ loads }) =>
          loads.some(({ outcome }) => outcome === `reject`),
        ),
      ),
    ).toBe(true)
    expect(
      scenarios.some(({ attempts }) =>
        attempts.some(({ loads }) =>
          loads.some(({ writeBeforeSettlement }) => writeBeforeSettlement),
        ),
      ),
    ).toBe(true)
    expect(
      scenarios.some(({ settlementOrder }) =>
        settlementOrder.some((value, index) => value !== index),
      ),
    ).toBe(true)
    expect(
      scenarios.some(({ releaseOnLastAttempt }) =>
        Boolean(releaseOnLastAttempt),
      ),
    ).toBe(true)
    expect(
      scenarios.some(({ afterSettlement }) => afterSettlement.length > 0),
    ).toBe(true)
    expect(
      scenarios.some(({ afterSettlement }) =>
        afterSettlement.some(({ type }) => type === `request`),
      ),
    ).toBe(true)
  })

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

  it(`keeps the published replacement after a reentrant replay fails`, async () => {
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

      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
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
      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      replays[1]?.deferred.resolve()
      await flushPromises()

      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.status).toBe(`ready`)
      expect(subscription.lastError).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  const orderedReplayCases = ([`asc`, `desc`] as const).flatMap((direction) => [
    ...([`return`, `resolve`] as const).flatMap((delivery) =>
      ([`same`, `changed`] as const).map((identity) => ({
        name: `${direction} ${delivery} with ${identity} keys`,
        direction,
        delivery,
        identity,
      })),
    ),
    ...([`throw`, `reject`] as const).map((delivery) => ({
      name: `${direction} ${delivery}`,
      direction,
      delivery,
      identity: `none` as const,
    })),
  ])

  it.each(orderedReplayCases)(
    `restores ordered offset and cursor state after replay: $name`,
    async ({ direction, delivery, identity }) => {
      type OrderedReplayRow = {
        id: `one` | `two` | `three` | `four`
        value: number
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<OrderedReplayRow, string>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      const loadOptions: Array<LoadSubsetOptions> = []
      const replayLoads: Array<ReturnType<typeof createDeferred<void>>> = []
      const replayRows: ReadonlyArray<OrderedReplayRow> =
        identity === `same`
          ? [
              { id: `one`, value: 1 },
              { id: `two`, value: 2 },
            ]
          : [
              { id: `three`, value: 1 },
              { id: `four`, value: 2 },
            ]
      let replayRowsInstalled = false
      const installReplayRows = () => {
        if (replayRowsInstalled || identity === `none`) return
        replayRowsInstalled = true
        begin()
        for (const row of replayRows) {
          write({ type: `insert`, value: row })
        }
        commit()
      }
      const collection = createCollection<OrderedReplayRow>({
        id: `ordered-replay-${direction}-${delivery}-${identity}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            begin()
            write({ type: `insert`, value: { id: `one`, value: 1 } })
            write({ type: `insert`, value: { id: `two`, value: 2 } })
            commit()
            params.markReady()
            return {
              loadSubset: (options) => {
                loadCount++
                loadOptions.push(options)
                if (loadCount <= 2) return true
                if (loadCount > 4) return true

                if (delivery === `return`) {
                  installReplayRows()
                  return true
                }
                if (delivery === `throw`) {
                  if (loadCount === 3) {
                    throw new Error(`ordered replay failed`)
                  }
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
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderedIndex = direction === `asc` ? index : new ReverseIndex(index)
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`value`]),
          compareOptions: { direction, nulls: `first` },
        },
      ]
      const batches: Array<Array<OrderedReplayRow[`id`]>> = []
      const subscription = collection.subscribeChanges((changes) => {
        batches.push(changes.map(({ value }) => value.id))
      })
      subscription.setOrderByIndex(orderedIndex)

      const initialIds =
        direction === `asc`
          ? ([`one`, `two`] as const)
          : ([`two`, `one`] as const)
      const replacementIds =
        direction === `asc`
          ? ([`three`, `four`] as const)
          : ([`four`, `three`] as const)
      const succeeds = delivery === `return` || delivery === `resolve`
      const expectedIds = identity === `changed` ? replacementIds : initialIds

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        expect(batches).toEqual([[initialIds[0]]])
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [direction === `asc` ? 1 : 2],
        })
        expect(loadOptions[1]).toMatchObject({
          offset: 1,
          cursor: { lastKey: initialIds[1] },
        })

        begin()
        truncate()
        commit()
        await flushPromises()
        expectSameSubsetRequest(loadOptions[2]!, loadOptions[0]!)
        expectSameSubsetRequest(loadOptions[3]!, loadOptions[1]!)

        if (delivery === `resolve`) {
          expect(replayLoads).toHaveLength(2)
          installReplayRows()
          replayLoads[0]?.resolve()
          replayLoads[1]?.resolve()
        } else if (delivery === `reject`) {
          expect(replayLoads).toHaveLength(2)
          replayLoads[0]?.reject(new Error(`ordered replay failed`))
          replayLoads[1]?.resolve()
        } else {
          expect(replayLoads).toEqual([])
        }
        await flushPromises()
        expect(collection.toArray.map(({ id }) => id).sort()).toEqual(
          succeeds ? [...expectedIds].sort() : [],
        )

        const batchCount = batches.length
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [direction === `asc` ? 2 : 1],
        })
        expect(loadOptions[4]).toMatchObject({
          offset: 2,
          cursor: {
            lastKey: succeeds ? expectedIds[1] : initialIds[1],
          },
        })
        if (succeeds) expect(batches.at(-1)).toEqual([])
        else expect(batches).toHaveLength(batchCount)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`keeps a same-key source replacement private after a failed replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandIds: [`one`],
      attempts: [
        {
          loads: [{ demandId: `one`, rows: [], outcome: `reject` }],
        },
      ],
      settlementOrder: [0],
      settlementPhases: [0],
      afterSettlement: [{ type: `put`, row: { id: `one`, value: 2 } }],
    })
  })

  it(`does not let an unpublished truncate delete suppress a later insert`, async () => {
    await runReplayScenario({
      initialRows: [],
      demandIds: [`two`, `one`],
      attempts: [
        {
          loads: [
            {
              demandId: `two`,
              rows: [{ id: `two`, value: -1 }],
              outcome: `resolve`,
            },
            { demandId: `one`, rows: [], outcome: `reject` },
          ],
        },
        {
          loads: [
            { demandId: `two`, rows: [], outcome: `resolve` },
            {
              demandId: `one`,
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
      demandIds: [`one`],
      attempts: [
        {
          loads: [{ demandId: `one`, rows: [], outcome: `reject` }],
        },
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 2 }],
              outcome: `resolve`,
            },
          ],
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
      demandIds: [`one`],
      attempts: [
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 1 }],
              outcome: `resolve`,
            },
          ],
        },
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 2 }],
              outcome: `resolve`,
            },
          ],
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
      demandIds: [`one`],
      attempts: [
        {
          loads: [{ demandId: `one`, rows: [], outcome: `resolve` }],
        },
        {
          loads: [{ demandId: `one`, rows: [], outcome: `resolve` }],
        },
      ],
      settlementOrder: [1, 0],
      settlementPhases: [1, 1],
      afterSettlement: [],
    })
  })

  it(`uses the newest complete multi-demand replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandIds: [`one`, `two`],
      attempts: [
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 2 }],
              outcome: `resolve`,
            },
            { demandId: `two`, rows: [], outcome: `reject` },
          ],
        },
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 3 }],
              outcome: `resolve`,
            },
            {
              demandId: `two`,
              rows: [{ id: `two`, value: 4 }],
              outcome: `resolve`,
            },
          ],
        },
      ],
      settlementOrder: [2, 3, 0, 1],
      settlementPhases: [1, 1, 1, 1],
      afterSettlement: [],
    })
  })

  it(`excludes rows written before their replay demand is released`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `two`, value: 0 }],
      demandIds: [`one`, `two`],
      attempts: [
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 1 }],
              outcome: `reject`,
              writeBeforeSettlement: true,
            },
            {
              demandId: `two`,
              rows: [{ id: `two`, value: 2 }],
              outcome: `resolve`,
            },
          ],
        },
      ],
      settlementOrder: [0, 1],
      settlementPhases: [0, 0],
      releaseOnLastAttempt: `one`,
      afterSettlement: [{ type: `request`, demandId: `one` }],
    })
  })

  it(`replaces a retained snapshot with a later empty replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandIds: [`one`],
      attempts: [
        {
          loads: [{ demandId: `one`, rows: [], outcome: `reject` }],
        },
        {
          loads: [{ demandId: `one`, rows: [], outcome: `resolve` }],
        },
      ],
      settlementOrder: [0, 1],
      settlementPhases: [0, 1],
      afterSettlement: [],
    })
  })

  it(`does not start a queued replay after a newer truncate supersedes it`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const loadSignals: Array<AbortSignal | undefined> = []
    const collection = createCollection<ReplayRow>({
      id: `superseded-before-replay-setup`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: ({ signal }) => {
              loadSignals.push(signal)
              return loadSignals.length === 1 ? true : replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })

      begin()
      truncate()
      commit()
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loadSignals).toHaveLength(2)
      expect(loadSignals[0]?.aborted).toBe(true)
      expect(loadSignals[1]?.aborted).toBe(false)
    } finally {
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`aborts a replay acquisition before a reentrant newer truncate starts`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const olderReplay = createDeferred<void>()
    const newerReplay = createDeferred<void>()
    const replaySignals: Array<AbortSignal | undefined> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `reentrant-newer-replay`,
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
            loadSubset: ({ signal }) => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 0 } })
                commit()
                return true
              }

              replaySignals.push(signal)
              if (loadCount === 2) {
                begin()
                truncate()
                commit()
                return olderReplay.promise
              }
              return newerReplay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })

    const install = (value: number) => {
      begin()
      write({
        type: collection.has(`one`) ? `update` : `insert`,
        value: { id: `one`, value },
      })
      commit()
    }

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 0 }])

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(replaySignals).toHaveLength(2)
      expect(replaySignals[0]?.aborted).toBe(true)

      install(2)
      newerReplay.resolve()
      await flushPromises()
      if (!replaySignals[0]?.aborted) install(1)
      olderReplay.resolve()
      await flushPromises()

      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
    } finally {
      olderReplay.resolve()
      newerReplay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not retain replay work registered after its demand is released`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const releasedReplay = createDeferred<void>()
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `released-during-replay-start`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          begin()
          write({ type: `insert`, value: { id: `one`, value: 1 } })
          write({ type: `insert`, value: { id: `two`, value: 1 } })
          commit()
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount <= 2) return true
              if (loadCount === 3) {
                subscription.releaseSnapshot(firstWhere)
                return releasedReplay.promise
              }
              begin()
              write({ type: `insert`, value: { id: `two`, value: 2 } })
              commit()
              return Promise.resolve()
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(subscription.status).toBe(`ready`)
      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
    } finally {
      releasedReplay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`finishes replay state and surfaces an async subscriber failure`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const listenerFailure = new Error(`replay subscriber failed`)
    const queuedMicrotasks: Array<VoidFunction> = []
    let loadCount = 0
    let rejectReplacement = false
    const collection = createCollection<ReplayRow>({
      id: `async-replay-subscriber-failure`,
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
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
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
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
      if (rejectReplacement) throw listenerFailure
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
      rejectReplacement = true
      const queueMicrotaskSpy = vi
        .spyOn(globalThis, `queueMicrotask`)
        .mockImplementation((callback) => queuedMicrotasks.push(callback))
      try {
        replay.resolve()
        await flushPromises()

        expect(subscription.status).toBe(`ready`)
        expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
        expect(queuedMicrotasks).toHaveLength(1)
        expect(() => queuedMicrotasks[0]!()).toThrow(listenerFailure)
      } finally {
        queueMicrotaskSpy.mockRestore()
      }
    } finally {
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not start another demand for a replay superseded by reentrancy`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    let loadCount = 0
    let inSupersededSetup = false
    let staleSecondDemandStarted = false
    const collection = createCollection<ReplayRow>({
      id: `reentrant-multi-demand-replay`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          begin()
          write({ type: `insert`, value: { id: `one`, value: 0 } })
          write({ type: `insert`, value: { id: `two`, value: 0 } })
          commit()
          operations.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              if (loadCount <= 2) return true
              if (loadCount === 3) {
                inSupersededSetup = true
                queueMicrotask(() => {
                  inSupersededSetup = false
                })
                begin()
                truncate()
                commit()
                return true
              }
              if (inSupersededSetup) {
                staleSecondDemandStarted = true
                begin()
                write({ type: `insert`, value: { id: `two`, value: 1 } })
                commit()
                return true
              }
              if (options.where === firstWhere) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 2 } })
                commit()
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(staleSecondDemandStarted).toBe(false)
      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`releases the old and new leases once when loading status retires a replay demand`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-status-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return loads.length === 1 ? true : replay.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    let releaseOnLoading = false
    subscription.on(`status:loadingSubset`, () => {
      if (releaseOnLoading) subscription.releaseSnapshot(where)
    })

    try {
      subscription.requestSnapshot({ where, optimizedOnly: false })
      releaseOnLoading = true
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loads).toHaveLength(2)
      expect(loads[1]?.signal?.aborted).toBe(true)
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([1, 0])
      expect(subscription.status).toBe(`ready`)
    } finally {
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`releases replay work when its final publication callback throws`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const listenerFailure = new Error(`release publication failed`)
    let rejectReplacement = false
    const collection = createCollection<ReplayRow>({
      id: `replay-release-callback-cleanup`,
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
              loads.push(options)
              if (loads.length === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
                commit()
                return true
              }
              return replay.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {
      if (rejectReplacement) throw listenerFailure
    })

    try {
      subscription.requestSnapshot({ where, optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 2 } })
      commit()
      rejectReplacement = true

      expect(() => subscription.releaseSnapshot(where)).toThrow(listenerFailure)
      expect(loads[1]?.signal?.aborted).toBe(true)
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([0, 1])
      expect(subscription.status).toBe(`ready`)
    } finally {
      rejectReplacement = false
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not retain a demand released during adapter startup`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    const releasedLoad = createDeferred<void>()
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-new-demand-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length === 1) return true
              if (loads.length === 2) return replay.promise
              subscription.releaseSnapshot(secondWhere)
              return releasedLoad.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      begin()
      truncate()
      commit()
      await flushPromises()

      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      replay.resolve()
      await flushPromises()

      expect(loads).toHaveLength(3)
      expect(loads[2]?.signal?.aborted).toBe(true)
      expect(unloads).toContain(loads[2])
      expect(subscription.status).toBe(`ready`)
      expect(subscription.pendingTruncateReplacement).toBeUndefined()
    } finally {
      releasedLoad.resolve()
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes a replay replacement before reporting ready`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replay = createDeferred<void>()
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `replay-ready-after-publication`,
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
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
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
    const visible = new Map<string | number, ReplayRow>()
    const readyValues: Array<number | undefined> = []
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })
    subscription.on(`status:ready`, () => {
      readyValues.push(visible.get(`one`)?.value)
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

      replay.resolve()
      await flushPromises()

      expect(readyValues).toEqual([2])
      expect(visible.get(`one`)?.value).toBe(2)
      expect(subscription.status).toBe(`ready`)
    } finally {
      replay.resolve()
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`ignores a synchronous replay failure after its demand releases itself`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const releasedFailure = new Error(`released replay load failed`)
    const reportedErrors: Array<unknown> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `released-sync-failure`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          begin()
          write({ type: `insert`, value: { id: `one`, value: 1 } })
          write({ type: `insert`, value: { id: `two`, value: 1 } })
          commit()
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount <= 2) return true
              if (loadCount === 3) {
                subscription.releaseSnapshot(firstWhere)
                throw releasedFailure
              }
              begin()
              write({ type: `insert`, value: { id: `two`, value: 2 } })
              commit()
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      recordPublishedChanges(visible, changes as Array<ReplayChange>)
    })
    subscription.on(`loadSubset:error`, ({ error }) => {
      reportedErrors.push(error)
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(reportedErrors).not.toContain(releasedFailure)
      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.status).toBe(`ready`)
      expect(subscription.pendingTruncateReplacement).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retries an old replay lease when its reentrant release fails`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let reentered = false
    const releaseFailure = new Error(`old replay lease release failed`)
    const collection = createCollection<ReplayRow>({
      id: `reentrant-replay-lease-replacement`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[0] && !reentered) {
                reentered = true
                subscription.releaseSnapshot(where)
                throw releaseFailure
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({ where, optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loads).toHaveLength(2)
      expect(unloads).toHaveLength(2)
      expect(unloads[0]).toBe(loads[0])
      expect(unloads[1]).toBe(loads[1])
      subscription.unsubscribe()
      expect(unloads).toEqual([loads[0], loads[1], loads[0]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`rejects replay completion with the exact reported adapter error`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replayLoad = createDeferred<void>()
    const failure = new Error(`exact replay failure`)
    const reportedErrors: Array<unknown> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `exact-replay-completion-error`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => (++loadCount === 1 ? true : replayLoad.promise),
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
      truncateReplayPublication: {
        start: () => {},
        succeed: () => {},
      },
    })
    subscription.on(`loadSubset:error`, ({ error }) => {
      reportedErrors.push(error)
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      const replacement = subscription.pendingTruncateReplacement
      expect(replacement).toBeInstanceOf(Promise)

      replayLoad.reject(failure)

      await expect(replacement).rejects.toBe(failure)
      expect(subscription.lastError).toBe(failure)
      expect(reportedErrors).toEqual([failure])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`normalizes one primitive rejection for every observer of a shared replay`, async () => {
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const replayLoad = createDeferred<void>()
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const secondWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])
    const loads: Array<LoadSubsetOptions> = []
    const reportedErrors: Array<{
      options: LoadSubsetOptions
      error: unknown
    }> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `shared-primitive-replay-error`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              return loadCount <= 2 ? true : replayLoad.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
      truncateReplayPublication: {
        start: () => {},
        succeed: () => {},
      },
    })
    subscription.on(`loadSubset:error`, ({ options, error }) => {
      reportedErrors.push({ options, error })
    })

    try {
      subscription.requestSnapshot({
        where: firstWhere,
        optimizedOnly: false,
      })
      subscription.requestSnapshot({
        where: secondWhere,
        optimizedOnly: false,
      })
      begin()
      truncate()
      commit()
      await flushPromises()
      const replacement = subscription.pendingTruncateReplacement
      expect(replacement).toBeInstanceOf(Promise)

      replayLoad.reject(undefined)

      let replacementError: unknown
      try {
        await replacement
      } catch (error) {
        replacementError = error
      }
      expect(reportedErrors).toHaveLength(2)
      expect(reportedErrors.map(({ options }) => options)).toEqual([
        loads[2],
        loads[3],
      ])
      expect(reportedErrors[0]?.error).toBeInstanceOf(Error)
      expect(reportedErrors[1]?.error).toBe(reportedErrors[0]?.error)
      expect(subscription.lastError).toBe(reportedErrors[0]?.error)
      expect(replacementError).toBe(reportedErrors[0]?.error)
    } finally {
      replayLoad.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`none`, `first`, `second`, `both`] as const)(
    `normalizes one primitive rejection for ordinary shared loads after releasing %s demand`,
    async (released) => {
      const sharedLoad = createDeferred<void>()
      const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const secondWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`two`),
      ])
      const loads: Array<LoadSubsetOptions> = []
      const reportedErrors: Array<{
        options: LoadSubsetOptions
        error: unknown
      }> = []
      const collection = createCollection<ReplayRow>({
        id: `shared-primitive-ordinary-error-${released}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return sharedLoad.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ options, error }) => {
        reportedErrors.push({ options, error })
      })

      try {
        subscription.requestSnapshot({ where: firstWhere })
        subscription.requestSnapshot({ where: secondWhere })
        expect(loads.map(({ where }) => where)).toEqual([
          firstWhere,
          secondWhere,
        ])

        if (released === `first` || released === `both`) {
          subscription.releaseSnapshot(firstWhere)
        }
        if (released === `second` || released === `both`) {
          subscription.releaseSnapshot(secondWhere)
        }
        expect(loads[0]?.signal?.aborted).toBe(
          released === `first` || released === `both`,
        )
        expect(loads[1]?.signal?.aborted).toBe(
          released === `second` || released === `both`,
        )

        sharedLoad.reject(undefined)
        await flushPromises()

        const activeLoads = loads.filter((load) => !load.signal?.aborted)
        expect(reportedErrors.map(({ options }) => options)).toEqual(
          activeLoads,
        )
        if (activeLoads.length > 0) {
          expect(reportedErrors[0]?.error).toBeInstanceOf(Error)
          for (const { error } of reportedErrors) {
            expect(error).toBe(reportedErrors[0]?.error)
          }
          expect(subscription.lastError).toBe(reportedErrors[0]?.error)
        } else {
          expect(subscription.lastError).toBeUndefined()
        }
        expect(subscription.status).toBe(`ready`)
      } finally {
        sharedLoad.resolve()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`first`, `second`, `both`] as const)(
    `settles a shared replay rejection after releasing %s demand`,
    async (released) => {
      let begin!: () => void
      let commit!: () => void
      let truncate!: () => void
      const replayLoad = createDeferred<void>()
      const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const secondWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`two`),
      ])
      const loads: Array<LoadSubsetOptions> = []
      const reportedErrors: Array<{
        options: LoadSubsetOptions
        error: unknown
      }> = []
      let loadCount = 0
      const collection = createCollection<ReplayRow>({
        id: `released-shared-primitive-replay-error-${released}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                loadCount++
                return loadCount <= 2 ? true : replayLoad.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
        truncateReplayPublication: {
          start: () => {},
          succeed: () => {},
        },
      })
      subscription.on(`loadSubset:error`, ({ options, error }) => {
        reportedErrors.push({ options, error })
      })

      try {
        subscription.requestSnapshot({ where: firstWhere })
        subscription.requestSnapshot({ where: secondWhere })
        begin()
        truncate()
        commit()
        await flushPromises()
        const replacement = subscription.pendingTruncateReplacement
        expect(replacement).toBeInstanceOf(Promise)
        expect(loads.map(({ where }) => where)).toEqual([
          firstWhere,
          secondWhere,
          firstWhere,
          secondWhere,
        ])
        const settlement = replacement!.then(
          () => ({ status: `resolved` as const }),
          (error: unknown) => ({ status: `rejected` as const, error }),
        )

        if (released === `first` || released === `both`) {
          subscription.releaseSnapshot(firstWhere)
        }
        if (released === `second` || released === `both`) {
          subscription.releaseSnapshot(secondWhere)
        }
        expect(loads[2]?.signal?.aborted).toBe(
          released === `first` || released === `both`,
        )
        expect(loads[3]?.signal?.aborted).toBe(
          released === `second` || released === `both`,
        )

        if (released === `both`) {
          const result = await settlement
          expect(result).toMatchObject({
            status: `rejected`,
            error: { name: `AbortError` },
          })
          expect(reportedErrors).toEqual([])
          expect(subscription.lastError).toBeUndefined()
          expect(subscription.status).toBe(`ready`)
        } else {
          expect(subscription.pendingTruncateReplacement).toBe(replacement)
          expect(subscription.status).toBe(`loadingSubset`)
          replayLoad.reject(undefined)
          const result = await settlement
          expect(result.status).toBe(`rejected`)

          const activeIndex = released === `first` ? 3 : 2
          expect(reportedErrors).toHaveLength(1)
          expect(reportedErrors[0]?.options).toBe(loads[activeIndex])
          expect(reportedErrors[0]?.error).toBeInstanceOf(Error)
          expect(subscription.lastError).toBe(reportedErrors[0]?.error)
          expect(result).toMatchObject({
            status: `rejected`,
            error: reportedErrors[0]?.error,
          })
        }
      } finally {
        replayLoad.resolve()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`does not start replacement work after release unsubscribes`, () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-replacement-unsubscribe`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              subscription.unsubscribe()
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ where, optimizedOnly: false })
    expect(
      subscription.requestSnapshot({
        where,
        optimizedOnly: false,
        replaceExistingDemand: true,
      }),
    ).toBe(false)

    expect(loads).toHaveLength(1)
    expect(unloads).toEqual([loads[0]])
  })

  it.each([`generic`, `specific`] as const)(
    `does not emit a stale specific status after reentrant release from a %s listener`,
    async (reentryEvent) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const load = createDeferred<void>()
      const collection = createCollection<ReplayRow>({
        id: `reentrant-specific-status`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.markReady()
            return {
              loadSubset: () => load.promise,
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const observed: Array<{ event: string; current: string }> = []
      if (reentryEvent === `generic`) {
        subscription.on(`status:change`, ({ status }) => {
          if (status === `loadingSubset`) subscription.releaseSnapshot(where)
        })
      } else {
        subscription.on(`status:loadingSubset`, () => {
          subscription.releaseSnapshot(where)
        })
      }
      subscription.on(`status:loadingSubset`, ({ status }) => {
        observed.push({ event: status, current: subscription.status })
      })
      subscription.on(`status:ready`, ({ status }) => {
        observed.push({ event: status, current: subscription.status })
      })

      try {
        subscription.requestSnapshot({ where, optimizedOnly: false })
        expect(observed).toEqual([{ event: `ready`, current: `ready` }])
      } finally {
        load.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`generic`, `specific`] as const)(
    `does not resume an obsolete status transition after %s-listener ABA reentry`,
    async (reentryEvent) => {
      const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const secondWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`two`),
      ])
      const load = createDeferred<void>()
      const collection = createCollection<ReplayRow>({
        id: `reentrant-status-aba-${reentryEvent}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.markReady()
            return {
              loadSubset: () => load.promise,
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const trace: Array<string> = []
      let reentered = false
      const reenter = () => {
        if (reentered) return
        reentered = true
        subscription.releaseSnapshot(firstWhere)
        subscription.requestSnapshot({ where: secondWhere })
      }
      if (reentryEvent === `generic`) {
        subscription.on(`status:change`, ({ status }) => {
          if (status === `loadingSubset`) reenter()
        })
      } else {
        subscription.on(`status:loadingSubset`, reenter)
      }
      subscription.on(`status:change`, ({ previousStatus, status }) => {
        trace.push(
          `generic:${previousStatus}->${status}:${subscription.status}`,
        )
      })
      subscription.on(`status:loadingSubset`, () => {
        trace.push(`specific:loadingSubset:${subscription.status}`)
      })

      try {
        subscription.requestSnapshot({ where: firstWhere })

        expect(trace).toEqual(
          reentryEvent === `generic`
            ? [
                `generic:loadingSubset->ready:ready`,
                `generic:ready->loadingSubset:loadingSubset`,
                `specific:loadingSubset:loadingSubset`,
              ]
            : [
                `generic:ready->loadingSubset:loadingSubset`,
                `generic:loadingSubset->ready:ready`,
                `generic:ready->loadingSubset:loadingSubset`,
                `specific:loadingSubset:loadingSubset`,
              ],
        )
      } finally {
        load.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`generic`, `specific`] as const)(
    `stops %s status delivery when an earlier ready listener unsubscribes`,
    async (reentryEvent) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
      const load = createDeferred<void>()
      const collection = createCollection<ReplayRow>({
        id: `reentrant-status-unsubscribe-${reentryEvent}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.markReady()
            return {
              loadSubset: () => load.promise,
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const trace: Array<string> = []
      const unsubscribe = () => {
        trace.push(`unsubscribe`)
        subscription.unsubscribe()
      }
      if (reentryEvent === `generic`) {
        subscription.on(`status:change`, ({ status }) => {
          if (status === `ready`) unsubscribe()
        })
      } else {
        subscription.on(`status:ready`, unsubscribe)
      }
      subscription.on(`status:change`, ({ status }) => {
        if (status === `ready`) trace.push(`late-generic`)
      })
      subscription.on(`status:ready`, () => trace.push(`late-specific`))
      subscription.on(`unsubscribed`, () => trace.push(`unsubscribed`))

      try {
        subscription.requestSnapshot({ where })
        load.resolve()
        await flushPromises()

        expect(trace).toEqual(
          reentryEvent === `generic`
            ? [`unsubscribe`, `unsubscribed`]
            : [`late-generic`, `unsubscribe`, `unsubscribed`],
        )
      } finally {
        load.resolve()
        await collection.cleanup()
      }
    },
  )

  fcTest.prop([replayScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1756,
  })(`matches replay and ownership laws for a fixed seed`, runReplayScenario)

  fcTest.prop(
    [replayScenarioArbitrary],
    oracleRandomParameters(
      generatedRuns,
      replay,
      `subscription-replay.completion`,
    ),
  )(
    `matches replay and ownership laws for a random or replayed seed`,
    runReplayScenario,
  )

  fcTest.prop(
    [sequentialReplayScenarioArbitrary],
    oracleRandomParameters(
      generatedRuns,
      replay,
      `subscription-replay.sequential`,
    ),
  )(
    `matches synchronous, asynchronous, and partial-failure replay laws`,
    runSequentialReplayScenario,
  )

  fcTest.prop([cleanupRestartScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1757,
  })(
    `isolates cleanup and restart sessions for a fixed seed`,
    runCleanupRestartScenario,
  )

  fcTest.prop(
    [cleanupRestartScenarioArbitrary],
    oracleRandomParameters(
      generatedRuns,
      replay,
      `subscription-replay.restart`,
    ),
  )(
    `isolates cleanup and restart sessions for a random or replayed seed`,
    runCleanupRestartScenario,
  )

  fcTest.prop([fc.scheduler()], { numRuns: generatedRuns, seed: 1760 })(
    `keeps same-tick obsolete and current replay settlements generation-safe`,
    expectScheduledReplaySettlementIsGenerationSafe,
  )

  fcTest.prop(
    [fc.scheduler()],
    oracleRandomParameters(
      generatedRuns,
      replay,
      `subscription-replay.same-tick`,
    ),
  )(
    `keeps same-tick replay settlements generation-safe for a random or replayed seed`,
    expectScheduledReplaySettlementIsGenerationSafe,
  )

  fcTest.prop([sharedSubscriptionScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1758,
  })(
    `keeps independent transport and logical ownership aligned for a fixed seed`,
    runSharedSubscriptionScenario,
  )

  fcTest.prop(
    [sharedSubscriptionScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replay, `subscription-replay.shared`),
  )(
    `keeps independent transport and logical ownership aligned for a random or replayed seed`,
    runSharedSubscriptionScenario,
  )

  fcTest.prop([optimisticReplayScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1759,
  })(
    `preserves optimistic overlays across replay outcomes for a fixed seed`,
    runOptimisticReplayScenario,
  )

  fcTest.prop(
    [optimisticReplayScenarioArbitrary],
    oracleRandomParameters(
      generatedRuns,
      replay,
      `subscription-replay.optimistic`,
    ),
  )(
    `preserves optimistic overlays across replay outcomes for a random or replayed seed`,
    runOptimisticReplayScenario,
  )
})
