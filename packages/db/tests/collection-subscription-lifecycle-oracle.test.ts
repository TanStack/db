import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { createOracleReach } from './oracle-reach.js'
import {
  captureMicrotaskErrors,
  createOnDemandCollection,
  flushPromises,
} from './utils.js'
import {
  oraclePropertyOptions,
  oracleRandomParameters,
  oracleReplayTest,
  readOracleRunConfig,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
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
    expect(
      [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [...scenario.demands]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, version: 1 })),
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
        expect(
          [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
        ).toEqual(retainedRows)
        // Repeated coherent notifications are legal; each copied snapshot
        // must retain the last complete publication until replacement settles.
        for (const snapshot of publications.slice(prefixStart)) {
          expect(snapshot).toEqual(retainedRows)
        }
      }
      assertRetainedPrefix()
      await collection.cleanup()
      assertRetainedPrefix()
      for (const attempt of attempts.filter(
        ({ syncRunGeneration: attemptSyncRunGeneration }) =>
          attemptSyncRunGeneration === discardedSyncRunGeneration,
      )) {
        expect(attempt.options.signal?.aborted).toBe(true)
      }
      collection.startSyncImmediate()
      assertRetainedPrefix()
      await flushPromises()
      assertRetainedPrefix()
      const expectedSyncRunGeneration = restartIndex + 1
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
        expect(
          [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
        ).toEqual(expectedRows)
        expect(publications.slice(publicationCount)).toEqual([expectedRows])
        publishedBeforeRetirement.add(expectedSyncRunGeneration)
      }
    }

    const currentSyncRunGeneration = scenario.syncRunOutcomes.length
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
      expect(
        [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(expectedRows)
      const expectedFailedAttempts = settledCurrent.filter(
        (attempt) => outcomeFor(attempt) === `reject`,
      )
      expect(errors.map(({ demand }) => demand)).toEqual(
        expectedFailedAttempts.map(({ demand }) => demand),
      )
      for (const [index, { error }] of errors.entries()) {
        expect(error).toBe(failureFor(expectedFailedAttempts[index]!))
      }
      expect(subscription.lastError).toBe(
        expectedFailedAttempts.length
          ? failureFor(expectedFailedAttempts.at(-1)!)
          : undefined,
      )
      expect(subscription.status).toBe(
        currentComplete ? `ready` : `loadingSubset`,
      )
      expect(publications.slice(publicationTraceStart)).toEqual(
        currentComplete && currentSucceeded ? [expectedRows] : [],
      )
      expect(statuses.slice(statusTraceStart)).toEqual(
        currentComplete ? [`ready`] : [],
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
    expect(
      [...visible.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [...scenario.demands]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ id, version: expectedVersion })),
    )
    if (currentSucceeded) {
      expect(errors).toEqual([])
      expect(subscription.lastError).toBeUndefined()
    } else {
      const expectedFailedAttempts = settledCurrent.filter(
        (attempt) => outcomeFor(attempt) === `reject`,
      )
      expect(errors.map(({ demand }) => demand)).toEqual(
        expectedFailedAttempts.map(({ demand }) => demand),
      )
      for (const [index, { error }] of errors.entries()) {
        expect(error).toBe(failureFor(expectedFailedAttempts[index]!))
      }
      expect(subscription.lastError).toBe(
        failureFor(expectedFailedAttempts.at(-1)!),
      )
    }
    expect(subscription.status).toBe(`ready`)
    for (const attempt of current) {
      expect(attempt.options.signal?.aborted).toBe(false)
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
    expect(new Set(settlements.map(({ attempt }) => attempt)).size).toBe(
      settlements.length,
    )
    expect(settlements).toHaveLength(
      attempts.filter(
        ({ syncRunGeneration: attemptSyncRunGeneration }) =>
          attemptSyncRunGeneration > 0,
      ).length,
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
      expect(attempt.options.signal?.aborted).toBe(true)
    }
    expect(unloads).toEqual(
      scenario.demands.map((demand) => ({
        syncRunGeneration: currentSyncRunGeneration,
        demand,
      })),
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
 * Private-replay model: a replay whose current attempt settles before the
 * obsolete one stays private. Its prior row stays visible and publishes no
 * replacement until the obsolete attempt settles.
 */
function isPrivateReplay(
  origin: `initial` | `replay`,
  order: `old-first` | `current-first`,
): boolean {
  return origin === `replay` && order === `current-first`
}

/**
 * Readiness model: the subscription is ready after the current attempt settles
 * only when the obsolete attempt already settled.
 */
function expectedStatusAfterCurrentSettles(
  order: `old-first` | `current-first`,
): `ready` | `loadingSubset` {
  return order === `old-first` ? `ready` : `loadingSubset`
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

declareOracle({
  check: [runAsyncRestartScenario],
  model: [
    modelSubscriberResumeRetirement,
    startupRetirementModel,
    expectedUnloadsAfterUnavailableWait,
    expectedLoadsAfterCleanupEndsWait,
    expectedStatusAfterQueuedCancel,
    expectedUncaughtReleaseErrors,
    expectedSubscriberCountAfterRelease,
    isPrivateReplay,
    expectedStatusAfterCurrentSettles,
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
  const { multiplier, ...replay } = readOracleRunConfig()

  it(`executes every required async restart regime`, async () => {
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
    expect(required.filter((label) => !reach.has(label))).toEqual([])
  })

  it(`covers every finite start, failure-delivery, and release cell`, () => {
    expect(
      new Set(
        startScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(startOutcomes.length * startReentries.length)
    expect(
      new Set(
        failureScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(2 * startReentries.length)
    expect(
      new Set(
        releaseScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(2 * 4)
    expect(
      new Set(
        restartScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(4 * 5)
  })

  it(`accounts for every acquisition phase and entry pair`, () => {
    const allCells = new Set<AcquisitionCell>(
      acquisitionPhases.flatMap((phase) =>
        acquisitionEntries.map((entry) => `${phase}:${entry}` as const),
      ),
    )
    expect(
      new Set([...legalAcquisitionCells, ...excludedAcquisitionCells.keys()]),
    ).toEqual(allCells)
  })

  it(`accounts for every acquisition lifecycle state and interaction cause`, () => {
    const allCells = new Set<AcquisitionInteractionCell>(
      acquisitionLifecycleStates.flatMap((state) =>
        acquisitionInteractionCauses.map(
          (cause) => `${state}:${cause}` as const,
        ),
      ),
    )
    expect(new Set(Object.keys(acquisitionInteractionCellDefinitions))).toEqual(
      allCells,
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
          expect(() => collection.startSyncImmediate()).toThrow(failure)
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
          expect(nestedRestartError).toMatchObject({
            name: `CollectionStateError`,
            message: expect.stringContaining(`after cleanup() completes`),
          })
        } else {
          expect(nestedRestartError).toBeUndefined()
        }
        expect(collection.status).toBe(
          restartSucceeded ? `ready` : `cleaned-up`,
        )
        expect(cleanups).toEqual(returnsObsoleteCleanup ? [0, 1] : [0])
        expect(syncRunGeneration).toBe(
          entry === `loading` ? (restart ? 1 : 0) : 1,
        )

        if (restartSucceeded) {
          subscription.requestSnapshot({
            where: new Func(`eq`, [new PropRef([`id`]), new Value(`row`)]),
          })
          expect(loads).toEqual([syncRunGeneration])
          subscription.unsubscribe()
          expect(unloads).toEqual([syncRunGeneration])
        } else {
          expect(loads).toEqual([])
          expect(unloads).toEqual([])
        }
      } finally {
        removeListener()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`error`, `cleaned-up`] as const).flatMap((unavailable) =>
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
    async ({ unavailable, outcome, phase, entry }) => {
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
        if (unavailable === `error`)
          operations.markError(new Error(`initial error`))
        else await collection.cleanup()
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
        expect(callbacks).toBe(1)
        expect(result).toBeInstanceOf(Promise)
        await flushPromises()
        expect(settlements).toEqual([])
        expect(loads).toEqual([])
        const recover = () => {
          if (unavailable === `cleaned-up`) collection.startSyncImmediate()
          operations.markReady()
        }
        if (phase === `during`) {
          recover()
          await flushPromises()
          expect(loads).toHaveLength(1)
          if (outcome !== `return` && outcome !== `throw`) {
            expect(settlements).toEqual([])
            expect([...rows.values()]).toEqual([])
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
          expect(settlements).toEqual([`success`])
          expect(visibleOnSuccess).toEqual([[`row`]])
          expect([...rows.values()].map(({ id }) => id)).toEqual([`row`])
        } else if (outcome === `throw` || outcome === `reject`) {
          expect(settlements).toHaveLength(1)
          expect(settlements[0]).toBe(failure)
          expect([...rows.values()]).toEqual([])
        } else {
          expect(settlements).toEqual([
            expect.objectContaining({ name: `AbortError` }),
          ])
          expect(unloads).toEqual(
            expectedUnloadsAfterUnavailableWait(phase, outcome, loads),
          )
          if (phase === `before` && outcome !== `cleanup`) {
            recover()
            await flushPromises()
            expect(loads).toEqual([])
          }
          if (outcome === `cleanup`) {
            // Cleanup ends this wait, not the surviving subscription's demand.
            collection.startSyncImmediate()
            operations.markReady()
            await flushPromises()
            expect(loads).toHaveLength(expectedLoadsAfterCleanupEndsWait(phase))
          }
          // Non-cooperative late settlement cannot rewrite the observed outcome.
          transport.resolve()
          await flushPromises()
          expect(settlements).toEqual([
            expect.objectContaining({ name: `AbortError` }),
          ])
        }
        expect(callbacks).toBe(1)
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
      expect(collection._deferSyncStart()).toBe(true)
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

        expect(collection.status).toBe(expectedStatusAfterQueuedCancel(action))
        expect(loads).toHaveLength(0)
        expect(unloads).toHaveLength(0)
        expect(observed).toHaveLength(1)
        await expect(observed[0]).rejects.toMatchObject({ name: `AbortError` })
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

        expect(loads).toHaveLength(1)
        expect(unloads).toHaveLength(1)
        expect(unloads[0]).toBe(loads[0])
        expect(loads[0]!.signal!.aborted).toBe(true)
        expect(subscription.status).toBe(`ready`)
        // The release error is reported uncaught, not as a load error.
        expect(errors).toEqual([])
        expect(uncaught.errors).toEqual(
          expectedUncaughtReleaseErrors(outcome, failure),
        )

        releaseOwner()
        expect(unloads).toHaveLength(1)
        subscription.unsubscribe()
        expect(unloads).toHaveLength(1)
        for (const options of unloads) expect(options).toBe(loads[0])
        expect(loads).toHaveLength(1)
        await Promise.resolve()
        expect(uncaught.errors).toEqual(
          expectedUncaughtReleaseErrors(outcome, failure),
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
        expect(releaseError).toBe(undefined)
        // Adapter reentry sees a retired acquisition, including after throw.
        // A release error reaches no error listener, so that listener cannot
        // reenter teardown.
        expect(unloads).toHaveLength(1)
        // Only the adapter path reentered and unsubscribed.
        expect(collection.subscriberCount).toBe(
          expectedSubscriberCountAfterRelease(reentry),
        )
        expect(errors).toEqual([])
        expect(nestedFailures).toEqual([])
        expect(() => subscription.unsubscribe()).not.toThrow()
        expect(unloads).toHaveLength(1)
        subscription.unsubscribe()
        expect(unloads).toHaveLength(1)
        expect(loads).toHaveLength(1)
        for (const options of unloads) expect(options).toBe(loads[0])
        await Promise.resolve()
        // One attempt, one report, whatever the adapter would throw later.
        expect(uncaught.errors).toEqual([failure])
      } finally {
        uncaught.restore()
        await collection.cleanup()
        subscription.unsubscribe()
      }
    },
  )

  it.each(
    ([`initial`, `replay`] as const).flatMap((origin) =>
      ([`resolve`, `reject`] as const).flatMap((oldOutcome) =>
        ([`old-first`, `current-first`] as const).map((order) => ({
          origin,
          oldOutcome,
          order,
        })),
      ),
    ),
  )(
    `separates publication from readiness for pending $origin work, $oldOutcome, $order`,
    async ({ origin, oldOutcome, order }) => {
      type Row = { id: string; version: number }
      const where = {
        a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
        b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
      }
      const loads: Array<{
        options: LoadSubsetOptions
        deferred: ReturnType<typeof createDeferred<void>>
      }> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      const visible = new Map<string | number, Row>()
      let emptyBatches = 0
      let replacementChanges = 0
      let operations!: Parameters<SyncConfig<Row, string>[`sync`]>[0]
      const collection = createCollection<Row, string>({
        id: `publication-readiness-boundary`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (nextOperations) => {
            operations = nextOperations
            operations.markReady()
            return {
              loadSubset: (options) => {
                const deferred = createDeferred<void>()
                void deferred.promise.catch(() => {})
                loads.push({ options, deferred })
                return deferred.promise
              },
              unloadSubset: (options) => {
                unloads.push(options)
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          if (changes.length === 0) emptyBatches++
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
              if (change.value.id === `b` && change.value.version === 2)
                replacementChanges++
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      const write = async (id: string, version: number) => {
        operations.begin()
        operations.write({
          type: collection.has(id) ? `update` : `insert`,
          value: { id, version },
        })
        const receipt = operations.commit()
        if (receipt !== true) await receipt
      }
      const truncate = async () => {
        operations.begin()
        operations.truncate()
        const receipt = operations.commit()
        if (receipt !== true) await receipt
        await flushPromises()
      }
      const settle = async (
        attempt: (typeof loads)[number],
        outcome: `resolve` | `reject`,
        id = `b`,
      ) => {
        // The source cannot cancel transport promptly, but must suppress its
        // canceled writes. Late settlement does not install an obsolete row.
        if (outcome === `resolve`) {
          if (!attempt.options.signal?.aborted) await write(id, 2)
          attempt.deferred.resolve()
        } else attempt.deferred.reject(new Error(`obsolete source failed`))
        await flushPromises()
      }
      try {
        subscription.requestSnapshot({ where: where.b })
        await write(`b`, 0)
        if (origin === `replay`) {
          loads[0]!.deferred.resolve()
          await flushPromises()
          await truncate()
        }
        const old = loads.at(-1)!
        await truncate()
        const current = loads.at(-1)!
        expect(old.options.signal?.aborted).toBe(true)
        expect([...visible.values()]).toEqual([{ id: `b`, version: 0 }])
        if (order === `old-first`) {
          await settle(old, oldOutcome)
          expect(subscription.status).toBe(`loadingSubset`)
          expect([...visible.values()]).toEqual([{ id: `b`, version: 0 }])
        }
        await settle(current, `resolve`)
        const privateReplay = isPrivateReplay(origin, order)
        expect([...visible.values()]).toEqual([
          { id: `b`, version: privateReplay ? 0 : 2 },
        ])
        expect(subscription.status).toBe(
          expectedStatusAfterCurrentSettles(order),
        )
        const emptyBeforeRequest = emptyBatches
        subscription.requestSnapshot({ where: where.a })
        expect(emptyBatches - emptyBeforeRequest).toBe(privateReplay ? 0 : 1)
        await settle(loads.at(-1)!, `resolve`, `a`)
        expect([...visible.values()]).toEqual(
          privateReplay
            ? [{ id: `b`, version: 0 }]
            : [
                { id: `b`, version: 2 },
                { id: `a`, version: 2 },
              ],
        )
        if (order === `current-first`) await settle(old, oldOutcome)
        expect([...visible.values()]).toEqual([
          { id: `b`, version: 2 },
          { id: `a`, version: 2 },
        ])
        expect(subscription.status).toBe(`ready`)
        expect(errors).toEqual([])
        expect(replacementChanges).toBe(1)
        subscription.unsubscribe()
        expect(unloads).toHaveLength(loads.length)
        for (const { options } of loads)
          expect(unloads.filter((value) => value === options)).toHaveLength(1)
      } finally {
        for (const { deferred } of loads) deferred.resolve()
        await flushPromises()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(threeGenerationScenarios)(
    `fences three sync-run generations for $obsoleteOutcome/$currentOutcome settled $settlementOrder`,
    async ({ obsoleteOutcome, currentOutcome, settlementOrder }) => {
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
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])

      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      expect(subscription.status).toBe(`loadingSubset`)

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
        expect(subscription.status).toBe(`loadingSubset`)
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
      expect([...visible.values()]).toEqual([
        { id: `row`, version: settled.version },
      ])
      expect(errors).toEqual(settled.errors)
      expect(subscription.lastError).toBe(settled.lastError)
      expect(subscription.status).toBe(`ready`)

      subscription.unsubscribe()
      expect(unloadSyncRunGenerations).toEqual([2])
      await collection.cleanup()
    },
  )

  const fixedCampaign = oracleReplayTest(fcTest)

  fixedCampaign.prop([asyncRestartScenarioArbitrary], {
    numRuns: 30 * multiplier,
    seed: 1_657_002,
  })(
    `fences async demand settlements across sync-run generations for a fixed seed`,
    async (scenario) => {
      await runAsyncRestartScenario(scenario)
    },
    120_000,
  )

  fcTest.prop(
    [asyncRestartScenarioArbitrary],
    oracleRandomParameters(
      30 * multiplier,
      replay,
      `subscription-lifecycle.async-restart`,
    ),
  )(
    `fences async demand settlements across sync-run generations for a random or replayed seed`,
    async (scenario) => {
      await runAsyncRestartScenario(scenario)
    },
    120_000,
  )
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
  for (const campaign of [`fixed`, `random`] as const) {
    it(`acquires retained demand after replacement readiness (${campaign})`, async () => {
      const reach = createOracleReach(`resume-notification-error`, [
        `throwing-notification`,
        `retained-owner`,
        `held-cleanup`,
        `replacement-ready`,
      ])
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            pending: fc.boolean(),
            throws: fc.boolean(),
            demands: fc.integer({ min: 1, max: 3 }),
          }),
          async (history) => {
            reach.beginHistory()
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
                where: new Func(`eq`, [
                  new PropRef([`id`]),
                  new Value(String(i)),
                ]),
              })
            // Drain the initial run's notifications while demand still defers.
            await flushPromises()
            expect(loads).toBe(0)
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
              expect(notifications).toBe(2)
              expect(result.threw).toBe(history.throws)
              if (history.throws) {
                expect(result.error).toBe(failure)
                reach.reach(`throwing-notification`)
              }
              expect(subscription.isDeferringAcquisition()).toBe(false)
              expect(source.subscriberCount).toBe(1)
              reach.reach(`retained-owner`)
              if (history.pending) {
                expect(source.status).toBe(`ready`)
                reach.reach(`held-cleanup`)
              }
              gate.resolve()
              await cleanup
              if (history.pending) source.startSyncImmediate()
              await flushPromises()
              reach.reach(`replacement-ready`)
              expect(source.status).toBe(`ready`)
              expect(loads).toBe(history.demands)
              expect(subscription.status).toBe(`ready`)
            } finally {
              off()
              subscription.unsubscribe()
              gate.resolve()
              await source.cleanup()
            }
          },
        ),
        campaign === `fixed`
          ? { ...oraclePropertyOptions(60), seed: 2229 }
          : oraclePropertyOptions(
              60,
              `subscription-lifecycle.notification-error`,
            ),
      )
      reach.assertReached()
      console.info(
        `resume-notification-error ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    })
  }
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
        expect(collection._deferSyncStart()).toBe(true)
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
        expect(starts, `adapter entries at admission return`).toBe(
          expected.starts,
        )
        expect(cleanups).toBe(expected.cleanups)
        expect(collection.status).toBe(expected.statusOnReturn)
        expect(statuses).toEqual(expected.statusesOnReturn)

        pendingCleanup.resolve()
        await cleanup
        expect(starts, `cleanup settlement must not restart`).toBe(
          expected.starts,
        )
        expect(collection.status).toBe(expected.statusAfterCleanup)
        expect(statuses).toEqual(expected.statusesAfterCleanup)

        removeStatusListener()
        peer = collection.subscribeChanges(() => {}, {
          includeInitialState: false,
        })
        expect(starts, `later demand may restart a retired run`).toBe(
          expected.starts + (history.cleanupAt === `none` ? 0 : 1),
        )
        expect(collection.status).toBe(`ready`)
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
        expect(starts).toBe(expected.starts)
        expect(collection.subscriberCount).toBe(expected.acquiring)
        expect(counts).toEqual(expected.counts)
        expect(collection._hasSubscriberOrPreload()).toBe(
          expected.subscriberOrPreload,
        )
        await cleanup
        await flushPromises()
        expect(collection.subscriberCount).toBe(expected.acquiring)
        expect(loads).toBe(
          history.syncMode === `on-demand` && history.retireAt === `none`
            ? 1
            : 0,
        )
        offStatus()
        offCounts()
        subscription.unsubscribe()
        expect(collection.subscriberCount).toBe(0)
      } finally {
        offStatus()
        offCounts()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
})
