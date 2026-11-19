import { fc } from '@fast-check/vitest'
import { expect, it as vitestIt } from 'vitest'
import {
  oracleProperty,
  oracleReplayTest,
  oracleRoute,
} from './oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import {
  applyReconciliationStep,
  createReconciliationModel,
  executedReplayReach,
  snapshotModel,
  upsert,
} from './d2-source-reconciliation-model-oracle.js'
import type {
  SourceKey,
  SourceRow,
} from './d2-source-reconciliation-support.js'
import type {
  ReconciliationStep,
  SourceOperation,
} from './d2-source-reconciliation-model-oracle.js'

const it = oracleReplayTest(vitestIt)

/**
 * D2 source reconciliation turns source-key snapshots into exact signed row
 * changes across graph lifetimes. The contribution-conservation and
 * publication laws in `src/query/live/ARCHITECTURE.md` authorize the graph
 * result; the `reconcileChangesForD2` boundary owns the exact sent-row value
 * used for each retraction.
 *
 * The model and its per-step check live in
 * `d2-source-reconciliation-model-oracle.ts`. The model has three separate
 * nodes: authoritative source rows, production's
 * sent-row memory, and an independently integrated weighted relation. Generated
 * batches may lie about previous values, reuse equal keys of different JS
 * types, replay rows, delete, truncate, tear down, and restart. The reference
 * derives truth from the source-key map, never from reported previous values.
 *
 * After each helper cut the raw reconciled messages must integrate to the
 * source relation. Ordered Effect and live-query Collection tests check exact
 * retractions at indexed and scan consumer boundaries. The generated model
 * exercises the reconciliation helper; fixed cases receive controlled
 * truncate replay and live-query graph restart through actual consumers.
 * The controlled source injects stale change messages; a provider E2E owner
 * such as `electric-db-collection/e2e/electric.e2e.test.ts` must show which
 * events a real source emits and the public result they produce. These cuts do
 * not establish every graph shape or publication schedule.
 */

const sourceRowArbitrary = fc.record({
  id: fc.integer({ min: 0, max: 3 }),
  revision: fc.integer({ min: 0, max: 4 }),
  value: fc.integer({ min: -2, max: 2 }),
})

const sourceKeyArbitrary: fc.Arbitrary<SourceKey> = fc.oneof(
  fc.integer({ min: 0, max: 2 }),
  fc.constantFrom(`0`, `1`, `source`),
)

const sourceOperationArbitrary: fc.Arbitrary<SourceOperation> = fc.oneof(
  fc
    .record({
      key: sourceKeyArbitrary,
      row: sourceRowArbitrary,
      reportedPreviousValue: sourceRowArbitrary,
    })
    .map((operation) => ({ type: `upsert` as const, ...operation })),
  fc
    .record({
      key: sourceKeyArbitrary,
      row: sourceRowArbitrary,
      reportedPreviousValue: sourceRowArbitrary,
    })
    .map((operation) => ({ type: `rawUpdate` as const, ...operation })),
  sourceKeyArbitrary.map((key) => ({ type: `replay` as const, key })),
  fc
    .record({
      key: sourceKeyArbitrary,
      reportedValue: sourceRowArbitrary,
    })
    .map((operation) => ({ type: `delete` as const, ...operation })),
)

const reconciliationStepArbitrary: fc.Arbitrary<ReconciliationStep> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc
      .array(sourceOperationArbitrary, { minLength: 1, maxLength: 5 })
      .map((operations) => ({ type: `batch` as const, operations })),
  },
  { weight: 1, arbitrary: fc.constant({ type: `truncate` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `teardown` as const }) },
  { weight: 1, arbitrary: fc.constant({ type: `restart` as const }) },
)

const reconciliationHistoryArbitrary = fc.array(reconciliationStepArbitrary, {
  minLength: 1,
  maxLength: 30,
})

// Grammar controls: the fixed numeric/string key, unknown update/delete,
// stale previous-value, and changed-source restart histories below are all
// reconstructible here. Upsert establishes or replaces authoritative source
// rows; rawUpdate exercises an update without a prior sent row; replay checks
// repeat delivery; delete tests exact retraction or an unknown key. Truncate
// preserves the sent row for a later source batch, while teardown and restart
// distinguish source ownership from graph memory. The helper simulator makes
// truncate an explicit no-op; its effect is observable only in the ordered
// consumer tests below. Removing another operation rule loses its named
// transition; removing key type or revision/value variation loses a distinct
// source contribution. Batches of 1..5 operations expose
// within-batch transitions; histories of 1..30 expose later source replay.
// Row fields and keys use the bounded domains above. Out-of-range row numbers
// use the same equality law; object keys and malformed messages are excluded
// by the SourceKey/SourceOperation grammar. Repeated teardown/restart and a
// truncate without a later batch are harmless simulator signals, not claims
// about public Collection lifecycle legality or real truncate replay.

function sourceOperationForKeyArbitrary(
  key: SourceKey,
): fc.Arbitrary<SourceOperation> {
  return fc.oneof(
    fc
      .tuple(sourceRowArbitrary, sourceRowArbitrary)
      .map(([row, reportedPreviousValue]) => ({
        type: `upsert` as const,
        key,
        row,
        reportedPreviousValue,
      })),
    fc
      .tuple(sourceRowArbitrary, sourceRowArbitrary)
      .map(([row, reportedPreviousValue]) => ({
        type: `rawUpdate` as const,
        key,
        row,
        reportedPreviousValue,
      })),
    fc.constant({ type: `replay` as const, key }),
    sourceRowArbitrary.map((reportedValue) => ({
      type: `delete` as const,
      key,
      reportedValue,
    })),
  )
}

const disjointHistoriesArbitrary = fc.tuple(
  fc.array(sourceOperationForKeyArbitrary(0), {
    minLength: 1,
    maxLength: 8,
  }),
  fc.array(sourceOperationForKeyArbitrary(`other`), {
    minLength: 1,
    maxLength: 8,
  }),
)

it(`executes changed down-state sources and checks their restart replay`, () => {
  oracleRoute(`fixed seed`)
  const histories = fc.sample(reconciliationHistoryArbitrary, {
    seed: 1780,
    numRuns: 500,
  })

  // Run every history, not just the first syntax match. Each accepted restart
  // has already passed tracker and signed-relation assertions above.
  const counts = histories.map((steps, sample) => {
    try {
      return executedReplayReach(steps)
    } catch (cause) {
      throw new Error(JSON.stringify({ seed: 1780, sample, steps }), { cause })
    }
  })
  expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0)
})

const assertChangedSourceReplay = (row: SourceRow, key: SourceKey) => {
  const replacement = { ...row, revision: row.revision + 1 }
  oracleAssertion('assertChangedSourceReplay', () =>
    expect(
      executedReplayReach([
        upsert(key, row),
        { type: `teardown` },
        upsert(key, replacement, row),
        { type: `restart` },
      ]),
    ).toBe(1),
  )
}

oracleProperty({
  id: `d2-source.changed-restart`,
  law: {
    statement: `A changed source payload is replayed exactly when a helper graph restarts.`,
    authority: `Contribution-conservation and publication laws in src/query/live/ARCHITECTURE.md; reconcileChangesForD2 exact sent-row boundary`,
    limits: `The existing bounded helper simulation and source-key grammar; fixed real-consumer histories and provider E2E boundaries retain their separate scope.`,
  },
  // What this oracle owns: the gap report judges reconcileChangesForD2 and its
  // static reference tree by this file's tests.
  owns: [`src/query/live/utils.ts#reconcileChangesForD2`],
  histories: {
    arbitrary: fc.tuple(sourceRowArbitrary, sourceKeyArbitrary),
    runs: 100,
    fixedSeeds: [1782],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`d2-source.changed-restart`, plan, observe, () =>
      assertChangedSourceReplay(...plan.history),
    ),
  check: forwardAssertionJudgment,
})

const assertExactSourceContributions = (
  steps: ReadonlyArray<ReconciliationStep>,
) => {
  const model = createReconciliationModel()
  for (const step of steps) {
    applyReconciliationStep(model, step)
  }
}

oracleProperty({
  id: `d2-source.exact-retractions`,
  law: {
    statement: `After every helper action, exact signed contributions integrate to the authoritative source rows.`,
    authority: `Contribution-conservation and publication laws in src/query/live/ARCHITECTURE.md; reconcileChangesForD2 exact sent-row boundary`,
    limits: `The existing bounded helper simulation and source-key grammar; fixed real-consumer histories and provider E2E boundaries retain their separate scope.`,
  },
  owns: [`src/query/live/utils.ts#reconcileChangesForD2`],
  histories: {
    arbitrary: reconciliationHistoryArbitrary,
    runs: 200,
    fixedSeeds: [1780],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`d2-source.exact-retractions`, plan, observe, () =>
      assertExactSourceContributions(plan.history),
    ),
  check: forwardAssertionJudgment,
})

const assertDisjointHistoriesCommute = ([left, right]: [
  Array<SourceOperation>,
  Array<SourceOperation>,
]) => {
  const leftThenRight = createReconciliationModel()
  applyReconciliationStep(leftThenRight, { type: `batch`, operations: left })
  applyReconciliationStep(leftThenRight, { type: `batch`, operations: right })

  const rightThenLeft = createReconciliationModel()
  applyReconciliationStep(rightThenLeft, { type: `batch`, operations: right })
  applyReconciliationStep(rightThenLeft, { type: `batch`, operations: left })

  oracleAssertion('assertDisjointHistoriesCommute', () =>
    expect(snapshotModel(rightThenLeft)).toEqual(snapshotModel(leftThenRight)),
  )
}

oracleProperty({
  id: `d2-source.disjoint-commutation`,
  law: {
    statement: `Disjoint source histories commute in source rows, sent rows and integrated weighted relation.`,
    authority: `Contribution-conservation and publication laws in src/query/live/ARCHITECTURE.md; reconcileChangesForD2 exact sent-row boundary`,
    limits: `The existing bounded helper simulation and source-key grammar; fixed real-consumer histories and provider E2E boundaries retain their separate scope.`,
  },
  owns: [`src/query/live/utils.ts#reconcileChangesForD2`],
  histories: {
    arbitrary: disjointHistoriesArbitrary,
    runs: 100,
    fixedSeeds: [1781],
  },
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `d2-source.disjoint-commutation`,
      plan,
      observe,
      () => assertDisjointHistoriesCommute(plan.history),
    ),
  check: forwardAssertionJudgment,
})
