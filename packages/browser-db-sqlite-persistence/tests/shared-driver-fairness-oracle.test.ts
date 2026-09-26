/**
 * Node campaign for the shared-driver K=1 contract documented in
 * `shared-driver-fairness-oracle.ts`. Fixed histories prove neutral reach and a
 * persist storm; generated legal histories vary both lane sizes, mutation
 * width, and tail order. Public rows and logical completion checkpoints are
 * checked independently of production scheduling, and an executable
 * named persist-first FIFO wrong answer proves the checker rejects the original
 * fault. Grammar controls reconstruct that witness, exercise the bounded
 * marginals, reject a nearby invalid storm, and ablate tail-order variation.
 * The identical generated property runs in retained fixed-seed and seedless
 * random lanes. Supplying both TANSTACK_DB_DRIVER_FAIRNESS_SEED and
 * TANSTACK_DB_DRIVER_FAIRNESS_PATH replaces those lanes with one checked
 * seed+shrink-path replay. An axis-removal calibration proves that removing
 * tail-order variation loses hydrate-before-later-persist histories.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  SHARED_DRIVER_FAIRNESS_BOUND,
  createPersistFirstFaultObservation,
  findSharedDriverFairnessViolation,
  observeSharedDriverFairness,
} from './shared-driver-fairness-oracle'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type {
  SharedDriverFairnessObservation,
  SharedDriverFairnessOptions,
  SharedDriverFairnessScenario,
  SharedDriverFairnessWork,
} from './shared-driver-fairness-oracle'

const FIXED_SEED = 165_905
const GENERATED_RUNS = 12
const HYDRATE_COUNT_RANGE = { min: 2, max: 7 } as const
const PERSIST_COUNT_RANGE = { min: 3, max: 7 } as const
const MUTATIONS_PER_PERSIST_RANGE = { min: 1, max: 3 } as const

type FairnessReplayEnvironment = Record<string, string | undefined>

type FairnessReplayConfig = {
  seed: number
  path: string
}

type FairnessPropertyMode = {
  label: `fixed-seed` | `seedless-random` | `checked-replay`
  seed?: number
  path?: string
}

function readFairnessReplayConfig(
  environment: FairnessReplayEnvironment = process.env,
): FairnessReplayConfig | undefined {
  const seedText = environment.TANSTACK_DB_DRIVER_FAIRNESS_SEED
  const path = environment.TANSTACK_DB_DRIVER_FAIRNESS_PATH
  if (seedText === undefined && path === undefined) return undefined
  if (seedText === undefined || path === undefined) {
    throw new Error(
      `TANSTACK_DB_DRIVER_FAIRNESS_SEED and TANSTACK_DB_DRIVER_FAIRNESS_PATH must be supplied together`,
    )
  }

  const seed = Number(seedText)
  if (seedText.trim() === `` || !Number.isSafeInteger(seed)) {
    throw new Error(`TANSTACK_DB_DRIVER_FAIRNESS_SEED must be an integer`)
  }
  if (!/^\d+(?::\d+)*$/.test(path)) {
    throw new Error(
      `TANSTACK_DB_DRIVER_FAIRNESS_PATH must contain colon-separated nonnegative integers`,
    )
  }
  return { seed, path }
}

function createFairnessPropertyModes(
  replay: FairnessReplayConfig | undefined,
): ReadonlyArray<FairnessPropertyMode> {
  if (replay) {
    return [{ label: `checked-replay`, ...replay }]
  }
  return [
    { label: `fixed-seed`, seed: FIXED_SEED },
    { label: `seedless-random` },
  ]
}

function readFairnessCalibration(
  environment: FairnessReplayEnvironment = process.env,
): SharedDriverFairnessOptions {
  const fault = environment.TANSTACK_DB_DRIVER_FAIRNESS_CALIBRATION
  if (fault === undefined) return {}
  if (fault !== `persist-first-fifo`) {
    throw new Error(
      `TANSTACK_DB_DRIVER_FAIRNESS_CALIBRATION must be persist-first-fifo`,
    )
  }
  return { schedulingFault: fault }
}

const fairnessPropertyModes = createFairnessPropertyModes(
  readFairnessReplayConfig(),
)
const fairnessCalibration = readFairnessCalibration()

type WorkKind = SharedDriverFairnessWork[`kind`]

type GeneratedFairnessHistory = {
  hydrateCount: number
  persistCount: number
  mutationsPerPersist: number
  orderedKinds: ReadonlyArray<WorkKind>
  replayHistory: string
}

type GeneratedTailEntry = {
  kind: WorkKind
  token: string
}

function createScenario(
  id: string,
  orderedKinds: ReadonlyArray<WorkKind>,
  mutationsPerPersist = 1,
): SharedDriverFairnessScenario {
  let hydrateIndex = 0
  let persistIndex = 0
  return {
    id,
    work: orderedKinds.map((kind) => {
      if (kind === `persist`) {
        const index = persistIndex++
        return {
          kind,
          id: `persist-${index}`,
          mutationsPerPersist,
        }
      }
      const index = hydrateIndex++
      return {
        kind,
        id: `hydrate-${index}`,
        seededRows: [
          { id: `row-${index}-0`, value: index * 10 },
          { id: `row-${index}-1`, value: index * 10 + 1 },
        ],
      }
    }),
  }
}

function expectedHydratedCollections(scenario: SharedDriverFairnessScenario) {
  return scenario.work.flatMap((work) =>
    work.kind === `hydrate`
      ? [
          {
            collectionId: `${scenario.id}-${work.id}`,
            rows: work.seededRows.map((row) => ({ ...row })),
          },
        ]
      : [],
  )
}

async function withNodeScenario(
  scenario: SharedDriverFairnessScenario,
  assertion: (
    observation: SharedDriverFairnessObservation,
  ) => void | Promise<void>,
  options: SharedDriverFairnessOptions = {},
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), `db-driver-fairness-`))
  let primaryFailure: unknown
  try {
    const observation = await observeSharedDriverFairness(
      () =>
        createWASQLiteTestDatabase({
          filename: join(directory, `state.sqlite`),
        }),
      scenario,
      options,
    )
    await assertion(observation)
  } catch (error) {
    primaryFailure = error
  }

  let nodeCleanupFailure: unknown
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch (error) {
    nodeCleanupFailure = error
  }

  if (primaryFailure !== undefined) {
    if (nodeCleanupFailure !== undefined) {
      const primaryMessage =
        primaryFailure instanceof Error
          ? primaryFailure.message
          : String(primaryFailure)
      const cleanupMessage =
        nodeCleanupFailure instanceof Error
          ? nodeCleanupFailure.message
          : String(nodeCleanupFailure)
      throw new Error(
        `${primaryMessage}; node cleanup diagnostics: ${cleanupMessage}`,
      )
    }
    throw primaryFailure
  }
  if (nodeCleanupFailure !== undefined) throw nodeCleanupFailure
}

function expectObservationReach(
  observation: SharedDriverFairnessObservation,
): void {
  const expectedHydrates = expectedHydratedCollections(observation.scenario)
  expect(observation.admittedHydrateIds).toEqual(
    expectedHydrates.map(({ collectionId }) => collectionId),
  )
  expect(observation.hydrationCompletions).toHaveLength(expectedHydrates.length)
  // Actual rows come from the public Collection after preload. The expected
  // rows above are derived independently from the generated seed history.
  expect(observation.hydratedCollections).toEqual(expectedHydrates)
}

function expectFairObservation(
  observation: SharedDriverFairnessObservation,
): void {
  expectObservationReach(observation)
  const violation = findSharedDriverFairnessViolation(
    observation,
    SHARED_DRIVER_FAIRNESS_BOUND,
  )
  if (violation) {
    throw new Error(
      `shared-driver fairness mismatch at ${violation.checkpoint.collectionId}: ` +
        `${violation.checkpoint.completedPersistIds.length} persists completed ` +
        `(maximum ${violation.expectedMaximumCompletedPersists}), ` +
        `${violation.checkpoint.pendingPersistCount} remained pending ` +
        `(minimum ${violation.expectedMinimumPendingPersists}); ` +
        `permitted completed ids: ${JSON.stringify(violation.permittedCompletedPersistIds)}; ` +
        `cleanup diagnostics: ${JSON.stringify(observation.cleanupFailures)}`,
    )
  }
  expect(observation.cleanupFailures).toEqual([])
}

function buildGeneratedHistory(
  hydrateCount: number,
  persistCount: number,
  mutationsPerPersist: number,
  generatedTail: ReadonlyArray<GeneratedTailEntry>,
): GeneratedFairnessHistory {
  return {
    hydrateCount,
    persistCount,
    mutationsPerPersist,
    orderedKinds: [
      `persist` as const,
      ...generatedTail.map(({ kind }) => kind),
    ],
    replayHistory: `p0,${generatedTail.map(({ token }) => token).join(`,`)}`,
  }
}

function createGeneratedHistoryArbitrary(
  tailOrderAxis: `varied` | `removed`,
): fc.Arbitrary<GeneratedFairnessHistory> {
  return fc
    .record({
      hydrateCount: fc.integer(HYDRATE_COUNT_RANGE),
      persistCount: fc.integer(PERSIST_COUNT_RANGE),
      mutationsPerPersist: fc.integer(MUTATIONS_PER_PERSIST_RANGE),
    })
    .chain(({ hydrateCount, persistCount, mutationsPerPersist }) => {
      const tail = [
        ...Array.from({ length: persistCount - 1 }, (_, index) => ({
          kind: `persist` as const,
          token: `p${index + 1}`,
        })),
        ...Array.from({ length: hydrateCount }, (_, index) => ({
          kind: `hydrate` as const,
          token: `h${index}`,
        })),
      ]
      const orderedTail =
        tailOrderAxis === `varied`
          ? fc.shuffledSubarray(tail, {
              minLength: tail.length,
              maxLength: tail.length,
            })
          : fc.constant(tail)
      return orderedTail.map((generatedTail) =>
        buildGeneratedHistory(
          hydrateCount,
          persistCount,
          mutationsPerPersist,
          generatedTail,
        ),
      )
    })
}

function reachesHydrateBeforeLaterPersist(
  history: GeneratedFairnessHistory,
): boolean {
  let hydrateSeen = false
  for (const kind of history.orderedKinds.slice(1)) {
    if (kind === `hydrate`) hydrateSeen = true
    if (kind === `persist` && hydrateSeen) return true
  }
  return false
}

const generatedHistoryArbitrary = createGeneratedHistoryArbitrary(`varied`)
const tailOrderAblatedArbitrary = createGeneratedHistoryArbitrary(`removed`)
let generatedPropertyExecutions = 0

const generatedFairnessProperty = fc.asyncProperty(
  generatedHistoryArbitrary,
  async ({
    hydrateCount,
    persistCount,
    mutationsPerPersist,
    orderedKinds,
    replayHistory,
  }) => {
    generatedPropertyExecutions++
    const observationId =
      `generated-h${hydrateCount}-p${persistCount}-m${mutationsPerPersist}-` +
      replayHistory.replaceAll(`,`, `-`)
    await withNodeScenario(
      createScenario(observationId, orderedKinds, mutationsPerPersist),
      expectFairObservation,
      fairnessCalibration,
    )
  },
)

describe(`shared BrowserWASQLiteDriver fairness oracle`, () => {
  it(`selects fixed and seedless lanes by default and only replay when requested`, () => {
    expect(createFairnessPropertyModes(readFairnessReplayConfig({}))).toEqual([
      { label: `fixed-seed`, seed: FIXED_SEED },
      { label: `seedless-random` },
    ])
    expect(
      createFairnessPropertyModes(
        readFairnessReplayConfig({
          TANSTACK_DB_DRIVER_FAIRNESS_SEED: `42`,
          TANSTACK_DB_DRIVER_FAIRNESS_PATH: `0:1`,
        }),
      ),
    ).toEqual([{ label: `checked-replay`, seed: 42, path: `0:1` }])
    expect(readFairnessCalibration({})).toEqual({})
    expect(
      readFairnessCalibration({
        TANSTACK_DB_DRIVER_FAIRNESS_CALIBRATION: `persist-first-fifo`,
      }),
    ).toEqual({ schedulingFault: `persist-first-fifo` })
  })

  it.each([
    {
      name: `seed without path`,
      environment: { TANSTACK_DB_DRIVER_FAIRNESS_SEED: `42` },
      message: `must be supplied together`,
    },
    {
      name: `path without seed`,
      environment: { TANSTACK_DB_DRIVER_FAIRNESS_PATH: `0` },
      message: `must be supplied together`,
    },
    {
      name: `non-integer seed`,
      environment: {
        TANSTACK_DB_DRIVER_FAIRNESS_SEED: `4.2`,
        TANSTACK_DB_DRIVER_FAIRNESS_PATH: `0`,
      },
      message: `must be an integer`,
    },
    {
      name: `invalid shrink path`,
      environment: {
        TANSTACK_DB_DRIVER_FAIRNESS_SEED: `42`,
        TANSTACK_DB_DRIVER_FAIRNESS_PATH: `0:-1`,
      },
      message: `colon-separated nonnegative integers`,
    },
  ])(`rejects incomplete or invalid replay coordinates: $name`, (probe) => {
    expect(() => readFairnessReplayConfig(probe.environment)).toThrow(
      probe.message,
    )
  })

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

  it(`reaches cold hydration and preserves independently seeded public rows without queued persists`, async () => {
    await withNodeScenario(
      createScenario(`neutral-reach`, [`hydrate`, `hydrate`, `hydrate`]),
      (observation) => {
        expectFairObservation(observation)
        expect(
          observation.rawDequeues.some((entry) =>
            entry.sql.startsWith(
              `SELECT key, value, metadata, row_version FROM`,
            ),
          ),
        ).toBe(true)
      },
    )
  })

  it(`completes a pending cold hydrate before an unrelated persist backlog drains`, async () => {
    await withNodeScenario(
      createScenario(
        `fixed-persist-storm`,
        [`persist`, `persist`, `persist`, `hydrate`, `hydrate`],
        2,
      ),
      expectFairObservation,
    )
  })

  it.each(fairnessPropertyModes)(
    `bounds persist completions for generated ordered cold-hydrate/persist histories in $label mode`,
    async (mode) => {
      const executionsBefore = generatedPropertyExecutions
      await fc.assert(generatedFairnessProperty, {
        numRuns: GENERATED_RUNS,
        verbose: 2,
        ...(mode.seed === undefined ? {} : { seed: mode.seed }),
        ...(mode.path === undefined ? {} : { path: mode.path }),
      })
      expect(generatedPropertyExecutions).toBeGreaterThan(executionsBefore)
    },
  )

  it(`proves tail-order ablation removes a hydrate-before-later-persist history`, () => {
    const sampleOptions = { seed: FIXED_SEED, numRuns: GENERATED_RUNS }
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

  it(`rejects the named persist-first FIFO wrong answer through the real package path`, async () => {
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
      },
      { schedulingFault: `persist-first-fifo` },
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
