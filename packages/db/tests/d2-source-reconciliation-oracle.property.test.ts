import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it as vitestIt } from 'vitest'
import { reconcileChangesForD2 } from '../src/query/live/utils.js'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import {
  addWeight,
  expectedWeightedRowIdentity,
} from './d2-source-reconciliation-support.js'
import type {
  SourceKey,
  SourceRow,
} from './d2-source-reconciliation-support.js'
import type { ChangeMessage } from '../src/types.js'

const it = oracleReplayTest(vitestIt)
const fixedCampaign = oracleReplayTest(fcTest)
const randomCampaign = (property: string) => oracleReplayTest(fcTest, property)

/**
 * D2 source reconciliation turns source-key snapshots into exact signed row
 * changes across graph lifetimes. The contribution-conservation and
 * publication laws in `src/query/live/ARCHITECTURE.md` authorize the graph
 * result; the `reconcileChangesForD2` boundary owns the exact sent-row value
 * used for each retraction.
 *
 * The model has three separate nodes: authoritative source rows, production's
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

type SourceOperation =
  | {
      type: `upsert`
      key: SourceKey
      row: SourceRow
      reportedPreviousValue: SourceRow
    }
  | {
      type: `rawUpdate`
      key: SourceKey
      row: SourceRow
      reportedPreviousValue: SourceRow
    }
  | { type: `replay`; key: SourceKey }
  | { type: `delete`; key: SourceKey; reportedValue: SourceRow }

type ReconciliationStep =
  | { type: `batch`; operations: ReadonlyArray<SourceOperation> }
  | { type: `truncate` }
  | { type: `teardown` }
  | { type: `restart` }

type ReconciliationModel = {
  // Only sourceRows is expected state. sentRows belongs to the real helper;
  // relation independently integrates that helper's raw weighted output.
  sourceRows: Map<SourceKey, SourceRow>
  sentRows: Map<SourceKey, SourceRow>
  relation: Map<string, number>
  // Model-only switch for helper invocation, not a production graph state.
  graphActive: boolean
}

type Reconciler = (
  changes: Array<ChangeMessage<SourceRow, SourceKey>>,
  sentRows: Map<SourceKey, SourceRow>,
) => Array<ChangeMessage<SourceRow, SourceKey>>

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

// Grammar controls: the pinned numeric/string key, unknown update/delete,
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

function applyToRelation(
  relation: Map<string, number>,
  changes: ReadonlyArray<ChangeMessage<SourceRow, SourceKey>>,
): void {
  for (const change of changes) {
    if (change.type === `insert`) {
      addWeight(relation, change.key, change.value, 1)
    } else if (change.type === `update`) {
      addWeight(relation, change.key, change.previousValue!, -1)
      addWeight(relation, change.key, change.value, 1)
    } else {
      addWeight(relation, change.key, change.value, -1)
    }
  }
}

function sourceChangesFor(
  operations: ReadonlyArray<SourceOperation>,
  sourceRows: Map<SourceKey, SourceRow>,
): Array<ChangeMessage<SourceRow, SourceKey>> {
  const changes: Array<ChangeMessage<SourceRow, SourceKey>> = []
  for (const operation of operations) {
    if (operation.type === `upsert`) {
      const previousValue = sourceRows.get(operation.key)
      changes.push(
        previousValue === undefined
          ? { type: `insert`, key: operation.key, value: { ...operation.row } }
          : {
              type: `update`,
              key: operation.key,
              value: { ...operation.row },
              previousValue: { ...operation.reportedPreviousValue },
            },
      )
      sourceRows.set(operation.key, { ...operation.row })
    } else if (operation.type === `rawUpdate`) {
      changes.push({
        type: `update`,
        key: operation.key,
        value: { ...operation.row },
        previousValue: { ...operation.reportedPreviousValue },
      })
      sourceRows.set(operation.key, { ...operation.row })
    } else if (operation.type === `replay`) {
      const row = sourceRows.get(operation.key)
      if (row !== undefined) {
        changes.push({ type: `insert`, key: operation.key, value: { ...row } })
      }
    } else {
      changes.push({
        type: `delete`,
        key: operation.key,
        value: { ...operation.reportedValue },
      })
      sourceRows.delete(operation.key)
    }
  }
  return changes
}

function expectTrackerMatchesSource(
  sourceRows: ReadonlyMap<SourceKey, SourceRow>,
  sentRows: ReadonlyMap<SourceKey, SourceRow>,
): void {
  const compareEntries = (
    [a]: readonly [SourceKey, SourceRow],
    [b]: readonly [SourceKey, SourceRow],
  ) => `${typeof a}:${String(a)}`.localeCompare(`${typeof b}:${String(b)}`)
  expect([...sentRows.entries()].sort(compareEntries)).toEqual(
    [...sourceRows.entries()].sort(compareEntries),
  )
}

function expectWeightedRelationMatchesSource(
  sourceRows: ReadonlyMap<SourceKey, SourceRow>,
  relation: ReadonlyMap<string, number>,
): void {
  expect(
    [...relation.entries()].sort(([a], [b]) => a.localeCompare(b)),
  ).toEqual(
    [...sourceRows.entries()]
      .map(([key, row]) => [expectedWeightedRowIdentity(key, row), 1] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

function createReconciliationModel(): ReconciliationModel {
  return {
    sourceRows: new Map(),
    sentRows: new Map(),
    relation: new Map(),
    graphActive: true,
  }
}

function snapshotModel(model: ReconciliationModel): {
  source: Array<string>
  sent: Array<string>
  relation: Array<readonly [string, number]>
} {
  const rows = (entries: ReadonlyMap<SourceKey, SourceRow>) =>
    [...entries]
      .map(
        ([key, row]) =>
          `${typeof key}:${String(key)}|${row.id}:${row.revision}:${row.value}`,
      )
      .sort()
  return {
    source: rows(model.sourceRows),
    sent: rows(model.sentRows),
    relation: [...model.relation].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  }
}

function applyReconciliationStep(
  model: ReconciliationModel,
  step: ReconciliationStep,
  reconcile: Reconciler = reconcileChangesForD2,
): void {
  // This is a helper/session simulation, not real graph restart wiring.
  // The separate Effect/live tests below inject events at a real consumer.
  if (step.type === `truncate`) {
    // Truncate is only an early lifecycle signal. Its later source batch
    // still needs the retained exact rows to retract the active graph.
  } else if (step.type === `teardown`) {
    model.sentRows.clear()
    model.relation.clear()
    model.graphActive = false
  } else if (step.type === `restart`) {
    if (!model.graphActive) {
      const replay = [...model.sourceRows].map(([key, value]) => ({
        type: `insert` as const,
        key,
        value: { ...value },
      }))
      applyToRelation(model.relation, reconcile(replay, model.sentRows))
      model.graphActive = true
    }
  } else {
    const changes = sourceChangesFor(step.operations, model.sourceRows)
    if (model.graphActive) {
      const reconciled = reconcile(changes, model.sentRows)
      applyToRelation(model.relation, reconciled)
    }
  }

  if (model.graphActive) {
    expectTrackerMatchesSource(model.sourceRows, model.sentRows)
    expectWeightedRelationMatchesSource(model.sourceRows, model.relation)
  } else {
    expect(model.sentRows.size).toBe(0)
    expect(model.relation.size).toBe(0)
  }
}

function upsert(
  key: SourceKey,
  row: SourceRow,
  reportedPreviousValue: SourceRow = row,
): ReconciliationStep {
  return {
    type: `batch`,
    operations: [{ type: `upsert`, key, row, reportedPreviousValue }],
  }
}

it(`keeps numeric and string source keys distinct across restart`, () => {
  const model = createReconciliationModel()
  const row = { id: 1, revision: 1, value: 1 }
  const keys = [0, `0`] as const

  applyReconciliationStep(model, {
    type: `batch`,
    operations: keys.map((key) => ({
      type: `upsert` as const,
      key,
      row,
      reportedPreviousValue: row,
    })),
  })
  expect(model.sourceRows).toEqual(
    new Map<SourceKey, SourceRow>([
      [0, row],
      [`0`, row],
    ]),
  )
  expect(model.sentRows).toEqual(model.sourceRows)
  expect(model.relation).toEqual(
    new Map([
      [expectedWeightedRowIdentity(0, row), 1],
      [expectedWeightedRowIdentity(`0`, row), 1],
    ]),
  )

  applyReconciliationStep(model, { type: `teardown` })
  applyReconciliationStep(model, { type: `restart` })
  expect(model.sourceRows).toEqual(
    new Map<SourceKey, SourceRow>([
      [0, row],
      [`0`, row],
    ]),
  )
  expect(model.sentRows).toEqual(model.sourceRows)
  expect(model.relation).toEqual(
    new Map([
      [expectedWeightedRowIdentity(0, row), 1],
      [expectedWeightedRowIdentity(`0`, row), 1],
    ]),
  )
})

it(`preserves external source rows across graph teardown and restart`, () => {
  const model = createReconciliationModel()
  const row = { id: 1, revision: 1, value: 1 }

  applyReconciliationStep(model, upsert(`row`, row))
  applyReconciliationStep(model, { type: `teardown` })
  expect(model.graphActive).toBe(false)
  expect(model.sourceRows).toEqual(new Map([[`row`, row]]))
  expect(model.sentRows).toEqual(new Map())
  expect(model.relation).toEqual(new Map())

  applyReconciliationStep(model, { type: `restart` })
  expect(model.graphActive).toBe(true)
  expect(model.sourceRows).toEqual(new Map([[`row`, row]]))
  expect(model.sentRows).toEqual(new Map([[`row`, row]]))
  expect(model.relation).toEqual(
    new Map([[expectedWeightedRowIdentity(`row`, row), 1]]),
  )
})

it(`replays external source changes made while the graph is down`, () => {
  const model = createReconciliationModel()
  const first = { id: 1, revision: 1, value: 1 }
  const replacement = { id: 1, revision: 2, value: 2 }

  applyReconciliationStep(model, upsert(`row`, first))
  applyReconciliationStep(model, { type: `teardown` })
  applyReconciliationStep(model, upsert(`row`, replacement, first))
  expect(model.sourceRows).toEqual(new Map([[`row`, replacement]]))
  expect(model.sentRows).toEqual(new Map())
  expect(model.relation).toEqual(new Map())

  applyReconciliationStep(model, { type: `restart` })
  expect(model.sourceRows).toEqual(new Map([[`row`, replacement]]))
  expect(model.sentRows).toEqual(new Map([[`row`, replacement]]))
  expect(model.relation).toEqual(
    new Map([[expectedWeightedRowIdentity(`row`, replacement), 1]]),
  )
})

function executedReplayReach(steps: ReadonlyArray<ReconciliationStep>): number {
  const model = createReconciliationModel()
  let sourceAtTeardown: Array<string> = []
  let completedChangedRestarts = 0
  for (const step of steps) {
    const activeBefore = model.graphActive
    if (step.type === `teardown` && activeBefore)
      sourceAtTeardown = snapshotModel(model).source
    applyReconciliationStep(model, step)
    if (step.type === `restart` && !activeBefore) {
      const replayed = snapshotModel(model).source
      if (
        sourceAtTeardown.length !== replayed.length ||
        sourceAtTeardown.some((value, index) => value !== replayed[index])
      )
        completedChangedRestarts++
    }
  }
  return completedChangedRestarts
}

it(`executes changed down-state sources and checks their restart replay`, () => {
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

it(`does not count absent replay or an unfinished downtime as replay coverage`, () => {
  const absent: ReconciliationStep = {
    type: `batch`,
    operations: [{ type: `replay`, key: `missing` }],
  }
  expect(
    executedReplayReach([{ type: `teardown` }, absent, { type: `restart` }]),
  ).toBe(0)
  const change = upsert(`row`, { id: 1, revision: 1, value: 1 })
  expect(executedReplayReach([{ type: `teardown` }, change])).toBe(0)
  expect(
    executedReplayReach([{ type: `teardown` }, change, { type: `restart` }]),
  ).toBe(1)
  expect(
    executedReplayReach([
      change,
      { type: `teardown` },
      change,
      { type: `restart` },
    ]),
  ).toBe(0)
})

const assertChangedSourceReplay = (row: SourceRow, key: SourceKey) => {
  const replacement = { ...row, revision: row.revision + 1 }
  expect(
    executedReplayReach([
      upsert(key, row),
      { type: `teardown` },
      upsert(key, replacement, row),
      { type: `restart` },
    ]),
  ).toBe(1)
}

fixedCampaign.prop([sourceRowArbitrary, sourceKeyArbitrary], {
  numRuns: oracleRuns(100),
  seed: 1782,
})(
  `forces a changed source payload through every generated helper restart for a fixed seed`,
  assertChangedSourceReplay,
)

randomCampaign(`d2-source.changed-restart`).prop(
  [sourceRowArbitrary, sourceKeyArbitrary],
  oraclePropertyOptions(100, `d2-source.changed-restart`),
)(
  `forces a changed source payload through every generated helper restart for a random or replayed seed`,
  assertChangedSourceReplay,
)

it.each([`upsert`, `rawUpdate`, `replay`, `restart`] as const)(
  `detects driver mutation at %s without changing expected source rows`,
  (entry) => {
    const model = createReconciliationModel()
    const row = { id: 1, revision: 1, value: 1 }
    const step: ReconciliationStep =
      entry === `restart`
        ? { type: `restart` }
        : entry === `replay`
          ? { type: `batch`, operations: [{ type: `replay`, key: `row` }] }
          : {
              type: `batch`,
              operations: [
                { type: entry, key: `row`, row, reportedPreviousValue: row },
              ],
            }
    if (entry === `restart` || entry === `replay`) {
      applyReconciliationStep(model, upsert(`row`, row))
      applyReconciliationStep(model, { type: `teardown` })
      if (entry === `replay`) model.graphActive = true
    }
    const corrupt: Reconciler = (changes, sent) => {
      for (const change of changes) change.value.value++
      return reconcileChangesForD2(changes, sent)
    }
    expect(() => applyReconciliationStep(model, step, corrupt)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
    expect(model.sourceRows.get(`row`)).toEqual({
      id: 1,
      revision: 1,
      value: 1,
    })
    expect(row).toEqual({ id: 1, revision: 1, value: 1 })
    // Fresh real helper control at the same entry, including restart hydration.
    const valid = createReconciliationModel()
    if (entry === `restart` || entry === `replay`) {
      applyReconciliationStep(valid, upsert(`row`, row))
      applyReconciliationStep(valid, { type: `teardown` })
      if (entry === `replay`) valid.graphActive = true
    }
    applyReconciliationStep(valid, step)
  },
)

const assertExactSourceContributions = (
  steps: ReadonlyArray<ReconciliationStep>,
) => {
  const model = createReconciliationModel()
  for (const step of steps) {
    applyReconciliationStep(model, step)
  }
}

fixedCampaign.prop([reconciliationHistoryArbitrary], {
  numRuns: oracleRuns(200),
  seed: 1780,
})(
  `keeps one exact D2 contribution per source key for a fixed seed`,
  assertExactSourceContributions,
)

randomCampaign(`d2-source.exact-retractions`).prop(
  [reconciliationHistoryArbitrary],
  oraclePropertyOptions(200, `d2-source.exact-retractions`),
)(
  `keeps one exact D2 contribution per source key for a random or replayed seed`,
  assertExactSourceContributions,
)

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

  expect(snapshotModel(rightThenLeft)).toEqual(snapshotModel(leftThenRight))
}

fixedCampaign.prop([disjointHistoriesArbitrary], {
  numRuns: oracleRuns(100),
  seed: 1781,
})(
  `commutes independent source histories for a fixed seed`,
  assertDisjointHistoriesCommute,
)

randomCampaign(`d2-source.disjoint-commutation`).prop(
  [disjointHistoriesArbitrary],
  oraclePropertyOptions(100, `d2-source.disjoint-commutation`),
)(
  `commutes independent source histories for a random or replayed seed`,
  assertDisjointHistoriesCommute,
)

declareOracle({
  check: [
    applyReconciliationStep,
    expectTrackerMatchesSource,
    expectWeightedRelationMatchesSource,
    assertExactSourceContributions,
    assertChangedSourceReplay,
    assertDisjointHistoriesCommute,
  ],
  model: [applyToRelation],
  grammar: [reconciliationHistoryArbitrary],
})
