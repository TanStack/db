/**
 * Node campaign for the shared-driver K=1 contract documented in
 * `shared-driver-fairness-oracle.ts`. Fixed histories prove neutral reach and a
 * persist storm; generated legal histories vary the sizes of both lanes, mutation
 * width, and tail order. Public rows and logical completion checkpoints are
 * checked independently of production scheduling, and an executable
 * named persist-first FIFO wrong answer proves the checker rejects the original
 * fault. Grammar controls reconstruct that witness, exercise the bounded
 * marginals, reject a nearby invalid storm, and ablate tail-order variation.
 * The identical generated property runs in retained fixed-seed and seedless
 * random campaigns. Supplying both TANSTACK_DB_DRIVER_FAIRNESS_SEED and
 * TANSTACK_DB_DRIVER_FAIRNESS_PATH replaces those campaigns with one checked
 * seed+shrink-path replay. An axis-removal calibration proves that removing
 * tail-order variation loses hydrate-before-later-persist histories.
 * Those grammar controls and the synthetic checker calibration run no
 * production, so they live in `shared-driver-fairness-grammar.test.ts`; the
 * Node driver, check, and grammar live in `shared-driver-fairness-node-oracle.ts`.
 * The shared fixture holds the first `BEGIN IMMEDIATE` while cold `preload()`
 * calls queue. This file supplies BetterSQLite; the receiving witness in
 * `../e2e/shared-driver-fairness-witness.opfs.spec.ts` uses the same fixture with a
 * Chromium OPFSCoopSyncVFS worker after release. It checks rows and K=1 cuts.
 * Generated failures record the original and reduced histories with their
 * violated laws and checkpoints; the report says whether shrinking retained
 * that violation. The full logical persist completion order checks lane FIFO.
 */
import { describe, expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  browserReplayAlias,
  registerBrowserProperty,
} from './browser-property-registration-oracle'
import {
  findSharedDriverFairnessLawViolations,
  findSharedDriverFairnessViolation,
} from './shared-driver-fairness-oracle'
import {
  FairnessOracleFailure,
  GENERATED_RUNS,
  createScenario,
  expectFairObservation,
  expectObservationReach,
  generatedHistoryArbitrary,
  withNodeScenario,
} from './shared-driver-fairness-node-oracle'
import {
  FIXED_SEED,
  readFairnessCalibration,
  readFairnessReplayConfig,
} from './shared-driver-fairness-config'
import type { GeneratedFairnessHistory } from './shared-driver-fairness-node-oracle'
import type {
  SharedDriverFairnessScenario,
  SharedDriverFairnessWork,
} from './shared-driver-fairness-oracle'

const fairnessReplay = readFairnessReplayConfig()
browserReplayAlias(
  fairnessReplay && {
    property: 'browser.shared-driver-fairness',
    ...fairnessReplay,
  },
)
const fairnessCalibration = readFairnessCalibration()

let generatedPropertyExecutions = 0
type GeneratedFailureRecord = {
  law: string
  checkpoint: string
  history: string
  message: string
}
const generatedFailureRecords: Array<GeneratedFailureRecord> = []

function recordGeneratedFailure(error: unknown, history: string): void {
  const primary = error instanceof AggregateError ? error.cause : error
  generatedFailureRecords.push({
    law:
      primary instanceof FairnessOracleFailure
        ? primary.law
        : `unclassified driver or setup failure`,
    checkpoint:
      primary instanceof FairnessOracleFailure
        ? primary.checkpoint
        : `before classified refinement check`,
    history,
    message: error instanceof Error ? error.message : String(error),
  })
}

const runGeneratedFairnessHistory = async ({
  hydrateCount,
  persistCount,
  mutationsPerPersist,
  orderedKinds,
  replayHistory,
}: GeneratedFairnessHistory) => {
  generatedPropertyExecutions++
  const observationId =
    `generated-h${hydrateCount}-p${persistCount}-m${mutationsPerPersist}-` +
    replayHistory.replaceAll(`,`, `-`)
  try {
    await withNodeScenario(
      createScenario(observationId, orderedKinds, mutationsPerPersist),
      expectFairObservation,
      fairnessCalibration,
    )
  } catch (error) {
    recordGeneratedFailure(error, replayHistory)
    throw error
  }
}

// Each fixed history below runs through withNodeScenario and the shared
// comparison, expectFairObservation; the adapter transports that judgment.
const fairnessLaw = `shared-driver K=1 fairness`
const fairnessLawText = {
  statement: `Under a persist storm, the already-running persist completes before the first cold hydrate, at most one more persist completes between consecutive hydrate completions, FIFO order holds inside each lane, and hydrated public rows equal their independently seeded rows.`,
  authority: `RFC #1659's K=1 complete-logical-cold-hydrate scheduling, as shared-driver-fairness-oracle.ts states it.`,
}

async function runNeutralReach(): Promise<void> {
  await withNodeScenario(
    createScenario(`neutral-reach`, [`hydrate`, `hydrate`, `hydrate`]),
    (observation) => {
      expectFairObservation(observation)
      expect(
        observation.rawDequeues.some((entry) =>
          entry.sql.startsWith(`SELECT key, value, metadata, row_version FROM`),
        ),
      ).toBe(true)
    },
  )
}

async function runFixedPersistStorm(): Promise<void> {
  const scenario = createScenario(
    `fixed-persist-storm`,
    [`persist`, `persist`, `persist`, `hydrate`, `hydrate`],
    2,
  )
  await withNodeScenario(scenario, (observation) => {
    expectFairObservation(observation)

    // A K=2 scheduler could finish the third persist before the second
    // hydrate. K=1 must leave it pending at that logical checkpoint.
    const secondHydrate = observation.hydrationCompletions[1]!
    expect(secondHydrate.pendingPersistCount).toBeGreaterThan(0)
    const completedPersistIds = scenario.work
      .filter((work) => work.kind === `persist`)
      .map((work) => `${scenario.id}-${work.id}`)
    expect(observation.hydrationCompletions[0]?.completedPersistIds).toEqual(
      completedPersistIds.slice(0, 1),
    )
    const k2WrongAnswer = {
      ...observation,
      logicalCompletionOrder: [
        `persist:${completedPersistIds[0]}`,
        `hydrate:${observation.hydrationCompletions[0]!.collectionId}`,
        `persist:${completedPersistIds[1]}`,
        `persist:${completedPersistIds[2]}`,
        `hydrate:${secondHydrate.collectionId}`,
      ],
      hydrationCompletions: [
        observation.hydrationCompletions[0]!,
        {
          ...secondHydrate,
          completionOrdinal: 4,
          completedPersistIds,
          pendingPersistCount: 0,
        },
      ],
    }
    expect(findSharedDriverFairnessViolation(k2WrongAnswer)).toMatchObject({
      checkpoint: k2WrongAnswer.hydrationCompletions[1],
      expectedMaximumCompletedPersists: 2,
      expectedMinimumPendingPersists: 1,
    })
    expect(findSharedDriverFairnessViolation(k2WrongAnswer, 2)).toBeUndefined()

    // A hydrate that preempts the running persist stays under every K=1
    // ceiling. Only the non-preemptible law rejects it.
    const firstHydrate = observation.hydrationCompletions[0]!
    const preemptedWrongAnswer = {
      ...observation,
      hydrationCompletions: [
        {
          ...firstHydrate,
          completedPersistIds: [],
          pendingPersistCount: firstHydrate.pendingPersistCount + 1,
        },
        ...observation.hydrationCompletions.slice(1),
      ],
    }
    expect(
      findSharedDriverFairnessViolation(preemptedWrongAnswer),
    ).toBeUndefined()
    expect(
      findSharedDriverFairnessLawViolations(preemptedWrongAnswer).map(
        ({ law, checkpoint }) => ({ law, checkpoint }),
      ),
    ).toEqual([
      {
        law: `non-preemptible running persist`,
        checkpoint: `hydrate completion 0`,
      },
    ])

    const swappedPersistOrder = observation.logicalCompletionOrder.map(
      (entry) => {
        if (entry === `persist:${completedPersistIds[1]}`) {
          return `persist:${completedPersistIds[2]}`
        }
        if (entry === `persist:${completedPersistIds[2]}`) {
          return `persist:${completedPersistIds[1]}`
        }
        return entry
      },
    )
    let orderFailure: unknown
    try {
      expectFairObservation({
        ...observation,
        logicalCompletionOrder: swappedPersistOrder,
      })
    } catch (error) {
      orderFailure = error
    }
    expect(orderFailure).toMatchObject({
      law: `persist FIFO completion order`,
      checkpoint: `after all work settled`,
    })
  })
}

// The named persist-first storm: four persists, then two hydrates. The real
// scheduler must pass it; the persist-first FIFO scheduling mutant must fail
// the checker on it.
const persistFirstScenario = () =>
  createScenario(
    `persist-first-fixture-fault`,
    [`persist`, `persist`, `persist`, `persist`, `hydrate`, `hydrate`],
    1,
  )

async function rejectPersistFirstFifo(): Promise<void> {
  let rejected: ReturnType<typeof findSharedDriverFairnessViolation>
  // A failure of this witness's own checks, including the marked reach check,
  // fails the calibration, as it failed the old test: it is rethrown without a
  // cause chain, so the adapter cannot read it as the check rejecting the
  // mutant. Only the violation found below counts as that rejection.
  try {
    await withNodeScenario(
      createScenario(
        `persist-first-fixture-fault`,
        [`persist`, `persist`, `persist`, `persist`, `hydrate`, `hydrate`],
        1,
      ),
      (observation) => {
        expectObservationReach(observation)
        const violation = findSharedDriverFairnessViolation(observation)
        if (!violation) {
          throw new Error(
            `persist-first scheduling mutant escaped the fairness checker; ` +
              `cleanup diagnostics: ${JSON.stringify(observation.cleanupFailures)}`,
          )
        }
        expect(violation.checkpoint.completedPersistIds).toHaveLength(4)
        expect(violation.checkpoint.pendingPersistCount).toBe(0)
        expect(observation.cleanupFailures).toEqual([])
        rejected = violation
      },
      { schedulingFault: `persist-first-fifo` },
    )
  } catch (error) {
    throw Object.assign(
      new Error(
        `persist-first calibration witness failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
      { witnessFailure: error },
    )
  }
  // The checker found the mutant's violation at the asserted checkpoint.
  if (rejected)
    rejectAt(
      `calibration persist-first-fifo`,
      new Error(
        `persist-first scheduling mutant rejected: ${JSON.stringify(rejected.checkpoint)}`,
      ),
    )
}

describe(`shared BrowserWASQLiteDriver fairness oracle`, () => {
  oracleProperty({
    id: `browser.shared-driver-fairness.neutral`,
    law: {
      ...fairnessLawText,
      limits: `The neutral hydrate-only history: cold hydration is reached and public rows are preserved without queued persists.`,
    },
    owns: [`src/wa-sqlite-driver.ts`],
    histories: [
      {
        name: `reaches cold hydration and preserves independently seeded public rows without queued persists`,
      },
    ],
    label: ({ name }) => name,
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(fairnessLaw, plan, observe, () =>
        runNeutralReach(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `browser.shared-driver-fairness.persist-storm`,
    law: {
      ...fairnessLawText,
      limits: `The fixed persist storm, with its checker calibrations of a K=2 answer, a preempted running persist, and swapped persist order on the real observation.`,
    },
    owns: [`src/wa-sqlite-driver.ts`],
    histories: [
      {
        name: `completes a pending cold hydrate before an unrelated persist backlog drains and distinguishes K=1 from K=2`,
      },
    ],
    label: ({ name }) => name,
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(fairnessLaw, plan, observe, () =>
        runFixedPersistStorm(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `browser.shared-driver-fairness.persist-first`,
    law: {
      ...fairnessLawText,
      limits: `The named persist-first storm through the real package path; its calibration runs the persist-first FIFO scheduling mutant.`,
    },
    owns: [`src/wa-sqlite-driver.ts`],
    histories: [{ name: `persist-first-fixture` }],
    label: ({ name }) => name,
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(fairnessLaw, plan, observe, () =>
        withNodeScenario(persistFirstScenario(), expectFairObservation),
      ),
    check: forwardAssertionJudgment,
    calibrations: [
      {
        name: `rejects the named persist-first FIFO wrong answer through the real package path`,
        law: fairnessLaw,
        driver: (plan, observe) =>
          recordAssertionJudgment(fairnessLaw, plan, observe, () =>
            rejectPersistFirstFifo(),
          ),
      },
    ],
  })

  {
    let executionsBefore = 0
    registerBrowserProperty(
      generatedHistoryArbitrary,
      {
        id: 'browser.shared-driver-fairness',
        owns: [`src/wa-sqlite-driver.ts`],
        runs: GENERATED_RUNS,
        fixedSeed: FIXED_SEED,
        beforeCampaign: () => {
          executionsBefore = generatedPropertyExecutions
          generatedFailureRecords.length = 0
        },
        failedCampaign: () => {
          const original = generatedFailureRecords[0]
          const reduced = generatedFailureRecords.at(-1)
          console.info(`shared-driver fairness original and reduced failure`, {
            original,
            reduced,
            sameViolation:
              original !== undefined &&
              reduced !== undefined &&
              original.law !== `unclassified driver or setup failure` &&
              original.law === reduced.law &&
              original.checkpoint === reduced.checkpoint,
          })
          // The native runner reports the campaign seed, shrink count and path.
        },
        afterCampaign: () => {
          oracleAssertion('shared-driver-fairness', () =>
            expect(generatedPropertyExecutions).toBeGreaterThan(
              executionsBefore,
            ),
          )
        },
      },
      `bounds persist completions for generated ordered cold-hydrate/persist histories`,
      runGeneratedFairnessHistory,
      30_000,
    )
  }

  // An election barrier waits between two queued hydrates while persists are
  // queued. It waits for the work queued before it (persist-0 and hydrate-0)
  // and is not logical work, so the K=1 checkpoints and the full interleaving
  // must equal the same history without it. The scheduler trace shows that it
  // settled after the hydrate queued before it and before the hydrate queued
  // after it. An empty hydrate scope used as the barrier is a hydrate
  // completion for K=1 and lets a second persist through; an empty regular
  // task takes the persist slot after hydrate-0 and delays persist-1.
  describe(`election barrier between queued hydrates`, () => {
    const id = `barrier-between-hydrates`
    const hydrate = (index: number): SharedDriverFairnessWork => ({
      kind: `hydrate`,
      id: `hydrate-${index}`,
      seededRows: [{ id: `row-${index}`, value: index }],
    })
    const persist = (index: number): SharedDriverFairnessWork => ({
      kind: `persist`,
      id: `persist-${index}`,
      mutationsPerPersist: 1,
    })
    const withBarrier: SharedDriverFairnessScenario = {
      id,
      work: [
        persist(0),
        hydrate(0),
        { kind: `barrier`, id: `barrier-0` },
        hydrate(1),
        persist(1),
        persist(2),
      ],
    }
    const withoutBarrier: SharedDriverFairnessScenario = {
      id,
      work: withBarrier.work.filter((work) => work.kind !== `barrier`),
    }

    async function runBarrierHistory(): Promise<void> {
      let baseline: ReadonlyArray<string> | undefined
      await withNodeScenario(withoutBarrier, (observation) => {
        expectFairObservation(observation)
        baseline = observation.logicalCompletionOrder
      })
      await withNodeScenario(withBarrier, (observation) => {
        expectFairObservation(observation)
        expect(observation.logicalCompletionOrder).toEqual(baseline)
        const trace = observation.schedulerTrace
        expect(trace[0]).toBe(`barrier-call:barrier-0@1`)
        const settled = trace.indexOf(`barrier-settled:barrier-0`)
        expect(settled).toBeGreaterThan(trace.indexOf(`hydrate-scope-end:1`))
        expect(settled).toBeLessThan(trace.indexOf(`hydrate-scope-end:2`))
      })
    }

    async function rejectEmptyRegularBarrier(): Promise<void> {
      let baseline: ReadonlyArray<string> | undefined
      await withNodeScenario(withoutBarrier, (observation) => {
        baseline = observation.logicalCompletionOrder
      })
      let observed: ReadonlyArray<string> | undefined
      let checkerFailure: unknown
      await withNodeScenario(
        withBarrier,
        (observation) => {
          observed = observation.logicalCompletionOrder
          try {
            expectFairObservation(observation)
          } catch (error) {
            checkerFailure = error
          }
        },
        { barrierFault: `empty-regular` },
      )
      const outcome = {
        sameInterleaving: JSON.stringify(observed) === JSON.stringify(baseline),
        checkerFailed: checkerFailure !== undefined,
      }
      // Exactly the old matcher, which required this outcome not to equal
      // { sameInterleaving: true, checkerFailed: false }: the mutant counts as
      // rejected when it changed the interleaving or failed the checker.
      if (!outcome.sameInterleaving || outcome.checkerFailed)
        rejectAt(
          `calibration empty-regular`,
          new Error(
            `empty regular barrier rejected: ${JSON.stringify(outcome)}`,
            { cause: checkerFailure },
          ),
        )
    }

    async function rejectEmptyHydrateBarrier(): Promise<void> {
      let failure: unknown
      await withNodeScenario(
        withBarrier,
        (observation) => {
          try {
            expectFairObservation(observation)
          } catch (error) {
            failure = error
          }
        },
        { barrierFault: `empty-hydrate` },
      )
      // Exactly the old matcher: only a failure that names this law and
      // checkpoint counts as the check rejecting the empty hydrate scope.
      const matched =
        typeof failure === `object` &&
        failure !== null &&
        `law` in failure &&
        failure.law ===
          `K=1 completed-persist bound; K=1 pending-persist backlog; completed persist outside permitted prefix` &&
        `checkpoint` in failure &&
        failure.checkpoint === `hydrate completion 1`
      if (matched)
        rejectAt(
          `calibration empty-hydrate`,
          failure instanceof Error
            ? failure
            : new Error(`empty hydrate barrier rejected`, { cause: failure }),
        )
    }

    oracleProperty({
      id: `browser.shared-driver-fairness.barrier`,
      law: {
        ...fairnessLawText,
        limits: `One election barrier between two queued hydrates, compared with the same history without it; its calibrations run an empty regular task and an empty hydrate scope as the barrier.`,
      },
      owns: [`src/wa-sqlite-driver.ts`],
      histories: [
        {
          name: `keeps the K=1 interleaving and waits only for the hydrate queued before it`,
        },
      ],
      label: ({ name }) => name,
      model: recordedAssertionJudgment,
      driver: (plan, observe) =>
        recordAssertionJudgment(fairnessLaw, plan, observe, () =>
          runBarrierHistory(),
        ),
      check: forwardAssertionJudgment,
      calibrations: [
        {
          name: `rejects an empty regular task used as the barrier`,
          law: fairnessLaw,
          driver: (plan, observe) =>
            recordAssertionJudgment(fairnessLaw, plan, observe, () =>
              rejectEmptyRegularBarrier(),
            ),
        },
        {
          name: `rejects an empty hydrate scope used as the barrier`,
          law: fairnessLaw,
          driver: (plan, observe) =>
            recordAssertionJudgment(fairnessLaw, plan, observe, () =>
              rejectEmptyHydrateBarrier(),
            ),
        },
      ],
    })
  })
})
