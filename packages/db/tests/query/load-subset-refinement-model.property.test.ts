import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import {
  projectAcquisitionSettlement,
  projectAdapterLifecycle,
  projectAuthorizedContinuationStarts,
  projectReplayPublication,
  projectRetainedRowKeys,
  projectSourceReadiness,
  projectSyncTransactions,
  projectTransportLoads,
} from '../load-subset-full-flow-model.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import type {
  FullFlowVersionedRow,
  LoadSubsetFullFlowEvent,
} from '../load-subset-full-flow-model.js'
import type { LoadSubsetOptions, LoadSubsetResult } from '../../src/types.js'

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

function enumerateDemandLifecycles(): Array<Array<LoadSubsetFullFlowEvent>> {
  const histories: Array<Array<LoadSubsetFullFlowEvent>> = []
  const visit = (
    history: Array<LoadSubsetFullFlowEvent>,
    unseenOwners: ReadonlyArray<string>,
    activeOwners: ReadonlyArray<string>,
  ) => {
    histories.push(history)
    if (history.length === 4) return

    for (const ownerId of unseenOwners) {
      for (const alreadyAborted of [false, true]) {
        visit(
          [
            ...history,
            {
              type: `requestDemand`,
              ownerId,
              sessionId: `session`,
              demandId: `demand`,
              alreadyAborted,
            },
          ],
          unseenOwners.filter((owner) => owner !== ownerId),
          alreadyAborted ? activeOwners : [...activeOwners, ownerId],
        )
      }
    }
    for (const ownerId of activeOwners) {
      visit(
        [
          ...history,
          {
            type: `releaseDemand`,
            ownerId,
            demandId: `demand`,
            rowKeys: [],
            finalRowOwner: false,
            invalidatesAdapterEvidence: false,
          },
        ],
        unseenOwners,
        activeOwners.filter((owner) => owner !== ownerId),
      )
    }
  }

  visit([], [`owner-a`, `owner-b`], [])
  return histories
}

it(`exhaustively conserves adapter starts and releases for two owners`, () => {
  for (const history of enumerateDemandLifecycles()) {
    const lifecycle = projectAdapterLifecycle(history)
    const activeOwners = new Set<string>()

    for (const event of lifecycle) {
      if (event.type === `invoke`) {
        expect(activeOwners.has(event.ownerId), JSON.stringify(history)).toBe(
          false,
        )
        activeOwners.add(event.ownerId)
      } else {
        expect(
          activeOwners.delete(event.ownerId),
          JSON.stringify(history),
        ).toBe(true)
      }
    }
  }
})

function renameHistoryIds(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
  suffix: string,
): Array<LoadSubsetFullFlowEvent> {
  return history.map((event) => {
    switch (event.type) {
      case `requestDemand`:
        return {
          ...event,
          ownerId: `${event.ownerId}-${suffix}`,
          sessionId: `${event.sessionId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
        }
      case `applyAuthoritativeRows`:
      case `releaseDemand`:
        return {
          ...event,
          ownerId: `${event.ownerId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
        }
      case `registerSourceDemand`:
      case `settleSourceDemand`:
        return {
          ...event,
          sessionId: `${event.sessionId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
        }
      case `cleanupSession`:
        return { ...event, sessionId: `${event.sessionId}-${suffix}` }
      case `restartSession`:
        return {
          ...event,
          previousSessionId: `${event.previousSessionId}-${suffix}`,
          nextSessionId: `${event.nextSessionId}-${suffix}`,
        }
      case `advanceWindowRevision`:
        return { ...event, sessionId: `${event.sessionId}-${suffix}` }
      case `scheduleContinuation`:
        return {
          ...event,
          taskId: `${event.taskId}-${suffix}`,
          sessionId: `${event.sessionId}-${suffix}`,
        }
      case `runContinuation`:
        return { ...event, taskId: `${event.taskId}-${suffix}` }
      case `stageSyncTransaction`:
        return {
          ...event,
          transactionId: `${event.transactionId}-${suffix}`,
        }
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
        return {
          ...event,
          transactionId: `${event.transactionId}-${suffix}`,
        }
      case `startAcquisition`:
        return {
          ...event,
          acquisitionId: `${event.acquisitionId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
        }
      case `attachAcquisitionOwner`:
        return {
          ...event,
          acquisitionId: `${event.acquisitionId}-${suffix}`,
          ownerId: `${event.ownerId}-${suffix}`,
        }
      case `settleAcquisition`:
        return {
          ...event,
          acquisitionId: `${event.acquisitionId}-${suffix}`,
        }
      default:
        return event
    }
  })
}

fcTest.prop(
  [fc.string({ minLength: 1, maxLength: 4 })],
  oraclePropertyOptions(50),
)(`source demand names are observationally erased`, (suffix) => {
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `registerSourceDemand`,
      sessionId: `session`,
      sourceId: `source-a`,
      demandId: `demand-a`,
    },
    {
      type: `registerSourceDemand`,
      sessionId: `session`,
      sourceId: `source-b`,
      demandId: `demand-b`,
    },
    {
      type: `settleSourceDemand`,
      sessionId: `session`,
      sourceId: `source-a`,
      demandId: `demand-a`,
      outcome: `resolve`,
    },
  ]

  expect(projectSourceReadiness(renameHistoryIds(history, suffix))).toEqual(
    projectSourceReadiness(history),
  )
})

fcTest.prop(
  [fc.string({ minLength: 1, maxLength: 4 })],
  oraclePropertyOptions(50),
)(
  `demand, owner, session, and task names preserve projected laws`,
  (suffix) => {
    const demandHistory: Array<LoadSubsetFullFlowEvent> = [
      {
        type: `requestDemand`,
        ownerId: `owner`,
        sessionId: `session`,
        demandId: `demand`,
        alreadyAborted: false,
      },
      {
        type: `applyAuthoritativeRows`,
        ownerId: `owner`,
        demandId: `demand`,
        rowKeys: [`row`],
      },
      {
        type: `releaseDemand`,
        ownerId: `owner`,
        demandId: `demand`,
        rowKeys: [`row`],
        finalRowOwner: true,
        invalidatesAdapterEvidence: true,
      },
    ]
    const continuationHistory: Array<LoadSubsetFullFlowEvent> = [
      {
        type: `requestDemand`,
        ownerId: `owner`,
        sessionId: `session`,
        demandId: `demand`,
        alreadyAborted: false,
      },
      {
        type: `scheduleContinuation`,
        taskId: `task`,
        sessionId: `session`,
        windowRevision: 0,
      },
      { type: `runContinuation`, taskId: `task` },
    ]

    const renamedDemand = renameHistoryIds(demandHistory, suffix)
    expect(projectTransportLoads(renamedDemand)).toBe(
      projectTransportLoads(demandHistory),
    )
    expect(projectRetainedRowKeys(renamedDemand)).toEqual(
      projectRetainedRowKeys(demandHistory),
    )
    expect(
      projectAdapterLifecycle(renamedDemand).map(({ type }) => type),
    ).toEqual(projectAdapterLifecycle(demandHistory).map(({ type }) => type))
    expect(
      projectAuthorizedContinuationStarts(
        renameHistoryIds(continuationHistory, suffix),
      ),
    ).toBe(projectAuthorizedContinuationStarts(continuationHistory))
  },
)

fcTest.prop(
  [fc.string({ minLength: 1, maxLength: 4 })],
  oraclePropertyOptions(50),
)(`transaction names do not change publication semantics`, (suffix) => {
  const history = successfulTransaction(`transaction`, `source`, `row`)
  const original = projectSyncTransactions(history)
  const renamed = projectSyncTransactions(renameHistoryIds(history, suffix))

  expect({
    visibleRows: renamed.visibleRows,
    publishedBatches: renamed.publishedBatches,
    callbackReads: renamed.callbackReads,
    receiptStates: renamed.receipts.map(({ state }) => state),
  }).toEqual({
    visibleRows: original.visibleRows,
    publishedBatches: original.publishedBatches,
    callbackReads: original.callbackReads,
    receiptStates: original.receipts.map(({ state }) => state),
  })
})

fcTest.prop(
  [
    fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), {
      minLength: 1,
      maxLength: 3,
    }),
    fc.string({ minLength: 1, maxLength: 4 }),
  ],
  oraclePropertyOptions(50),
)(`acquisition and owner names are semantically erased`, (rowKeys, suffix) => {
  const history = acquisitionHistory(`shared`, rowKeys)
  const renamed = renameHistoryIds(history, suffix)

  const normalizeOwners = (
    observation: ReturnType<typeof projectAcquisitionSettlement>,
  ) => ({
    owners: observation.owners.map(({ state, rowKeys: keys }) => ({
      state,
      rowKeys: keys,
    })),
    visibleRowKeys: observation.visibleRowKeys,
  })

  expect(normalizeOwners(projectAcquisitionSettlement(renamed))).toEqual(
    normalizeOwners(projectAcquisitionSettlement(history)),
  )
})

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

type AcquisitionTopology = `shared` | `separate`

function acquisitionHistory(
  topology: AcquisitionTopology,
  rowKeys: ReadonlyArray<string>,
): Array<LoadSubsetFullFlowEvent> {
  const start = (acquisitionId: string): LoadSubsetFullFlowEvent => ({
    type: `startAcquisition`,
    acquisitionId,
    sourceId: `source`,
    demandId: `exact-demand`,
  })
  const attach = (
    acquisitionId: string,
    ownerId: string,
  ): LoadSubsetFullFlowEvent => ({
    type: `attachAcquisitionOwner`,
    acquisitionId,
    ownerId,
  })
  const settle = (acquisitionId: string): LoadSubsetFullFlowEvent => ({
    type: `settleAcquisition`,
    acquisitionId,
    outcome: `resolve`,
    rowKeys,
  })

  return topology === `shared`
    ? [
        start(`shared-acquisition`),
        attach(`shared-acquisition`, `owner-a`),
        attach(`shared-acquisition`, `owner-b`),
        settle(`shared-acquisition`),
      ]
    : [
        start(`acquisition-a`),
        attach(`acquisition-a`, `owner-a`),
        settle(`acquisition-a`),
        start(`acquisition-b`),
        attach(`acquisition-b`, `owner-b`),
        settle(`acquisition-b`),
      ]
}

function semanticAcquisitionResult(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
) {
  const { owners, visibleRowKeys } = projectAcquisitionSettlement(history)
  return { owners, visibleRowKeys }
}

async function runAcquisitionTopology(
  topology: AcquisitionTopology,
  rowKeys: ReadonlyArray<string>,
) {
  let physicalStarts = 0
  const createDeduplicator = () =>
    new DeduplicatedLoadSubset({
      loadSubset: () => {
        physicalStarts++
        return Promise.resolve({
          hasMore: false,
          appliedRowKeys: rowKeys,
        } satisfies LoadSubsetResult)
      },
    })
  const shared = createDeduplicator()
  const ownerDeduplicators =
    topology === `shared` ? [shared, shared] : [shared, createDeduplicator()]
  const options: LoadSubsetOptions = { limit: rowKeys.length }
  const results = await Promise.all(
    ownerDeduplicators.map((deduplicator) => deduplicator.loadSubset(options)),
  )

  return {
    physicalStarts,
    owners: results.map((result, index) => ({
      ownerId: index === 0 ? `owner-a` : `owner-b`,
      state: `resolved` as const,
      rowKeys:
        result === true || result === undefined
          ? []
          : [...(result.appliedRowKeys ?? [])].map(String).sort(),
    })),
    visibleRowKeys: [
      ...new Set(
        results.flatMap((result) =>
          result === true || result === undefined
            ? []
            : [...(result.appliedRowKeys ?? [])].map(String),
        ),
      ),
    ].sort(),
  }
}

fcTest.prop(
  [
    fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), {
      minLength: 1,
      maxLength: 3,
    }),
  ],
  oraclePropertyOptions(50),
)(
  `sharing an exact physical acquisition changes work, not logical results`,
  async (rowKeys) => {
    const sharedHistory = acquisitionHistory(`shared`, rowKeys)
    const separateHistory = acquisitionHistory(`separate`, rowKeys)
    const sharedExpected = projectAcquisitionSettlement(sharedHistory)
    const separateExpected = projectAcquisitionSettlement(separateHistory)

    expect(semanticAcquisitionResult(sharedHistory)).toEqual(
      semanticAcquisitionResult(separateHistory),
    )
    expect(sharedExpected.physicalStarts).toHaveLength(1)
    expect(separateExpected.physicalStarts).toHaveLength(2)

    const sharedActual = await runAcquisitionTopology(`shared`, rowKeys)
    const separateActual = await runAcquisitionTopology(`separate`, rowKeys)
    expect({
      owners: sharedActual.owners,
      visibleRowKeys: sharedActual.visibleRowKeys,
    }).toEqual(semanticAcquisitionResult(sharedHistory))
    expect({
      owners: separateActual.owners,
      visibleRowKeys: separateActual.visibleRowKeys,
    }).toEqual(semanticAcquisitionResult(separateHistory))
    expect(sharedActual.physicalStarts).toBe(1)
    expect(separateActual.physicalStarts).toBe(2)
  },
)
