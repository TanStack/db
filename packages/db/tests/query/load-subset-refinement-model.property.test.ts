import { fc, test as fcTest } from '@fast-check/vitest'
import { expect } from 'vitest'
import {
  projectReplayPublication,
  projectSyncTransactions,
} from '../load-subset-full-flow-model.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import type {
  FullFlowVersionedRow,
  LoadSubsetFullFlowEvent,
} from '../load-subset-full-flow-model.js'

function successfulTransaction(
  transactionId: string,
  sourceId: string,
  rowKey: string,
): Array<LoadSubsetFullFlowEvent> {
  return [
    {
      type: `stageSyncTransaction`,
      transactionId,
      sourceId,
      rowKeys: [rowKey],
    },
    {
      type: `commitSyncTransaction`,
      transactionId,
      parked: false,
      signalAborted: false,
    },
    { type: `enterSyncApplication`, transactionId },
    { type: `publishSyncTransaction`, transactionId },
    { type: `settleSyncReceipt`, transactionId },
  ]
}

fcTest.prop(
  [
    fc.string({ minLength: 1, maxLength: 4 }),
    fc.string({ minLength: 1, maxLength: 4 }),
  ],
  oraclePropertyOptions(50),
)(
  `commuting independent transactions preserves final public state and receipts`,
  (leftKey, rightKey) => {
    const left = successfulTransaction(`left-tx`, `left-source`, leftKey)
    const right = successfulTransaction(`right-tx`, `right-source`, rightKey)
    const leftThenRight = projectSyncTransactions([...left, ...right])
    const rightThenLeft = projectSyncTransactions([...right, ...left])

    // Event-batch order is intentionally observable and may differ. The
    // metamorphic law concerns the final independent state and receipts.
    expect(leftThenRight.visibleRows).toEqual(rightThenLeft.visibleRows)
    expect(leftThenRight.receipts).toEqual(rightThenLeft.receipts)
  },
)

function overlappingReplayHistory(
  baseline: FullFlowVersionedRow,
  replacement: FullFlowVersionedRow,
  oldAttemptId: string,
  newAttemptId: string,
  settlementOrder: `old-first` | `new-first`,
): Array<LoadSubsetFullFlowEvent> {
  const settlements: Array<LoadSubsetFullFlowEvent> =
    settlementOrder === `old-first`
      ? [
          {
            type: `settleReplay`,
            attemptId: oldAttemptId,
            outcome: `reject`,
          },
          {
            type: `settleReplay`,
            attemptId: newAttemptId,
            outcome: `resolve`,
          },
        ]
      : [
          {
            type: `settleReplay`,
            attemptId: newAttemptId,
            outcome: `resolve`,
          },
          {
            type: `settleReplay`,
            attemptId: oldAttemptId,
            outcome: `reject`,
          },
        ]
  return [
    {
      type: `establishPublication`,
      sourceId: baseline.sourceId,
      rows: [baseline],
    },
    {
      type: `startReplay`,
      attemptId: oldAttemptId,
      sourceId: baseline.sourceId,
    },
    {
      type: `startReplay`,
      attemptId: newAttemptId,
      sourceId: baseline.sourceId,
    },
    {
      type: `writeReplayRows`,
      attemptId: newAttemptId,
      rows: [replacement],
      acceptedByCore: true,
    },
    ...settlements,
  ]
}

fcTest.prop(
  [fc.integer({ min: -10, max: 10 }), fc.integer({ min: -10, max: 10 })],
  oraclePropertyOptions(50),
)(
  `overlapping replay settlement order does not change the newest complete replacement`,
  (baselineVersion, replacementVersion) => {
    const baseline = {
      sourceId: `source`,
      rowKey: `row`,
      version: baselineVersion,
    }
    const replacement = {
      sourceId: `source`,
      rowKey: `row`,
      version: replacementVersion,
    }

    expect(
      projectReplayPublication(
        overlappingReplayHistory(
          baseline,
          replacement,
          `old`,
          `new`,
          `old-first`,
        ),
      ),
    ).toEqual(
      projectReplayPublication(
        overlappingReplayHistory(
          baseline,
          replacement,
          `old`,
          `new`,
          `new-first`,
        ),
      ),
    )
  },
)

fcTest.prop([fc.integer({ min: -10, max: 10 })], oraclePropertyOptions(50))(
  `replay attempt names are observationally erased`,
  (replacementVersion) => {
    const baseline = { sourceId: `source`, rowKey: `row`, version: 0 }
    const replacement = {
      sourceId: `source`,
      rowKey: `row`,
      version: replacementVersion,
    }

    expect(
      projectReplayPublication(
        overlappingReplayHistory(
          baseline,
          replacement,
          `attempt-a`,
          `attempt-b`,
          `new-first`,
        ),
      ),
    ).toEqual(
      projectReplayPublication(
        overlappingReplayHistory(
          baseline,
          replacement,
          `renamed-old`,
          `renamed-new`,
          `new-first`,
        ),
      ),
    )
  },
)
