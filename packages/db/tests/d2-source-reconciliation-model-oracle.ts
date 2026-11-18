// The D2 source reconciliation model and its per-step check, moved unchanged
// out of d2-source-reconciliation-oracle.property.test.ts so that the ordinary
// tests in d2-source-reconciliation.test.ts can import them without importing
// the oracle file. The oracle file states the law and runs its generated
// histories through these functions. This module registers no tests.
import { expect } from 'vitest'
import { reconcileChangesForD2 } from '../src/query/live/utils.js'
import { oracleAssertion } from './oracle-assertion-adapter.js'
import {
  addWeight,
  expectedWeightedRowIdentity,
} from './d2-source-reconciliation-support.js'
import type {
  SourceKey,
  SourceRow,
} from './d2-source-reconciliation-support.js'
import type { ChangeMessage } from '../src/types.js'

export type SourceOperation =
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

export type ReconciliationStep =
  | { type: `batch`; operations: ReadonlyArray<SourceOperation> }
  | { type: `truncate` }
  | { type: `teardown` }
  | { type: `restart` }

export type ReconciliationModel = {
  // Only sourceRows is expected state. sentRows belongs to the real helper;
  // relation independently integrates that helper's raw weighted output.
  sourceRows: Map<SourceKey, SourceRow>
  sentRows: Map<SourceKey, SourceRow>
  relation: Map<string, number>
  // Model-only switch for helper invocation, not a production graph state.
  graphActive: boolean
}

export type Reconciler = (
  changes: Array<ChangeMessage<SourceRow, SourceKey>>,
  sentRows: Map<SourceKey, SourceRow>,
) => Array<ChangeMessage<SourceRow, SourceKey>>

export function applyToRelation(
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

export function sourceChangesFor(
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

export function expectTrackerMatchesSource(
  sourceRows: ReadonlyMap<SourceKey, SourceRow>,
  sentRows: ReadonlyMap<SourceKey, SourceRow>,
): void {
  const compareEntries = (
    [a]: readonly [SourceKey, SourceRow],
    [b]: readonly [SourceKey, SourceRow],
  ) => `${typeof a}:${String(a)}`.localeCompare(`${typeof b}:${String(b)}`)
  oracleAssertion('expectTrackerMatchesSource', () =>
    expect([...sentRows.entries()].sort(compareEntries)).toEqual(
      [...sourceRows.entries()].sort(compareEntries),
    ),
  )
}

export function expectWeightedRelationMatchesSource(
  sourceRows: ReadonlyMap<SourceKey, SourceRow>,
  relation: ReadonlyMap<string, number>,
): void {
  oracleAssertion('expectWeightedRelationMatchesSource', () =>
    expect(
      [...relation.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ).toEqual(
      [...sourceRows.entries()]
        .map(
          ([key, row]) => [expectedWeightedRowIdentity(key, row), 1] as const,
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  )
}

export function createReconciliationModel(): ReconciliationModel {
  return {
    sourceRows: new Map(),
    sentRows: new Map(),
    relation: new Map(),
    graphActive: true,
  }
}

export function snapshotModel(model: ReconciliationModel): {
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

export function applyReconciliationStep(
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
    oracleAssertion('applyReconciliationStep', () =>
      expect(model.sentRows.size).toBe(0),
    )
    oracleAssertion('applyReconciliationStep', () =>
      expect(model.relation.size).toBe(0),
    )
  }
}

export function upsert(
  key: SourceKey,
  row: SourceRow,
  reportedPreviousValue: SourceRow = row,
): ReconciliationStep {
  return {
    type: `batch`,
    operations: [{ type: `upsert`, key, row, reportedPreviousValue }],
  }
}

export function executedReplayReach(
  steps: ReadonlyArray<ReconciliationStep>,
): number {
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
