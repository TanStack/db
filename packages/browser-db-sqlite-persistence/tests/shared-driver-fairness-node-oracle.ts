/**
 * The Node production driver, its law check, and the generated history grammar
 * of the shared-driver fairness campaign in shared-driver-fairness-oracle.test.ts.
 * withNodeScenario runs one scenario through the real package path on a
 * file-backed wa-sqlite test database; expectFairObservation applies the
 * shared comparison of shared-driver-fairness-oracle.ts and names the first
 * violated law and checkpoint; the arbitraries generate legal storms, with and
 * without tail-order variation. Owns nothing and registers no tests: the
 * campaign drives production with them, and shared-driver-fairness-grammar.test.ts
 * calibrates the grammar with them.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { expect } from 'vitest'
import {
  oracleAssertion,
  rejectAt,
} from '../../db/tests/oracle-assertion-adapter'
import {
  SHARED_DRIVER_FAIRNESS_BOUND,
  findSharedDriverFairnessLawViolations,
  observeSharedDriverFairness,
} from './shared-driver-fairness-oracle'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type {
  SharedDriverFairnessObservation,
  SharedDriverFairnessOptions,
  SharedDriverFairnessScenario,
  SharedDriverFairnessWork,
} from './shared-driver-fairness-oracle'

export const GENERATED_RUNS = 12
export const HYDRATE_COUNT_RANGE = { min: 2, max: 7 } as const
export const PERSIST_COUNT_RANGE = { min: 3, max: 7 } as const
export const MUTATIONS_PER_PERSIST_RANGE = { min: 1, max: 3 } as const

export class FairnessOracleFailure extends Error {
  constructor(
    readonly law: string,
    readonly checkpoint: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
  }
}

export function checkAt(
  law: string,
  checkpoint: string,
  assertion: () => void,
): void {
  try {
    assertion()
  } catch (error) {
    throw new FairnessOracleFailure(law, checkpoint, error)
  }
}

export type WorkKind = SharedDriverFairnessWork[`kind`]

export type GeneratedFairnessHistory = {
  hydrateCount: number
  persistCount: number
  mutationsPerPersist: number
  orderedKinds: ReadonlyArray<WorkKind>
  replayHistory: string
}

export type GeneratedTailEntry = {
  kind: WorkKind
  token: string
}

export function createScenario(
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

export async function withNodeScenario(
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
      throw new AggregateError(
        [primaryFailure, nodeCleanupFailure],
        `primary: ${String(primaryFailure)}; node cleanup diagnostics: ${String(nodeCleanupFailure)}`,
        { cause: primaryFailure },
      )
    }
    throw primaryFailure
  }
  if (nodeCleanupFailure !== undefined) throw nodeCleanupFailure
}

export const REACH_LAWS = new Set([
  `hydrate admission IDs`,
  `hydrate completion count`,
  `hydrated public rows`,
])

// The shared comparison owns every law. This driver turns its first violation
// into a FairnessOracleFailure that names the law and checkpoint.
export function throwFirstViolation(
  observation: SharedDriverFairnessObservation,
  laws: (law: string) => boolean,
): void {
  const violation = findSharedDriverFairnessLawViolations(
    observation,
    SHARED_DRIVER_FAIRNESS_BOUND,
  ).find(({ law }) => laws(law))
  if (!violation) return
  rejectAt(
    violation.checkpoint,
    new FairnessOracleFailure(
      violation.law,
      violation.checkpoint,
      new Error(
        `shared-driver fairness mismatch: expected ${JSON.stringify(violation.expected)}, ` +
          `got ${JSON.stringify(violation.actual)}; ` +
          `cleanup diagnostics: ${JSON.stringify(observation.cleanupFailures)}`,
      ),
    ),
  )
}

export function expectObservationReach(
  observation: SharedDriverFairnessObservation,
): void {
  throwFirstViolation(observation, (law) => REACH_LAWS.has(law))
}

export function expectFairObservation(
  observation: SharedDriverFairnessObservation,
): void {
  throwFirstViolation(observation, () => true)
  checkAt(`driver cleanup`, `after observation`, () =>
    oracleAssertion('expectFairObservation', () =>
      expect(observation.cleanupFailures).toEqual([]),
    ),
  )
}

export function buildGeneratedHistory(
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

export function createGeneratedHistoryArbitrary(
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

export function reachesHydrateBeforeLaterPersist(
  history: GeneratedFairnessHistory,
): boolean {
  let hydrateSeen = false
  for (const kind of history.orderedKinds.slice(1)) {
    if (kind === `hydrate`) hydrateSeen = true
    if (kind === `persist` && hydrateSeen) return true
  }
  return false
}

export const generatedHistoryArbitrary =
  createGeneratedHistoryArbitrary(`varied`)
export const tailOrderAblatedArbitrary =
  createGeneratedHistoryArbitrary(`removed`)
