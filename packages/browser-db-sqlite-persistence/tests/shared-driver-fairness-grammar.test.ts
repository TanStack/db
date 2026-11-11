/**
 * Calibrations of the shared-driver fairness grammar and checker. The grammar
 * reconstructs the known persist-first witness, covers the range marginals,
 * and rejects a nearby invalid storm before any production work; removing
 * tail-order variation loses every hydrate-before-later-persist history; and
 * the checker rejects a synthetic persist-first observation. They run no
 * production, so they are ordinary tests. The campaign that drives production
 * is shared-driver-fairness-oracle.test.ts.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { oracleRuns } from '../../db/tests/oracle-config'
import {
  createPersistFirstFaultObservation,
  findSharedDriverFairnessViolation,
} from './shared-driver-fairness-oracle'
import {
  GENERATED_RUNS,
  buildGeneratedHistory,
  createScenario,
  expectFairObservation,
  generatedHistoryArbitrary,
  reachesHydrateBeforeLaterPersist,
  tailOrderAblatedArbitrary,
  withNodeScenario,
} from './shared-driver-fairness-node-oracle'
import { FIXED_SEED } from './shared-driver-fairness-config'

describe(`shared BrowserWASQLiteDriver fairness oracle`, () => {
  it(`reconstructs the known persist-first witness, covers range marginals, and rejects a nearby invalid storm`, async () => {
    const knownWitness = buildGeneratedHistory(2, 4, 1, [
      { kind: `persist`, token: `p1` },
      { kind: `persist`, token: `p2` },
      { kind: `persist`, token: `p3` },
      { kind: `hydrate`, token: `h0` },
      { kind: `hydrate`, token: `h1` },
    ])
    expect(knownWitness).toEqual({
      hydrateCount: 2,
      persistCount: 4,
      mutationsPerPersist: 1,
      orderedKinds: [
        `persist`,
        `persist`,
        `persist`,
        `persist`,
        `hydrate`,
        `hydrate`,
      ],
      replayHistory: `p0,p1,p2,p3,h0,h1`,
    })

    // Fixing hydrate count at two loses later completion checkpoints. Fixing
    // persist count at three loses larger backlogs. Fixing mutation width at
    // one loses multi-row work inside one logical persist.
    const marginalHistories = [
      buildGeneratedHistory(2, 3, 1, [
        { kind: `persist`, token: `p1` },
        { kind: `persist`, token: `p2` },
        { kind: `hydrate`, token: `h0` },
        { kind: `hydrate`, token: `h1` },
      ]),
      buildGeneratedHistory(7, 7, 3, [
        ...Array.from({ length: 6 }, (_, index) => ({
          kind: `persist` as const,
          token: `p${index + 1}`,
        })),
        ...Array.from({ length: 7 }, (_, index) => ({
          kind: `hydrate` as const,
          token: `h${index}`,
        })),
      ]),
    ]
    expect(
      marginalHistories.map((history) => [
        history.hydrateCount,
        history.persistCount,
        history.mutationsPerPersist,
      ]),
    ).toEqual([
      [2, 3, 1],
      [7, 7, 3],
    ])

    await expect(
      withNodeScenario(
        createScenario(`invalid-storm-boundary`, [
          `hydrate`,
          `persist`,
          `hydrate`,
        ]),
        expectFairObservation,
      ),
    ).rejects.toThrow(`must begin with its already-running persist`)
  })

  it(`proves tail-order ablation removes a hydrate-before-later-persist history`, () => {
    const sampleOptions = {
      seed: FIXED_SEED,
      numRuns: oracleRuns(GENERATED_RUNS),
    }
    const completeGrammar = fc.sample(generatedHistoryArbitrary, sampleOptions)
    const tailOrderAblatedGrammar = fc.sample(
      tailOrderAblatedArbitrary,
      sampleOptions,
    )

    expect(completeGrammar.some(reachesHydrateBeforeLaterPersist)).toBe(true)
    expect(tailOrderAblatedGrammar.some(reachesHydrateBeforeLaterPersist)).toBe(
      false,
    )
  })

  it(`calibrates the checker against a synthetic persist-first observation`, () => {
    const scenario = createScenario(
      `persist-first-checker-calibration`,
      [`persist`, `persist`, `persist`, `persist`, `hydrate`, `hydrate`],
      1,
    )
    const fault = createPersistFirstFaultObservation(scenario)

    expect(findSharedDriverFairnessViolation(fault)).toMatchObject({
      checkpoint: fault.hydrationCompletions[0],
      expectedMaximumCompletedPersists: 1,
      expectedMinimumPendingPersists: 3,
    })
  })
})
