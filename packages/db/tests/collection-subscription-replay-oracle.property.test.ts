import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../src/query/subset-dedupe.js'
import { createTransaction } from '../src/transactions.js'
import { projectAtomicOrderedPublicationState } from './load-subset-full-flow-model.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { Collection } from '../src/collection/index.js'
import type { OrderBy } from '../src/query/ir.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
} from '../src/types.js'
import type { LoadSubsetFullFlowEvent } from './load-subset-full-flow-model.js'

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

type ReplayCompletionScenario = {
  delivery: `return` | `resolve`
  obsoleteBy:
    | `stay-active`
    | `release-snapshot`
    | `unsubscribe`
    | `request-abort`
    | `newer-truncate`
  failingUnload: `none` | `initial` | `first-replay`
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
                : fc.constant<ReadonlyArray<SourceAction>>([]),
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

const replayCompletionScenarioArbitrary: fc.Arbitrary<ReplayCompletionScenario> =
  fc.record({
    delivery: fc.constantFrom(`return` as const, `resolve` as const),
    obsoleteBy: fc.constantFrom(
      `stay-active` as const,
      `release-snapshot` as const,
      `unsubscribe` as const,
      `request-abort` as const,
      `newer-truncate` as const,
    ),
    failingUnload: fc.constantFrom(
      `none` as const,
      `initial` as const,
      `first-replay` as const,
    ),
  })

const exhaustiveReplayCompletionScenarios: Array<ReplayCompletionScenario> = [
  `return` as const,
  `resolve` as const,
].flatMap((delivery) =>
  (
    [
      `stay-active`,
      `release-snapshot`,
      `unsubscribe`,
      `request-abort`,
      `newer-truncate`,
    ] as const
  ).flatMap((obsoleteBy) =>
    ([`none`, `initial`, `first-replay`] as const).map((failingUnload) => ({
      delivery,
      obsoleteBy,
      failingUnload,
    })),
  ),
)

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

function expectReplayRequestToRestart(
  actual: LoadSubsetOptions,
  stored: LoadSubsetOptions,
  expectedOffset = 0,
): void {
  expect(actual.where).toBe(stored.where)
  expect(actual.orderBy).toBe(stored.orderBy)
  expect(actual.limit).toBe(stored.limit)
  expect(actual.cursor).toBeUndefined()
  expect(actual.offset).toBe(expectedOffset)
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
      const session = modelSession!
      const load = pending.load
      const isCurrent =
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
        const pending = pendingReplays[replayIndex]!
        if (pending.load.writeBeforeSettlement) {
          writeReplayRows(pending, true)
        }
      }
      if (
        attemptIndex === scenario.attempts.length - 1 &&
        scenario.releaseOnLastAttempt !== undefined
      ) {
        subscription.releaseSnapshot(
          demandWheres.get(scenario.releaseOnLastAttempt)!,
        )
        activeDemandIds.delete(scenario.releaseOnLastAttempt)
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
      if (action.type === `request`) {
        queuedReacquisitions.add(action.demandId)
        activeDemandIds.add(action.demandId)
        subscription.requestSnapshot({
          optimizedOnly: false,
          where: demandWheres.get(action.demandId),
        })
        const row = sourceRows.get(action.demandId)
        if (row) expectedPublished.set(action.demandId, { ...row })
      }
      const applied = applySourceAction(action)
      if (applied && action.type === `delete`) {
        expectedPublished.delete(action.id)
      } else if (applied && action.type === `put`) {
        recordExpectedSourceWrite([action.row], { type: `ordinary` }, true)
        assertSourceWrites()
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

let replayCompletionHarnessId = 0

async function runReplayCompletionScenario(
  scenario: ReplayCompletionScenario,
): Promise<void> {
  let begin!: () => void
  let commit!: () => void
  let truncate!: () => void
  const requestAbortController = new AbortController()
  const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
  const loads: Array<LoadSubsetOptions> = []
  const leases = new Map<
    LoadSubsetOptions,
    { index: number; attempts: number; accepted: number; active: boolean }
  >()
  const pending: Array<ReturnType<typeof createDeferred<void>>> = []
  let actionRan = false
  let failedUnload = false

  const truncateSource = () => {
    begin()
    truncate()
    commit()
  }

  const runObsolescenceAction = () => {
    if (actionRan) return
    actionRan = true
    try {
      switch (scenario.obsoleteBy) {
        case `stay-active`:
          break
        case `release-snapshot`:
          subscription.releaseSnapshot(where)
          break
        case `unsubscribe`:
          subscription.unsubscribe()
          break
        case `request-abort`:
          requestAbortController.abort()
          break
        case `newer-truncate`:
          truncateSource()
          break
      }
    } catch {
      // A failed physical release remains active and must be retried below.
    }
  }

  const collection = createCollection<ReplayRow>({
    id: `replay-completion-authority-${replayCompletionHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            const index = loads.length
            loads.push(options)
            leases.set(options, {
              index,
              attempts: 0,
              accepted: 0,
              active: true,
            })
            if (index === 0) return true

            if (scenario.delivery === `return`) {
              if (index === 1) runObsolescenceAction()
              return true
            }

            const deferred = createDeferred<void>()
            pending.push(deferred)
            return deferred.promise
          },
          unloadSubset: (options) => {
            const lease = leases.get(options)
            if (!lease) throw new Error(`Unknown replay acquisition`)
            lease.attempts++
            const shouldFail =
              !failedUnload &&
              ((scenario.failingUnload === `initial` && lease.index === 0) ||
                (scenario.failingUnload === `first-replay` &&
                  lease.index === 1))
            if (shouldFail) {
              failedUnload = true
              throw new Error(`Physical release failed`)
            }
            lease.accepted++
            lease.active = false
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })

  try {
    subscription.requestSnapshot({
      where,
      signal: requestAbortController.signal,
      optimizedOnly: false,
    })
    truncateSource()
    await flushPromises()

    if (scenario.delivery === `resolve`) {
      runObsolescenceAction()
      await flushPromises()
      const settlementOrder =
        scenario.obsoleteBy === `newer-truncate`
          ? [...pending].reverse()
          : pending
      for (const deferred of settlementOrder) {
        deferred.resolve()
        await flushPromises()
      }
    }

    await flushPromises()
    expect(actionRan).toBe(true)
    expect(loads).toHaveLength(scenario.obsoleteBy === `newer-truncate` ? 3 : 2)

    for (let retry = 0; retry < 3; retry++) {
      try {
        subscription.unsubscribe()
      } catch {
        // Retrying a failed exact release is required and remains idempotent.
      }
      await flushPromises()
      if ([...leases.values()].every(({ active }) => !active)) break
    }

    for (const lease of leases.values()) {
      expect(lease.accepted).toBe(1)
      expect(lease.active).toBe(false)
      expect(lease.attempts).toBe(
        1 +
          Number(
            (scenario.failingUnload === `initial` && lease.index === 0) ||
              (scenario.failingUnload === `first-replay` && lease.index === 1),
          ),
      )
    }
  } finally {
    for (const deferred of pending) deferred.resolve()
    await flushPromises()
    try {
      subscription.unsubscribe()
    } catch {
      subscription.unsubscribe()
    }
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

async function runSharedSubscriptionScenario(
  scenario: SharedSubscriptionScenario,
): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  const transport = createDeferred<void>()
  let transportOptions: LoadSubsetOptions | undefined
  let transportCalls = 0
  const unloads: Array<LoadSubsetOptions> = []
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: (options) => {
      transportCalls++
      transportOptions = options
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
    expect(transportCalls).toBe(1)
    expect(subscriptions[0].status).toBe(`loadingSubset`)
    expect(subscriptions[1].status).toBe(`loadingSubset`)

    if (scenario.releaseCountBeforeSettlement >= 1) {
      subscriptions[0].unsubscribe()
      firstUnsubscribed = true
      expect(transportOptions?.signal?.aborted).toBe(false)
    }
    if (scenario.releaseCountBeforeSettlement === 2) {
      subscriptions[1].unsubscribe()
      secondUnsubscribed = true
      expect(transportOptions?.signal?.aborted).toBe(true)
    }

    const failure = new Error(`shared transport failed`)
    if (scenario.outcome === `resolve`) {
      if (!transportOptions?.signal?.aborted) {
        begin()
        write({ type: `insert`, value: { id: `one`, value: 1 } })
        commit()
      }
      transport.resolve()
    } else {
      transport.reject(
        transportOptions?.signal?.aborted
          ? new DOMException(`obsolete`, `AbortError`)
          : failure,
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
    transport.resolve()
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

const { multiplier, replaySeed } = readOracleRunConfig()
const generatedRuns = 30 * multiplier
const generatedTimeout = 5_000 * multiplier

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

  it(`ignores ordered coverage from an initial acquisition retired by replay`, async () => {
    type Outcome = {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<ReplayRow[`id`]>
    }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<Outcome>>
    }> = []
    const collection = createCollection<ReplayRow>({
      id: `retired-initial-ordered-coverage`,
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
              const deferred = createDeferred<Outcome>()
              loads.push({ options, deferred })
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
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`value`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const visible = new Set<ReplayRow[`id`]>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        const key = change.key as ReplayRow[`id`]
        if (change.type === `delete`) visible.delete(key)
        else visible.add(key)
      }
    })
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      begin()
      write({ type: `insert`, value: { id: `one`, value: 1 } })
      commit()

      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads).toHaveLength(2)
      expect(loads[0]?.options.signal?.aborted).toBe(true)

      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      loads[1]?.deferred.resolve({
        hasMore: true,
        appliedRowKeys: [`two`],
      })
      await flushPromises()
      expect([...visible]).toEqual([])
      expect(subscription.orderedBoundaryKey).toBeUndefined()

      loads[0]?.deferred.resolve({
        hasMore: false,
        appliedRowKeys: [`one`],
      })
      await flushPromises()

      expect([...visible]).toEqual([])
      expect(subscription.orderedBoundaryKey).toBeUndefined()
    } finally {
      for (const load of loads) {
        load.deferred.resolve({ hasMore: false, appliedRowKeys: [] })
      }
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`preserves unbounded locale refinement when replaying a demand`, async () => {
    type LocaleRow = { id: string; label: string }
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<LoadSubsetOptions> = []
    const collection = createCollection<LocaleRow>({
      id: `unbounded-locale-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.label, {
      indexType: BTreeIndex,
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`label`]),
        compareOptions: {
          direction: `asc`,
          nulls: `first`,
          stringSort: `locale`,
          locale: `en-US`,
          localeOptions: { numeric: true },
        },
      },
    ]
    const subscription = collection.subscribeChanges(() => {})
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({
        orderBy,
        limit: 1,
        minValues: [`item2`],
      })
      expect(loads).toHaveLength(1)
      expect(loads[0]?.limit).toBeUndefined()
      expect(loads[0]?.offset).toBeUndefined()
      expect(loads[0]?.cursor).toBeUndefined()

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loads).toHaveLength(2)
      expect(loads[1]?.limit).toBeUndefined()
      expect(loads[1]?.offset).toBeUndefined()
      expect(loads[1]?.cursor).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`return`, `resolve`] as const)(
    `does not publish ordered coverage after reentrant snapshot release: %s`,
    async (resultKind) => {
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
      ) => void
      let commit!: () => void
      let releaseDuringLoad = () => {}
      const loads: Array<LoadSubsetOptions> = []
      const where = new Func(`eq`, [new PropRef([`value`]), new Value(1)])
      const collection = createCollection<ReplayRow>({
        id: `reentrant-ordered-release-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (loads.length === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `one`, value: 1 } })
                  commit()
                  releaseDuringLoad()
                }
                return resultKind === `return` ? true : Promise.resolve()
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`value`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const published: Array<ReplayChange> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          published.push(...changes)
        },
        { whereExpression: where },
      )
      subscription.setOrderByIndex(index)
      releaseDuringLoad = () => subscription.releaseSnapshot(where)

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()

        expect(loads).toHaveLength(1)
        expect(published).toEqual([])

        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()
        expect(loads).toHaveLength(2)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`asc`, `desc`] as const)(
    `keeps failed ordered replay deltas inside the retained top-K window: %s`,
    async (direction) => {
      type Row = { id: `a` | `b` | `z`; rank: number }
      type Outcome = {
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<Row[`id`]>
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      const replay = createDeferred<Outcome>()
      const collection = createCollection<Row>({
        id: `failed-ordered-top-k-delta-${direction}`,
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
                  write({ type: `insert`, value: { id: `a`, rank: 1 } })
                  commit()
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [`a`] as const,
                  })
                }
                return replay.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const ascendingIndex = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const index =
        direction === `asc` ? ascendingIndex : new ReverseIndex(ascendingIndex)
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction, nulls: `first` },
        },
      ]
      const visible = new Set<Row[`id`]>()
      const batches: Array<Array<Row[`id`]>> = []
      const subscription = collection.subscribeChanges((changes) => {
        batches.push(changes.map(({ key }) => key as Row[`id`]))
        for (const change of changes) {
          const key = change.key as Row[`id`]
          if (change.type === `delete`) visible.delete(key)
          else visible.add(key)
        }
      })
      subscription.setOrderByIndex(index)

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()
        expect([...visible]).toEqual([`a`])

        begin()
        truncate()
        commit()
        await flushPromises()
        replay.reject(new Error(`ordered replay failed`))
        await flushPromises()

        const batchesBeforeDelta = batches.length
        // Reconfirm the retained public row in the new source generation. This
        // must not emit a duplicate, but it makes a later source delete real.
        begin()
        write({ type: `insert`, value: { id: `a`, rank: 1 } })
        commit()
        begin()
        write({
          type: `insert`,
          value: { id: `z`, rank: direction === `asc` ? 100 : -100 },
        })
        commit()

        expect([...visible]).toEqual([`a`])
        expect(batches).toHaveLength(batchesBeforeDelta)
        expect(subscription.orderedBoundaryKey).toBe(`a`)

        begin()
        write({
          type: `insert`,
          value: { id: `b`, rank: direction === `asc` ? 0 : 2 },
        })
        commit()
        expect([...visible]).toEqual([`b`])
        expect(subscription.orderedBoundaryKey).toBe(`b`)

        begin()
        write({ type: `delete`, key: `b` })
        commit()
        expect([...visible]).toEqual([`a`])
        expect(subscription.orderedBoundaryKey).toBe(`a`)

        begin()
        write({ type: `delete`, key: `a` })
        commit()
        expect([...visible]).toEqual([`z`])
        expect(subscription.orderedBoundaryKey).toBe(`z`)

        begin()
        write({ type: `insert`, value: { id: `a`, rank: 1 } })
        commit()
        expect([...visible]).toEqual([`a`])

        subscription.ensureOrderedWindowSize(2)
        expect([...visible]).toEqual([`a`, `z`])
        expect(subscription.orderedBoundaryKey).toBe(`z`)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`retains an empty failed ordered publication across invisible deltas`, async () => {
    type Row = {
      id: `private` | `invisible`
      rank: number
      route: `visible` | `invisible`
    }
    type Outcome = {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<Row[`id`]>
    }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const replay = createDeferred<Outcome>()
    const laterLoad = createDeferred<Outcome>()
    const loadOptions: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `empty-failed-ordered-invisible-delta`,
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
              loadOptions.push(options)
              if (loadCount === 1) {
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [] as const,
                })
              }
              return loadCount === 2 ? replay.promise : laterLoad.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const where = new Func(`eq`, [new PropRef([`route`]), new Value(`visible`)])
    let publishedChangeCount = 0
    const subscription = collection.subscribeChanges(
      (changes) => {
        publishedChangeCount += changes.length
      },
      { whereExpression: where },
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      expect(publishedChangeCount).toBe(0)
      expect(subscription.orderedBoundaryKey).toBeUndefined()

      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({
        type: `insert`,
        value: { id: `private`, rank: 10, route: `visible` },
      })
      commit()
      replay.reject(new Error(`ordered replay failed`))
      await flushPromises()

      begin()
      write({
        type: `insert`,
        value: { id: `invisible`, rank: 0, route: `invisible` },
      })
      commit()

      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      expect(loadOptions).toHaveLength(3)
      expect(loadOptions[2]).toMatchObject({ offset: 0 })
      expect(loadOptions[2]?.cursor).toBeUndefined()
      expect(subscription.orderedBoundaryKey).toBeUndefined()
      expect(publishedChangeCount).toBe(0)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`reconciles failed ordered publications for coverage and sibling-demand changes`, async () => {
    type Row = { id: `a` | `x` | `y`; rank: number }
    type Outcome = {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<Row[`id`]>
    }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const replayLoads: Array<ReturnType<typeof createDeferred<Outcome>>> = []
    const collection = createCollection<Row>({
      id: `failed-ordered-sibling-demand`,
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
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`] as const,
                })
              }
              if (loadCount === 2 || loadCount > 4) {
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [] as const,
                })
              }
              const deferred = createDeferred<Outcome>()
              replayLoads.push(deferred)
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const seedSiblingWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`a`),
    ])
    const visible = new Set<Row[`id`]>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        const key = change.key as Row[`id`]
        if (change.type === `delete`) visible.delete(key)
        else visible.add(key)
      }
    })
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      subscription.requestSnapshot({ where: seedSiblingWhere })
      await flushPromises()
      expect([...visible]).toEqual([`a`])

      begin()
      truncate()
      commit()
      await flushPromises()
      expect(replayLoads).toHaveLength(2)

      begin()
      write({ type: `insert`, value: { id: `x`, rank: 100 } })
      commit()
      replayLoads[0]?.resolve({
        hasMore: false,
        appliedRowKeys: [`x`],
      })
      replayLoads[1]?.reject(new Error(`sibling replay failed`))
      await flushPromises()

      expect([...visible]).toEqual([`a`])
      expect.soft(subscription.hasOrderedCoverageForActiveWindow).toBe(false)

      const xWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`x`)])
      subscription.requestSnapshot({ where: xWhere })
      await flushPromises()
      expect([...visible].sort()).toEqual([`a`, `x`])

      subscription.releaseSnapshot(xWhere)
      expect.soft([...visible]).toEqual([`a`])

      subscription.requestSnapshot({ where: xWhere })
      await flushPromises()
      expect([...visible].sort()).toEqual([`a`, `x`])

      begin()
      write({ type: `insert`, value: { id: `y`, rank: 200 } })
      commit()
      expect.soft([...visible].sort()).toEqual([`a`, `x`])
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
      const replayLoads: Array<
        ReturnType<
          typeof createDeferred<{
            hasMore: boolean
            appliedRowKeys: Array<OrderedReplayRow[`id`]>
          }>
        >
      > = []
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
            params.markReady()
            return {
              loadSubset: (options) => {
                loadCount++
                loadOptions.push(options)
                if (loadCount === 1) {
                  const row =
                    direction === `asc`
                      ? ({ id: `one`, value: 1 } as const)
                      : ({ id: `two`, value: 2 } as const)
                  begin()
                  write({ type: `insert`, value: row })
                  commit()
                  return Promise.resolve({
                    hasMore: true,
                    appliedRowKeys: [row.id],
                  })
                }
                if (loadCount === 2) {
                  const row =
                    direction === `asc`
                      ? ({ id: `two`, value: 2 } as const)
                      : ({ id: `one`, value: 1 } as const)
                  begin()
                  write({ type: `insert`, value: row })
                  commit()
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [row.id],
                  })
                }

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

                const deferred = createDeferred<{
                  hasMore: boolean
                  appliedRowKeys: Array<OrderedReplayRow[`id`]>
                }>()
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
      const visibleIds = new Set<OrderedReplayRow[`id`]>()
      const publicationSnapshots: Array<Array<OrderedReplayRow[`id`]>> = []
      const subscription = collection.subscribeChanges((changes) => {
        batches.push(changes.map(({ value }) => value.id))
        for (const change of changes) {
          if (change.type === `delete`)
            visibleIds.delete(change.key as OrderedReplayRow[`id`])
          else visibleIds.add(change.key as OrderedReplayRow[`id`])
        }
        publicationSnapshots.push([...visibleIds].sort())
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
        await flushPromises()
        // A finite ordered result stays unpublished until the continuation
        // proves the complete boundary class used for the public-key tie-break.
        expect(batches).toEqual([])
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [direction === `asc` ? 1 : 2],
        })
        await flushPromises()
        expect(batches).toEqual([[initialIds[0]]])
        expect(loadOptions[1]).toMatchObject({
          offset: 0,
          cursor: { lastKey: initialIds[0] },
        })

        begin()
        truncate()
        commit()
        await flushPromises()
        const replayOptions = loadOptions
          .slice(2)
          .filter((options) => options.limit !== undefined)
        expectReplayRequestToRestart(replayOptions[0]!, loadOptions[0]!)
        expectReplayRequestToRestart(
          replayOptions[1]!,
          loadOptions[1]!,
          // A synchronous first replay acquisition can establish private
          // current-generation progress before the second one is rebuilt.
          delivery === `return` ? 1 : 0,
        )

        if (delivery === `resolve` || delivery === `reject`) {
          const batchesBeforeResize = batches.length
          subscription.ensureOrderedWindowSize(2)
          subscription.ensureOrderedWindowSize(1)
          expect(batches).toHaveLength(batchesBeforeResize)
        }

        if (delivery === `resolve`) {
          expect(replayLoads).toHaveLength(2)
          installReplayRows()
          replayLoads[0]?.resolve({
            hasMore: true,
            appliedRowKeys: [expectedIds[0]],
          })
          replayLoads[1]?.resolve({
            hasMore: false,
            appliedRowKeys: [expectedIds[1]],
          })
        } else if (delivery === `reject`) {
          expect(replayLoads).toHaveLength(2)
          replayLoads[0]?.reject(new Error(`ordered replay failed`))
          replayLoads[1]?.resolve({
            hasMore: false,
            appliedRowKeys: [initialIds[1]],
          })
        } else {
          expect(replayLoads).toEqual([])
        }
        await flushPromises()
        expect(collection.toArray.map(({ id }) => id).sort()).toEqual(
          succeeds ? [...expectedIds].sort() : [],
        )
        expect(publicationSnapshots).toEqual(
          delivery === `resolve`
            ? [[initialIds[0]], [...expectedIds].sort()]
            : delivery === `return` && identity === `changed`
              ? [[initialIds[0]], [expectedIds[0]]]
              : [[initialIds[0]]],
        )

        const loadCountBeforeWiden = loadOptions.length
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [direction === `asc` ? 2 : 1],
        })
        if (succeeds) {
          expect(loadOptions).toHaveLength(loadCountBeforeWiden)
        } else {
          expect(loadOptions[loadCountBeforeWiden]).toMatchObject({
            offset: 1,
            cursor: { lastKey: initialIds[0] },
          })
        }
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`resolve`, `reject`] as const)(
    `keeps an empty ordered publication private until every replay demand settles: %s`,
    async (otherOutcome) => {
      type Row = {
        id: `new-ordered`
        rank: number
        route: `ordered` | `other`
      }
      type Outcome = {
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<Row[`id`]>
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      let initialLoads = 2
      const history: Array<LoadSubsetFullFlowEvent> = [
        {
          type: `stagePublicationRows`,
          publicationId: `initial`,
          demandId: `ordered`,
          rows: [],
        },
        { type: `commitPublication`, publicationId: `initial` },
        {
          type: `requestDemand`,
          ownerId: `other-owner`,
          sessionId: `session`,
          demandId: `other`,
          alreadyAborted: false,
        },
        {
          type: `stagePublicationRows`,
          publicationId: `initial`,
          demandId: `other`,
          rows: [],
        },
        { type: `commitPublication`, publicationId: `initial` },
      ]
      const expectedBoundary = () =>
        projectAtomicOrderedPublicationState(history, {
          demandId: `ordered`,
          direction: `asc`,
          initialWindowSize: 1,
        }).currentPublication?.orderedBoundary?.key
      const replayLoads: Array<{
        options: LoadSubsetOptions
        deferred: ReturnType<typeof createDeferred<Outcome>>
      }> = []
      const collection = createCollection<Row>({
        id: `empty-ordered-replay-${otherOutcome}`,
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
                if (initialLoads > 0) {
                  initialLoads--
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [],
                  })
                }
                const deferred = createDeferred<Outcome>()
                replayLoads.push({ options, deferred })
                return deferred.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const otherWhere = new Func(`eq`, [
        new PropRef([`route`]),
        new Value(`other`),
      ])
      const visible = new Set<Row[`id`]>()
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          const key = change.key as Row[`id`]
          if (change.type === `delete`) visible.delete(key)
          else visible.add(key)
        }
      })
      subscription.setOrderByIndex(index)

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        subscription.requestSnapshot({ where: otherWhere })
        await flushPromises()
        expect([...visible]).toEqual([])
        expect(subscription.orderedBoundaryKey).toBeUndefined()

        begin()
        truncate()
        commit()
        await flushPromises()
        expect(replayLoads).toHaveLength(2)
        history.push({
          type: `beginReplacement`,
          publicationId: `replacement`,
          demandIds: [`ordered`, `other`],
        })

        const orderedReplay = replayLoads.find(({ options }) => options.orderBy)
        const otherReplay = replayLoads.find(({ options }) => !options.orderBy)
        if (!orderedReplay || !otherReplay) {
          throw new Error(`Expected ordered and additional replay demands`)
        }

        begin()
        write({
          type: `insert`,
          value: { id: `new-ordered`, rank: 1, route: `ordered` },
        })
        commit()
        history.push({
          type: `stagePublicationRows`,
          publicationId: `replacement`,
          demandId: `ordered`,
          rows: [{ key: `new-ordered`, orderValue: 1 }],
        })
        orderedReplay.deferred.resolve({
          hasMore: false,
          appliedRowKeys: [`new-ordered`],
        })
        history.push({
          type: `settleReplacement`,
          publicationId: `replacement`,
          demandId: `ordered`,
          outcome: `success`,
          extent: `exhausted`,
        })
        await flushPromises()

        expect([...visible]).toEqual([])
        expect(subscription.orderedBoundaryKey).toBe(expectedBoundary())

        if (otherOutcome === `resolve`) {
          otherReplay.deferred.resolve({
            hasMore: false,
            appliedRowKeys: [],
          })
          history.push({
            type: `settleReplacement`,
            publicationId: `replacement`,
            demandId: `other`,
            outcome: `success`,
            extent: `exhausted`,
          })
        } else {
          otherReplay.deferred.reject(new Error(`other replay failed`))
          history.push({
            type: `settleReplacement`,
            publicationId: `replacement`,
            demandId: `other`,
            outcome: `failure`,
          })
        }
        await flushPromises()

        expect([...visible]).toEqual(
          otherOutcome === `resolve` ? [`new-ordered`] : [],
        )
        expect(subscription.orderedBoundaryKey).toBe(expectedBoundary())

        if (otherOutcome === `resolve`) {
          // Fail the next generation so the changed-key publication becomes
          // the retained restoration baseline, then widen it. The request must
          // continue from the new public key and prefix.
          begin()
          truncate()
          commit()
          await flushPromises()
          const nextReplayLoads = replayLoads.slice(2)
          expect(nextReplayLoads).toHaveLength(2)
          history.push({
            type: `beginReplacement`,
            publicationId: `failed-replacement`,
            demandIds: [`ordered`, `other`],
          })
          const nextOrderedReplay = nextReplayLoads.find(
            ({ options }) => options.orderBy,
          )
          const nextOtherReplay = nextReplayLoads.find(
            ({ options }) => !options.orderBy,
          )
          if (!nextOrderedReplay || !nextOtherReplay) {
            throw new Error(`Expected the next ordered and additional replays`)
          }
          nextOrderedReplay.deferred.reject(new Error(`next replay failed`))
          history.push({
            type: `settleReplacement`,
            publicationId: `failed-replacement`,
            demandId: `ordered`,
            outcome: `failure`,
          })
          nextOtherReplay.deferred.resolve({
            hasMore: false,
            appliedRowKeys: [],
          })
          history.push({
            type: `settleReplacement`,
            publicationId: `failed-replacement`,
            demandId: `other`,
            outcome: `success`,
            extent: `exhausted`,
          })
          await flushPromises()
          expect(subscription.orderedBoundaryKey).toBe(expectedBoundary())

          const loadCountBeforeWiden = replayLoads.length
          subscription.requestLimitedSnapshot({
            orderBy,
            limit: 1,
            minValues: [1],
          })
          expect(replayLoads[loadCountBeforeWiden]?.options).toMatchObject({
            offset: 1,
            cursor: { lastKey: `new-ordered` },
          })
          replayLoads[loadCountBeforeWiden]?.deferred.resolve({
            hasMore: false,
            appliedRowKeys: [],
          })
          await flushPromises()
        }
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`publishes a same-key replacement after a failed replay`, async () => {
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

  fcTest.prop([replayScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1756,
  })(
    `matches replay and ownership laws for a fixed seed`,
    runReplayScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [replayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `matches replay and ownership laws for a random or replayed seed`,
    runReplayScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [sequentialReplayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `matches synchronous, asynchronous, and partial-failure replay laws`,
    runSequentialReplayScenario,
    generatedTimeout,
  )

  it(`releases every exact acquisition once across bounded replay completion histories`, async () => {
    for (const scenario of exhaustiveReplayCompletionScenarios) {
      await runReplayCompletionScenario(scenario)
    }
  })

  fcTest.prop([replayCompletionScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1761,
  })(
    `preserves replay completion authority for a fixed seed`,
    runReplayCompletionScenario,
  )

  fcTest.prop(
    [replayCompletionScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `preserves replay completion authority for a random or replayed seed`,
    runReplayCompletionScenario,
  )

  fcTest.prop([cleanupRestartScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1757,
  })(
    `isolates cleanup and restart sessions for a fixed seed`,
    runCleanupRestartScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [cleanupRestartScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `isolates cleanup and restart sessions for a random or replayed seed`,
    runCleanupRestartScenario,
    generatedTimeout,
  )

  fcTest.prop([sharedSubscriptionScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1758,
  })(
    `keeps shared transport and logical ownership distinct for a fixed seed`,
    runSharedSubscriptionScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [sharedSubscriptionScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `keeps shared transport and logical ownership distinct for a random or replayed seed`,
    runSharedSubscriptionScenario,
    generatedTimeout,
  )

  fcTest.prop([optimisticReplayScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1759,
  })(
    `preserves optimistic overlays across replay outcomes for a fixed seed`,
    runOptimisticReplayScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [optimisticReplayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed),
  )(
    `preserves optimistic overlays across replay outcomes for a random or replayed seed`,
    runOptimisticReplayScenario,
    generatedTimeout,
  )
})
