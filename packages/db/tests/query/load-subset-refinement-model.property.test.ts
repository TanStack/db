import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import {
  projectAcquisitionSettlement,
  projectAdapterLifecycle,
  projectAuthorizedContinuationStarts,
  projectReplayPublication,
  projectRetainedRowKeys,
  projectReusableDemands,
  projectSourceReadiness,
  projectSyncTransactions,
  projectTransportLoads,
} from '../load-subset-full-flow-model.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { flushPromises } from '../utils.js'
import type {
  FullFlowVersionedRow,
  LoadSubsetFullFlowEvent,
} from '../load-subset-full-flow-model.js'
import type { LoadSubsetResult } from '../../src/types.js'

function refinementCampaigns(fixedSeed: number) {
  return [
    {
      label: `fixed seed ${fixedSeed}`,
      options: { numRuns: oracleRuns(50), seed: fixedSeed },
    },
    {
      label: `random or replayed seed`,
      options: oraclePropertyOptions(50),
    },
  ] as const
}

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

for (const campaign of refinementCampaigns(1_779_001)) {
  fcTest.prop(
    [
      fc.string({ minLength: 1, maxLength: 4 }),
      fc.string({ minLength: 1, maxLength: 4 }),
    ],
    campaign.options,
  )(
    `commuting independent transactions preserves final public state and receipts (${campaign.label})`,
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
}

type DemandLifecycleCase = {
  history: Array<LoadSubsetFullFlowEvent>
  expected: Array<{ type: `invoke` | `release`; ownerId: string }>
}

function enumerateDemandLifecycles(): Array<DemandLifecycleCase> {
  const cases: Array<DemandLifecycleCase> = []
  const visit = (
    history: Array<LoadSubsetFullFlowEvent>,
    expected: DemandLifecycleCase[`expected`],
    unseenOwners: ReadonlyArray<string>,
    activeOwners: ReadonlyArray<string>,
  ) => {
    cases.push({ history, expected })
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
              attemptId: `${ownerId}-attempt`,
              alreadyAborted,
            },
          ],
          alreadyAborted
            ? expected
            : [...expected, { type: `invoke`, ownerId }],
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
            attemptId: `${ownerId}-attempt`,
            rowKeys: [],
            finalRowOwner: false,
            invalidatesAdapterEvidence: false,
          },
        ],
        [...expected, { type: `release`, ownerId }],
        unseenOwners,
        activeOwners.filter((owner) => owner !== ownerId),
      )
    }
  }

  visit([], [], [`owner-a`, `owner-b`], [])
  return cases
}

it(`exhaustively projects exact adapter starts and releases for two owners`, () => {
  for (const { history, expected } of enumerateDemandLifecycles()) {
    const lifecycle = projectAdapterLifecycle(history)
    expect(lifecycle, JSON.stringify(history)).toEqual(expected)
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

it(`shares concurrent exact demand and retries after evidence-free settlement`, () => {
  const request = (
    ownerId: string,
    attemptId = `${ownerId}-attempt`,
  ): LoadSubsetFullFlowEvent => ({
    type: `requestDemand`,
    ownerId,
    sessionId: `session`,
    demandId: `exact-demand`,
    attemptId,
    alreadyAborted: false,
  })
  const concurrent = [request(`owner-a`), request(`owner-b`)]

  expect(projectTransportLoads(concurrent)).toBe(
    projectAcquisitionSettlement(acquisitionHistory(`shared`, [`row`]))
      .physicalStarts.length,
  )
  expect(
    projectTransportLoads([
      ...concurrent,
      {
        type: `releaseDemand`,
        ownerId: `owner-a`,
        demandId: `exact-demand`,
        attemptId: `owner-a-attempt`,
        rowKeys: [],
        finalRowOwner: true,
        invalidatesAdapterEvidence: true,
      },
      request(`owner-c`),
    ]),
  ).toBe(2)
  expect(
    projectTransportLoads([
      ...concurrent,
      {
        type: `settleDemandWithoutEvidence`,
        demandId: `exact-demand`,
        attemptId: `owner-a-attempt`,
      },
      request(`owner-c`),
    ]),
  ).toBe(2)
  expect(
    projectTransportLoads([
      ...concurrent,
      {
        type: `applyAuthoritativeRows`,
        ownerId: `owner-a`,
        demandId: `exact-demand`,
        attemptId: `owner-a-attempt`,
        rowKeys: [`row`],
      },
      request(`owner-c`),
    ]),
  ).toBe(1)
})

it.each([
  {
    name: `authoritative`,
    event: {
      type: `applyAuthoritativeRows`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `old-attempt`,
      rowKeys: [`stale-row`],
    },
  },
  {
    name: `unproven`,
    event: {
      type: `applyUnprovenRows`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `old-attempt`,
      rowKeys: [`stale-row`],
    },
  },
  {
    name: `rejected`,
    event: {
      type: `rejectDemand`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `old-attempt`,
    },
  },
  {
    name: `evidence-free`,
    event: {
      type: `settleDemandWithoutEvidence`,
      demandId: `exact-demand`,
      attemptId: `old-attempt`,
    },
  },
  {
    name: `released`,
    event: {
      type: `releaseDemand`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `old-attempt`,
      rowKeys: [],
      finalRowOwner: true,
      invalidatesAdapterEvidence: true,
    },
  },
] satisfies ReadonlyArray<{
  name: string
  event: LoadSubsetFullFlowEvent
}>)(
  `keeps fresh same-demand work shared when an old attempt is $name after truncate`,
  ({ event }) => {
    expect(
      projectTransportLoads([
        {
          type: `requestDemand`,
          ownerId: `old-owner`,
          sessionId: `session`,
          demandId: `exact-demand`,
          attemptId: `old-attempt`,
          alreadyAborted: false,
        },
        { type: `truncateSource`, sessionId: `session` },
        {
          type: `requestDemand`,
          ownerId: `fresh-owner`,
          sessionId: `session`,
          demandId: `exact-demand`,
          attemptId: `fresh-attempt`,
          alreadyAborted: false,
        },
        event,
        {
          type: `requestDemand`,
          ownerId: `peer-owner`,
          sessionId: `session`,
          demandId: `exact-demand`,
          attemptId: `peer-attempt`,
          alreadyAborted: false,
        },
      ]),
    ).toBe(2)
  },
)

it(`scopes reusable evidence to the physical attempt when an owner is reused`, () => {
  const oldRequest: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    ownerId: `stable-owner`,
    sessionId: `session`,
    demandId: `exact-demand`,
    attemptId: `old-attempt`,
    alreadyAborted: false,
  }
  const freshRequest: LoadSubsetFullFlowEvent = {
    ...oldRequest,
    attemptId: `fresh-attempt`,
  }
  const oldSettlement: LoadSubsetFullFlowEvent = {
    type: `applyAuthoritativeRows`,
    ownerId: `stable-owner`,
    demandId: `exact-demand`,
    attemptId: `old-attempt`,
    rowKeys: [`stale-row`],
  }
  const freshSettlement: LoadSubsetFullFlowEvent = {
    ...oldSettlement,
    attemptId: `fresh-attempt`,
    rowKeys: [`fresh-row`],
  }
  const staleRelease: LoadSubsetFullFlowEvent = {
    type: `releaseDemand`,
    ownerId: `stable-owner`,
    demandId: `exact-demand`,
    attemptId: `old-attempt`,
    rowKeys: [`stale-row`],
    finalRowOwner: true,
    invalidatesAdapterEvidence: true,
  }
  const beforeFreshSettlement = [
    oldRequest,
    { type: `truncateSource`, sessionId: `session` } as const,
    freshRequest,
    oldSettlement,
  ]

  expect(projectReusableDemands(beforeFreshSettlement)).toEqual([])
  expect(
    projectReusableDemands([...beforeFreshSettlement, freshSettlement]),
  ).toEqual([`exact-demand`])
  expect(
    projectReusableDemands([
      ...beforeFreshSettlement,
      freshSettlement,
      staleRelease,
    ]),
  ).toEqual([`exact-demand`])
  expect(
    projectTransportLoads([
      ...beforeFreshSettlement,
      freshSettlement,
      staleRelease,
      {
        ...freshRequest,
        ownerId: `peer-owner`,
        attemptId: `peer-attempt`,
      },
    ]),
  ).toBe(2)
})

it(`does not rebuild coverage when a released attempt settles after its replacement starts`, () => {
  expect(
    projectReusableDemands([
      {
        type: `requestDemand`,
        ownerId: `old-owner`,
        sessionId: `session`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
        alreadyAborted: false,
      },
      {
        type: `releaseDemand`,
        ownerId: `old-owner`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
        rowKeys: [],
        finalRowOwner: true,
        invalidatesAdapterEvidence: true,
      },
      {
        type: `requestDemand`,
        ownerId: `fresh-owner`,
        sessionId: `session`,
        demandId: `exact-demand`,
        attemptId: `fresh-attempt`,
        alreadyAborted: false,
      },
      {
        type: `applyAuthoritativeRows`,
        ownerId: `old-owner`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
        rowKeys: [`stale-row`],
      },
    ]),
  ).toEqual([])
})

it(`keeps fresh same-epoch work shared after an older rejected attempt releases`, () => {
  const oldRequest: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    ownerId: `old-owner`,
    sessionId: `session`,
    demandId: `exact-demand`,
    attemptId: `old-attempt`,
    alreadyAborted: false,
  }
  const freshRequest: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    ownerId: `fresh-owner`,
    sessionId: `session`,
    demandId: `exact-demand`,
    attemptId: `fresh-attempt`,
    alreadyAborted: false,
  }

  expect(
    projectTransportLoads([
      oldRequest,
      {
        type: `rejectDemand`,
        ownerId: `old-owner`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
      },
      freshRequest,
      {
        type: `releaseDemand`,
        ownerId: `old-owner`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
        rowKeys: [],
        finalRowOwner: true,
        invalidatesAdapterEvidence: true,
      },
      {
        ...freshRequest,
        ownerId: `peer-owner`,
        attemptId: `peer-attempt`,
      },
    ]),
  ).toBe(2)
})

it(`rejects histories that reuse one demand attempt identity`, () => {
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `requestDemand`,
      ownerId: `old-owner`,
      sessionId: `session`,
      demandId: `exact-demand`,
      attemptId: `reused-attempt`,
      alreadyAborted: false,
    },
    {
      type: `releaseDemand`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `reused-attempt`,
      rowKeys: [],
      finalRowOwner: true,
      invalidatesAdapterEvidence: true,
    },
    {
      type: `requestDemand`,
      ownerId: `fresh-owner`,
      sessionId: `session`,
      demandId: `exact-demand`,
      attemptId: `reused-attempt`,
      alreadyAborted: false,
    },
    {
      type: `applyAuthoritativeRows`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `reused-attempt`,
      rowKeys: [`stale-row`],
    },
  ]

  expect(() => projectTransportLoads(history)).toThrow(
    `Demand attempt "reused-attempt" was requested more than once`,
  )
  expect(() => projectReusableDemands(history)).toThrow(
    `Demand attempt "reused-attempt" was requested more than once`,
  )
})

it(`rejects histories that settle one demand attempt twice`, () => {
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `requestDemand`,
      ownerId: `owner`,
      sessionId: `session`,
      demandId: `demand`,
      attemptId: `attempt`,
      alreadyAborted: false,
    },
    {
      type: `settleDemandWithoutEvidence`,
      demandId: `demand`,
      attemptId: `attempt`,
    },
    {
      type: `rejectDemand`,
      ownerId: `owner`,
      demandId: `demand`,
      attemptId: `attempt`,
    },
  ]

  expect(() => projectTransportLoads(history)).toThrow(
    `Demand attempt "attempt" settled more than once`,
  )
  expect(() => projectReusableDemands(history)).toThrow(
    `Demand attempt "attempt" settled more than once`,
  )
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
          attemptId: `${event.attemptId}-${suffix}`,
        }
      case `applyAuthoritativeRows`:
      case `applyUnprovenRows`:
      case `rejectDemand`:
      case `releaseDemand`:
        return {
          ...event,
          ownerId: `${event.ownerId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
          attemptId: `${event.attemptId}-${suffix}`,
        }
      case `settleDemandWithoutEvidence`:
        return {
          ...event,
          demandId: `${event.demandId}-${suffix}`,
          attemptId: `${event.attemptId}-${suffix}`,
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

for (const campaign of refinementCampaigns(1_779_002)) {
  fcTest.prop([fc.string({ minLength: 1, maxLength: 4 })], campaign.options)(
    `source demand names are observationally erased (${campaign.label})`,
    (suffix) => {
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
    },
  )
}

for (const campaign of refinementCampaigns(1_779_003)) {
  fcTest.prop([fc.string({ minLength: 1, maxLength: 4 })], campaign.options)(
    `demand, attempt, owner, session, and task names preserve projected laws (${campaign.label})`,
    (suffix) => {
      const demandHistory: Array<LoadSubsetFullFlowEvent> = [
        {
          type: `requestDemand`,
          ownerId: `owner`,
          sessionId: `session`,
          demandId: `demand`,
          attemptId: `attempt`,
          alreadyAborted: false,
        },
        {
          type: `applyAuthoritativeRows`,
          ownerId: `owner`,
          demandId: `demand`,
          attemptId: `attempt`,
          rowKeys: [`row`],
        },
        {
          type: `releaseDemand`,
          ownerId: `owner`,
          demandId: `demand`,
          attemptId: `attempt`,
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
          attemptId: `attempt`,
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

      const evidenceFreeHistory: Array<LoadSubsetFullFlowEvent> = [
        {
          type: `requestDemand`,
          ownerId: `evidence-free-owner`,
          sessionId: `session`,
          demandId: `evidence-free-demand`,
          attemptId: `evidence-free-attempt`,
          alreadyAborted: false,
        },
        {
          type: `settleDemandWithoutEvidence`,
          demandId: `evidence-free-demand`,
          attemptId: `evidence-free-attempt`,
        },
      ]

      const renamedDemand = renameHistoryIds(demandHistory, suffix)
      expect(
        renamedDemand.flatMap((event) =>
          `attemptId` in event ? [event.attemptId] : [],
        ),
      ).toEqual(
        demandHistory.flatMap((event) =>
          `attemptId` in event ? [`${event.attemptId}-${suffix}`] : [],
        ),
      )
      expect(
        renameHistoryIds(evidenceFreeHistory, suffix).flatMap((event) =>
          `attemptId` in event ? [event.attemptId] : [],
        ),
      ).toEqual([
        `evidence-free-attempt-${suffix}`,
        `evidence-free-attempt-${suffix}`,
      ])
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
}

for (const campaign of refinementCampaigns(1_779_004)) {
  fcTest.prop([fc.string({ minLength: 1, maxLength: 4 })], campaign.options)(
    `transaction names do not change publication semantics (${campaign.label})`,
    (suffix) => {
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
    },
  )
}

for (const campaign of refinementCampaigns(1_779_005)) {
  fcTest.prop(
    [
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), {
        minLength: 1,
        maxLength: 3,
      }),
      fc.string({ minLength: 1, maxLength: 4 }),
    ],
    campaign.options,
  )(
    `acquisition and owner names are semantically erased (${campaign.label})`,
    (rowKeys, suffix) => {
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
    },
  )
}

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

for (const campaign of refinementCampaigns(1_779_006)) {
  fcTest.prop(
    [fc.integer({ min: -10, max: 10 }), fc.integer({ min: -10, max: 10 })],
    campaign.options,
  )(
    `overlapping replay settlement order does not change the newest complete replacement (${campaign.label})`,
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
}

for (const campaign of refinementCampaigns(1_779_007)) {
  fcTest.prop([fc.integer({ min: -10, max: 10 })], campaign.options)(
    `replay attempt names are observationally erased (${campaign.label})`,
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
}

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
  const runId = ++acquisitionRunId
  let physicalStarts = 0
  const delivery = createDeferred<void>()
  const createSource = (suffix: string) => {
    type Row = { id: string }
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => true | Promise<void>
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: async () => {
        physicalStarts++
        await delivery.promise
        begin()
        for (const id of rowKeys) write({ type: `insert`, value: { id } })
        const applied = commit()
        if (applied !== true) await applied
        return {
          hasMore: false,
          appliedRowKeys: rowKeys,
        } satisfies LoadSubsetResult
      },
    })
    return createCollection<Row>({
      id: `refinement-acquisition-${runId}-${suffix}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: deduplicated.loadSubset,
            unloadSubset: deduplicated.unloadSubset,
          }
        },
      },
    })
  }
  const sharedSource = createSource(`shared`)
  const ownerSources =
    topology === `shared`
      ? [sharedSource, sharedSource]
      : [sharedSource, createSource(`separate`)]
  const sources = [...new Set(ownerSources)]
  const ownerIds = [`owner-a`, `owner-b`] as const
  const liveQueries = ownerSources.map((source, index) =>
    createLiveQueryCollection({
      id: `refinement-acquisition-${runId}-${ownerIds[index]}`,
      query: (q) => q.from({ row: source }),
      startSync: true,
    }),
  )
  const batches: Array<Array<Array<string>>> = [[], []]
  const callbackReads: Array<Array<Array<string>>> = [[], []]
  const subscriptions = liveQueries.map((live, index) =>
    live.subscribeChanges(
      (changes) => {
        batches[index]!.push(changes.map(({ key }) => String(key)).sort())
        callbackReads[index]!.push(
          live.toArray.map(({ id }) => String(id)).sort(),
        )
      },
      { includeInitialState: false },
    ),
  )
  const preloads = liveQueries.map((live) => live.preload())
  const expectedPhysicalStarts = topology === `shared` ? 1 : 2

  try {
    for (
      let attempt = 0;
      attempt < 20 && physicalStarts < expectedPhysicalStarts;
      attempt++
    ) {
      await flushPromises()
    }
    expect(physicalStarts).toBe(expectedPhysicalStarts)
    delivery.resolve()
    await Promise.all(preloads)

    const owners = liveQueries.map((live, index) => ({
      ownerId: ownerIds[index]!,
      state: `resolved` as const,
      rowKeys: live.toArray.map(({ id }) => String(id)).sort(),
    }))
    return {
      physicalStarts,
      owners,
      visibleRowKeys: [
        ...new Set(owners.flatMap(({ rowKeys: keys }) => keys)),
      ].sort(),
      batches,
      callbackReads,
    }
  } finally {
    delivery.resolve()
    subscriptions.forEach((subscription) => subscription.unsubscribe())
    await Promise.all([
      ...liveQueries.map((live) => live.cleanup()),
      ...sources.map((source) => source.cleanup()),
    ])
  }
}

let acquisitionRunId = 0

for (const campaign of refinementCampaigns(1_779_008)) {
  fcTest.prop(
    [
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), {
        minLength: 1,
        maxLength: 3,
      }),
    ],
    campaign.options,
  )(
    `sharing an exact physical acquisition changes work, not logical results (${campaign.label})`,
    async (rowKeys) => {
      const sharedHistory = acquisitionHistory(`shared`, rowKeys)
      const separateHistory = acquisitionHistory(`separate`, rowKeys)
      const sharedExpected = projectAcquisitionSettlement(sharedHistory)
      const separateExpected = projectAcquisitionSettlement(separateHistory)
      const sharedSemantic = semanticAcquisitionResult(sharedHistory)
      const separateSemantic = semanticAcquisitionResult(separateHistory)

      expect(sharedSemantic).toEqual(separateSemantic)
      expect(sharedExpected.physicalStarts).toHaveLength(1)
      expect(separateExpected.physicalStarts).toHaveLength(2)

      const sharedActual = await runAcquisitionTopology(`shared`, rowKeys)
      const separateActual = await runAcquisitionTopology(`separate`, rowKeys)
      expect({
        owners: sharedActual.owners,
        visibleRowKeys: sharedActual.visibleRowKeys,
      }).toEqual(sharedSemantic)
      expect({
        owners: separateActual.owners,
        visibleRowKeys: separateActual.visibleRowKeys,
      }).toEqual(separateSemantic)
      expect(sharedActual.batches).toEqual(separateActual.batches)
      expect(sharedActual.callbackReads).toEqual(separateActual.callbackReads)
      expect(sharedActual.physicalStarts).toBe(1)
      expect(separateActual.physicalStarts).toBe(2)
    },
  )
}
