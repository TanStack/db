import { fc } from '@fast-check/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import {
  captureMicrotaskErrors,
  createOnDemandCollection,
  flushPromises,
} from './utils.js'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleRoute,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import { oracleProperty } from './oracle-property.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import {
  modelSubscriberResumeRetirement,
  modelSubscriberStartCleanup,
  subscriberResumeRetirementHistories,
  subscriberStartCleanupHistories,
} from './collection-subscription-lifecycle-grammar-oracle.js'
import {
  acquisitionCellDefinitions,
  acquisitionEntries,
  acquisitionInteractionCauses,
  acquisitionInteractionCellDefinitions,
  acquisitionLifecycleStates,
  acquisitionPhases,
  excludedAcquisitionCells,
  failureScenarios,
  legalAcquisitionCells,
  releaseScenarios,
  restartScenarios,
  startOutcomes,
  startReentries,
  startScenarios,
} from './collection-subscription-lifecycle-cell-support.js'
import type {
  AcquisitionCell,
  AcquisitionInteractionCell,
} from './collection-subscription-lifecycle-cell-support.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'

/**
 * This is the boundary matrix for subscription acquisition and retirement.
 *
 * The model is a product of a small acquisition lifecycle state, logical owners,
 * sync run, and callback entry point. The explicit cell table names every
 * legal phase/entry pair and gives a reason for every excluded pair. Scenario
 * drivers then add sync return/throw/resolve/reject, abort, release, peer loss,
 * unsubscribe, cleanup, restart, and reentry in controlled orders.
 *
 * The cell witnesses live in collection-subscription-lifecycle-cells.test.ts.
 * Each case there declares the cells it may reach, and the coverage audit in
 * that file fails if a legal cell was never observed. This file keeps the
 * grammar calibrations, the model checks, and the generated properties that
 * run the scenario drivers. Counts, signals, errors, readiness, owners, and
 * rows are checked separately.
 *
 * Release law: an `unloadSubset` that throws is an adapter bug. The
 * subscription attempts each physical release once and reports its error
 * uncaught, once, with the adapter's identity. The error fails nothing: the
 * call that released does not throw it, `lastError` and `loadSubset:error` do
 * not record it, and logical demand still retires. `failed-release` therefore
 * means "attempted once; never retried", not "failed the caller". This suite is the
 * exhaustive boundary companion to the generated lifecycle histories, not a
 * second copy of their transition implementation.
 */

const threeGenerationScenarios = ([`resolve`, `reject`] as const).flatMap(
  (obsoleteOutcome) =>
    ([`resolve`, `reject`] as const).flatMap((currentOutcome) =>
      ([`obsolete-first`, `current-first`] as const).map((settlementOrder) => ({
        obsoleteOutcome,
        currentOutcome,
        settlementOrder,
      })),
    ),
)

type AsyncRestartScenario = {
  demands: ReadonlyArray<`a` | `b`>
  syncRunOutcomes: ReadonlyArray<ReadonlyArray<`resolve` | `reject`>>
  settlementOrder: `obsolete-first` | `current-first` | `interleaved`
}

const asyncRestartCoverageScenarios = [
  {
    demands: [`a`],
    syncRunOutcomes: [[`reject`]],
    settlementOrder: `current-first`,
  },
  {
    demands: [`a`],
    syncRunOutcomes: [[`resolve`], [`resolve`]],
    settlementOrder: `obsolete-first`,
  },
  {
    demands: [`a`, `b`],
    syncRunOutcomes: [
      [`reject`, `resolve`],
      [`resolve`, `reject`],
    ],
    settlementOrder: `current-first`,
  },
  {
    demands: [`a`, `b`],
    syncRunOutcomes: [
      [`resolve`, `resolve`],
      [`reject`, `reject`],
      [`resolve`, `resolve`],
    ],
    settlementOrder: `interleaved`,
  },
] as const satisfies ReadonlyArray<AsyncRestartScenario>

const asyncRestartScenarioArbitrary: fc.Arbitrary<AsyncRestartScenario> = fc
  .uniqueArray(fc.constantFrom(`a` as const, `b` as const), {
    minLength: 1,
    maxLength: 2,
  })
  .chain((demands) =>
    fc.record({
      demands: fc.constant(demands),
      syncRunOutcomes: fc.array(
        fc.array(fc.constantFrom(`resolve` as const, `reject` as const), {
          minLength: demands.length,
          maxLength: demands.length,
        }),
        { minLength: 1, maxLength: 3 },
      ),
      settlementOrder: fc.constantFrom(
        `obsolete-first` as const,
        `current-first` as const,
        `interleaved` as const,
      ),
    }),
  )

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    asyncRestartScenarioArbitrary,
    ({ demands, syncRunOutcomes, settlementOrder }) => {
      const realizesInterleaving =
        settlementOrder === `interleaved` &&
        demands.length > 1 &&
        syncRunOutcomes.length > 1
      return [
        `demands=${demands.length}`,
        `sync-run-generations=${syncRunOutcomes.length + 1}`,
        `current=${syncRunOutcomes.at(-1)?.join(`+`)}`,
        `mixed-current=${new Set(syncRunOutcomes.at(-1)).size > 1}`,
        `obsolete-reject=${syncRunOutcomes
          .slice(0, -1)
          .some((outcomes) => outcomes.includes(`reject`))}`,
        `requested-order=${
          settlementOrder === `interleaved` && !realizesInterleaving
            ? `degenerate-interleaved`
            : settlementOrder
        }`,
      ]
    },
    oraclePropertyOptions(1_000, `subscription-lifecycle.async-statistics`),
  )
}

async function runAsyncRestartScenario(
  scenario: AsyncRestartScenario,
): Promise<Set<string>> {
  type DemandName = `a` | `b`
  type Row = { id: DemandName; version: number }
  type Attempt = {
    syncRunGeneration: number
    demand: DemandName
    options: LoadSubsetOptions
    deferred: ReturnType<typeof createDeferred<void>>
  }
  type SettlementEvent = {
    attempt: Attempt
    syncRunGeneration: number
    demand: DemandName
    outcome: `resolve` | `reject`
    activeSyncRunGeneration: number
  }
  const where = {
    a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
    b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
  }
  const demandForWhere = new Map<unknown, DemandName>([
    [where.a, `a`],
    [where.b, `b`],
  ])
  const attempts: Array<Attempt> = []
  const errors: Array<{ demand: DemandName; error: unknown }> = []
  const publications: Array<Array<Row>> = []
  const statuses: Array<string> = []
  const visible = new Map<string | number, Row>()
  const unloads: Array<{ syncRunGeneration: number; demand: DemandName }> = []
  const settlements: Array<SettlementEvent> = []
  const settledAttempts = new Set<Attempt>()
  const publishedBeforeRetirement = new Set<number>()
  const failures = scenario.syncRunOutcomes.map((_, restartIndex) =>
    scenario.demands.map(
      (demand) => new Error(`sync run ${restartIndex + 1} ${demand} failed`),
    ),
  )
  let syncRunGeneration = -1

  const outcomeFor = (attempt: Attempt) =>
    scenario.syncRunOutcomes[attempt.syncRunGeneration - 1]![
      scenario.demands.indexOf(attempt.demand)
    ]!
  const failureFor = (attempt: Attempt) =>
    failures[attempt.syncRunGeneration - 1]![
      scenario.demands.indexOf(attempt.demand)
    ]!

  const settleAttempt = async (attempt: Attempt): Promise<void> => {
    const outcome = outcomeFor(attempt)
    if (outcome === `resolve`) attempt.deferred.resolve()
    else attempt.deferred.reject(failureFor(attempt))
    await flushPromises()
    settlements.push({
      attempt,
      syncRunGeneration: attempt.syncRunGeneration,
      demand: attempt.demand,
      outcome,
      activeSyncRunGeneration: syncRunGeneration,
    })
    settledAttempts.add(attempt)
  }

  const collection = createOnDemandCollection<Row>({
    id: `async-restart-lifecycle`,
    sync: {
      sync: (operations) => {
        syncRunGeneration++
        const ownSyncRunGeneration = syncRunGeneration
        operations.markReady()
        return {
          loadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`unknown async demand`)
            const deferred = createDeferred<void>()
            void deferred.promise.catch(() => {})
            attempts.push({
              syncRunGeneration: ownSyncRunGeneration,
              demand,
              options,
              deferred,
            })
            return deferred.promise.then(() => {
              operations.begin()
              operations.write({
                type: `insert`,
                value: { id: demand, version: ownSyncRunGeneration + 1 },
              })
              const receipt = operations.commit()
              if (receipt !== true) return receipt
              return undefined
            })
          },
          unloadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`unknown async demand`)
            unloads.push({
              syncRunGeneration: ownSyncRunGeneration,
              demand,
            })
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            version: change.value.version,
          })
        }
      }
      publications.push(
        [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
      )
    },
    { includeInitialState: false },
  )
  subscription.on(`loadSubset:error`, ({ options, error }) => {
    const demand = demandForWhere.get(options.where)
    if (!demand) throw new Error(`unknown errored demand`)
    errors.push({ demand, error })
  })
  subscription.on(`status:change`, ({ status }) => statuses.push(status))

  let failed = false
  let primaryError: unknown
  let reached: Set<string> | undefined
  const cleanupErrors: Array<unknown> = []
  try {
    for (const demand of scenario.demands) {
      subscription.requestSnapshot({ where: where[demand] })
    }
    for (const attempt of attempts.filter(
      ({ syncRunGeneration: value }) => value === 0,
    )) {
      attempt.deferred.resolve()
    }
    await flushPromises()
    oracleAssertion('existing comparison at 322', () =>
      expect(
        [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(
        [...scenario.demands]
          .sort((a, b) => a.localeCompare(b))
          .map((id) => ({ id, version: 1 })),
      ),
    )

    for (
      let restartIndex = 0;
      restartIndex < scenario.syncRunOutcomes.length;
      restartIndex++
    ) {
      const discardedSyncRunGeneration = syncRunGeneration
      const prefixStart = publications.length
      const retainedVersion = publishedBeforeRetirement.size
        ? Math.max(...publishedBeforeRetirement) + 1
        : 1
      const retainedRows = [...scenario.demands]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, version: retainedVersion }))
      const assertRetainedPrefix = () => {
        oracleAssertion('existing comparison at 344', () =>
          expect(
            [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
          ).toEqual(retainedRows),
        )
        // Repeated coherent notifications are legal; each copied snapshot
        // must retain the last complete publication until replacement settles.
        for (const snapshot of publications.slice(prefixStart)) {
          oracleAssertion('existing comparison at 350', () =>
            expect(snapshot).toEqual(retainedRows),
          )
        }
      }
      assertRetainedPrefix()
      await collection.cleanup()
      assertRetainedPrefix()
      for (const attempt of attempts.filter(
        ({ syncRunGeneration: attemptSyncRunGeneration }) =>
          attemptSyncRunGeneration === discardedSyncRunGeneration,
      )) {
        oracleAssertion('existing comparison at 360', () =>
          expect(attempt.options.signal?.aborted).toBe(true),
        )
      }
      collection.startSyncImmediate()
      assertRetainedPrefix()
      await flushPromises()
      assertRetainedPrefix()
      const expectedSyncRunGeneration = restartIndex + 1
      oracleAssertion('existing comparison at 367', () =>
        expect(
          attempts
            .filter(
              ({ syncRunGeneration: attemptSyncRunGeneration }) =>
                attemptSyncRunGeneration <= expectedSyncRunGeneration,
            )
            .map(({ syncRunGeneration: attemptSyncRunGeneration, demand }) => ({
              syncRunGeneration: attemptSyncRunGeneration,
              demand,
            })),
        ).toEqual(
          Array.from(
            { length: expectedSyncRunGeneration + 1 },
            (_, attemptSyncRunGeneration) =>
              scenario.demands.map((demand) => ({
                syncRunGeneration: attemptSyncRunGeneration,
                demand,
              })),
          ).flat(),
        ),
      )

      const publishesBeforeLaterRestart =
        scenario.settlementOrder === `interleaved` &&
        restartIndex === 0 &&
        scenario.syncRunOutcomes.length > 1 &&
        scenario.syncRunOutcomes[restartIndex]!.every(
          (outcome) => outcome === `resolve`,
        )
      if (publishesBeforeLaterRestart) {
        const publicationCount = publications.length
        for (const attempt of attempts.filter(
          ({ syncRunGeneration: attemptSyncRunGeneration }) =>
            attemptSyncRunGeneration === expectedSyncRunGeneration,
        )) {
          await settleAttempt(attempt)
        }
        const expectedRows = [...scenario.demands]
          .sort((a, b) => a.localeCompare(b))
          .map((id) => ({ id, version: expectedSyncRunGeneration + 1 }))
        oracleAssertion('existing comparison at 406', () =>
          expect(
            [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
          ).toEqual(expectedRows),
        )
        oracleAssertion('existing comparison at 409', () =>
          expect(publications.slice(publicationCount)).toEqual([expectedRows]),
        )
        publishedBeforeRetirement.add(expectedSyncRunGeneration)
      }
    }

    const currentSyncRunGeneration = scenario.syncRunOutcomes.length
    oracleAssertion('existing comparison at 415', () =>
      expect(
        attempts.map(
          ({ syncRunGeneration: attemptSyncRunGeneration, demand }) => ({
            syncRunGeneration: attemptSyncRunGeneration,
            demand,
          }),
        ),
      ).toEqual(
        Array.from(
          { length: currentSyncRunGeneration + 1 },
          (_, attemptSyncRunGeneration) =>
            scenario.demands.map((demand) => ({
              syncRunGeneration: attemptSyncRunGeneration,
              demand,
            })),
        ).flat(),
      ),
    )
    const obsolete = attempts.filter(
      (attempt) =>
        attempt.syncRunGeneration > 0 &&
        attempt.syncRunGeneration < currentSyncRunGeneration &&
        !settledAttempts.has(attempt),
    )
    const current = attempts.filter(
      ({ syncRunGeneration: value }) => value === currentSyncRunGeneration,
    )
    const orderedAttempts =
      scenario.settlementOrder === `obsolete-first`
        ? [...obsolete, ...current]
        : scenario.settlementOrder === `current-first`
          ? [...current, ...obsolete]
          : attempts
              .filter(({ syncRunGeneration: value }) => value > 0)
              .filter((attempt) => !settledAttempts.has(attempt))
              .sort((left, right) =>
                left.demand === right.demand
                  ? right.syncRunGeneration - left.syncRunGeneration
                  : left.demand.localeCompare(right.demand),
              )

    const settledCurrent: Array<Attempt> = []
    const publicationTraceStart = publications.length
    const statusTraceStart = statuses.length
    const retainedVersion = publishedBeforeRetirement.size
      ? Math.max(...publishedBeforeRetirement) + 1
      : 1
    const assertObservableState = () => {
      const currentComplete = settledCurrent.length === current.length
      const currentSucceeded = current.every(
        (attempt) => outcomeFor(attempt) === `resolve`,
      )
      const visibleVersion =
        currentComplete && currentSucceeded
          ? currentSyncRunGeneration + 1
          : retainedVersion
      const expectedRows = [...scenario.demands]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, version: visibleVersion }))
      oracleAssertion('existing comparison at 473', () =>
        expect(
          [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
        ).toEqual(expectedRows),
      )
      const expectedFailedAttempts = settledCurrent.filter(
        (attempt) => outcomeFor(attempt) === `reject`,
      )
      oracleAssertion('existing comparison at 479', () =>
        expect(errors.map(({ demand }) => demand)).toEqual(
          expectedFailedAttempts.map(({ demand }) => demand),
        ),
      )
      for (const [index, { error }] of errors.entries()) {
        oracleAssertion('existing comparison at 483', () =>
          expect(error).toBe(failureFor(expectedFailedAttempts[index]!)),
        )
      }
      oracleAssertion('existing comparison at 485', () =>
        expect(subscription.lastError).toBe(
          expectedFailedAttempts.length
            ? failureFor(expectedFailedAttempts.at(-1)!)
            : undefined,
        ),
      )
      oracleAssertion('existing comparison at 490', () =>
        expect(subscription.status).toBe(
          currentComplete ? `ready` : `loadingSubset`,
        ),
      )
      oracleAssertion('existing comparison at 493', () =>
        expect(publications.slice(publicationTraceStart)).toEqual(
          currentComplete && currentSucceeded ? [expectedRows] : [],
        ),
      )
      oracleAssertion('existing comparison at 496', () =>
        expect(statuses.slice(statusTraceStart)).toEqual(
          currentComplete ? [`ready`] : [],
        ),
      )
    }

    for (const attempt of orderedAttempts) {
      await settleAttempt(attempt)
      if (attempt.syncRunGeneration === currentSyncRunGeneration)
        settledCurrent.push(attempt)
      assertObservableState()
    }

    const currentSucceeded = current.every(
      (attempt) => outcomeFor(attempt) === `resolve`,
    )
    const expectedVersion = currentSucceeded
      ? currentSyncRunGeneration + 1
      : retainedVersion
    oracleAssertion('existing comparison at 514', () =>
      expect(
        [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(
        [...scenario.demands]
          .sort((a, b) => a.localeCompare(b))
          .map((id) => ({ id, version: expectedVersion })),
      ),
    )
    if (currentSucceeded) {
      oracleAssertion('existing comparison at 522', () =>
        expect(errors).toEqual([]),
      )
      oracleAssertion('existing comparison at 523', () =>
        expect(subscription.lastError).toBeUndefined(),
      )
    } else {
      const expectedFailedAttempts = settledCurrent.filter(
        (attempt) => outcomeFor(attempt) === `reject`,
      )
      oracleAssertion('existing comparison at 528', () =>
        expect(errors.map(({ demand }) => demand)).toEqual(
          expectedFailedAttempts.map(({ demand }) => demand),
        ),
      )
      for (const [index, { error }] of errors.entries()) {
        oracleAssertion('existing comparison at 532', () =>
          expect(error).toBe(failureFor(expectedFailedAttempts[index]!)),
        )
      }
      oracleAssertion('existing comparison at 534', () =>
        expect(subscription.lastError).toBe(
          failureFor(expectedFailedAttempts.at(-1)!),
        ),
      )
    }
    oracleAssertion('existing comparison at 538', () =>
      expect(subscription.status).toBe(`ready`),
    )
    for (const attempt of current) {
      oracleAssertion('existing comparison at 540', () =>
        expect(attempt.options.signal?.aborted).toBe(false),
      )
    }

    const finalScopes = settlements.map(
      ({ syncRunGeneration: attemptSyncRunGeneration }) =>
        attemptSyncRunGeneration === currentSyncRunGeneration
          ? `current`
          : `obsolete`,
    )
    const firstCurrent = finalScopes.indexOf(`current`)
    const lastCurrent = finalScopes.lastIndexOf(`current`)
    const firstObsolete = finalScopes.indexOf(`obsolete`)
    const lastObsolete = finalScopes.lastIndexOf(`obsolete`)
    const observedOrder =
      firstCurrent === -1 || firstObsolete === -1
        ? undefined
        : lastObsolete < firstCurrent
          ? `obsolete-first`
          : lastCurrent < firstObsolete
            ? `current-first`
            : `interleaved`
    const currentOutcomes = settlements
      .filter(
        ({ syncRunGeneration: attemptSyncRunGeneration }) =>
          attemptSyncRunGeneration === currentSyncRunGeneration,
      )
      .map(({ outcome }) => outcome)
    oracleAssertion('existing comparison at 567', () =>
      expect(new Set(settlements.map(({ attempt }) => attempt)).size).toBe(
        settlements.length,
      ),
    )
    oracleAssertion('existing comparison at 570', () =>
      expect(settlements).toHaveLength(
        attempts.filter(
          ({ syncRunGeneration: attemptSyncRunGeneration }) =>
            attemptSyncRunGeneration > 0,
        ).length,
      ),
    )
    const reach = new Set([
      `demands:${new Set(attempts.map(({ demand }) => demand)).size}`,
      `sync-run-generations:${new Set(attempts.map(({ syncRunGeneration: attemptSyncRunGeneration }) => attemptSyncRunGeneration)).size}`,
      ...[...new Set(currentOutcomes)].map((outcome) => `current:${outcome}`),
      `mixed-current:${new Set(currentOutcomes).size > 1}`,
      `obsolete-reject:${settlements.some(
        ({ syncRunGeneration: attemptSyncRunGeneration, outcome }) =>
          attemptSyncRunGeneration < currentSyncRunGeneration &&
          outcome === `reject`,
      )}`,
      ...(observedOrder ? [`order:${observedOrder}`] : []),
      `real-interleaving:${settlements.some(
        ({
          syncRunGeneration: attemptSyncRunGeneration,
          activeSyncRunGeneration,
        }) =>
          attemptSyncRunGeneration < currentSyncRunGeneration &&
          activeSyncRunGeneration === attemptSyncRunGeneration &&
          publishedBeforeRetirement.has(attemptSyncRunGeneration),
      )}`,
    ])

    subscription.unsubscribe()
    for (const attempt of current) {
      oracleAssertion('existing comparison at 600', () =>
        expect(attempt.options.signal?.aborted).toBe(true),
      )
    }
    oracleAssertion('existing comparison at 602', () =>
      expect(unloads).toEqual(
        scenario.demands.map((demand) => ({
          syncRunGeneration: currentSyncRunGeneration,
          demand,
        })),
      ),
    )
    reached = reach
  } catch (error) {
    failed = true
    primaryError = error
  } finally {
    try {
      subscription.unsubscribe()
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      await collection.cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (
      collection.status === `cleaned-up` &&
      attempts.every(({ options }) => options.signal?.aborted === true)
    ) {
      // Retire captured sync runs before releasing any still-pending transport.
      for (const { deferred } of attempts) deferred.resolve()
      try {
        await flushPromises()
      } catch (error) {
        cleanupErrors.push(error)
      }
    } else {
      cleanupErrors.push(
        new Error(`Async restart cleanup did not retire all work`),
      )
    }
  }
  if (cleanupErrors.length) {
    if (failed) {
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        `Async restart and cleanup failed`,
        { cause: primaryError },
      )
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0]
    throw new AggregateError(cleanupErrors, `Async restart cleanup failed`)
  }
  if (failed) throw primaryError
  if (!reached) throw new Error(`Async restart did not record its reach`)
  return reached
}

/**
 * Startup retirement model: a nested restart succeeds only when no cleanup
 * started during the sync entry. A `ready` or `ready-effect-throw` entry also
 * returns the obsolete sync run's cleanup resource.
 */
function startupRetirementModel(
  entry: `loading` | `ready` | `adapter-throw` | `ready-effect-throw`,
  restart: boolean,
): {
  cleanupStartedDuringSyncEntry: boolean
  restartSucceeded: boolean
  returnsObsoleteCleanup: boolean
} {
  const cleanupStartedDuringSyncEntry = entry !== `loading`
  const restartSucceeded = restart && !cleanupStartedDuringSyncEntry
  const returnsObsoleteCleanup =
    entry === `ready` || entry === `ready-effect-throw`
  return {
    cleanupStartedDuringSyncEntry,
    restartSucceeded,
    returnsObsoleteCleanup,
  }
}

/**
 * Unavailable-wait model: only a release or unsubscribe during recovery retires
 * the physical acquisition that recovery started. A cleanup ends the wait
 * without ending the surviving demand, so the adapter sees one load when the
 * wait began before recovery and two when recovery had already loaded it.
 */
function expectedUnloadsAfterUnavailableWait(
  phase: `before` | `during`,
  outcome:
    | `return`
    | `throw`
    | `resolve`
    | `reject`
    | `release`
    | `unsubscribe`
    | `cleanup`
    | `abort`,
  loads: ReadonlyArray<LoadSubsetOptions>,
): ReadonlyArray<LoadSubsetOptions> {
  return phase === `during` &&
    (outcome === `release` || outcome === `unsubscribe`)
    ? loads
    : []
}

/** Unavailable-wait model: the number of adapter loads after a cleanup ends the wait. */
function expectedLoadsAfterCleanupEndsWait(phase: `before` | `during`): number {
  return phase === `before` ? 1 : 2
}

/**
 * Queued-cancel model: cleanup leaves the collection cleaned up, while release
 * and unsubscribe leave the collection ready.
 */
function expectedStatusAfterQueuedCancel(
  action: `cleanup` | `release` | `unsubscribe`,
): `cleaned-up` | `ready` {
  return action === `cleanup` ? `cleaned-up` : `ready`
}

/**
 * Release-error model: a physical release that throws is reported once,
 * uncaught, and never reaches the caller or the load error listener.
 */
function expectedUncaughtReleaseErrors(
  outcome: `return` | `throw`,
  failure: Error,
): Array<unknown> {
  return outcome === `throw` ? [failure] : []
}

/**
 * Reentry model: only an adapter reentry unsubscribes before the outer release
 * returns. A release error reaches no error listener, so that path cannot
 * unsubscribe.
 */
function expectedSubscriberCountAfterRelease(
  reentry: `adapter` | `error-listener`,
): number {
  return reentry === `adapter` ? 0 : 1
}

/**
 * Three-generation model: the current sync run decides the published row and
 * the delivered error. The obsolete run's settlement never publishes.
 */
function expectedThreeGenerationSettlement(
  currentOutcome: `resolve` | `reject`,
  currentFailure: Error,
): {
  version: number
  errors: Array<unknown>
  lastError: unknown
} {
  return {
    version: currentOutcome === `resolve` ? 3 : 1,
    errors: currentOutcome === `reject` ? [currentFailure] : [],
    lastError: currentOutcome === `reject` ? currentFailure : undefined,
  }
}

// What this oracle owns: the gap report judges the demand lifecycle of a
// subscription in subscription.ts, its startup, cleanup, restart, and
// release, by this file's tests.
declareOracle({
  owns: [`src/collection/subscription.ts`],
  check: [runAsyncRestartScenario],
  model: [
    modelSubscriberResumeRetirement,
    startupRetirementModel,
    expectedUnloadsAfterUnavailableWait,
    expectedLoadsAfterCleanupEndsWait,
    expectedStatusAfterQueuedCancel,
    expectedUncaughtReleaseErrors,
    expectedSubscriberCountAfterRelease,
    expectedThreeGenerationSettlement,
  ],
  grammar: [
    acquisitionCellDefinitions,
    acquisitionInteractionCellDefinitions,
    startScenarios,
    failureScenarios,
    releaseScenarios,
    restartScenarios,
    asyncRestartScenarioArbitrary,
  ],
})

/**
 * Exhaust the synchronous adapter-start boundary before adding more runtime
 * special cases. Logical demand is visible during this callback, but a
 * physical acquisition and its lease exist only if the callback returns.
 */
describe(`CollectionSubscription demand lifecycle oracle`, () => {
  it(`executes every required async restart regime`, async () => {
    oracleRoute(`case`)
    const reach = new Set<string>()
    for (const scenario of asyncRestartCoverageScenarios) {
      for (const label of await runAsyncRestartScenario(scenario)) {
        reach.add(label)
      }
    }
    const required = [
      `demands:1`,
      `demands:2`,
      `sync-run-generations:2`,
      `sync-run-generations:3`,
      `sync-run-generations:4`,
      `current:resolve`,
      `current:reject`,
      `mixed-current:true`,
      `obsolete-reject:true`,
      `order:obsolete-first`,
      `order:current-first`,
      `order:interleaved`,
      `real-interleaving:true`,
    ]
    oracleAssertion('existing comparison at 818', () =>
      expect(required.filter((label) => !reach.has(label))).toEqual([]),
    )
  })

  it(`covers every finite start, failure-delivery, and release cell`, () => {
    oracleRoute(`case`)
    oracleAssertion('existing comparison at 823', () =>
      expect(
        new Set(
          startScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
        ),
      ).toHaveLength(startOutcomes.length * startReentries.length),
    )
    oracleAssertion('existing comparison at 828', () =>
      expect(
        new Set(
          failureScenarios.map(
            ({ outcome, reentry }) => `${outcome}:${reentry}`,
          ),
        ),
      ).toHaveLength(2 * startReentries.length),
    )
    oracleAssertion('existing comparison at 833', () =>
      expect(
        new Set(
          releaseScenarios.map(
            ({ outcome, reentry }) => `${outcome}:${reentry}`,
          ),
        ),
      ).toHaveLength(2 * 4),
    )
    oracleAssertion('existing comparison at 838', () =>
      expect(
        new Set(
          restartScenarios.map(
            ({ outcome, reentry }) => `${outcome}:${reentry}`,
          ),
        ),
      ).toHaveLength(4 * 5),
    )
  })

  it(`accounts for every acquisition phase and entry pair`, () => {
    oracleRoute(`case`)
    const allCells = new Set<AcquisitionCell>(
      acquisitionPhases.flatMap((phase) =>
        acquisitionEntries.map((entry) => `${phase}:${entry}` as const),
      ),
    )
    oracleAssertion('existing comparison at 852', () =>
      expect(
        new Set([...legalAcquisitionCells, ...excludedAcquisitionCells.keys()]),
      ).toEqual(allCells),
    )
  })

  it(`accounts for every acquisition lifecycle state and interaction cause`, () => {
    oracleRoute(`case`)
    const allCells = new Set<AcquisitionInteractionCell>(
      acquisitionLifecycleStates.flatMap((state) =>
        acquisitionInteractionCauses.map(
          (cause) => `${state}:${cause}` as const,
        ),
      ),
    )
    oracleAssertion('existing comparison at 866', () =>
      expect(
        new Set(Object.keys(acquisitionInteractionCellDefinitions)),
      ).toEqual(allCells),
    )
  })

  it.each(
    ([false, true] as const).flatMap((restart) =>
      (
        [`loading`, `ready`, `adapter-throw`, `ready-effect-throw`] as const
      ).map((entry) => ({ restart, entry })),
    ),
  )(
    `retires startup at $entry with nested restart=$restart`,
    async ({ entry, restart }) => {
      oracleRoute(`case`)
      const failure = new Error(`obsolete startup failed`)
      const cleanups: Array<number> = []
      const loads: Array<number> = []
      const unloads: Array<number> = []
      let syncRunGeneration = -1
      let retire = false
      let nestedRestartError: unknown
      const collection = createOnDemandCollection<{ id: string }>({
        sync: {
          sync: ({ markReady }) => {
            const ownSyncRunGeneration = ++syncRunGeneration
            markReady()
            if (ownSyncRunGeneration === 1 && entry === `adapter-throw`) {
              throw failure
            }
            return {
              loadSubset: () => {
                loads.push(ownSyncRunGeneration)
                return true
              },
              unloadSubset: () => unloads.push(ownSyncRunGeneration),
              cleanup: () => {
                cleanups.push(ownSyncRunGeneration)
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      let removeListener = () => {}
      try {
        await collection.cleanup()
        const retireSyncRun = () => {
          if (!retire) return
          retire = false
          void collection.cleanup()
          if (restart) {
            try {
              collection.startSyncImmediate()
            } catch (error) {
              nestedRestartError = error
            }
          }
          if (entry === `ready-effect-throw`) throw failure
        }
        removeListener =
          entry === `ready-effect-throw`
            ? collection.onFirstReady(retireSyncRun)
            : collection.on(
                entry === `loading` ? `status:loading` : `status:ready`,
                retireSyncRun,
              )
        retire = true
        if (entry === `adapter-throw` || entry === `ready-effect-throw`) {
          oracleAssertion('existing comparison at 937', () =>
            expect(() => collection.startSyncImmediate()).toThrow(failure),
          )
        } else {
          collection.startSyncImmediate()
        }
        await flushPromises()

        const {
          cleanupStartedDuringSyncEntry,
          restartSucceeded,
          returnsObsoleteCleanup,
        } = startupRetirementModel(entry, restart)
        if (restart && cleanupStartedDuringSyncEntry) {
          oracleAssertion('existing comparison at 949', () =>
            expect(nestedRestartError).toMatchObject({
              name: `CollectionStateError`,
              message: expect.stringContaining(`after cleanup() completes`),
            }),
          )
        } else {
          oracleAssertion('existing comparison at 954', () =>
            expect(nestedRestartError).toBeUndefined(),
          )
        }
        oracleAssertion('existing comparison at 956', () =>
          expect(collection.status).toBe(
            restartSucceeded ? `ready` : `cleaned-up`,
          ),
        )
        oracleAssertion('existing comparison at 959', () =>
          expect(cleanups).toEqual(returnsObsoleteCleanup ? [0, 1] : [0]),
        )
        oracleAssertion('existing comparison at 960', () =>
          expect(syncRunGeneration).toBe(
            entry === `loading` ? (restart ? 1 : 0) : 1,
          ),
        )

        if (restartSucceeded) {
          subscription.requestSnapshot({
            where: new Func(`eq`, [new PropRef([`id`]), new Value(`row`)]),
          })
          oracleAssertion('existing comparison at 968', () =>
            expect(loads).toEqual([syncRunGeneration]),
          )
          subscription.unsubscribe()
          oracleAssertion('existing comparison at 970', () =>
            expect(unloads).toEqual([syncRunGeneration]),
          )
        } else {
          oracleAssertion('existing comparison at 972', () =>
            expect(loads).toEqual([]),
          )
          oracleAssertion('existing comparison at 973', () =>
            expect(unloads).toEqual([]),
          )
        }
      } finally {
        removeListener()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  // A cleaned-up attempt recovers with a restart. An errored attempt cannot
  // recover in place; the test above owns its demand.
  it.each(
    ([`cleaned-up`] as const).flatMap((unavailable) =>
      (
        [
          `return`,
          `resolve`,
          `reject`,
          `throw`,
          `release`,
          `unsubscribe`,
          `cleanup`,
          `abort`,
        ] as const
      ).flatMap((outcome) =>
        (outcome === `release` ||
        outcome === `unsubscribe` ||
        outcome === `cleanup` ||
        outcome === `abort`
          ? ([`before`, `during`] as const)
          : ([`during`] as const)
        ).flatMap((phase) =>
          // Ordered snapshots do not accept an external AbortSignal.
          (outcome === `abort`
            ? ([`snapshot`] as const)
            : ([`snapshot`, `limited`] as const)
          ).map((entry) => ({ unavailable, outcome, phase, entry })),
        ),
      ),
    ),
  )(
    `observes unavailable demand synchronously: $entry / $unavailable / $outcome / $phase`,
    async ({ outcome, phase, entry }) => {
      oracleRoute(`case`)
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const transport = createDeferred<void>()
      const failure = new Error(`recovery acquisition failed`)
      const signal = new AbortController()
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const rows = new Map<string | number, { id: string }>()
      let operations!: Parameters<SyncConfig<{ id: string }>[`sync`]>[0]
      const collection = createOnDemandCollection<{ id: string }>({
        sync: {
          sync: (next) => {
            operations = next
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (outcome === `throw`) throw failure
                operations.begin()
                operations.write({ type: `insert`, value: { id: `row` } })
                operations.commit()
                return outcome === `return` ? true : transport.promise
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) rows.delete(change.key)
            else rows.set(change.key, change.value)
          }
        },
        { includeInitialState: false },
      )
      let result: true | Promise<void> | undefined
      let release: (() => void) | undefined
      const settlements: Array<unknown> = []
      const visibleOnSuccess: Array<Array<string>> = []
      let callbacks = 0
      try {
        if (entry === `limited`) {
          subscription.setOrderByIndex(
            collection.createIndex((row) => row.id, { indexType: BTreeIndex }),
          )
        }
        await collection.cleanup()
        const onLoadSubsetResult = (
          value: true | Promise<void>,
          _options: LoadSubsetOptions,
          releaseDemand?: () => void,
        ) => {
          callbacks++
          result = value
          release = releaseDemand
          if (value instanceof Promise)
            void value.then(
              () => {
                visibleOnSuccess.push([...rows.values()].map(({ id }) => id))
                settlements.push(`success`)
              },
              (error: unknown) => settlements.push(error),
            )
        }
        if (entry === `snapshot`) {
          subscription.requestSnapshot({
            where,
            signal: signal.signal,
            onLoadSubsetResult,
          })
        } else {
          subscription.requestLimitedSnapshot({
            orderBy: [
              {
                expression: new PropRef([`id`]),
                compareOptions: { direction: `asc`, nulls: `first` },
              },
            ],
            limit: 1,
            onLoadSubsetResult,
          })
        }
        // Production callers copy the result as soon as requestSnapshot returns.
        oracleAssertion('existing comparison at 1101', () =>
          expect(callbacks).toBe(1),
        )
        oracleAssertion('existing comparison at 1102', () =>
          expect(result).toBeInstanceOf(Promise),
        )
        await flushPromises()
        oracleAssertion('existing comparison at 1104', () =>
          expect(settlements).toEqual([]),
        )
        oracleAssertion('existing comparison at 1105', () =>
          expect(loads).toEqual([]),
        )
        const recover = () => {
          collection.startSyncImmediate()
          operations.markReady()
        }
        if (phase === `during`) {
          recover()
          await flushPromises()
          oracleAssertion('existing comparison at 1113', () =>
            expect(loads).toHaveLength(1),
          )
          if (outcome !== `return` && outcome !== `throw`) {
            oracleAssertion('existing comparison at 1115', () =>
              expect(settlements).toEqual([]),
            )
            oracleAssertion('existing comparison at 1116', () =>
              expect([...rows.values()]).toEqual([]),
            )
          }
        }
        if (outcome === `release`) release!()
        else if (outcome === `unsubscribe`) subscription.unsubscribe()
        else if (outcome === `cleanup`) await collection.cleanup()
        else if (outcome === `abort`) signal.abort()
        else if (outcome === `reject`) transport.reject(failure)
        else if (outcome === `resolve`) transport.resolve()
        await flushPromises()
        if (outcome === `return` || outcome === `resolve`) {
          oracleAssertion('existing comparison at 1127', () =>
            expect(settlements).toEqual([`success`]),
          )
          oracleAssertion('existing comparison at 1128', () =>
            expect(visibleOnSuccess).toEqual([[`row`]]),
          )
          oracleAssertion('existing comparison at 1129', () =>
            expect([...rows.values()].map(({ id }) => id)).toEqual([`row`]),
          )
        } else if (outcome === `throw` || outcome === `reject`) {
          oracleAssertion('existing comparison at 1131', () =>
            expect(settlements).toHaveLength(1),
          )
          oracleAssertion('existing comparison at 1132', () =>
            expect(settlements[0]).toBe(failure),
          )
          oracleAssertion('existing comparison at 1133', () =>
            expect([...rows.values()]).toEqual([]),
          )
        } else {
          oracleAssertion('existing comparison at 1135', () =>
            expect(settlements).toEqual([
              expect.objectContaining({ name: `AbortError` }),
            ]),
          )
          oracleAssertion('existing comparison at 1138', () =>
            expect(unloads).toEqual(
              expectedUnloadsAfterUnavailableWait(phase, outcome, loads),
            ),
          )
          if (phase === `before` && outcome !== `cleanup`) {
            recover()
            await flushPromises()
            oracleAssertion('existing comparison at 1144', () =>
              expect(loads).toEqual([]),
            )
          }
          if (outcome === `cleanup`) {
            // Cleanup ends this wait, not the surviving subscription's demand.
            collection.startSyncImmediate()
            operations.markReady()
            await flushPromises()
            oracleAssertion('existing comparison at 1151', () =>
              expect(loads).toHaveLength(
                expectedLoadsAfterCleanupEndsWait(phase),
              ),
            )
          }
          // Non-cooperative late settlement cannot rewrite the observed outcome.
          transport.resolve()
          await flushPromises()
          oracleAssertion('existing comparison at 1156', () =>
            expect(settlements).toEqual([
              expect.objectContaining({ name: `AbortError` }),
            ]),
          )
        }
        oracleAssertion('existing comparison at 1160', () =>
          expect(callbacks).toBe(1),
        )
      } finally {
        transport.resolve()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`loading`, `ready`] as const).flatMap((phase) =>
      ([`cleanup`, `release`, `unsubscribe`] as const).map((action) => ({
        phase,
        action,
      })),
    ),
  )(
    `cancels queued acquisition during $phase via $action`,
    async ({ phase, action }) => {
      oracleRoute(`case`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      let cancelOnEntry = false
      const observed: Array<true | Promise<void>> = []
      const collection = createOnDemandCollection<{ id: string }>({
        id: `deferred-resume-cleanup`,
        startSync: false,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      oracleAssertion('existing comparison at 1201', () =>
        expect(collection._deferSyncStart()).toBe(true),
      )
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
        deferAcquisition: true,
      })
      const removeReadyListener = collection.on(`status:${phase}`, () => {
        if (!cancelOnEntry) return
        cancelOnEntry = false
        if (action === `cleanup`) void collection.cleanup()
        else if (action === `release`) subscription.releaseSnapshot(where)
        else subscription.unsubscribe()
      })
      subscription.requestSnapshot({
        where,
        onLoadSubsetResult: (result) => observed.push(result),
      })

      try {
        cancelOnEntry = true
        subscription.resumeDeferredAcquisition()
        await flushPromises()

        oracleAssertion('existing comparison at 1223', () =>
          expect(collection.status).toBe(
            expectedStatusAfterQueuedCancel(action),
          ),
        )
        oracleAssertion('existing comparison at 1224', () =>
          expect(loads).toHaveLength(0),
        )
        oracleAssertion('existing comparison at 1225', () =>
          expect(unloads).toHaveLength(0),
        )
        oracleAssertion('existing comparison at 1226', () =>
          expect(observed).toHaveLength(1),
        )
        await oracleAssertion('existing comparison at 1227', () =>
          expect(observed[0]).rejects.toMatchObject({ name: `AbortError` }),
        )
      } finally {
        removeReadyListener()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`return`, `throw`] as const).flatMap((outcome) =>
      [false, true].map((releaseSelf) => ({ outcome, releaseSelf })),
    ),
  )(
    `retires only the acquired lease for aborted replay with unload=$outcome, releaseSelf=$releaseSelf`,
    async ({ outcome, releaseSelf }) => {
      oracleRoute(`case`)
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const controller = new AbortController()
      const failure = new Error(`release failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      const uncaught = captureMicrotaskErrors()
      let releaseOwner = () => {}
      let operations!: Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0]
      const collection = createCollection<{ id: string }, string>({
        id: `aborted-replay-release`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (nextOperations) => {
            operations = nextOperations
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (unloads.length === 1) {
                  if (releaseSelf) releaseOwner()
                  if (outcome === `throw`) throw failure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      releaseOwner = () => subscription.releaseSnapshot(where)
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      try {
        subscription.requestSnapshot({ where, signal: controller.signal })
        controller.abort()
        operations.begin()
        operations.truncate()
        const receipt = operations.commit()
        if (receipt !== true) await receipt
        await flushPromises()

        oracleAssertion('existing comparison at 1291', () =>
          expect(loads).toHaveLength(1),
        )
        oracleAssertion('existing comparison at 1292', () =>
          expect(unloads).toHaveLength(1),
        )
        oracleAssertion('existing comparison at 1293', () =>
          expect(unloads[0]).toBe(loads[0]),
        )
        oracleAssertion('existing comparison at 1294', () =>
          expect(loads[0]!.signal!.aborted).toBe(true),
        )
        oracleAssertion('existing comparison at 1295', () =>
          expect(subscription.status).toBe(`ready`),
        )
        // The release error is reported uncaught, not as a load error.
        oracleAssertion('existing comparison at 1297', () =>
          expect(errors).toEqual([]),
        )
        oracleAssertion('existing comparison at 1298', () =>
          expect(uncaught.errors).toEqual(
            expectedUncaughtReleaseErrors(outcome, failure),
          ),
        )

        releaseOwner()
        oracleAssertion('existing comparison at 1303', () =>
          expect(unloads).toHaveLength(1),
        )
        subscription.unsubscribe()
        oracleAssertion('existing comparison at 1305', () =>
          expect(unloads).toHaveLength(1),
        )
        for (const options of unloads)
          oracleAssertion('existing comparison at 1306', () =>
            expect(options).toBe(loads[0]),
          )
        oracleAssertion('existing comparison at 1307', () =>
          expect(loads).toHaveLength(1),
        )
        await Promise.resolve()
        oracleAssertion('existing comparison at 1309', () =>
          expect(uncaught.errors).toEqual(
            expectedUncaughtReleaseErrors(outcome, failure),
          ),
        )
      } finally {
        uncaught.restore()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`adapter`, `error-listener`] as const).flatMap((reentry) =>
      [1, 2].map((failures) => ({ reentry, failures })),
    ),
  )(
    `attempts release once across $reentry reentry with $failures configured failures`,
    async ({ reentry, failures }) => {
      oracleRoute(`case`)
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const failure = new Error(`physical release failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      const nestedFailures: Array<unknown> = []
      const uncaught = captureMicrotaskErrors()
      let releaseOwner = () => {}
      const collection = createOnDemandCollection<{ id: string }>({
        id: `release-reentry-${reentry}-${failures}`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (unloads.length === 1 && reentry === `adapter`) {
                  releaseOwner()
                }
                if (unloads.length <= failures) throw failure
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      releaseOwner = () => {
        try {
          subscription.unsubscribe()
        } catch (error) {
          nestedFailures.push(error)
        }
      }
      subscription.on(`loadSubset:error`, ({ error }) => {
        errors.push(error)
        if (errors.length === 1 && reentry === `error-listener`) releaseOwner()
      })
      try {
        subscription.requestSnapshot({ where })
        let releaseError: unknown
        try {
          subscription.releaseSnapshot(where)
        } catch (error) {
          releaseError = error
        }
        oracleAssertion('existing comparison at 1379', () =>
          expect(releaseError).toBe(undefined),
        )
        // Adapter reentry sees a retired acquisition, including after throw.
        // A release error reaches no error listener, so that listener cannot
        // reenter teardown.
        oracleAssertion('existing comparison at 1383', () =>
          expect(unloads).toHaveLength(1),
        )
        // Only the adapter path reentered and unsubscribed.
        oracleAssertion('existing comparison at 1385', () =>
          expect(collection.subscriberCount).toBe(
            expectedSubscriberCountAfterRelease(reentry),
          ),
        )
        oracleAssertion('existing comparison at 1388', () =>
          expect(errors).toEqual([]),
        )
        oracleAssertion('existing comparison at 1389', () =>
          expect(nestedFailures).toEqual([]),
        )
        oracleAssertion('existing comparison at 1390', () =>
          expect(() => subscription.unsubscribe()).not.toThrow(),
        )
        oracleAssertion('existing comparison at 1391', () =>
          expect(unloads).toHaveLength(1),
        )
        subscription.unsubscribe()
        oracleAssertion('existing comparison at 1393', () =>
          expect(unloads).toHaveLength(1),
        )
        oracleAssertion('existing comparison at 1394', () =>
          expect(loads).toHaveLength(1),
        )
        for (const options of unloads)
          oracleAssertion('existing comparison at 1395', () =>
            expect(options).toBe(loads[0]),
          )
        await Promise.resolve()
        // One attempt, one report, whatever the adapter would throw later.
        oracleAssertion('existing comparison at 1398', () =>
          expect(uncaught.errors).toEqual([failure]),
        )
      } finally {
        uncaught.restore()
        await collection.cleanup()
        subscription.unsubscribe()
      }
    },
  )

  it.each(threeGenerationScenarios)(
    `fences three sync-run generations for $obsoleteOutcome/$currentOutcome settled $settlementOrder`,
    async ({ obsoleteOutcome, currentOutcome, settlementOrder }) => {
      oracleRoute(`case`)
      type Row = { id: string; version: number }
      const obsolete = createDeferred<void>()
      const current = createDeferred<void>()
      void obsolete.promise.catch(() => {})
      void current.promise.catch(() => {})
      const obsoleteFailure = new Error(`obsolete sync run failed`)
      const currentFailure = new Error(`current sync run failed`)
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const unloadSyncRunGenerations: Array<number> = []
      let syncRunGeneration = -1

      const collection = createOnDemandCollection<Row>({
        id: `three-sync-run-generations-${obsoleteOutcome}-${currentOutcome}-${settlementOrder}`,
        sync: {
          sync: (operations) => {
            syncRunGeneration++
            const ownSyncRunGeneration = syncRunGeneration
            operations.markReady()
            return {
              loadSubset: (options) => {
                if (ownSyncRunGeneration === 0) {
                  operations.begin()
                  operations.write({
                    type: `insert`,
                    value: { id: `row`, version: 1 },
                  })
                  operations.commit(options.signal)
                  return true
                }
                const gate = ownSyncRunGeneration === 1 ? obsolete : current
                const outcome =
                  ownSyncRunGeneration === 1 ? obsoleteOutcome : currentOutcome
                const failure =
                  ownSyncRunGeneration === 1 ? obsoleteFailure : currentFailure
                return gate.promise.then(() => {
                  if (outcome === `reject`) throw failure
                  operations.begin()
                  operations.write({
                    type: `insert`,
                    value: {
                      id: `row`,
                      version: ownSyncRunGeneration + 1,
                    },
                  })
                  const receipt = operations.commit(options.signal)
                  if (receipt !== true) return receipt
                  return undefined
                })
              },
              unloadSubset: () =>
                unloadSyncRunGenerations.push(ownSyncRunGeneration),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.requestSnapshot()
      oracleAssertion('existing comparison at 1483', () =>
        expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }]),
      )

      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      oracleAssertion('existing comparison at 1491', () =>
        expect(subscription.status).toBe(`loadingSubset`),
      )

      const settleObsolete = () =>
        obsoleteOutcome === `resolve`
          ? obsolete.resolve()
          : obsolete.reject(obsoleteFailure)
      const settleCurrent = () =>
        currentOutcome === `resolve`
          ? current.resolve()
          : current.reject(currentFailure)
      if (settlementOrder === `obsolete-first`) {
        settleObsolete()
        await flushPromises()
        oracleAssertion('existing comparison at 1504', () =>
          expect(subscription.status).toBe(`loadingSubset`),
        )
        settleCurrent()
      } else {
        settleCurrent()
        await flushPromises()
        settleObsolete()
      }
      await flushPromises()

      const settled = expectedThreeGenerationSettlement(
        currentOutcome,
        currentFailure,
      )
      oracleAssertion('existing comparison at 1517', () =>
        expect([...visible.values()]).toEqual([
          { id: `row`, version: settled.version },
        ]),
      )
      oracleAssertion('existing comparison at 1520', () =>
        expect(errors).toEqual(settled.errors),
      )
      oracleAssertion('existing comparison at 1521', () =>
        expect(subscription.lastError).toBe(settled.lastError),
      )
      oracleAssertion('existing comparison at 1522', () =>
        expect(subscription.status).toBe(`ready`),
      )

      subscription.unsubscribe()
      oracleAssertion('existing comparison at 1525', () =>
        expect(unloadSyncRunGenerations).toEqual([2]),
      )
      await collection.cleanup()
    },
  )

  oracleProperty({
    id: `subscription-lifecycle.async-restart`,
    law: {
      statement: `Demand settlements are fenced by the sync run that owns their physical acquisition.`,
      authority: `Collection cleanup/restart and logical demand ownership in the glossary; the lifecycle grammar's existing model`,
      limits: `The existing bounded async restart regimes, status, errors, rows, acquisition, and release checkpoints.`,
    },
    histories: {
      arbitrary: asyncRestartScenarioArbitrary,
      runs: 30,
      fixedSeeds: [1_657_002],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `sync-run demand settlement`,
        plan,
        observe,
        async () => {
          await runAsyncRestartScenario(plan.history)
        },
      ),
    check: forwardAssertionJudgment,
    timeout: 120_000,
  })
})

/**
 * A resumption that transfers ownership before a first-demand notification
 * fails still retains its logical demand. Cleanup ends acquisition authority;
 * an explicit replacement sync run supplies the next opportunity to acquire.
 * This follows cleanup/restart and logical-demand ownership in the glossary.
 * The notification can run twice only when cleanup cleared its earlier mark.
 * Without cleanup the first mark occurs before the transfer, so its throw
 * leaves the subscription deferred. Collection event throws are asynchronous
 * and therefore cannot skip resumption's next statement.
 *
 * These generated histories reach a real synchronous notifyResumed throw,
 * including while public status stays ready during held cleanup. They check
 * the transfer at return and acquisition after replacement readiness. They do
 * not promise recovery from arbitrary programming errors or implicit restart.
 */
describe(`resumption notification error and surviving demand`, () => {
  const states = [
    `throwing-notification`,
    `retained-owner`,
    `held-cleanup`,
    `replacement-ready`,
  ] as const
  // Keep the original minimum of one per state in each full campaign. The
  // framework also reports reach, while its determinism test is not a campaign.
  type NotificationState = (typeof states)[number]
  let notificationCounts = new Map<NotificationState, number>(
    states.map((state) => [state, 0]),
  )
  let enteredThisHistory = new Set<NotificationState>()
  beforeEach(() => {
    notificationCounts = new Map(states.map((state) => [state, 0]))
    enteredThisHistory = new Set()
  })
  afterEach(({ task }) => {
    if (task.name === `fixed seed 2229` || task.name === `random seed`) {
      if (!oracleReplayRequested()) {
        const missing = states.filter(
          (state) => notificationCounts.get(state)! < 1,
        )
        if (missing.length > 0)
          throw new Error(
            `resume-notification-error: fewer than one history entered ${missing.join(`, `)}`,
          )
      }
      console.info(
        `resume-notification-error ${task.name}`,
        Object.fromEntries(notificationCounts),
      )
    }
  })
  const notificationHistoryArbitrary = fc.record({
    pending: fc.boolean(),
    throws: fc.boolean(),
    demands: fc.integer({ min: 1, max: 3 }),
  })
  async function runNotificationErrorHistory(
    history: { pending: boolean; throws: boolean; demands: number },
    entered: (state: (typeof states)[number]) => void,
  ): Promise<void> {
    enteredThisHistory = new Set()
    const gate = createDeferred<void>()
    const failure = new Error(`first-demand notification`)
    let loads = 0
    const source = createCollection<{ id: string }>({
      getKey: (row) => row.id,
      gcTime: 0,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            cleanup: () => (history.pending ? gate.promise : undefined),
            loadSubset: () => {
              loads++
              return true
            },
          }
        },
      },
    })
    source.startSyncImmediate()
    const subscription = source.subscribeChanges(() => {}, {
      deferAcquisition: true,
    })
    for (let i = 0; i < history.demands; i++)
      subscription.requestSnapshot({
        where: new Func(`eq`, [new PropRef([`id`]), new Value(String(i))]),
      })
    // Drain the initial run's notifications while demand still defers.
    await flushPromises()
    oracleAssertion('existing comparison at 1617', () => expect(loads).toBe(0))
    let cleanup: Promise<void> | undefined
    let notifications = 0
    const off = source._onFirstSubscriberOrPreload(() => {
      notifications++
      if (notifications === 1) {
        cleanup = source.cleanup()
        if (!history.pending) source.startSyncImmediate()
      } else if (history.throws) throw failure
    })
    try {
      let result: { threw: boolean; error?: unknown } = { threw: false }
      try {
        subscription.resumeDeferredAcquisition()
      } catch (error) {
        result = { threw: true, error }
      }
      oracleAssertion('existing comparison at 1634', () =>
        expect(notifications).toBe(2),
      )
      oracleAssertion('existing comparison at 1635', () =>
        expect(result.threw).toBe(history.throws),
      )
      if (history.throws) {
        oracleAssertion('existing comparison at 1637', () =>
          expect(result.error).toBe(failure),
        )
        entered(`throwing-notification`)
      }
      oracleAssertion('existing comparison at 1640', () =>
        expect(subscription.isDeferringAcquisition()).toBe(false),
      )
      oracleAssertion('existing comparison at 1641', () =>
        expect(source.subscriberCount).toBe(1),
      )
      entered(`retained-owner`)
      if (history.pending) {
        oracleAssertion('existing comparison at 1644', () =>
          expect(source.status).toBe(`ready`),
        )
        entered(`held-cleanup`)
      }
      gate.resolve()
      await cleanup
      if (history.pending) source.startSyncImmediate()
      await flushPromises()
      entered(`replacement-ready`)
      oracleAssertion('existing comparison at 1652', () =>
        expect(source.status).toBe(`ready`),
      )
      oracleAssertion('existing comparison at 1653', () =>
        expect(loads).toBe(history.demands),
      )
      oracleAssertion('existing comparison at 1654', () =>
        expect(subscription.status).toBe(`ready`),
      )
    } finally {
      off()
      subscription.unsubscribe()
      gate.resolve()
      await source.cleanup()
    }
  }
  oracleProperty({
    id: `subscription-lifecycle.notification-error`,
    law: {
      statement: `Resumption retains its logical demands when first-demand notification throws after ownership transfer; replacement readiness acquires them.`,
      authority: `Collection cleanup/restart and logical demand ownership in the glossary, as stated above`,
      limits: `The existing pending-cleanup, notification-failure, and one-to-three-demand grammar; no arbitrary programming-error recovery or implicit restart.`,
    },
    histories: {
      arbitrary: notificationHistoryArbitrary,
      runs: 60,
      fixedSeeds: [2229],
      measured: states,
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `resumption notification ownership`,
        plan,
        observe,
        () =>
          runNotificationErrorHistory(plan.history, (state) => {
            if (!enteredThisHistory.has(state)) {
              enteredThisHistory.add(state)
              notificationCounts.set(state, notificationCounts.get(state)! + 1)
            }
            observe(`reach`, state)
          }),
      ),
    check: forwardAssertionJudgment,
  })
  // The grammar's independent judgment treats cleanup as retiring this start,
  // not permission to retry it. This driver crosses no render gate, a held
  // gate with no request, and a held requested start with both source modes.
  // It records the complete public status trace at subscribeChanges return
  // and cleanup settlement. A later ordinary reader is fresh restart demand.
  it.each(
    subscriberStartCleanupHistories.flatMap((history) =>
      ([`none`, `unrequested`, `requested`] as const).flatMap((gate) =>
        ([`eager`, `on-demand`] as const).map((syncMode) => ({
          ...history,
          gate,
          syncMode,
        })),
      ),
    ),
  )(
    `ordinary admission preserves $cleanupAt cleanup (pending=$cleanupPending, $gate start, $syncMode)`,
    async (history) => {
      oracleRoute(`case`)
      const expected = modelSubscriberStartCleanup(history)
      const pendingCleanup = createDeferred<void>()
      let starts = 0
      let cleanups = 0
      let cleanupRequested = false
      let cleanup: Promise<void> | undefined
      const statuses: Array<string> = []
      const collection = createCollection({
        id: `ordinary-admission-cleanup`,
        startSync: false,
        syncMode: history.syncMode,
        getKey: (row: { id: string }) => row.id,
        sync: {
          sync: ({ markReady }) => {
            starts++
            markReady()
            return {
              loadSubset: () => true,
              cleanup: () => {
                cleanups++
                return history.cleanupPending
                  ? pendingCleanup.promise
                  : undefined
              },
            }
          },
        },
      })
      if (history.gate !== `none`) {
        oracleAssertion('existing comparison at 1727', () =>
          expect(collection._deferSyncStart()).toBe(true),
        )
        if (history.gate === `requested`) collection.startSyncImmediate()
      }
      const removeStatusListener = collection.on(
        `status:change`,
        ({ status }) => {
          statuses.push(status)
          if (!cleanupRequested && status === history.cleanupAt) {
            cleanupRequested = true
            cleanup = collection.cleanup()
          }
        },
      )
      let subscription:
        ReturnType<typeof collection.subscribeChanges> | undefined
      let peer: ReturnType<typeof collection.subscribeChanges> | undefined
      try {
        subscription = collection.subscribeChanges(() => {}, {
          includeInitialState: false,
        })
        oracleAssertion('existing comparison at 1747', () =>
          expect(starts, `adapter entries at admission return`).toBe(
            expected.starts,
          ),
        )
        oracleAssertion('existing comparison at 1750', () =>
          expect(cleanups).toBe(expected.cleanups),
        )
        oracleAssertion('existing comparison at 1751', () =>
          expect(collection.status).toBe(expected.statusOnReturn),
        )
        oracleAssertion('existing comparison at 1752', () =>
          expect(statuses).toEqual(expected.statusesOnReturn),
        )

        pendingCleanup.resolve()
        await cleanup
        oracleAssertion('existing comparison at 1756', () =>
          expect(starts, `cleanup settlement must not restart`).toBe(
            expected.starts,
          ),
        )
        oracleAssertion('existing comparison at 1759', () =>
          expect(collection.status).toBe(expected.statusAfterCleanup),
        )
        oracleAssertion('existing comparison at 1760', () =>
          expect(statuses).toEqual(expected.statusesAfterCleanup),
        )

        removeStatusListener()
        peer = collection.subscribeChanges(() => {}, {
          includeInitialState: false,
        })
        oracleAssertion('existing comparison at 1766', () =>
          expect(starts, `later demand may restart a retired run`).toBe(
            expected.starts + (history.cleanupAt === `none` ? 0 : 1),
          ),
        )
        oracleAssertion('existing comparison at 1769', () =>
          expect(collection.status).toBe(`ready`),
        )
      } finally {
        removeStatusListener()
        pendingCleanup.resolve()
        await cleanup
        peer?.unsubscribe()
        subscription?.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  // The callback can release this owner before resumption commits, or from
  // its acquiring notification. Both cuts must leave balanced public counts
  // and no later acquisition. The no-retirement neighbor must acquire normally.
  it.each(
    subscriberResumeRetirementHistories.flatMap((history) =>
      ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
        [false, true].map((renderGate) => ({
          ...history,
          syncMode,
          renderGate,
        })),
      ),
    ),
  )(
    `balances resume at $retireAt (cleanup=$cleanup, $syncMode, gate=$renderGate)`,
    async (history) => {
      oracleRoute(`case`)
      const expected = modelSubscriberResumeRetirement(history)
      let starts = 0
      let loads = 0
      const counts: Array<number> = []
      const collection = createCollection<{ id: string }>({
        getKey: (row) => row.id,
        gcTime: 0,
        syncMode: history.syncMode,
        sync: {
          sync: ({ markReady }) => {
            starts++
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
            }
          },
        },
      })
      if (history.renderGate) collection._deferSyncStart()
      const subscription = collection.subscribeChanges(() => {}, {
        deferAcquisition: true,
        includeInitialState: true,
      })
      let cleanup: Promise<void> | undefined
      let retired = false
      const retire = () => {
        if (retired) return
        retired = true
        subscription.unsubscribe()
        if (history.cleanup) cleanup = collection.cleanup()
      }
      const offStatus = collection.on(`status:change`, ({ status }) => {
        if (status === history.retireAt) retire()
      })
      const offCounts = collection.on(
        `subscribers:change`,
        ({ subscriberCount }) => {
          counts.push(subscriberCount)
          if (history.retireAt === `subscribers` && subscriberCount === 1)
            retire()
        },
      )
      try {
        subscription.resumeDeferredAcquisition()
        oracleAssertion('existing comparison at 1845', () =>
          expect(starts).toBe(expected.starts),
        )
        oracleAssertion('existing comparison at 1846', () =>
          expect(collection.subscriberCount).toBe(expected.acquiring),
        )
        oracleAssertion('existing comparison at 1847', () =>
          expect(counts).toEqual(expected.counts),
        )
        oracleAssertion('existing comparison at 1848', () =>
          expect(collection._hasSubscriberOrPreload()).toBe(
            expected.subscriberOrPreload,
          ),
        )
        await cleanup
        await flushPromises()
        oracleAssertion('existing comparison at 1853', () =>
          expect(collection.subscriberCount).toBe(expected.acquiring),
        )
        oracleAssertion('existing comparison at 1854', () =>
          expect(loads).toBe(
            history.syncMode === `on-demand` && history.retireAt === `none`
              ? 1
              : 0,
          ),
        )
        offStatus()
        offCounts()
        subscription.unsubscribe()
        oracleAssertion('existing comparison at 1862', () =>
          expect(collection.subscriberCount).toBe(0),
        )
      } finally {
        offStatus()
        offCounts()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
})
