import { fc, test as fcTest } from '@fast-check/vitest'
import { expect } from 'vitest'
import { reconcileChangesForD2 } from '../src/query/live/utils.js'
import { oraclePropertyOptions } from './oracle-config.js'
import type { ChangeMessage } from '../src/types.js'

type SourceRow = {
  id: number
  revision: number
  value: number
}

type SourceOperation =
  | {
      type: `upsert`
      row: SourceRow
      reportedPreviousValue: SourceRow
    }
  | { type: `replay`; key: number }
  | { type: `delete`; key: number; reportedValue: SourceRow }

type ReconciliationStep =
  | { type: `batch`; operations: ReadonlyArray<SourceOperation> }
  | { type: `reset` }

const sourceRowArbitrary = fc.record({
  id: fc.integer({ min: 0, max: 3 }),
  revision: fc.integer({ min: 0, max: 4 }),
  value: fc.integer({ min: -2, max: 2 }),
})

const sourceOperationArbitrary: fc.Arbitrary<SourceOperation> = fc.oneof(
  fc
    .record({
      row: sourceRowArbitrary,
      reportedPreviousValue: sourceRowArbitrary,
    })
    .map((operation) => ({ type: `upsert` as const, ...operation })),
  fc
    .integer({ min: 0, max: 3 })
    .map((key) => ({ type: `replay` as const, key })),
  fc
    .record({
      key: fc.integer({ min: 0, max: 3 }),
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
  { weight: 1, arbitrary: fc.constant({ type: `reset` as const }) },
)

function rowIdentity(row: SourceRow): string {
  return `${row.id}:${row.revision}:${row.value}`
}

function addWeight(
  relation: Map<string, number>,
  row: SourceRow,
  weight: 1 | -1,
): void {
  const identity = rowIdentity(row)
  const nextWeight = (relation.get(identity) ?? 0) + weight
  if (nextWeight === 0) relation.delete(identity)
  else relation.set(identity, nextWeight)
}

function applyToRelation(
  relation: Map<string, number>,
  changes: ReadonlyArray<ChangeMessage<SourceRow, number>>,
): void {
  for (const change of changes) {
    if (change.type === `insert`) {
      addWeight(relation, change.value, 1)
    } else if (change.type === `update`) {
      addWeight(relation, change.previousValue!, -1)
      addWeight(relation, change.value, 1)
    } else {
      addWeight(relation, change.value, -1)
    }
  }
}

function sourceChangesFor(
  operations: ReadonlyArray<SourceOperation>,
  sourceRows: Map<number, SourceRow>,
): Array<ChangeMessage<SourceRow, number>> {
  const changes: Array<ChangeMessage<SourceRow, number>> = []
  for (const operation of operations) {
    if (operation.type === `upsert`) {
      const previousValue = sourceRows.get(operation.row.id)
      changes.push(
        previousValue === undefined
          ? { type: `insert`, key: operation.row.id, value: operation.row }
          : {
              type: `update`,
              key: operation.row.id,
              value: operation.row,
              previousValue: operation.reportedPreviousValue,
            },
      )
      sourceRows.set(operation.row.id, operation.row)
    } else if (operation.type === `replay`) {
      const row = sourceRows.get(operation.key)
      if (row !== undefined) {
        changes.push({ type: `insert`, key: operation.key, value: row })
      }
    } else {
      const row = sourceRows.get(operation.key)
      if (row !== undefined) {
        changes.push({
          type: `delete`,
          key: operation.key,
          value: operation.reportedValue,
        })
        sourceRows.delete(operation.key)
      }
    }
  }
  return changes
}

function expectExactSourceRelation(
  sourceRows: ReadonlyMap<number, SourceRow>,
  sentRows: ReadonlyMap<number, SourceRow>,
  relation: ReadonlyMap<string, number>,
): void {
  expect([...sentRows.entries()].sort(([a], [b]) => a - b)).toEqual(
    [...sourceRows.entries()].sort(([a], [b]) => a - b),
  )
  expect(
    [...relation.entries()].sort(([a], [b]) => a.localeCompare(b)),
  ).toEqual(
    [...sourceRows.values()]
      .map((row) => [rowIdentity(row), 1] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

fcTest.prop(
  [fc.array(reconciliationStepArbitrary, { minLength: 1, maxLength: 30 })],
  oraclePropertyOptions(200, `d2-source.exact-retractions`),
)(
  `keeps one exact D2 contribution per source key across batched histories`,
  (steps) => {
    const sourceRows = new Map<number, SourceRow>()
    const sentRows = new Map<number, SourceRow>()
    const relation = new Map<string, number>()

    for (const step of steps) {
      if (step.type === `reset`) {
        sourceRows.clear()
        sentRows.clear()
        relation.clear()
      } else {
        const changes = sourceChangesFor(step.operations, sourceRows)
        const reconciled = reconcileChangesForD2(changes, sentRows)
        applyToRelation(relation, reconciled)
      }
      expectExactSourceRelation(sourceRows, sentRows, relation)
    }
  },
)
