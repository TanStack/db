import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../src/query/subset-dedupe.js'
import { createTransaction } from '../src/transactions.js'
import { valueOrderBy } from './collection-subscription-ordered-fixture.js'
import {
  oracleFixedSeed,
  oracleRoute,
  readOracleRunConfig,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import { oracleProperty } from './oracle-property.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import { flushPromises } from './utils.js'
import {
  expectSameSubsetRequest,
  recordPublishedChanges,
  sortedChanges,
  sortedRows,
} from './collection-subscription-replay-support.js'
import type {
  ReplayChange,
  ReplayRow,
} from './collection-subscription-replay-support.js'
import type { Collection } from '../src/collection/index.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
} from '../src/types.js'
import type { Scheduler } from 'fast-check'

/**
 * # Does replay replace a source atomically under hostile timing?
 *
 * Replay rebuilds a subscription while old acquisitions, source writes,
 * optimistic state, callbacks, and cleanup may still be in flight. The public
 * snapshot must change only when the newest complete replay earns authority.
 * Older, failed, aborted, or released work may settle and release resources,
 * but it must not leak rows or overwrite a newer snapshot. A newer replay
 * aborts the older attempts' loads, and an abort ends a load (maintainer
 * decision): the newest replay does not wait for them. An `unloadSubset`
 * that throws is an adapter bug: the subscription reports it uncaught once,
 * and it is not a replay failure, so the replay continues as if the release
 * had succeeded.
 * A direct snapshot can select source rows while replay keeps publication
 * private. A later ordered local snapshot must continue after those selected
 * rows, including during subscriber callback reentry.
 *
 * Small scenario records describe source rows, logical demands, replay
 * attempts, settlement order, release points, and later source actions. Plain
 * Map-based reducers compute the expected snapshot and event batches. The
 * production driver uses real Collection subscriptions, indexes, transactions,
 * and callback reentry. It compares every intermediate publication, not only
 * the final rows.
 *
 * `collection-subscription-lifecycle-publication-oracle.property.test.ts`
 * owns the general public-row and exact-batch law. This file applies it to
 * replay-specific schedules, including same-key source changes after a failed
 * replay. The Collection `subscribeChanges` contract supplies the public
 * observation. General owner/attempt status is modeled in the lifecycle
 * grammar, and optimistic transaction semantics in the optimistic-history
 * oracle.
 */

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

// Values include -0, a distinct row value from 0 (maintainer decision,
// 2026-10-29), so a replay can replace a row that differs only by a zero's
// sign.
const replayValue = fc.oneof(fc.integer({ min: -2, max: 2 }), fc.constant(-0))

const rowArbitrary: fc.Arbitrary<ReplayRow> = fc.record({
  id: fc.constantFrom(`one` as const, `two` as const),
  value: replayValue,
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
      .option(replayValue, { nil: undefined })
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
      .tuple(fc.constantFrom(...demandIds), replayValue)
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

// Reach: replacements in which a row changed only by the sign of a zero.
let zeroSignReplacements = 0

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
    } else if (!Object.is(value.value, previousValue.value)) {
      // -0 and 0 are distinct row values.
      if (value.value === previousValue.value) zeroSignReplacements++
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

async function runReplayScenario(scenario: ReplayScenario): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  let loadCount = 0
  let unloadCount = 0
  const acquisitionCounts = new Map<
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
    oracleAssertion('existing comparison at 401', () =>
      expect(sourceWrites).toEqual(expectedSourceWrites),
    )
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
              const counts = acquisitionCounts.get(options) ?? {
                acquisitions: 0,
                releases: 0,
              }
              counts.acquisitions++
              acquisitionCounts.set(options, counts)
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
              const counts = acquisitionCounts.get(options) ?? {
                acquisitions: 0,
                releases: 0,
              }
              counts.releases++
              acquisitionCounts.set(options, counts)
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
    oracleAssertion('existing comparison at 522', () =>
      expect(sortedRows(visible)).toEqual(sortedRows(expected)),
    )
  }

  const assertSource = () => {
    const actual = rowsById(
      collection.toArray.map(({ id, value }) => ({ id, value })),
    )
    oracleAssertion('existing comparison at 529', () =>
      expect(sortedRows(actual)).toEqual(sortedRows(sourceRows)),
    )
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
    // A put of the value the source holds writes nothing; -0 is not 0.
    if (previous !== undefined && Object.is(previous.value, action.row.value))
      return false
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
    let modelReplayState:
      | {
          baseline: Map<string | number, ReplayRow>
          pending: Set<number>
          currentAttemptIndex: number
          publicationCount: number
          // The current attempt failed, even if its demand was released since.
          failed: boolean
        }
      | undefined

    // A new attempt supersedes the previous one, and its failure with it.
    // It aborts the older attempts' loads, and an abort ends a load
    // (maintainer decision): the replay no longer waits for them.
    const startModelAttempt = (
      state: NonNullable<typeof modelReplayState>,
      attemptIndex: number,
    ): void => {
      state.currentAttemptIndex = attemptIndex
      state.failed = false
      state.pending.clear()
    }

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
      oracleAssertion('existing comparison at 620', () =>
        expect(installed).toBe(isCurrent),
      )
      assertSourceWrites()
    }

    const settleReplay = async (replayIndex: number) => {
      const pending = pendingReplays[replayIndex]!
      const replayState = modelReplayState
      const load = pending.load
      const isCurrent =
        replayState !== undefined &&
        pending.attemptIndex === replayState.currentAttemptIndex &&
        activeDemandIds.has(load.demandId)
      pending.settled = true
      if (load.outcome === `resolve`) {
        writeReplayRows(pending, isCurrent)
        pending.deferred.resolve()
      } else {
        if (isCurrent) {
          lastReportedError = pending.error
          replayState.failed = true
        } else {
          oracleAssertion('existing comparison at 641', () =>
            expect(pending.signal?.aborted).toBe(true),
          )
        }
        pending.deferred.reject(pending.error)
      }
      replayState?.pending.delete(replayIndex)
      await flushPromises()
      assertSource()

      if (!replayState) {
        oracleAssertion('existing comparison at 650', () =>
          expect(subscription.status).toBe(`ready`),
        )
        assertPublished(expectedPublished)
        oracleAssertion('existing comparison at 652', () =>
          expect(subscription.lastError).toBe(lastReportedError),
        )
        return
      }

      const hasPendingReplay = replayState.pending.size > 0
      oracleAssertion('existing comparison at 657', () =>
        expect(subscription.status).toBe(
          hasPendingReplay ? `loadingSubset` : `ready`,
        ),
      )

      if (replayState.pending.size === 0) {
        const currentAttempt =
          scenario.attempts[replayState.currentAttemptIndex]!
        const currentAttemptSucceeds = currentAttempt.loads.every(
          ({ demandId, outcome }) =>
            !activeDemandIds.has(demandId) || outcome === `resolve`,
        )
        const previousPublication = new Map(expectedPublished)
        expectedPublished.clear()
        const nextRows = currentAttemptSucceeds
          ? sourceRows
          : replayState.baseline
        for (const [id, row] of nextRows) {
          expectedPublished.set(id, { ...row })
        }

        if (currentAttemptSucceeds) {
          const expectedBatch = publicationDiff(
            previousPublication,
            expectedPublished,
          )
          oracleAssertion('existing comparison at 682', () =>
            expect(publicationCount - replayState.publicationCount).toBe(
              Number(expectedBatch.length > 0),
            ),
          )
          if (expectedBatch.length > 0) {
            oracleAssertion('existing comparison at 686', () =>
              expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
                sortedChanges(expectedBatch),
              ),
            )
          }
          modelReplayState = undefined
        } else {
          oracleAssertion('existing comparison at 692', () =>
            expect(publicationCount).toBe(replayState.publicationCount),
          )
        }
        expectedPublicationCount = publicationCount
      } else {
        oracleAssertion('existing comparison at 696', () =>
          expect(publicationCount).toBe(replayState.publicationCount),
        )
      }

      assertPublished(expectedPublished)
      oracleAssertion('existing comparison at 700', () =>
        expect(subscription.lastError).toBe(lastReportedError),
      )
      oracleAssertion('existing comparison at 701', () =>
        expect(reportedErrors.at(-1)).toBe(lastReportedError),
      )
    }

    for (const [attemptIndex, attempt] of scenario.attempts.entries()) {
      modelReplayState ??= {
        baseline: new Map(expectedPublished),
        pending: new Set(),
        currentAttemptIndex: attemptIndex,
        publicationCount: expectedPublicationCount,
        failed: false,
      }
      startModelAttempt(modelReplayState, attemptIndex)

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
        modelReplayState.pending.add(replayIndex)
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
        subscription.releaseSnapshot(demandWheres.get(releasedDemand)!)
        activeDemandIds.delete(releasedDemand)
        for (const replayIndex of modelReplayState.pending) {
          if (pendingReplays[replayIndex]?.load.demandId === releasedDemand) {
            modelReplayState.pending.delete(replayIndex)
          }
        }
        // A released request does not retract rows already applied by the
        // source. Releasing the final demand retires the replay: one that has
        // not failed publishes the rows the source applied, since nothing can
        // complete it; a failed one keeps the retained baseline (law 9).
        if (modelReplayState.pending.size === 0 && activeDemandIds.size === 0) {
          if (!modelReplayState.failed) {
            const previousPublication = new Map(expectedPublished)
            expectedPublished.clear()
            for (const [id, row] of sourceRows) {
              expectedPublished.set(id, { ...row })
            }
            const expectedBatch = publicationDiff(
              previousPublication,
              expectedPublished,
            )
            const priorPublicationCount = modelReplayState.publicationCount
            oracleAssertion('existing comparison at 761', () =>
              expect(publicationCount - priorPublicationCount).toBe(
                Number(expectedBatch.length > 0),
              ),
            )
            if (expectedBatch.length > 0) {
              oracleAssertion('existing comparison at 765', () =>
                expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
                  sortedChanges(expectedBatch),
                ),
              )
            }
          }
          expectedPublicationCount = publicationCount
          modelReplayState = undefined
        }
      }
      assertSource()
      assertPublished(expectedPublished)
      oracleAssertion('existing comparison at 776', () =>
        expect(publicationCount).toBe(
          modelReplayState?.publicationCount ?? expectedPublicationCount,
        ),
      )
      oracleAssertion('existing comparison at 779', () =>
        expect(subscription.lastError).toBe(lastReportedError),
      )
      oracleAssertion('existing comparison at 780', () =>
        expect(subscription.status).toBe(
          modelReplayState && modelReplayState.pending.size > 0
            ? `loadingSubset`
            : `ready`,
        ),
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

    oracleAssertion('existing comparison at 798', () =>
      expect(modelReplayState?.pending.size ?? 0).toBe(0),
    )

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
        if (!modelReplayState && row) {
          expectedPublished.set(action.demandId, { ...row })
        }
      }
      const applied = applySourceAction(action)
      if (applied && action.type === `delete`) {
        if (!modelReplayState) expectedPublished.delete(action.id)
      } else if (applied && action.type === `put`) {
        recordExpectedSourceWrite([action.row], { type: `ordinary` }, true)
        assertSourceWrites()
        if (!modelReplayState) {
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
        !modelReplayState &&
        (action.type === `request` || expectedBatch.length > 0)
      oracleAssertion('existing comparison at 834', () =>
        expect(publicationCount).toBe(
          countBeforeAction + Number(expectsPublication),
        ),
      )
      if (expectsPublication) {
        oracleAssertion('existing comparison at 838', () =>
          expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
            sortedChanges(expectedBatch),
          ),
        )
      }
    }

    subscription.unsubscribe()
    unsubscribed = true
    oracleAssertion('existing comparison at 846', () =>
      expect(unloadCount).toBe(loadCount),
    )
    for (const counts of acquisitionCounts.values()) {
      oracleAssertion('existing comparison at 848', () =>
        expect(counts).toEqual({ acquisitions: 1, releases: 1 }),
      )
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
  const acquisitionCounts = new Map<
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
              acquisitionCounts.set(options, {
                acquisitions: 1,
                releases: 0,
              })
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
            // A throw is a rejection (maintainer decision): an acquisition
            // that core releases.
            acquisitionCounts.set(options, {
              acquisitions: 1,
              releases: 0,
            })
            if (load.outcome === `throw`) {
              throw error
            }
            if (load.outcome === `return`) return true
            const deferred = createDeferred<void>()
            pending.push({ load, deferred, error })
            return deferred.promise
          },
          unloadSubset: (options) => {
            const counts = acquisitionCounts.get(options)
            if (!counts) {
              throw new Error(`Released an acquisition that never returned`)
            }
            counts.releases++
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
      oracleAssertion('existing comparison at 1008', () =>
        expect(publicationCount - publicationBefore).toBe(
          Number(expectedBatch.length > 0),
        ),
      )
      if (expectedBatch.length > 0) {
        oracleAssertion('existing comparison at 1012', () =>
          expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
            sortedChanges(expectedBatch),
          ),
        )
      }
      oracleAssertion('existing comparison at 1016', () =>
        expect(sortedRows(visible)).toEqual(sortedRows(expectedPublished)),
      )
      oracleAssertion('existing comparison at 1017', () =>
        expect(
          sortedRows(
            rowsById(
              collection.toArray.map(({ id, value }) => ({ id, value })),
            ),
          ),
        ).toEqual(sortedRows(sourceRows)),
      )
      oracleAssertion('existing comparison at 1022', () =>
        expect(subscription.status).toBe(`ready`),
      )
      oracleAssertion('existing comparison at 1023', () =>
        expect(subscription.lastError).toBe(expectedLastError),
      )
      oracleAssertion('existing comparison at 1024', () =>
        expect(reportedErrors.at(-1)).toBe(expectedLastError),
      )
    }

    subscription.unsubscribe()
    unsubscribed = true
    for (const counts of acquisitionCounts.values()) {
      oracleAssertion('existing comparison at 1030', () =>
        expect(counts).toEqual({ acquisitions: 1, releases: 1 }),
      )
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
  const syncRuns: Array<{
    begin: () => void
    write: (message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>) => void
    commit: () => void
  }> = []
  const loads: Array<{
    syncRunGeneration: number
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []
  let nextSyncRunGeneration = 0
  const collection = createCollection<ReplayRow>({
    id: `cleanup-restart-oracle`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const syncRunGeneration = nextSyncRunGeneration++
        syncRuns.push({ begin, write, commit })
        markReady()
        return {
          loadSubset: () => {
            const deferred = createDeferred<void>()
            loads.push({ syncRunGeneration, deferred })
            return deferred.promise
          },
        }
      },
    },
  })

  const settle = async (loadIndex: number, outcome: `resolve` | `reject`) => {
    const load = loads[loadIndex]!
    if (outcome === `resolve`) load.deferred.resolve()
    else {
      load.deferred.reject(
        new Error(`sync run ${load.syncRunGeneration} failed`),
      )
    }
    await flushPromises()
  }

  try {
    const oldResult = collection._sync.loadSubset({})
    oracleAssertion('existing comparison at 1087', () =>
      expect(oldResult).toBeInstanceOf(Promise),
    )
    if (oldResult instanceof Promise) void oldResult.catch(() => {})
    oracleAssertion('existing comparison at 1089', () =>
      expect(collection.isLoadingSubset).toBe(true),
    )

    await collection.cleanup()
    oracleAssertion('existing comparison at 1092', () =>
      expect(collection.isLoadingSubset).toBe(false),
    )

    collection.startSyncImmediate()
    const newResult = collection._sync.loadSubset({})
    oracleAssertion('existing comparison at 1096', () =>
      expect(newResult).toBeInstanceOf(Promise),
    )
    if (newResult instanceof Promise) void newResult.catch(() => {})
    oracleAssertion('existing comparison at 1098', () =>
      expect(loads.map(({ syncRunGeneration }) => syncRunGeneration)).toEqual([
        0, 1,
      ]),
    )
    oracleAssertion('existing comparison at 1101', () =>
      expect(collection.isLoadingSubset).toBe(true),
    )

    const oldSyncRun = syncRuns[0]!
    oldSyncRun.begin()
    oldSyncRun.write({ type: `insert`, value: { id: `one`, value: 1 } })
    oldSyncRun.commit()
    oracleAssertion('existing comparison at 1107', () =>
      expect(collection.toArray).toEqual([]),
    )

    const currentSyncRun = syncRuns[1]!
    currentSyncRun.begin()
    currentSyncRun.write({ type: `insert`, value: { id: `two`, value: 2 } })
    currentSyncRun.commit()
    oracleAssertion('existing comparison at 1113', () =>
      expect(
        collection.toArray.map(({ id, value }) => ({ id, value })),
      ).toEqual([{ id: `two`, value: 2 }]),
    )

    const settlementOrder = scenario.settleOldFirst ? [0, 1] : [1, 0]
    const outcomes = [scenario.oldOutcome, scenario.newOutcome] as const
    let newSettled = false
    for (const loadIndex of settlementOrder) {
      await settle(loadIndex, outcomes[loadIndex]!)
      if (loadIndex === 1) newSettled = true
      oracleAssertion('existing comparison at 1123', () =>
        expect(collection.isLoadingSubset).toBe(!newSettled),
      )
      oracleAssertion('existing comparison at 1124', () =>
        expect(
          collection.toArray.map(({ id, value }) => ({ id, value })),
        ).toEqual([{ id: `two`, value: 2 }]),
      )
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
            const replayAttemptGeneration = loads.length + 1
            const outcome = scheduler
              .schedule(
                Promise.resolve(),
                `replay-attempt-${replayAttemptGeneration}`,
              )
              .then(() => {
                if (signal?.aborted) return
                begin()
                write({
                  type: `insert`,
                  value: { id: `one`, value: replayAttemptGeneration },
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

    oracleAssertion('existing comparison at 1196', () =>
      expect(loads).toHaveLength(2),
    )
    oracleAssertion('existing comparison at 1197', () =>
      expect(loads[0]!.signal?.aborted).toBe(true),
    )

    await scheduler.waitAll()
    await Promise.all(loads.map(({ outcome }) => outcome))
    await flushPromises()

    oracleAssertion('existing comparison at 1203', () =>
      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 2 }]),
    )
    oracleAssertion('existing comparison at 1204', () =>
      expect(subscription.status).toBe(`ready`),
    )
    oracleAssertion('existing comparison at 1205', () =>
      expect(subscription.lastError).toBeUndefined(),
    )
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
    oracleAssertion('existing comparison at 1274', () =>
      expect(transportOptions).toHaveLength(2),
    )
    oracleAssertion('existing comparison at 1275', () =>
      expect(subscriptions[0].status).toBe(`loadingSubset`),
    )
    oracleAssertion('existing comparison at 1276', () =>
      expect(subscriptions[1].status).toBe(`loadingSubset`),
    )

    if (scenario.releaseCountBeforeSettlement >= 1) {
      subscriptions[0].unsubscribe()
      firstUnsubscribed = true
      oracleAssertion('existing comparison at 1281', () =>
        expect(transportOptions[0]?.signal?.aborted).toBe(true),
      )
      oracleAssertion('existing comparison at 1282', () =>
        expect(transportOptions[1]?.signal?.aborted).toBe(false),
      )
    }
    if (scenario.releaseCountBeforeSettlement === 2) {
      subscriptions[1].unsubscribe()
      secondUnsubscribed = true
      oracleAssertion('existing comparison at 1287', () =>
        expect(transportOptions[1]?.signal?.aborted).toBe(true),
      )
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
      oracleAssertion('existing comparison at 1310', () =>
        expect(subscriptions[1].status).toBe(`ready`),
      )
      oracleAssertion('existing comparison at 1311', () =>
        expect(subscriptions[1].lastError).toBe(
          scenario.outcome === `reject` ? failure : undefined,
        ),
      )
      oracleAssertion('existing comparison at 1314', () =>
        expect([...visible[1].values()]).toEqual(
          scenario.outcome === `resolve` ? [{ id: `one`, value: 1 }] : [],
        ),
      )
    } else {
      oracleAssertion('existing comparison at 1318', () =>
        expect(subscriptions[1].lastError).toBeUndefined(),
      )
      oracleAssertion('existing comparison at 1319', () =>
        expect([...visible[1].values()]).toEqual([]),
      )
    }
    if (firstUnsubscribed) {
      oracleAssertion('existing comparison at 1322', () =>
        expect(subscriptions[0].lastError).toBeUndefined(),
      )
    } else {
      oracleAssertion('existing comparison at 1324', () =>
        expect(subscriptions[0].lastError).toBe(
          scenario.outcome === `reject` ? failure : undefined,
        ),
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
    oracleAssertion('existing comparison at 1337', () =>
      expect(unloads).toHaveLength(2),
    )
    oracleAssertion('existing comparison at 1338', () =>
      expect(new Set(unloads).size).toBe(2),
    )
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
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => true | Promise<void>
  let replayReceipt: true | Promise<void> = true
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
            // The load settles after its rows are visible.
            return replay.promise.then(async () => {
              await replayReceipt
            })
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
  void transaction.when(`settled`).catch(() => {})
  let unsubscribed = false

  try {
    subscription.requestSnapshot({ optimizedOnly: false })
    oracleAssertion('existing comparison at 1437', () =>
      expect(sortedRows(visible)).toEqual(sortedRows(initialSource)),
    )

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
    oracleAssertion('existing comparison at 1451', () =>
      expect(sortedRows(visible)).toEqual(sortedRows(optimisticBaseline)),
    )
    oracleAssertion('existing comparison at 1452', () =>
      expect(
        sortedRows(
          rowsById(collection.toArray.map(({ id, value }) => ({ id, value }))),
        ),
      ).toEqual(sortedRows(optimisticBaseline)),
    )
    batches.length = 0

    begin()
    truncate()
    commit()
    await flushPromises()
    // A loadSubset adapter commits its request-scoped rows before its
    // promise settles. The persisting mutation holds them; they publish with
    // the drop of its optimistic state when it settles.
    begin()
    for (const row of replayRows) {
      write({ type: `insert`, value: { ...row } })
    }
    replayReceipt = commit()
    if (scenario.outcome === `resolve`) replay.resolve()
    else replay.reject(replayFailure)
    await flushPromises()
    mutation.resolve()
    await transaction.when(`settled`)
    await flushPromises()
    await flushPromises()

    // A failed replay leaves the subscription at its last coherent snapshot.
    const expected =
      scenario.outcome === `resolve` ? replaySource : optimisticBaseline
    const expectedBatch =
      scenario.outcome === `resolve`
        ? publicationDiff(optimisticBaseline, expected)
        : []
    oracleAssertion('existing comparison at 1486', () =>
      expect(sortedRows(visible)).toEqual(sortedRows(expected)),
    )
    oracleAssertion('existing comparison at 1487', () =>
      expect(batches.map(sortedChanges)).toEqual(
        expectedBatch.length > 0 ? [sortedChanges(expectedBatch)] : [],
      ),
    )
    oracleAssertion('existing comparison at 1490', () =>
      expect(subscription.lastError).toBe(
        scenario.outcome === `reject` ? replayFailure : undefined,
      ),
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

const { multiplier } = readOracleRunConfig()
const generatedRuns = 30 * multiplier

/**
 * The filtered-replay model. Replay replaces every source row that the callback
 * mirror does not show, as one insert batch, and the next ordered row is the
 * first value of at least 1 that replay did not select privately.
 */
function predictFilteredReplay(
  rows: ReadonlyArray<{ id: string; value: number }>,
  initialPublicRows: ReadonlyMap<string, { id: string; value: number }>,
  privatelySelected: ReadonlySet<string>,
): {
  nextOrdered: { id: string; value: number } | undefined
  replacement: Array<string>
} {
  const nextOrdered = rows
    .filter(({ value }) => value >= 1)
    .sort((left, right) => left.value - right.value)
    .find(({ id }) => !privatelySelected.has(id))
  const replacement = rows
    .filter(({ id }) => !initialPublicRows.has(id))
    .map(({ id }) => `insert:${id}`)
  return { nextOrdered, replacement }
}

declareOracle({
  check: [
    runReplayScenario,
    runSequentialReplayScenario,
    runCleanupRestartScenario,
    expectScheduledReplaySettlementIsGenerationSafe,
    runSharedSubscriptionScenario,
    runOptimisticReplayScenario,
  ],
  model: [publicationDiff, predictFilteredReplay],
  grammar: [
    replayScenarioArbitrary,
    sequentialReplayScenarioArbitrary,
    cleanupRestartScenarioArbitrary,
    sharedSubscriptionScenarioArbitrary,
    optimisticReplayScenarioArbitrary,
  ],
})

describe(`CollectionSubscription replay oracle`, () => {
  it(`generates shared, failed, stale, released, and post-replay histories`, () => {
    oracleRoute(`fixed seed`)
    const scenarios = fc.sample(
      replayScenarioArbitrary,
      oracleFixedSeed(1755, { numRuns: 300 }),
    )

    oracleAssertion('existing comparison at 1561', () =>
      expect(scenarios.some(({ demandIds }) => demandIds.length > 1)).toBe(
        true,
      ),
    )
    oracleAssertion('existing comparison at 1562', () =>
      expect(scenarios.some(({ attempts }) => attempts.length > 1)).toBe(true),
    )
    oracleAssertion('existing comparison at 1563', () =>
      expect(
        scenarios.some(({ attempts }) =>
          attempts.some(({ loads }) =>
            loads.some(({ outcome }) => outcome === `reject`),
          ),
        ),
      ).toBe(true),
    )
    oracleAssertion('existing comparison at 1570', () =>
      expect(
        scenarios.some(({ attempts }) =>
          attempts.some(({ loads }) =>
            loads.some(({ writeBeforeSettlement }) => writeBeforeSettlement),
          ),
        ),
      ).toBe(true),
    )
    oracleAssertion('existing comparison at 1577', () =>
      expect(
        scenarios.some(({ settlementOrder }) =>
          settlementOrder.some((value, index) => value !== index),
        ),
      ).toBe(true),
    )
    oracleAssertion('existing comparison at 1582', () =>
      expect(
        scenarios.some(({ releaseOnLastAttempt }) =>
          Boolean(releaseOnLastAttempt),
        ),
      ).toBe(true),
    )
    oracleAssertion('existing comparison at 1587', () =>
      expect(
        scenarios.some(({ afterSettlement }) => afterSettlement.length > 0),
      ).toBe(true),
    )
    oracleAssertion('existing comparison at 1590', () =>
      expect(
        scenarios.some(({ afterSettlement }) =>
          afterSettlement.some(({ type }) => type === `request`),
        ),
      ).toBe(true),
    )
  })

  // A snapshot chosen while a direct truncate replay is pending enters the
  // private replacement, not the callback mirror. Its key still excludes that
  // row from the next ordered local selection. An earlier subscriber's callback
  // is a legal reentry cut: it can read the source replacement before this
  // subscriber receives the same source transaction.
  it(`continues after a privately selected filtered snapshot during callback reentry`, async () => {
    oracleRoute(`fixed history`)
    type Row = { id: string; value: number }
    const rows: Array<Row> = [
      { id: `one`, value: 1 },
      { id: `two`, value: 2 },
      { id: `three`, value: 3 },
    ]
    // The model separates a callback-visible row from rows selected locally
    // during replay. Neither all source rows nor the callback mirror determines
    // the next choice; only the filtered snapshot selected `one` here.
    const privatelySelected = new Set(
      rows.filter(({ id }) => id === `one`).map(({ id }) => id),
    )
    const initialPublicRows = new Map<string, Row>([[`one`, rows[0]!]])
    const { nextOrdered, replacement: expectedReplacement } =
      predictFilteredReplay(rows, initialPublicRows, privatelySelected)
    const publicRows = new Map<string, Row>()

    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    const heldReplay = createDeferred<void>()
    const loadOptions: Array<LoadSubsetOptions> = []
    let holdReplayRequest = false
    let heldRequestCount = 0
    const collection = createCollection<Row>({
      id: `ordered-replay-mixed-snapshot-reentry`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          begin()
          for (const value of rows) write({ type: `insert`, value })
          commit()
          params.markReady()
          return {
            loadSubset: (options) => {
              loadOptions.push(options)
              if (
                holdReplayRequest &&
                options.orderBy !== undefined &&
                options.offset === 0 &&
                options.cursor === undefined
              ) {
                holdReplayRequest = false
                heldRequestCount++
                return heldReplay.promise
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.value, {
      indexType: BTreeIndex,
    })
    const orderBy = valueOrderBy()
    const whereOne = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const batches: Array<Array<string>> = []
    const invalidChanges: Array<string> = []
    let armed = false
    let reentered = false
    const trigger = collection.subscribeChanges(
      (changes) => {
        if (!armed || !changes.some(({ type }) => type === `insert`)) return
        armed = false
        reentered = true
        target.requestSnapshot({ where: whereOne })
        target.requestLimitedSnapshot({ orderBy, limit: 1 })
      },
      { includeInitialState: false },
    )
    const target = collection.subscribeChanges((changes) => {
      if (changes.length === 0) return
      const batch: Array<string> = []
      for (const change of changes) {
        batch.push(`${change.type}:${change.key}`)
        if (change.type === `insert`) {
          if (publicRows.has(String(change.key)))
            invalidChanges.push(`duplicate insert:${change.key}`)
          publicRows.set(String(change.key), change.value)
        } else if (change.type === `delete`) {
          publicRows.delete(String(change.key))
        } else {
          publicRows.set(String(change.key), change.value)
        }
      }
      batches.push(batch)
    })
    target.setOrderByIndex(index)
    try {
      target.requestLimitedSnapshot({ orderBy, limit: 1 })
      oracleAssertion('existing comparison at 1702', () =>
        expect(batches).toEqual([[`insert:one`]]),
      )
      batches.length = 0

      target.requestSnapshot({
        where: new Func(`eq`, [new PropRef([`id`]), new Value(`missing`)]),
      })
      holdReplayRequest = true
      begin()
      truncate()
      commit()
      await flushPromises()
      oracleAssertion('existing comparison at 1713', () =>
        expect(heldRequestCount).toBe(1),
      )

      armed = true
      begin()
      for (const value of rows) write({ type: `insert`, value })
      commit()
      await flushPromises()

      oracleAssertion('existing comparison at 1721', () =>
        expect(reentered).toBe(true),
      )
      oracleAssertion('existing comparison at 1722', () =>
        expect(batches).toEqual([]),
      )
      oracleAssertion('existing comparison at 1723', () =>
        expect(loadOptions.at(-1)).toMatchObject({ offset: 0 }),
      )
      oracleAssertion('existing comparison at 1724', () =>
        expect(loadOptions.at(-1)?.limit).toBeGreaterThanOrEqual(
          1 + privatelySelected.size + Number(nextOrdered !== undefined),
        ),
      )
      oracleAssertion('existing comparison at 1727', () =>
        expect(loadOptions.at(-1)?.cursor?.lastKey).toBeUndefined(),
      )
      heldReplay.resolve()
      await flushPromises()
      oracleAssertion('existing comparison at 1730', () =>
        expect(batches.map((batch) => [...batch].sort())).toEqual([
          expectedReplacement.sort(),
        ]),
      )
      oracleAssertion('existing comparison at 1733', () =>
        expect(invalidChanges).toEqual([]),
      )
      oracleAssertion('existing comparison at 1734', () =>
        expect([...publicRows.keys()].sort()).toEqual(
          rows.map(({ id }) => id).sort(),
        ),
      )
    } finally {
      heldReplay.resolve()
      trigger.unsubscribe()
      target.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps private row tracking through consecutive failed replays`, async () => {
    oracleRoute(`fixed history`)
    await runReplayScenario({
      initialRows: [
        { id: `one`, value: -2 },
        { id: `two`, value: 0 },
      ],
      demandIds: [`two`],
      attempts: [
        {
          loads: [
            {
              demandId: `two`,
              rows: [],
              outcome: `reject`,
              writeBeforeSettlement: true,
            },
          ],
        },
        {
          loads: [
            {
              demandId: `two`,
              rows: [],
              outcome: `reject`,
              writeBeforeSettlement: true,
            },
          ],
        },
        {
          loads: [
            {
              demandId: `two`,
              rows: [{ id: `two`, value: -2 }],
              outcome: `resolve`,
              writeBeforeSettlement: true,
            },
          ],
        },
      ],
      settlementOrder: [0, 2, 1],
      settlementPhases: [0, 1, 2],
      afterSettlement: [],
    })
  })

  it(`retains a successful retry after retiring its failed peer`, async () => {
    oracleRoute(`fixed history`)
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
              writeBeforeSettlement: false,
            },
            {
              demandId: `two`,
              rows: [{ id: `two`, value: -1 }],
              outcome: `reject`,
              writeBeforeSettlement: false,
            },
          ],
        },
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 2 }],
              outcome: `reject`,
              writeBeforeSettlement: true,
            },
            {
              demandId: `two`,
              rows: [{ id: `two`, value: 1 }],
              outcome: `resolve`,
              writeBeforeSettlement: false,
            },
          ],
        },
      ],
      settlementOrder: [3, 1, 0, 2],
      settlementPhases: [0, 0, 1, 1],
      releaseOnLastAttempt: `one`,
      afterSettlement: [{ type: `request`, demandId: `one` }],
    })
  })

  it(`does not republish an identical snapshot after a synchronous replay failure`, async () => {
    oracleRoute(`fixed history`)
    await runSequentialReplayScenario({
      initialRows: [{ id: `one`, value: 0 }],
      loads: [
        { rows: [], outcome: `throw` },
        { rows: [{ id: `one`, value: 0 }], outcome: `return` },
      ],
    })
  })

  it(`keeps a same-key source replacement private after a failed replay`, async () => {
    oracleRoute(`fixed history`)
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
    oracleRoute(`fixed history`)
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
    oracleRoute(`fixed history`)
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
    oracleRoute(`fixed history`)
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
    oracleRoute(`fixed history`)
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
    oracleRoute(`fixed history`)
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

  it(`retains applied rows after their replay demand is released`, async () => {
    oracleRoute(`fixed history`)
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

  it(`refreshes a retained row when its final released demand is reacquired`, async () => {
    oracleRoute(`fixed history`)
    // Reduced from the fixed replay corpus after removing release-time pruning.
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
              writeBeforeSettlement: true,
            },
          ],
        },
      ],
      settlementOrder: [0],
      settlementPhases: [0],
      releaseOnLastAttempt: `one`,
      afterSettlement: [{ type: `request`, demandId: `one` }],
    })
  })

  it(`replaces a retained snapshot with a later empty replay`, async () => {
    oracleRoute(`fixed history`)
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

  // The fixed campaign's histories reach a replacement that changes a row
  // only by a zero's sign, where a diff without signed zeros publishes
  // nothing.
  it(`reaches a zero-sign replacement in the fixed campaign`, async () => {
    oracleRoute(`fixed seed`)
    zeroSignReplacements = 0
    for (const scenario of fc.sample(
      replayScenarioArbitrary,
      oracleFixedSeed(1756, { numRuns: generatedRuns }),
    )) {
      await runReplayScenario(scenario)
    }
    oracleAssertion('existing comparison at 2105', () =>
      expect(zeroSignReplacements).toBeGreaterThan(0),
    )
  })
})

// The existing independent helper retains its model and comparison checkpoints.
oracleProperty({
  id: `subscription-replay.completion`,
  law: {
    statement: `Replay publication is atomic and obsolete work cannot publish.`,
    authority: `Collection subscribeChanges contract; the replay and cleanup laws stated above`,
    limits: `The existing bounded scenario grammar and its public-row, error, readiness, and event checkpoints; no additional histories are claimed.`,
  },
  // What this oracle owns: the gap report judges every function in
  // collection/subscription.ts by this file's replay histories.
  owns: [`src/collection/subscription.ts`],
  histories: {
    arbitrary: replayScenarioArbitrary,
    runs: 30,
    fixedSeeds: [1756],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `Replay publication is atomic and obsolete work cannot publish.`,
      plan,
      observe,
      () => runReplayScenario(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// The existing independent helper retains its model and comparison checkpoints.
oracleProperty({
  id: `subscription-replay.sequential`,
  law: {
    statement: `Synchronous, asynchronous, and partially failed replays preserve the last complete snapshot.`,
    authority: `Collection subscribeChanges contract; the replay and cleanup laws stated above`,
    limits: `The existing bounded scenario grammar and its public-row, error, readiness, and event checkpoints; no additional histories are claimed.`,
  },
  owns: [`src/collection/subscription.ts`],
  histories: {
    arbitrary: sequentialReplayScenarioArbitrary,
    runs: 30,
    fixedSeeds: [1761],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `Synchronous, asynchronous, and partially failed replays preserve the last complete snapshot.`,
      plan,
      observe,
      () => runSequentialReplayScenario(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// The existing independent helper retains its model and comparison checkpoints.
oracleProperty({
  id: `subscription-replay.restart`,
  law: {
    statement: `Cleanup retires the sync run and its obsolete replay work.`,
    authority: `Collection subscribeChanges contract; the replay and cleanup laws stated above`,
    limits: `The existing bounded scenario grammar and its public-row, error, readiness, and event checkpoints; no additional histories are claimed.`,
  },
  owns: [`src/collection/subscription.ts`],
  histories: {
    arbitrary: cleanupRestartScenarioArbitrary,
    runs: 30,
    fixedSeeds: [1757],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `Cleanup retires the sync run and its obsolete replay work.`,
      plan,
      observe,
      () => runCleanupRestartScenario(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// The existing independent helper retains its model and comparison checkpoints.
oracleProperty({
  id: `subscription-replay.same-tick`,
  law: {
    statement: `Same-tick obsolete replay settlement cannot overwrite the current replay.`,
    authority: `Collection subscribeChanges contract; the replay and cleanup laws stated above`,
    limits: `The existing bounded scenario grammar and its public-row, error, readiness, and event checkpoints; no additional histories are claimed.`,
  },
  owns: [`src/collection/subscription.ts`],
  histories: { arbitrary: fc.scheduler(), runs: 30, fixedSeeds: [1760] },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `Same-tick obsolete replay settlement cannot overwrite the current replay.`,
      plan,
      observe,
      () =>
        expectScheduledReplaySettlementIsGenerationSafe(
          fc.cloneIfNeeded(plan.history),
        ),
    ),
  check: forwardAssertionJudgment,
})

// The existing independent helper retains its model and comparison checkpoints.
oracleProperty({
  id: `subscription-replay.shared`,
  law: {
    statement: `Physical transport sharing preserves independent logical ownership.`,
    authority: `Collection subscribeChanges contract; the replay and cleanup laws stated above`,
    limits: `The existing bounded scenario grammar and its public-row, error, readiness, and event checkpoints; no additional histories are claimed.`,
  },
  owns: [`src/collection/subscription.ts`],
  histories: {
    arbitrary: sharedSubscriptionScenarioArbitrary,
    runs: 30,
    fixedSeeds: [1758],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `Physical transport sharing preserves independent logical ownership.`,
      plan,
      observe,
      () => runSharedSubscriptionScenario(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// The existing independent helper retains its model and comparison checkpoints.
oracleProperty({
  id: `subscription-replay.optimistic`,
  law: {
    statement: `Replay preserves optimistic overlays until their existing settlement checkpoint.`,
    authority: `Collection subscribeChanges contract; the replay and cleanup laws stated above`,
    limits: `The existing bounded scenario grammar and its public-row, error, readiness, and event checkpoints; no additional histories are claimed.`,
  },
  owns: [`src/collection/subscription.ts`],
  histories: {
    arbitrary: optimisticReplayScenarioArbitrary,
    runs: 30,
    fixedSeeds: [1759],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `Replay preserves optimistic overlays until their existing settlement checkpoint.`,
      plan,
      observe,
      () => runOptimisticReplayScenario(plan.history),
    ),
  check: forwardAssertionJudgment,
})
