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

const DEFAULT_SEED = 165_905
const replaySeed = Number(
  process.env.TANSTACK_DB_DRIVER_FAIRNESS_SEED ?? DEFAULT_SEED,
)
const replayPath = process.env.TANSTACK_DB_DRIVER_FAIRNESS_PATH

type WorkKind = SharedDriverFairnessWork[`kind`]

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

const generatedHistoryArbitrary = fc
  .record({
    hydrateCount: fc.integer({ min: 2, max: 7 }),
    persistCount: fc.integer({ min: 2, max: 7 }),
    mutationsPerPersist: fc.integer({ min: 1, max: 3 }),
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
    return fc
      .shuffledSubarray(tail, {
        minLength: tail.length,
        maxLength: tail.length,
      })
      .map((shuffledTail) => ({
        hydrateCount,
        persistCount,
        mutationsPerPersist,
        orderedKinds: [
          `persist` as const,
          ...shuffledTail.map(({ kind }) => kind),
        ],
        replayHistory: `p0,${shuffledTail.map(({ token }) => token).join(`,`)}`,
      }))
  })

describe(`shared BrowserWASQLiteDriver fairness oracle`, () => {
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
        [`persist`, `persist`, `persist`, `hydrate`],
        2,
      ),
      expectFairObservation,
    )
  })

  it(`bounds persist completions for generated ordered cold-hydrate/persist histories`, async () => {
    await fc.assert(
      fc.asyncProperty(
        generatedHistoryArbitrary,
        async ({
          hydrateCount,
          persistCount,
          mutationsPerPersist,
          orderedKinds,
          replayHistory,
        }) => {
          const observationId =
            `generated-h${hydrateCount}-p${persistCount}-m${mutationsPerPersist}-` +
            replayHistory.replaceAll(`,`, `-`)
          await withNodeScenario(
            createScenario(observationId, orderedKinds, mutationsPerPersist),
            expectFairObservation,
          )
        },
      ),
      {
        seed: replaySeed,
        path: replayPath,
        numRuns: 12,
        endOnFailure: true,
        verbose: 2,
      },
    )
  })

  it(`kills a persist-first FIFO scheduling mutant through the real package path`, async () => {
    await withNodeScenario(
      createScenario(
        `persist-first-fixture-fault`,
        [`persist`, `persist`, `persist`, `persist`, `hydrate`],
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
      [`persist`, `persist`, `persist`, `persist`, `hydrate`],
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
