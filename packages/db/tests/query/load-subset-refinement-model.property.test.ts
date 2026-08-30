import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import {
  projectAcquisitionSettlement,
  projectAdapterLifecycle,
  projectAtomicOrderedPublicationState,
  projectAuthorizedContinuationStarts,
  projectOrderedPublicationBoundary,
  projectReplayPublication,
  projectRetainedRowKeys,
  projectRetainedSourceRows,
  projectReusableDemands,
  projectReusableSourceDemands,
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
      options: oraclePropertyOptions(50, `load-subset-refinement.${fixedSeed}`),
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
  expected: Array<{
    type: `invoke` | `release`
    ownerId: string
    sourceId: string
    attemptId: string
  }>
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
              sourceId: `source`,
              ownerId,
              sessionId: `session`,
              demandId: `demand`,
              attemptId: `${ownerId}-attempt`,
              alreadyAborted,
            },
          ],
          alreadyAborted
            ? expected
            : [
                ...expected,
                {
                  type: `invoke`,
                  ownerId,
                  sourceId: `source`,
                  attemptId: `${ownerId}-attempt`,
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
            sourceId: `source`,
            ownerId,
            demandId: `demand`,
            attemptId: `${ownerId}-attempt`,
          },
        ],
        [
          ...expected,
          {
            type: `release`,
            ownerId,
            sourceId: `source`,
            attemptId: `${ownerId}-attempt`,
          },
        ],
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
    const activeAttempts = new Set<string>()

    for (const event of lifecycle) {
      if (event.type === `invoke`) {
        expect(
          activeAttempts.has(event.attemptId),
          JSON.stringify(history),
        ).toBe(false)
        activeAttempts.add(event.attemptId)
      } else {
        expect(
          activeAttempts.delete(event.attemptId),
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
    sourceId: `source`,
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
        sourceId: `source`,
        ownerId: `owner-a`,
        demandId: `exact-demand`,
        attemptId: `owner-a-attempt`,
      },
      request(`owner-c`),
    ]),
  ).toBe(1)
  expect(
    projectTransportLoads([
      ...concurrent,
      {
        type: `releaseDemand`,
        sourceId: `source`,
        ownerId: `owner-a`,
        demandId: `exact-demand`,
        attemptId: `owner-a-attempt`,
      },
      {
        type: `releaseDemand`,
        sourceId: `source`,
        ownerId: `owner-b`,
        demandId: `exact-demand`,
        attemptId: `owner-b-attempt`,
      },
      request(`owner-c`),
    ]),
  ).toBe(2)
  expect(
    projectTransportLoads([
      ...concurrent,
      {
        type: `settleDemandWithoutEvidence`,
        sourceId: `source`,
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
        sourceId: `source`,
        ownerId: `owner-a`,
        demandId: `exact-demand`,
        attemptId: `owner-a-attempt`,
        rowKeys: [`row`],
      },
      request(`owner-c`),
    ]),
  ).toBe(1)
})

it(`scopes identical demand attempts, rows, and evidence to their source`, () => {
  const request = (sourceId: string): LoadSubsetFullFlowEvent => ({
    type: `requestDemand`,
    sourceId,
    ownerId: `owner`,
    sessionId: `session`,
    demandId: `shared-demand`,
    attemptId: `shared-attempt`,
    alreadyAborted: false,
  })
  const settle = (sourceId: string): LoadSubsetFullFlowEvent => ({
    type: `applyAuthoritativeRows`,
    sourceId,
    ownerId: `owner`,
    demandId: `shared-demand`,
    attemptId: `shared-attempt`,
    rowKeys: [`shared-row`],
  })
  const sourceASettled = [
    request(`source-a`),
    request(`source-b`),
    settle(`source-a`),
  ]

  expect(projectTransportLoads(sourceASettled)).toBe(2)
  expect(projectRetainedSourceRows(sourceASettled)).toEqual([
    { sourceId: `source-a`, rowKey: `shared-row` },
  ])
  expect(projectReusableSourceDemands(sourceASettled)).toEqual([
    { sourceId: `source-a`, demandId: `shared-demand` },
  ])

  const bothSettled = [...sourceASettled, settle(`source-b`)]
  expect(projectRetainedSourceRows(bothSettled)).toEqual([
    { sourceId: `source-a`, rowKey: `shared-row` },
    { sourceId: `source-b`, rowKey: `shared-row` },
  ])
  expect(projectReusableSourceDemands(bothSettled)).toEqual([
    { sourceId: `source-a`, demandId: `shared-demand` },
    { sourceId: `source-b`, demandId: `shared-demand` },
  ])

  const sourceATruncated = [
    ...bothSettled,
    {
      type: `truncateSource`,
      sessionId: `session`,
      sourceId: `source-a`,
    } satisfies LoadSubsetFullFlowEvent,
  ]
  expect(projectRetainedSourceRows(sourceATruncated)).toEqual([
    { sourceId: `source-b`, rowKey: `shared-row` },
  ])
  expect(projectReusableSourceDemands(sourceATruncated)).toEqual([
    { sourceId: `source-b`, demandId: `shared-demand` },
  ])
})

it(`fences stale same-source settlement from a fresh demand generation`, () => {
  const oldRequest: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    sourceId: `source`,
    ownerId: `owner`,
    sessionId: `session`,
    demandId: `demand`,
    attemptId: `old-attempt`,
    alreadyAborted: false,
  }
  const freshRequest: LoadSubsetFullFlowEvent = {
    ...oldRequest,
    attemptId: `fresh-attempt`,
  }
  const beforeFreshSettlement: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    oldRequest,
    { type: `truncateSource`, sessionId: `session`, sourceId: `source` },
    freshRequest,
    {
      type: `applyAuthoritativeRows`,
      sourceId: `source`,
      ownerId: `owner`,
      demandId: `demand`,
      attemptId: `old-attempt`,
      rowKeys: [`stale-row`],
    },
  ]

  expect(projectTransportLoads(beforeFreshSettlement)).toBe(2)
  expect(projectRetainedSourceRows(beforeFreshSettlement)).toEqual([
    { sourceId: `source`, rowKey: `stale-row` },
  ])
  expect(projectReusableSourceDemands(beforeFreshSettlement)).toEqual([])

  const oldReleased = [
    ...beforeFreshSettlement,
    {
      type: `releaseDemand`,
      sourceId: `source`,
      ownerId: `owner`,
      demandId: `demand`,
      attemptId: `old-attempt`,
    } satisfies LoadSubsetFullFlowEvent,
  ]
  expect(projectRetainedSourceRows(oldReleased)).toEqual([])
  expect(projectReusableSourceDemands(oldReleased)).toEqual([])

  const freshSettled = [
    ...oldReleased,
    {
      type: `applyAuthoritativeRows`,
      sourceId: `source`,
      ownerId: `owner`,
      demandId: `demand`,
      attemptId: `fresh-attempt`,
      rowKeys: [`fresh-row`],
    } satisfies LoadSubsetFullFlowEvent,
  ]
  expect(projectRetainedSourceRows(freshSettled)).toEqual([
    { sourceId: `source`, rowKey: `fresh-row` },
  ])
  expect(projectReusableSourceDemands(freshSettled)).toEqual([
    { sourceId: `source`, demandId: `demand` },
  ])
})

for (const campaign of refinementCampaigns(1_779_010)) {
  fcTest.prop(
    [
      fc.uniqueArray(fc.string({ maxLength: 6 }), {
        minLength: 2,
        maxLength: 2,
      }),
      fc.string({ maxLength: 6 }),
      fc.string({ maxLength: 6 }),
      fc.string({ maxLength: 6 }),
    ],
    campaign.options,
  )(
    `source identity scopes equal demand histories (${campaign.label})`,
    (sourceIds, demandId, attemptId, rowKey) => {
      const [sourceA, sourceB] = sourceIds as [string, string]
      const request = (sourceId: string): LoadSubsetFullFlowEvent => ({
        type: `requestDemand`,
        sourceId,
        ownerId: `owner`,
        sessionId: `session`,
        demandId,
        attemptId,
        alreadyAborted: false,
      })
      const settle = (sourceId: string): LoadSubsetFullFlowEvent => ({
        type: `applyAuthoritativeRows`,
        sourceId,
        ownerId: `owner`,
        demandId,
        attemptId,
        rowKeys: [rowKey],
      })
      const settled = [
        request(sourceA),
        request(sourceB),
        settle(sourceA),
        settle(sourceB),
      ]
      const surviving = [
        ...settled,
        {
          type: `truncateSource`,
          sessionId: `session`,
          sourceId: sourceA,
        } satisfies LoadSubsetFullFlowEvent,
      ]

      expect(projectTransportLoads(settled)).toBe(2)
      expect(projectRetainedSourceRows(settled)).toEqual(
        [sourceA, sourceB]
          .sort((left, right) => left.localeCompare(right))
          .map((sourceId) => ({ sourceId, rowKey })),
      )
      expect(projectRetainedSourceRows(surviving)).toEqual([
        { sourceId: sourceB, rowKey },
      ])
      expect(projectReusableSourceDemands(surviving)).toEqual([
        { sourceId: sourceB, demandId },
      ])
    },
  )
}

for (const campaign of refinementCampaigns(1_779_011)) {
  fcTest.prop(
    [
      fc.string({ maxLength: 6 }),
      fc.string({ maxLength: 6 }),
      fc.uniqueArray(fc.string({ maxLength: 6 }), {
        minLength: 2,
        maxLength: 2,
      }),
      fc.string({ maxLength: 6 }),
      fc.string({ maxLength: 6 }),
    ],
    campaign.options,
  )(
    `truncate fences stale settlement from the next demand generation (${campaign.label})`,
    (sourceId, demandId, attemptIds, staleRowKey, freshRowKey) => {
      const [oldAttemptId, freshAttemptId] = attemptIds as [string, string]
      const request = (attemptId: string): LoadSubsetFullFlowEvent => ({
        type: `requestDemand`,
        sourceId,
        ownerId: `owner`,
        sessionId: `session`,
        demandId,
        attemptId,
        alreadyAborted: false,
      })
      const oldSettlesThenReleases: ReadonlyArray<LoadSubsetFullFlowEvent> = [
        request(oldAttemptId),
        { type: `truncateSource`, sessionId: `session`, sourceId },
        request(freshAttemptId),
        {
          type: `applyAuthoritativeRows`,
          sourceId,
          ownerId: `owner`,
          demandId,
          attemptId: oldAttemptId,
          rowKeys: [staleRowKey],
        },
        {
          type: `releaseDemand`,
          sourceId,
          ownerId: `owner`,
          demandId,
          attemptId: oldAttemptId,
        },
      ]
      const freshSettles = [
        ...oldSettlesThenReleases,
        {
          type: `applyAuthoritativeRows`,
          sourceId,
          ownerId: `owner`,
          demandId,
          attemptId: freshAttemptId,
          rowKeys: [freshRowKey],
        } satisfies LoadSubsetFullFlowEvent,
      ]

      expect(projectTransportLoads(oldSettlesThenReleases)).toBe(2)
      expect(projectRetainedSourceRows(oldSettlesThenReleases)).toEqual([])
      expect(projectReusableSourceDemands(oldSettlesThenReleases)).toEqual([])
      expect(projectRetainedSourceRows(freshSettles)).toEqual([
        { sourceId, rowKey: freshRowKey },
      ])
      expect(projectReusableSourceDemands(freshSettles)).toEqual([
        { sourceId, demandId },
      ])
    },
  )
}

it(`retains a row until its last independent demand claim releases`, () => {
  const request = (
    demandId: string,
    attemptId: string,
  ): LoadSubsetFullFlowEvent => ({
    type: `requestDemand`,
    sourceId: `source`,
    ownerId: attemptId,
    sessionId: `session`,
    demandId,
    attemptId,
    alreadyAborted: false,
  })
  const apply = (
    demandId: string,
    attemptId: string,
  ): LoadSubsetFullFlowEvent => ({
    type: `applyUnprovenRows`,
    sourceId: `source`,
    ownerId: attemptId,
    demandId,
    attemptId,
    rowKeys: [`x`],
  })
  const release = (
    demandId: string,
    attemptId: string,
  ): LoadSubsetFullFlowEvent => ({
    type: `releaseDemand`,
    sourceId: `source`,
    ownerId: attemptId,
    demandId,
    attemptId,
  })
  const sharedClaims = [
    request(`left`, `left-attempt`),
    request(`right`, `right-attempt`),
    apply(`left`, `left-attempt`),
    apply(`right`, `right-attempt`),
  ]

  expect(
    projectRetainedRowKeys([...sharedClaims, release(`left`, `left-attempt`)]),
  ).toEqual([`x`])
  expect(
    projectRetainedRowKeys([
      ...sharedClaims,
      release(`left`, `left-attempt`),
      release(`right`, `right-attempt`),
    ]),
  ).toEqual([])
})

it(`attaches late rows only to attempts that shared the settling acquisition`, () => {
  const request = (
    ownerId: string,
    attemptId: string,
  ): LoadSubsetFullFlowEvent => ({
    type: `requestDemand`,
    sourceId: `source`,
    ownerId,
    sessionId: `session`,
    demandId: `shared`,
    attemptId,
    alreadyAborted: false,
  })
  const release = (
    ownerId: string,
    attemptId: string,
  ): LoadSubsetFullFlowEvent => ({
    type: `releaseDemand`,
    sourceId: `source`,
    ownerId,
    demandId: `shared`,
    attemptId,
  })
  const lateSettlement: LoadSubsetFullFlowEvent = {
    type: `applyAuthoritativeRows`,
    sourceId: `source`,
    ownerId: `old-owner`,
    demandId: `shared`,
    attemptId: `old-attempt`,
    rowKeys: [`stale-row`],
  }
  const oldRequest = request(`old-owner`, `old-attempt`)
  const oldRelease = release(`old-owner`, `old-attempt`)

  const freshCohort = [
    oldRequest,
    oldRelease,
    request(`fresh-owner`, `fresh-attempt`),
    lateSettlement,
  ]
  expect(projectRetainedRowKeys(freshCohort)).toEqual([])
  expect(projectReusableDemands(freshCohort)).toEqual([])

  const attachedPeer = [
    oldRequest,
    request(`peer-owner`, `peer-attempt`),
    oldRelease,
    lateSettlement,
  ]
  expect(projectRetainedRowKeys(attachedPeer)).toEqual([`stale-row`])
  expect(projectReusableDemands(attachedPeer)).toEqual([`shared`])
})

it(`retires an ownerless acquisition without disturbing another cohort for the same demand`, () => {
  const demandId = `shared`
  const request = (attemptId: string): LoadSubsetFullFlowEvent => ({
    type: `requestDemand`,
    sourceId: `source`,
    ownerId: attemptId,
    sessionId: `session`,
    demandId,
    attemptId,
    alreadyAborted: false,
  })
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    request(`attempt-a`),
    { type: `truncateSource`, sessionId: `session`, sourceId: `source` },
    request(`attempt-b`),
    {
      type: `releaseDemand`,
      sourceId: `source`,
      ownerId: `attempt-b`,
      demandId,
      attemptId: `attempt-b`,
    },
    request(`attempt-c`),
    {
      type: `applyAuthoritativeRows`,
      sourceId: `source`,
      ownerId: `attempt-b`,
      demandId,
      attemptId: `attempt-b`,
      rowKeys: [`stale-b`],
    },
  ]

  expect(projectTransportLoads(history)).toBe(3)
  expect(projectRetainedRowKeys(history)).toEqual([])
  expect(projectReusableDemands(history)).toEqual([])

  const survivingAcquisitionSettles = [
    ...history,
    {
      type: `applyAuthoritativeRows`,
      sourceId: `source`,
      ownerId: `attempt-a`,
      demandId,
      attemptId: `attempt-a`,
      rowKeys: [`live-a`],
    } satisfies LoadSubsetFullFlowEvent,
  ]
  expect(projectTransportLoads(survivingAcquisitionSettles)).toBe(3)
  expect(projectRetainedRowKeys(survivingAcquisitionSettles)).toEqual([
    `live-a`,
  ])
  expect(projectReusableDemands(survivingAcquisitionSettles)).toEqual([])
})

it.each([
  {
    name: `one owner releases the first attempt first`,
    owners: [`owner`, `owner`] as const,
    releaseOrder: [0, 1] as const,
  },
  {
    name: `one owner releases the second attempt first`,
    owners: [`owner`, `owner`] as const,
    releaseOrder: [1, 0] as const,
  },
  {
    name: `two owners release the first attempt first`,
    owners: [`owner-a`, `owner-b`] as const,
    releaseOrder: [0, 1] as const,
  },
  {
    name: `two owners release the second attempt first`,
    owners: [`owner-a`, `owner-b`] as const,
    releaseOrder: [1, 0] as const,
  },
])(`derives shared ownership for $name`, ({ owners, releaseOrder }) => {
  const demandId = `shared`
  const attempts = owners.map((ownerId, index) => ({
    ownerId,
    attemptId: `attempt-${index}`,
  }))
  const requests = attempts.map<LoadSubsetFullFlowEvent>(
    ({ ownerId, attemptId }) => ({
      type: `requestDemand`,
      sourceId: `source`,
      ownerId,
      sessionId: `session`,
      demandId,
      attemptId,
      alreadyAborted: false,
    }),
  )
  const settlement: LoadSubsetFullFlowEvent = {
    type: `applyAuthoritativeRows`,
    sourceId: `source`,
    ownerId: attempts[0]!.ownerId,
    demandId,
    attemptId: attempts[0]!.attemptId,
    rowKeys: [`x`],
  }
  const releases = releaseOrder.map<LoadSubsetFullFlowEvent>((index) => ({
    type: `releaseDemand`,
    sourceId: `source`,
    ownerId: attempts[index]!.ownerId,
    demandId,
    attemptId: attempts[index]!.attemptId,
  }))

  for (let released = 0; released <= releases.length; released++) {
    const active = released < releases.length
    const history = [...requests, settlement, ...releases.slice(0, released)]
    const lifecycle = projectAdapterLifecycle(history)

    expect(lifecycle.filter(({ type }) => type === `invoke`)).toHaveLength(2)
    expect(lifecycle.filter(({ type }) => type === `release`)).toHaveLength(
      released,
    )
    expect(projectRetainedRowKeys(history)).toEqual(active ? [`x`] : [])
    expect(projectReusableDemands(history)).toEqual(active ? [demandId] : [])
    const peerRequest: LoadSubsetFullFlowEvent = {
      type: `requestDemand`,
      sourceId: `source`,
      ownerId: `peer`,
      sessionId: `session`,
      demandId,
      attemptId: `peer-after-${released}`,
      alreadyAborted: false,
    }
    expect(projectRetainedRowKeys([...history, peerRequest])).toEqual(
      active ? [`x`] : [],
    )
    expect(projectTransportLoads([...history, peerRequest])).toBe(
      active ? 1 : 2,
    )

    const publication = projectAtomicOrderedPublicationState(
      [
        ...history,
        {
          type: `stagePublicationRows`,
          publicationId: `publication`,
          sourceId: `source`,
          demandId: `ordered`,
          rows: [{ key: `o`, orderValue: 0 }],
        },
        {
          type: `stagePublicationRows`,
          publicationId: `publication`,
          sourceId: `source`,
          demandId,
          rows: [{ key: `x`, orderValue: 1 }],
        },
        { type: `commitPublication`, publicationId: `publication` },
      ],
      {
        sourceId: `source`,
        demandId: `ordered`,
        direction: `asc`,
        initialWindowSize: 1,
      },
    )
    expect(publication.currentPublication?.rows.map(({ key }) => key)).toEqual(
      active ? [`o`, `x`] : [`o`],
    )
  }

  const lateSharedSettlement = [
    requests[0]!,
    requests[1]!,
    releases[0]!,
    settlement,
  ]
  expect(projectRetainedRowKeys(lateSharedSettlement)).toEqual([`x`])
  expect(projectReusableDemands(lateSharedSettlement)).toEqual([demandId])

  const fullyReleasedBeforeSettlement = [
    ...requests,
    ...releases,
    {
      type: `requestDemand`,
      sourceId: `source`,
      ownerId: `fresh-owner`,
      sessionId: `session`,
      demandId,
      attemptId: `fresh-attempt`,
      alreadyAborted: false,
    } satisfies LoadSubsetFullFlowEvent,
    settlement,
  ]
  expect(projectRetainedRowKeys(fullyReleasedBeforeSettlement)).toEqual([])
  expect(projectReusableDemands(fullyReleasedBeforeSettlement)).toEqual([])
  expect(projectTransportLoads(fullyReleasedBeforeSettlement)).toBe(2)
})

it(`keeps a same-name publication demand active on its surviving source`, () => {
  const request = (sourceId: string): LoadSubsetFullFlowEvent => ({
    type: `requestDemand`,
    sourceId,
    ownerId: `owner`,
    sessionId: `session`,
    demandId: `shared`,
    attemptId: `same-attempt`,
    alreadyAborted: false,
  })
  const projection = projectAtomicOrderedPublicationState(
    [
      request(`source-a`),
      request(`source-b`),
      {
        type: `stagePublicationRows`,
        publicationId: `publication`,
        sourceId: `ordered-source`,
        demandId: `ordered`,
        rows: [{ key: `ordered-row`, orderValue: 0 }],
      },
      {
        type: `stagePublicationRows`,
        publicationId: `publication`,
        sourceId: `other-ordered-source`,
        demandId: `ordered`,
        rows: [{ key: `wrong-ordered-row`, orderValue: -1 }],
      },
      {
        type: `stagePublicationRows`,
        publicationId: `publication`,
        sourceId: `source-a`,
        demandId: `shared`,
        rows: [{ key: `source-a-row`, orderValue: 1 }],
      },
      {
        type: `stagePublicationRows`,
        publicationId: `publication`,
        sourceId: `source-b`,
        demandId: `shared`,
        rows: [{ key: `source-b-row`, orderValue: 2 }],
      },
      {
        type: `releaseDemand`,
        sourceId: `source-a`,
        ownerId: `owner`,
        demandId: `shared`,
        attemptId: `same-attempt`,
      },
      { type: `commitPublication`, publicationId: `publication` },
    ],
    {
      sourceId: `ordered-source`,
      demandId: `ordered`,
      direction: `asc`,
      initialWindowSize: 1,
    },
  )

  expect(projection.currentPublication?.rows.map(({ key }) => key)).toEqual([
    `ordered-row`,
    `source-b-row`,
  ])
})

it(`treats a same-name demand from another source as additional`, () => {
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `requestDemand`,
      sourceId: `source-b`,
      ownerId: `owner-b`,
      sessionId: `session`,
      demandId: `ordered`,
      attemptId: `attempt-b`,
      alreadyAborted: false,
    },
    {
      type: `stagePublicationRows`,
      publicationId: `publication`,
      sourceId: `source-a`,
      demandId: `ordered`,
      rows: [{ key: `source-a-row`, orderValue: 1 }],
    },
    {
      type: `stagePublicationRows`,
      publicationId: `publication`,
      sourceId: `source-b`,
      demandId: `ordered`,
      rows: [{ key: `source-b-row`, orderValue: 2 }],
    },
    { type: `commitPublication`, publicationId: `publication` },
  ]

  expect(
    projectAtomicOrderedPublicationState(history, {
      sourceId: `source-a`,
      demandId: `ordered`,
      direction: `asc`,
      initialWindowSize: 1,
    }).currentPublication?.rows.map(({ key }) => key),
  ).toEqual([`source-a-row`, `source-b-row`])
})

it(`settles same-name replacement demands independently by source`, () => {
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `stagePublicationRows`,
      publicationId: `initial`,
      sourceId: `ordered-source`,
      demandId: `ordered`,
      rows: [{ key: `old-ordered-row`, orderValue: 0 }],
    },
    { type: `commitPublication`, publicationId: `initial` },
    {
      type: `requestDemand`,
      sourceId: `source-a`,
      ownerId: `owner-a`,
      sessionId: `session`,
      demandId: `shared`,
      attemptId: `attempt-a`,
      alreadyAborted: false,
    },
    {
      type: `requestDemand`,
      sourceId: `source-b`,
      ownerId: `owner-b`,
      sessionId: `session`,
      demandId: `shared`,
      attemptId: `attempt-b`,
      alreadyAborted: false,
    },
    {
      type: `stagePublicationRows`,
      publicationId: `replacement`,
      sourceId: `ordered-source`,
      demandId: `ordered`,
      rows: [{ key: `new-ordered-row`, orderValue: 0 }],
    },
    {
      type: `stagePublicationRows`,
      publicationId: `replacement`,
      sourceId: `source-a`,
      demandId: `shared`,
      rows: [{ key: `source-a-row`, orderValue: 1 }],
    },
    {
      type: `stagePublicationRows`,
      publicationId: `replacement`,
      sourceId: `source-b`,
      demandId: `shared`,
      rows: [{ key: `source-b-row`, orderValue: 2 }],
    },
    {
      type: `beginReplacement`,
      publicationId: `replacement`,
      demands: [
        { sourceId: `ordered-source`, demandId: `ordered` },
        { sourceId: `source-a`, demandId: `shared` },
        { sourceId: `source-b`, demandId: `shared` },
      ],
    },
    {
      type: `settleReplacement`,
      publicationId: `replacement`,
      sourceId: `ordered-source`,
      demandId: `ordered`,
      outcome: `success`,
      extent: `exhausted`,
    },
    {
      type: `settleReplacement`,
      publicationId: `replacement`,
      sourceId: `source-a`,
      demandId: `shared`,
      outcome: `success`,
      extent: `exhausted`,
    },
  ]
  const options = {
    sourceId: `ordered-source`,
    demandId: `ordered`,
    direction: `asc` as const,
    initialWindowSize: 1,
  }

  expect(
    projectAtomicOrderedPublicationState(
      history,
      options,
    ).currentPublication?.rows.map(({ key }) => key),
  ).toEqual([`old-ordered-row`])

  history.push({
    type: `settleReplacement`,
    publicationId: `replacement`,
    sourceId: `source-b`,
    demandId: `shared`,
    outcome: `success`,
    extent: `exhausted`,
  })
  expect(
    projectAtomicOrderedPublicationState(
      history,
      options,
    ).currentPublication?.rows.map(({ key }) => key),
  ).toEqual([`new-ordered-row`, `source-a-row`, `source-b-row`])
})

it.each([`a-first`, `b-first`] as const)(
  `keeps ordered boundaries source-qualified when staged %s`,
  (stageOrder) => {
    const stages: Array<LoadSubsetFullFlowEvent> = [
      {
        type: `stagePublicationRows`,
        publicationId: `publication`,
        sourceId: `source-a`,
        demandId: `ordered`,
        rows: [{ key: `row-a`, orderValue: 1 }],
      },
      {
        type: `stagePublicationRows`,
        publicationId: `publication`,
        sourceId: `source-b`,
        demandId: `ordered`,
        rows: [{ key: `row-b`, orderValue: 2 }],
      },
    ]
    if (stageOrder === `b-first`) stages.reverse()
    const history = [
      ...stages,
      { type: `commitPublication`, publicationId: `publication` } as const,
    ]
    const boundary = (sourceId: string) =>
      projectOrderedPublicationBoundary(history, {
        sourceId,
        demandId: `ordered`,
        direction: `asc`,
        prefixSize: 1,
      })?.key

    expect(boundary(`source-a`)).toBe(`row-a`)
    expect(boundary(`source-b`)).toBe(`row-b`)
  },
)

it(`applies target events only to their named source and demand`, () => {
  const target = { sourceId: `source-a`, demandId: `ordered` } as const
  const base: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `stagePublicationRows`,
      publicationId: `initial`,
      ...target,
      rows: [{ key: `old-row`, orderValue: 0 }],
    },
    { type: `commitPublication`, publicationId: `initial` },
    {
      type: `stagePublicationRows`,
      publicationId: `replacement`,
      ...target,
      rows: [
        { key: `new-row-a`, orderValue: 1 },
        { key: `new-row-b`, orderValue: 2 },
      ],
    },
    {
      type: `beginReplacement`,
      publicationId: `replacement`,
      demands: [target],
    },
  ]
  const settle: LoadSubsetFullFlowEvent = {
    type: `settleReplacement`,
    publicationId: `replacement`,
    ...target,
    outcome: `success`,
    extent: `continues`,
  }
  const establish = (
    sourceId: string,
    demandId = `ordered`,
    publicationId = `replacement`,
  ): LoadSubsetFullFlowEvent => ({
    type: `establishReplacementCoverage`,
    publicationId,
    sourceId,
    demandId,
  })
  const resize = (
    sourceId: string,
    demandId = `ordered`,
  ): LoadSubsetFullFlowEvent => ({
    type: `resizeOrderedWindow`,
    sourceId,
    demandId,
    size: 2,
  })
  const rows = (history: ReadonlyArray<LoadSubsetFullFlowEvent>) =>
    projectAtomicOrderedPublicationState(history, {
      ...target,
      direction: `asc`,
      initialWindowSize: 1,
    }).currentPublication?.rows.map(({ key }) => key)

  expect(rows([...base, settle, establish(`source-b`)])).toEqual([`old-row`])
  expect(rows([...base, settle, establish(`source-a`, `other`)])).toEqual([
    `old-row`,
  ])
  expect(
    rows([...base, settle, establish(`source-a`, `ordered`, `obsolete`)]),
  ).toEqual([`old-row`])
  expect(rows([...base, settle, establish(`source-a`)])).toEqual([`new-row-a`])
  expect(
    rows([...base, resize(`source-b`), settle, establish(`source-a`)]),
  ).toEqual([`new-row-a`])
  expect(
    rows([...base, resize(`source-a`, `other`), settle, establish(`source-a`)]),
  ).toEqual([`new-row-a`])
  expect(
    rows([...base, resize(`source-a`), settle, establish(`source-a`)]),
  ).toEqual([`new-row-a`, `new-row-b`])
})

it.each([
  {
    name: `authoritative`,
    event: {
      type: `applyAuthoritativeRows`,
      sourceId: `source`,
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
      sourceId: `source`,
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
      sourceId: `source`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `old-attempt`,
    },
  },
  {
    name: `evidence-free`,
    event: {
      type: `settleDemandWithoutEvidence`,
      sourceId: `source`,
      demandId: `exact-demand`,
      attemptId: `old-attempt`,
    },
  },
  {
    name: `released`,
    event: {
      type: `releaseDemand`,
      sourceId: `source`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `old-attempt`,
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
          sourceId: `source`,
          ownerId: `old-owner`,
          sessionId: `session`,
          demandId: `exact-demand`,
          attemptId: `old-attempt`,
          alreadyAborted: false,
        },
        { type: `truncateSource`, sessionId: `session`, sourceId: `source` },
        {
          type: `requestDemand`,
          sourceId: `source`,
          ownerId: `fresh-owner`,
          sessionId: `session`,
          demandId: `exact-demand`,
          attemptId: `fresh-attempt`,
          alreadyAborted: false,
        },
        event,
        {
          type: `requestDemand`,
          sourceId: `source`,
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
    sourceId: `source`,
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
    sourceId: `source`,
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
    sourceId: `source`,
    ownerId: `stable-owner`,
    demandId: `exact-demand`,
    attemptId: `old-attempt`,
  }
  const beforeFreshSettlement = [
    oldRequest,
    {
      type: `truncateSource`,
      sessionId: `session`,
      sourceId: `source`,
    } as const,
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
        sourceId: `source`,
        ownerId: `old-owner`,
        sessionId: `session`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
        alreadyAborted: false,
      },
      {
        type: `releaseDemand`,
        sourceId: `source`,
        ownerId: `old-owner`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
      },
      {
        type: `requestDemand`,
        sourceId: `source`,
        ownerId: `fresh-owner`,
        sessionId: `session`,
        demandId: `exact-demand`,
        attemptId: `fresh-attempt`,
        alreadyAborted: false,
      },
      {
        type: `applyAuthoritativeRows`,
        sourceId: `source`,
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
    sourceId: `source`,
    ownerId: `old-owner`,
    sessionId: `session`,
    demandId: `exact-demand`,
    attemptId: `old-attempt`,
    alreadyAborted: false,
  }
  const freshRequest: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    sourceId: `source`,
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
        sourceId: `source`,
        ownerId: `old-owner`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
      },
      freshRequest,
      {
        type: `releaseDemand`,
        sourceId: `source`,
        ownerId: `old-owner`,
        demandId: `exact-demand`,
        attemptId: `old-attempt`,
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
      sourceId: `source`,
      ownerId: `old-owner`,
      sessionId: `session`,
      demandId: `exact-demand`,
      attemptId: `reused-attempt`,
      alreadyAborted: false,
    },
    {
      type: `releaseDemand`,
      sourceId: `source`,
      ownerId: `old-owner`,
      demandId: `exact-demand`,
      attemptId: `reused-attempt`,
    },
    {
      type: `requestDemand`,
      sourceId: `source`,
      ownerId: `fresh-owner`,
      sessionId: `session`,
      demandId: `exact-demand`,
      attemptId: `reused-attempt`,
      alreadyAborted: false,
    },
    {
      type: `applyAuthoritativeRows`,
      sourceId: `source`,
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
      sourceId: `source`,
      ownerId: `owner`,
      sessionId: `session`,
      demandId: `demand`,
      attemptId: `attempt`,
      alreadyAborted: false,
    },
    {
      type: `settleDemandWithoutEvidence`,
      sourceId: `source`,
      demandId: `demand`,
      attemptId: `attempt`,
    },
    {
      type: `rejectDemand`,
      sourceId: `source`,
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
          sourceId: `${event.sourceId}-${suffix}`,
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
          sourceId: `${event.sourceId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
          attemptId: `${event.attemptId}-${suffix}`,
        }
      case `truncateSource`:
        return {
          ...event,
          sessionId: `${event.sessionId}-${suffix}`,
          sourceId: `${event.sourceId}-${suffix}`,
        }
      case `settleDemandWithoutEvidence`:
        return {
          ...event,
          sourceId: `${event.sourceId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
          attemptId: `${event.attemptId}-${suffix}`,
        }
      case `registerSourceDemand`:
      case `settleSourceDemand`:
      case `retireSourceDemand`:
        return {
          ...event,
          sessionId: `${event.sessionId}-${suffix}`,
          sourceId: `${event.sourceId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
          attemptId: `${event.attemptId}-${suffix}`,
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
      case `startReplay`:
      case `writeReplayRows`:
      case `settleReplay`:
        return {
          ...event,
          attemptId: `${event.attemptId}-${suffix}`,
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
      case `stagePublicationRows`:
        return {
          ...event,
          publicationId: `${event.publicationId}-${suffix}`,
          sourceId: `${event.sourceId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
        }
      case `commitPublication`:
        return {
          ...event,
          publicationId: `${event.publicationId}-${suffix}`,
        }
      case `establishReplacementCoverage`:
        return {
          ...event,
          publicationId: `${event.publicationId}-${suffix}`,
          sourceId: `${event.sourceId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
        }
      case `beginReplacement`:
        return {
          ...event,
          publicationId: `${event.publicationId}-${suffix}`,
          demands: event.demands.map(({ sourceId, demandId }) => ({
            sourceId: `${sourceId}-${suffix}`,
            demandId: `${demandId}-${suffix}`,
          })),
        }
      case `settleReplacement`:
        return {
          ...event,
          publicationId: `${event.publicationId}-${suffix}`,
          sourceId: `${event.sourceId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
        }
      case `resizeOrderedWindow`:
        return {
          ...event,
          sourceId: `${event.sourceId}-${suffix}`,
          demandId: `${event.demandId}-${suffix}`,
        }
      default:
        return event
    }
  })
}

function expectObservationPreservedAfterEveryPrefix<T>(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
  suffix: string,
  project: (
    prefix: ReadonlyArray<LoadSubsetFullFlowEvent>,
    suffix: string,
  ) => T,
  normalize: (observation: T, suffix: string) => unknown = (observation) =>
    observation,
): void {
  for (let prefixLength = 0; prefixLength <= history.length; prefixLength++) {
    const prefix = history.slice(0, prefixLength)
    expect(
      normalize(project(renameHistoryIds(prefix, suffix), suffix), suffix),
      JSON.stringify({ prefixLength, prefix }),
    ).toEqual(normalize(project(prefix, ``), ``))
  }
}

function removeRenamingSuffix(value: string, suffix: string): string {
  const marker = `-${suffix}`
  return suffix !== `` && value.endsWith(marker)
    ? value.slice(0, -marker.length)
    : value
}

function normalizeSourceReadiness(
  observation: ReturnType<typeof projectSourceReadiness>,
  suffix: string,
) {
  return {
    ...observation,
    pendingSources: observation.pendingSources.map((sourceId) =>
      removeRenamingSuffix(sourceId, suffix),
    ),
    failedSources: observation.failedSources.map((sourceId) =>
      removeRenamingSuffix(sourceId, suffix),
    ),
  }
}

it(`settles source readiness by exact demand attempt`, () => {
  const pendingReplacement: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    {
      type: `registerSourceDemand`,
      sessionId: `session`,
      sourceId: `source`,
      demandId: `demand`,
      attemptId: `attempt-a`,
    },
    {
      type: `registerSourceDemand`,
      sessionId: `session`,
      sourceId: `source`,
      demandId: `demand`,
      attemptId: `attempt-b`,
    },
    {
      type: `settleSourceDemand`,
      sessionId: `session`,
      sourceId: `source`,
      demandId: `demand`,
      attemptId: `attempt-a`,
      outcome: `resolve`,
    },
  ]
  expect(projectSourceReadiness(pendingReplacement)).toEqual({
    status: `loading`,
    pendingSources: [`source`],
    failedSources: [],
  })
  expect(
    projectSourceReadiness([
      ...pendingReplacement,
      {
        type: `settleSourceDemand`,
        sessionId: `session`,
        sourceId: `source`,
        demandId: `demand`,
        attemptId: `attempt-b`,
        outcome: `resolve`,
      },
    ]),
  ).toEqual({ status: `ready`, pendingSources: [], failedSources: [] })
})

it(`retires source demand attempts without crossing source identity`, () => {
  const survivingSource: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    {
      type: `registerSourceDemand`,
      sessionId: `session`,
      sourceId: `source-a`,
      demandId: `shared-demand`,
      attemptId: `shared-attempt`,
    },
    {
      type: `registerSourceDemand`,
      sessionId: `session`,
      sourceId: `source-b`,
      demandId: `shared-demand`,
      attemptId: `shared-attempt`,
    },
    {
      type: `retireSourceDemand`,
      sessionId: `session`,
      sourceId: `source-a`,
      demandId: `shared-demand`,
      attemptId: `shared-attempt`,
    },
    {
      type: `settleSourceDemand`,
      sessionId: `session`,
      sourceId: `source-a`,
      demandId: `shared-demand`,
      attemptId: `shared-attempt`,
      outcome: `reject`,
    },
  ]
  expect(projectSourceReadiness(survivingSource)).toEqual({
    status: `loading`,
    pendingSources: [`source-b`],
    failedSources: [],
  })
  expect(
    projectSourceReadiness([
      ...survivingSource,
      {
        type: `settleSourceDemand`,
        sessionId: `session`,
        sourceId: `source-b`,
        demandId: `shared-demand`,
        attemptId: `shared-attempt`,
        outcome: `resolve`,
      },
    ]),
  ).toEqual({ status: `ready`, pendingSources: [], failedSources: [] })
})

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
          attemptId: `attempt-a`,
        },
        {
          type: `registerSourceDemand`,
          sessionId: `session`,
          sourceId: `source-b`,
          demandId: `demand-b`,
          attemptId: `attempt-b`,
        },
        {
          type: `settleSourceDemand`,
          sessionId: `session`,
          sourceId: `source-a`,
          demandId: `demand-a`,
          attemptId: `attempt-a`,
          outcome: `resolve`,
        },
      ]

      expectObservationPreservedAfterEveryPrefix(
        history,
        suffix,
        projectSourceReadiness,
        normalizeSourceReadiness,
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
          sourceId: `source`,
          ownerId: `owner`,
          sessionId: `session`,
          demandId: `demand`,
          attemptId: `attempt`,
          alreadyAborted: false,
        },
        {
          type: `applyAuthoritativeRows`,
          sourceId: `source`,
          ownerId: `owner`,
          demandId: `demand`,
          attemptId: `attempt`,
          rowKeys: [`row`],
        },
        {
          type: `releaseDemand`,
          sourceId: `source`,
          ownerId: `owner`,
          demandId: `demand`,
          attemptId: `attempt`,
        },
      ]
      const continuationHistory: Array<LoadSubsetFullFlowEvent> = [
        {
          type: `requestDemand`,
          sourceId: `source`,
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
          sourceId: `source`,
          ownerId: `evidence-free-owner`,
          sessionId: `session`,
          demandId: `evidence-free-demand`,
          attemptId: `evidence-free-attempt`,
          alreadyAborted: false,
        },
        {
          type: `settleDemandWithoutEvidence`,
          sourceId: `source`,
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

      for (const history of [
        demandHistory,
        evidenceFreeHistory,
        continuationHistory,
      ]) {
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectTransportLoads,
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectRetainedRowKeys,
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectReusableDemands,
          (demandIds, renamingSuffix) =>
            demandIds.map((demandId) =>
              removeRenamingSuffix(demandId, renamingSuffix),
            ),
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectAdapterLifecycle,
          (events, renamingSuffix) =>
            events.map(({ type, ownerId, attemptId }) => ({
              type,
              ownerId: removeRenamingSuffix(ownerId, renamingSuffix),
              attemptId: removeRenamingSuffix(attemptId, renamingSuffix),
            })),
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectAuthorizedContinuationStarts,
        )
      }
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

      expectObservationPreservedAfterEveryPrefix(
        history,
        suffix,
        projectSyncTransactions,
        (observation, renamingSuffix) => ({
          ...observation,
          receipts: observation.receipts.map(({ transactionId, state }) => ({
            transactionId: removeRenamingSuffix(transactionId, renamingSuffix),
            state,
          })),
        }),
      )
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
      expectObservationPreservedAfterEveryPrefix(
        history,
        suffix,
        projectAcquisitionSettlement,
        (observation, renamingSuffix) => ({
          physicalStarts: observation.physicalStarts.map((acquisitionId) =>
            removeRenamingSuffix(acquisitionId, renamingSuffix),
          ),
          owners: observation.owners.map(
            ({ ownerId, state, rowKeys: keys }) => ({
              ownerId: removeRenamingSuffix(ownerId, renamingSuffix),
              state,
              rowKeys: keys,
            }),
          ),
          visibleRowKeys: observation.visibleRowKeys,
        }),
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
  fcTest.prop(
    [
      fc.integer({ min: -10, max: 10 }),
      fc.string({ minLength: 1, maxLength: 4 }),
    ],
    campaign.options,
  )(
    `replay attempt names are observationally erased (${campaign.label})`,
    (replacementVersion, suffix) => {
      const baseline = { sourceId: `source`, rowKey: `row`, version: 0 }
      const replacement = {
        sourceId: `source`,
        rowKey: `row`,
        version: replacementVersion,
      }

      const history = overlappingReplayHistory(
        baseline,
        replacement,
        `attempt-a`,
        `attempt-b`,
        `new-first`,
      )
      expectObservationPreservedAfterEveryPrefix(
        history,
        suffix,
        projectReplayPublication,
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

function sourceErasureHistories(): Array<Array<LoadSubsetFullFlowEvent>> {
  const register = (
    sessionId: string,
    sourceId: string,
    demandId: string,
    attemptId: string,
  ): LoadSubsetFullFlowEvent => ({
    type: `registerSourceDemand`,
    sessionId,
    sourceId,
    demandId,
    attemptId,
  })
  const settle = (
    sessionId: string,
    sourceId: string,
    demandId: string,
    attemptId: string,
    outcome: `resolve` | `reject`,
  ): LoadSubsetFullFlowEvent => ({
    type: `settleSourceDemand`,
    sessionId,
    sourceId,
    demandId,
    attemptId,
    outcome,
  })

  return [
    [
      register(`session-a`, `source-a`, `demand-a`, `attempt-a`),
      register(`session-a`, `source-b`, `demand-b`, `attempt-b`),
      settle(`session-a`, `source-a`, `demand-a`, `attempt-a`, `resolve`),
      settle(`session-a`, `source-b`, `demand-b`, `attempt-b`, `reject`),
    ],
    [
      register(`session-a`, `source-a`, `demand-a`, `attempt-a`),
      { type: `cleanupSession`, sessionId: `session-a` },
      settle(`session-a`, `source-a`, `demand-a`, `attempt-a`, `resolve`),
    ],
    [
      register(`session-a`, `source-a`, `demand-a`, `attempt-a`),
      {
        type: `restartSession`,
        previousSessionId: `session-a`,
        nextSessionId: `session-b`,
      },
      settle(`session-a`, `source-a`, `demand-a`, `attempt-a`, `reject`),
      register(`session-b`, `source-b`, `demand-b`, `attempt-b`),
      settle(`session-b`, `source-b`, `demand-b`, `attempt-b`, `resolve`),
    ],
  ]
}

function demandErasureHistories(): Array<Array<LoadSubsetFullFlowEvent>> {
  const request = (
    ownerId: string,
    attemptId: string,
    alreadyAborted = false,
  ): LoadSubsetFullFlowEvent => ({
    type: `requestDemand`,
    sourceId: `source`,
    ownerId,
    sessionId: `session-a`,
    demandId: `demand-a`,
    attemptId,
    alreadyAborted,
  })
  const release = (
    ownerId: string,
    attemptId: string,
  ): LoadSubsetFullFlowEvent => ({
    type: `releaseDemand`,
    sourceId: `source`,
    ownerId,
    demandId: `demand-a`,
    attemptId,
  })

  return [
    [
      request(`owner-a`, `attempt-a`),
      {
        type: `applyAuthoritativeRows`,
        sourceId: `source`,
        ownerId: `owner-a`,
        demandId: `demand-a`,
        attemptId: `attempt-a`,
        rowKeys: [`row-a`],
      },
      release(`owner-a`, `attempt-a`),
    ],
    [
      request(`owner-a`, `attempt-a`),
      {
        type: `applyUnprovenRows`,
        sourceId: `source`,
        ownerId: `owner-a`,
        demandId: `demand-a`,
        attemptId: `attempt-a`,
        rowKeys: [`row-a`],
      },
      release(`owner-a`, `attempt-a`),
    ],
    [
      request(`owner-a`, `attempt-a`),
      {
        type: `rejectDemand`,
        sourceId: `source`,
        ownerId: `owner-a`,
        demandId: `demand-a`,
        attemptId: `attempt-a`,
      },
      release(`owner-a`, `attempt-a`),
    ],
    [
      request(`owner-a`, `attempt-a`),
      {
        type: `settleDemandWithoutEvidence`,
        sourceId: `source`,
        demandId: `demand-a`,
        attemptId: `attempt-a`,
      },
      release(`owner-a`, `attempt-a`),
    ],
    [request(`owner-a`, `attempt-a`, true), release(`owner-a`, `attempt-a`)],
    [
      request(`owner-a`, `attempt-a`),
      {
        type: `releaseDemand`,
        sourceId: `source`,
        ownerId: `owner-a`,
        demandId: `demand-a`,
        attemptId: `attempt-a`,
      },
    ],
    [
      request(`owner-a`, `attempt-a`),
      {
        type: `truncateSource`,
        sessionId: `session-a`,
        sourceId: `source`,
      },
      request(`owner-b`, `attempt-b`),
      {
        type: `applyAuthoritativeRows`,
        sourceId: `source`,
        ownerId: `owner-a`,
        demandId: `demand-a`,
        attemptId: `attempt-a`,
        rowKeys: [`stale-row`],
      },
      {
        type: `applyAuthoritativeRows`,
        sourceId: `source`,
        ownerId: `owner-b`,
        demandId: `demand-a`,
        attemptId: `attempt-b`,
        rowKeys: [`row-a`],
      },
    ],
    [
      request(`owner-a`, `attempt-a`),
      {
        type: `scheduleContinuation`,
        taskId: `task-a`,
        sessionId: `session-a`,
        windowRevision: 0,
      },
      {
        type: `advanceWindowRevision`,
        sessionId: `session-a`,
        revision: 1,
      },
      { type: `runContinuation`, taskId: `task-a` },
      { type: `cleanupSession`, sessionId: `session-a` },
      {
        type: `restartSession`,
        previousSessionId: `session-a`,
        nextSessionId: `session-b`,
      },
      {
        type: `requestDemand`,
        sourceId: `source`,
        ownerId: `owner-b`,
        sessionId: `session-b`,
        demandId: `demand-b`,
        attemptId: `attempt-b`,
        alreadyAborted: false,
      },
      {
        type: `scheduleContinuation`,
        taskId: `task-b`,
        sessionId: `session-b`,
        windowRevision: 0,
      },
      { type: `runContinuation`, taskId: `task-b` },
    ],
    [
      {
        type: `requestDemand`,
        sourceId: `source-a`,
        ownerId: `owner`,
        sessionId: `session-a`,
        demandId: `demand`,
        attemptId: `attempt`,
        alreadyAborted: false,
      },
      {
        type: `requestDemand`,
        sourceId: `source-b`,
        ownerId: `owner`,
        sessionId: `session-a`,
        demandId: `demand`,
        attemptId: `attempt`,
        alreadyAborted: false,
      },
      {
        type: `applyAuthoritativeRows`,
        sourceId: `source-a`,
        ownerId: `owner`,
        demandId: `demand`,
        attemptId: `attempt`,
        rowKeys: [`row`],
      },
      {
        type: `applyAuthoritativeRows`,
        sourceId: `source-b`,
        ownerId: `owner`,
        demandId: `demand`,
        attemptId: `attempt`,
        rowKeys: [`row`],
      },
      {
        type: `truncateSource`,
        sessionId: `session-a`,
        sourceId: `source-a`,
      },
    ],
  ]
}

function transactionErasureHistories(): Array<Array<LoadSubsetFullFlowEvent>> {
  const stage: LoadSubsetFullFlowEvent = {
    type: `stageSyncTransaction`,
    transactionId: `transaction`,
    sourceId: `source`,
    rowKeys: [`row`],
  }
  const settle: LoadSubsetFullFlowEvent = {
    type: `settleSyncReceipt`,
    transactionId: `transaction`,
  }

  return [
    successfulTransaction(`transaction`, `source`, `row`),
    [
      ...successfulTransaction(`transaction-a`, `source-a`, `row-a`),
      ...successfulTransaction(`transaction-b`, `source-b`, `row-b`),
    ],
    [
      stage,
      {
        type: `commitSyncTransaction`,
        transactionId: `transaction`,
        parked: false,
        signalAborted: true,
      },
      settle,
    ],
    [
      stage,
      {
        type: `commitSyncTransaction`,
        transactionId: `transaction`,
        parked: true,
        signalAborted: false,
      },
      { type: `abortSyncTransaction`, transactionId: `transaction` },
      settle,
    ],
    [
      stage,
      {
        type: `commitSyncTransaction`,
        transactionId: `transaction`,
        parked: true,
        signalAborted: false,
      },
      { type: `enterSyncApplication`, transactionId: `transaction` },
      { type: `publishSyncTransaction`, transactionId: `transaction` },
      settle,
    ],
  ]
}

function replayErasureHistories(): Array<Array<LoadSubsetFullFlowEvent>> {
  const baseline = { sourceId: `source`, rowKey: `row`, version: 0 }
  const replacement = { sourceId: `source`, rowKey: `row`, version: 1 }

  return [
    overlappingReplayHistory(
      baseline,
      replacement,
      `attempt-a`,
      `attempt-b`,
      `old-first`,
    ),
    overlappingReplayHistory(
      baseline,
      replacement,
      `attempt-a`,
      `attempt-b`,
      `new-first`,
    ),
    [
      { type: `establishPublication`, sourceId: `source`, rows: [baseline] },
      { type: `startReplay`, attemptId: `attempt-a`, sourceId: `source` },
      {
        type: `writeReplayRows`,
        attemptId: `attempt-a`,
        rows: [replacement],
        acceptedByCore: false,
      },
      { type: `settleReplay`, attemptId: `attempt-a`, outcome: `resolve` },
    ],
    [
      { type: `establishPublication`, sourceId: `source`, rows: [baseline] },
      { type: `startReplay`, attemptId: `attempt-a`, sourceId: `source` },
      { type: `settleReplay`, attemptId: `attempt-a`, outcome: `reject` },
    ],
  ]
}

function erasedIdentityReferences(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
): Array<{ path: string; field: string; value: string }> {
  const references: Array<{ path: string; field: string; value: string }> = []
  const add = (
    eventIndex: number,
    field: string,
    value: string,
    fieldPath = field,
  ) => {
    references.push({ path: `${eventIndex}.${fieldPath}`, field, value })
  }

  for (const [eventIndex, event] of history.entries()) {
    switch (event.type) {
      case `requestDemand`:
        add(eventIndex, `ownerId`, event.ownerId)
        add(eventIndex, `sessionId`, event.sessionId)
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `demandId`, event.demandId)
        add(eventIndex, `attemptId`, event.attemptId)
        break
      case `applyAuthoritativeRows`:
      case `applyUnprovenRows`:
      case `rejectDemand`:
      case `releaseDemand`:
        add(eventIndex, `ownerId`, event.ownerId)
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `demandId`, event.demandId)
        add(eventIndex, `attemptId`, event.attemptId)
        break
      case `settleDemandWithoutEvidence`:
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `demandId`, event.demandId)
        add(eventIndex, `attemptId`, event.attemptId)
        break
      case `truncateSource`:
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `sessionId`, event.sessionId)
        break
      case `cleanupSession`:
      case `advanceWindowRevision`:
        add(eventIndex, `sessionId`, event.sessionId)
        break
      case `restartSession`:
        add(eventIndex, `previousSessionId`, event.previousSessionId)
        add(eventIndex, `nextSessionId`, event.nextSessionId)
        break
      case `scheduleContinuation`:
        add(eventIndex, `taskId`, event.taskId)
        add(eventIndex, `sessionId`, event.sessionId)
        break
      case `runContinuation`:
        add(eventIndex, `taskId`, event.taskId)
        break
      case `stageSyncTransaction`:
      case `commitSyncTransaction`:
      case `enterSyncApplication`:
      case `abortSyncTransaction`:
      case `publishSyncTransaction`:
      case `settleSyncReceipt`:
        add(eventIndex, `transactionId`, event.transactionId)
        break
      case `startReplay`:
      case `writeReplayRows`:
      case `settleReplay`:
        add(eventIndex, `attemptId`, event.attemptId)
        break
      case `registerSourceDemand`:
      case `settleSourceDemand`:
      case `retireSourceDemand`:
        add(eventIndex, `sessionId`, event.sessionId)
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `demandId`, event.demandId)
        add(eventIndex, `attemptId`, event.attemptId)
        break
      case `startAcquisition`:
        add(eventIndex, `acquisitionId`, event.acquisitionId)
        add(eventIndex, `demandId`, event.demandId)
        break
      case `attachAcquisitionOwner`:
        add(eventIndex, `acquisitionId`, event.acquisitionId)
        add(eventIndex, `ownerId`, event.ownerId)
        break
      case `settleAcquisition`:
        add(eventIndex, `acquisitionId`, event.acquisitionId)
        break
      case `stagePublicationRows`:
        add(eventIndex, `publicationId`, event.publicationId)
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `demandId`, event.demandId)
        break
      case `commitPublication`:
        add(eventIndex, `publicationId`, event.publicationId)
        break
      case `establishReplacementCoverage`:
        add(eventIndex, `publicationId`, event.publicationId)
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `demandId`, event.demandId)
        break
      case `beginReplacement`:
        add(eventIndex, `publicationId`, event.publicationId)
        event.demands.forEach(({ sourceId, demandId }, demandIndex) => {
          add(
            eventIndex,
            `sourceId`,
            sourceId,
            `demands.${demandIndex}.sourceId`,
          )
          add(
            eventIndex,
            `demandId`,
            demandId,
            `demands.${demandIndex}.demandId`,
          )
        })
        break
      case `settleReplacement`:
        add(eventIndex, `publicationId`, event.publicationId)
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `demandId`, event.demandId)
        break
      case `establishPublication`:
        break
      case `resizeOrderedWindow`:
        add(eventIndex, `sourceId`, event.sourceId)
        add(eventIndex, `demandId`, event.demandId)
        break
    }
  }

  return references
}

function changedLeafPaths(
  left: unknown,
  right: unknown,
  path = ``,
): Array<string> {
  if (Object.is(left, right)) return []
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return [path]
    return left.flatMap((value, index) =>
      changedLeafPaths(
        value,
        right[index],
        path === `` ? `${index}` : `${path}.${index}`,
      ),
    )
  }
  if (
    typeof left === `object` &&
    left !== null &&
    typeof right === `object` &&
    right !== null
  ) {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const keys = [
      ...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]),
    ].sort()
    return keys.flatMap((key) =>
      changedLeafPaths(
        leftRecord[key],
        rightRecord[key],
        path === `` ? key : `${path}.${key}`,
      ),
    )
  }
  return [path]
}

function expectEveryErasedIdentityRenamed(
  history: ReadonlyArray<LoadSubsetFullFlowEvent>,
  suffix: string,
): void {
  const renamed = renameHistoryIds(history, suffix)
  const references = erasedIdentityReferences(history)
  expect(erasedIdentityReferences(renamed), JSON.stringify(history)).toEqual(
    references.map(({ path, field, value }) => ({
      path,
      field,
      value: `${value}-${suffix}`,
    })),
  )
  expect(
    changedLeafPaths(history, renamed).sort(),
    JSON.stringify(history),
  ).toEqual(references.map(({ path }) => path).sort())
}

function publicationErasureHistories(): Array<Array<LoadSubsetFullFlowEvent>> {
  const orderedRows = [
    { key: `row-a`, orderValue: 1 },
    { key: `row-b`, orderValue: 2 },
  ]
  const relatedRows = [{ key: `related`, orderValue: 3 }]
  const requestRelated: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    sourceId: `source`,
    ownerId: `owner-related`,
    sessionId: `session`,
    demandId: `related`,
    attemptId: `attempt-related`,
    alreadyAborted: false,
  }

  return [
    [
      {
        type: `stagePublicationRows`,
        publicationId: `publication-a`,
        sourceId: `source`,
        demandId: `ordered`,
        rows: orderedRows,
      },
      {
        type: `commitPublication`,
        publicationId: `publication-a`,
      },
      {
        type: `resizeOrderedWindow`,
        sourceId: `source`,
        demandId: `ordered`,
        size: 2,
      },
    ],
    [
      {
        type: `stagePublicationRows`,
        publicationId: `publication-a`,
        sourceId: `source`,
        demandId: `ordered`,
        rows: orderedRows,
      },
      {
        type: `commitPublication`,
        publicationId: `publication-a`,
      },
      requestRelated,
      {
        type: `stagePublicationRows`,
        publicationId: `publication-b`,
        sourceId: `source`,
        demandId: `ordered`,
        rows: orderedRows.slice(1),
      },
      {
        type: `stagePublicationRows`,
        publicationId: `publication-b`,
        sourceId: `source`,
        demandId: `related`,
        rows: relatedRows,
      },
      {
        type: `beginReplacement`,
        publicationId: `publication-b`,
        demands: [
          { sourceId: `source`, demandId: `ordered` },
          { sourceId: `source`, demandId: `related` },
        ],
      },
      {
        type: `settleReplacement`,
        publicationId: `publication-b`,
        sourceId: `source`,
        demandId: `related`,
        outcome: `success`,
        extent: `exhausted`,
      },
      {
        type: `settleReplacement`,
        publicationId: `publication-b`,
        sourceId: `source`,
        demandId: `ordered`,
        outcome: `success`,
        extent: `continues`,
      },
      {
        type: `establishReplacementCoverage`,
        publicationId: `publication-b`,
        sourceId: `source`,
        demandId: `ordered`,
      },
      {
        type: `releaseDemand`,
        sourceId: `source`,
        ownerId: `owner-related`,
        demandId: `related`,
        attemptId: `attempt-related`,
      },
    ],
    [
      {
        type: `stagePublicationRows`,
        publicationId: `publication-a`,
        sourceId: `source`,
        demandId: `ordered`,
        rows: orderedRows,
      },
      {
        type: `commitPublication`,
        publicationId: `publication-a`,
      },
      requestRelated,
      {
        type: `beginReplacement`,
        publicationId: `publication-b`,
        demands: [
          { sourceId: `source`, demandId: `ordered` },
          { sourceId: `source`, demandId: `related` },
        ],
      },
      {
        type: `settleReplacement`,
        publicationId: `publication-b`,
        sourceId: `source`,
        demandId: `related`,
        outcome: `abort`,
      },
      {
        type: `settleReplacement`,
        publicationId: `publication-b`,
        sourceId: `source`,
        demandId: `ordered`,
        outcome: `failure`,
      },
      { type: `cleanupSession`, sessionId: `session` },
      {
        type: `settleReplacement`,
        publicationId: `publication-b`,
        sourceId: `source`,
        demandId: `ordered`,
        outcome: `success`,
        extent: `exhausted`,
      },
    ],
  ]
}

for (const campaign of refinementCampaigns(1_779_009)) {
  fcTest.prop([fc.string({ minLength: 1, maxLength: 4 })], campaign.options)(
    `erased identities preserve every bounded next-command observation (${campaign.label})`,
    (suffix) => {
      for (const history of [
        ...sourceErasureHistories(),
        ...demandErasureHistories(),
        ...transactionErasureHistories(),
        ...replayErasureHistories(),
        ...publicationErasureHistories(),
        acquisitionHistory(`shared`, [`row-a`, `row-b`]),
        acquisitionHistory(`separate`, [`row-a`, `row-b`]),
        [
          {
            type: `startAcquisition`,
            acquisitionId: `acquisition`,
            sourceId: `source`,
            demandId: `demand`,
          },
          {
            type: `attachAcquisitionOwner`,
            acquisitionId: `acquisition`,
            ownerId: `owner`,
          },
          {
            type: `settleAcquisition`,
            acquisitionId: `acquisition`,
            outcome: `reject`,
            rowKeys: [`ghost-row`],
          },
        ] satisfies Array<LoadSubsetFullFlowEvent>,
      ]) {
        expectEveryErasedIdentityRenamed(history, suffix)
      }

      for (const history of sourceErasureHistories()) {
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectSourceReadiness,
          normalizeSourceReadiness,
        )
      }

      for (const history of demandErasureHistories()) {
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectTransportLoads,
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectRetainedRowKeys,
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectRetainedSourceRows,
          (rows, renamingSuffix) =>
            rows.map(({ sourceId, rowKey }) => ({
              sourceId: removeRenamingSuffix(sourceId, renamingSuffix),
              rowKey,
            })),
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectReusableDemands,
          (demandIds, renamingSuffix) =>
            demandIds.map((demandId) =>
              removeRenamingSuffix(demandId, renamingSuffix),
            ),
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectReusableSourceDemands,
          (demands, renamingSuffix) =>
            demands.map(({ sourceId, demandId }) => ({
              sourceId: removeRenamingSuffix(sourceId, renamingSuffix),
              demandId: removeRenamingSuffix(demandId, renamingSuffix),
            })),
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectAdapterLifecycle,
          (events, renamingSuffix) =>
            events.map(({ type, ownerId, attemptId }) => ({
              type,
              ownerId: removeRenamingSuffix(ownerId, renamingSuffix),
              attemptId: removeRenamingSuffix(attemptId, renamingSuffix),
            })),
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectAuthorizedContinuationStarts,
        )
      }

      for (const history of transactionErasureHistories()) {
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectSyncTransactions,
          (observation, renamingSuffix) => ({
            ...observation,
            receipts: observation.receipts.map(({ transactionId, state }) => ({
              transactionId: removeRenamingSuffix(
                transactionId,
                renamingSuffix,
              ),
              state,
            })),
          }),
        )
      }

      for (const history of replayErasureHistories()) {
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectReplayPublication,
        )
      }

      for (const history of publicationErasureHistories()) {
        const orderedProjection = (
          prefix: ReadonlyArray<LoadSubsetFullFlowEvent>,
          renamingSuffix: string,
        ) =>
          projectAtomicOrderedPublicationState(prefix, {
            sourceId:
              renamingSuffix === `` ? `source` : `source-${renamingSuffix}`,
            demandId:
              renamingSuffix === `` ? `ordered` : `ordered-${renamingSuffix}`,
            direction: `asc`,
            initialWindowSize: 1,
          })
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          orderedProjection,
        )
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          (prefix, renamingSuffix) =>
            projectOrderedPublicationBoundary(prefix, {
              sourceId:
                renamingSuffix === `` ? `source` : `source-${renamingSuffix}`,
              demandId:
                renamingSuffix === `` ? `ordered` : `ordered-${renamingSuffix}`,
              direction: `asc`,
              prefixSize: 2,
            }),
        )
      }

      for (const history of [
        acquisitionHistory(`shared`, [`row-a`, `row-b`]),
        acquisitionHistory(`separate`, [`row-a`, `row-b`]),
        [
          {
            type: `startAcquisition`,
            acquisitionId: `acquisition`,
            sourceId: `source`,
            demandId: `demand`,
          },
          {
            type: `attachAcquisitionOwner`,
            acquisitionId: `acquisition`,
            ownerId: `owner`,
          },
          {
            type: `settleAcquisition`,
            acquisitionId: `acquisition`,
            outcome: `reject`,
            rowKeys: [`ghost-row`],
          },
        ] satisfies Array<LoadSubsetFullFlowEvent>,
      ]) {
        expectObservationPreservedAfterEveryPrefix(
          history,
          suffix,
          projectAcquisitionSettlement,
          (observation, renamingSuffix) => ({
            physicalStarts: observation.physicalStarts.map((acquisitionId) =>
              removeRenamingSuffix(acquisitionId, renamingSuffix),
            ),
            owners: observation.owners.map(({ ownerId, state, rowKeys }) => ({
              ownerId: removeRenamingSuffix(ownerId, renamingSuffix),
              state,
              rowKeys,
            })),
            visibleRowKeys: observation.visibleRowKeys,
          }),
        )
      }
    },
  )
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
  let logicalStarts = 0
  let logicalReleases = 0
  let deduplications = 0
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
      onDeduplicate: () => {
        deduplications++
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
            loadSubset: (options) => {
              logicalStarts++
              return deduplicated.loadSubset(options)
            },
            unloadSubset: (options) => {
              logicalReleases++
              deduplicated.unloadSubset(options)
            },
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
  let owners: Array<{
    ownerId: (typeof ownerIds)[number]
    state: `resolved`
    rowKeys: Array<string>
  }> = []
  let settledBatches: Array<Array<Array<string>>> = [[], []]
  let settledCallbackReads: Array<Array<Array<string>>> = [[], []]
  let initialPhysicalStarts = 0
  let initialLogicalStarts = 0
  let initialDeduplications = 0
  let retainedOwnerRowKeys: Array<string> = []
  let retainedOwnerReady = false
  let coOwnerPhysicalStarts = 0
  let coOwnerLogicalStarts = 0
  let coOwnerDeduplications = 0
  let coOwnerRowKeys: Array<string> = []
  let coOwnerBatches: Array<Array<string>> = []
  let coOwnerCallbackReads: Array<Array<string>> = []
  let coOwnerBatchesAfterUnsubscribe: Array<Array<string>> = []
  let coOwnerCallbackReadsAfterUnsubscribe: Array<Array<string>> = []
  let remountRowKeys: Array<string> = []
  let remountBatches: Array<Array<string>> = []
  let remountCallbackReads: Array<Array<string>> = []
  let remountBatchesAfterUnsubscribe: Array<Array<string>> = []
  let remountCallbackReadsAfterUnsubscribe: Array<Array<string>> = []

  try {
    for (
      let attempt = 0;
      attempt < 20 && physicalStarts < expectedPhysicalStarts;
      attempt++
    ) {
      await flushPromises()
    }
    expect(physicalStarts).toBe(expectedPhysicalStarts)
    expect(logicalStarts).toBe(2)
    expect(liveQueries.map((live) => live.isReady())).toEqual([false, false])
    expect(liveQueries.map((live) => live.isLoadingSubset)).toEqual([
      true,
      true,
    ])
    expect(liveQueries.map((live) => live.toArray)).toEqual([[], []])
    expect(batches).toEqual([[], []])
    expect(callbackReads).toEqual([[], []])
    delivery.resolve()
    await Promise.all(preloads)

    owners = liveQueries.map((live, index) => ({
      ownerId: ownerIds[index]!,
      state: `resolved` as const,
      rowKeys: live.toArray.map(({ id }) => String(id)).sort(),
    }))
    expect(liveQueries.map((live) => live.isReady())).toEqual([true, true])
    expect(liveQueries.map((live) => live.isLoadingSubset)).toEqual([
      false,
      false,
    ])
    settledBatches = batches.map((ownerBatches) =>
      ownerBatches.map((batch) => [...batch]),
    )
    settledCallbackReads = callbackReads.map((ownerReads) =>
      ownerReads.map((read) => [...read]),
    )

    initialPhysicalStarts = physicalStarts
    initialLogicalStarts = logicalStarts
    initialDeduplications = deduplications
    subscriptions[0]!.unsubscribe()
    await liveQueries[0]!.cleanup()
    expect(logicalReleases).toBe(1)

    const coOwner = createLiveQueryCollection({
      id: `refinement-acquisition-${runId}-co-owner`,
      query: (q) => q.from({ row: sharedSource }),
      startSync: false,
    })
    const observedCoOwnerBatches: Array<Array<string>> = []
    const observedCoOwnerCallbackReads: Array<Array<string>> = []
    const coOwnerSubscription = coOwner.subscribeChanges(
      (changes) => {
        observedCoOwnerBatches.push(
          changes.map(({ key }) => String(key)).sort(),
        )
        observedCoOwnerCallbackReads.push(
          coOwner.toArray.map(({ id }) => String(id)).sort(),
        )
      },
      { includeInitialState: false },
    )
    try {
      await coOwner.preload()
      retainedOwnerRowKeys = liveQueries[1]!.toArray
        .map(({ id }) => String(id))
        .sort()
      retainedOwnerReady = liveQueries[1]!.isReady()
      coOwnerPhysicalStarts = physicalStarts
      coOwnerLogicalStarts = logicalStarts
      coOwnerDeduplications = deduplications
      coOwnerRowKeys = coOwner.toArray.map(({ id }) => String(id)).sort()
      coOwnerBatches = observedCoOwnerBatches.map((batch) => [...batch])
      coOwnerCallbackReads = observedCoOwnerCallbackReads.map((read) => [
        ...read,
      ])

      subscriptions[1]!.unsubscribe()
      await liveQueries[1]!.cleanup()
    } finally {
      coOwnerSubscription.unsubscribe()
      await coOwner.cleanup()
      coOwnerBatchesAfterUnsubscribe = observedCoOwnerBatches.map((batch) => [
        ...batch,
      ])
      coOwnerCallbackReadsAfterUnsubscribe = observedCoOwnerCallbackReads.map(
        (read) => [...read],
      )
    }
    expect(logicalReleases).toBe(3)

    const remount = createLiveQueryCollection({
      id: `refinement-acquisition-${runId}-remount`,
      query: (q) => q.from({ row: sharedSource }),
      startSync: false,
    })
    const observedRemountBatches: Array<Array<string>> = []
    const observedRemountCallbackReads: Array<Array<string>> = []
    const remountSubscription = remount.subscribeChanges(
      (changes) => {
        observedRemountBatches.push(
          changes.map(({ key }) => String(key)).sort(),
        )
        observedRemountCallbackReads.push(
          remount.toArray.map(({ id }) => String(id)).sort(),
        )
      },
      { includeInitialState: false },
    )
    try {
      await remount.preload()
      remountRowKeys = remount.toArray.map(({ id }) => String(id)).sort()
      remountBatches = observedRemountBatches.map((batch) => [...batch])
      remountCallbackReads = observedRemountCallbackReads.map((read) => [
        ...read,
      ])
    } finally {
      remountSubscription.unsubscribe()
      await remount.cleanup()
      remountBatchesAfterUnsubscribe = observedRemountBatches.map((batch) => [
        ...batch,
      ])
      remountCallbackReadsAfterUnsubscribe = observedRemountCallbackReads.map(
        (read) => [...read],
      )
    }
  } finally {
    delivery.resolve()
    subscriptions.forEach((subscription) => subscription.unsubscribe())
    await Promise.all([
      ...liveQueries.map((live) => live.cleanup()),
      ...sources.map((source) => source.cleanup()),
    ])
  }

  return {
    initialPhysicalStarts,
    initialLogicalStarts,
    initialDeduplications,
    retainedOwnerRowKeys,
    retainedOwnerReady,
    coOwnerPhysicalStarts,
    coOwnerLogicalStarts,
    coOwnerDeduplications,
    coOwnerRowKeys,
    coOwnerBatches,
    coOwnerCallbackReads,
    coOwnerBatchesAfterUnsubscribe,
    coOwnerCallbackReadsAfterUnsubscribe,
    totalPhysicalStarts: physicalStarts,
    totalLogicalStarts: logicalStarts,
    logicalReleases,
    totalDeduplications: deduplications,
    owners,
    visibleRowKeys: [
      ...new Set(owners.flatMap(({ rowKeys: keys }) => keys)),
    ].sort(),
    batches: settledBatches,
    callbackReads: settledCallbackReads,
    batchesAfterUnsubscribe: batches,
    callbackReadsAfterUnsubscribe: callbackReads,
    remountRowKeys,
    remountBatches,
    remountCallbackReads,
    remountBatchesAfterUnsubscribe,
    remountCallbackReadsAfterUnsubscribe,
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
      const expectedKeys = [...rowKeys].sort()
      const expectedBatches = [
        [expectedKeys, []],
        [expectedKeys, []],
      ]
      const expectedCallbackReads = [
        [expectedKeys, expectedKeys],
        [expectedKeys, expectedKeys],
      ]
      expect(sharedActual.batches).toEqual(expectedBatches)
      expect(sharedActual.callbackReads).toEqual(expectedCallbackReads)
      expect(sharedActual.batchesAfterUnsubscribe).toEqual(sharedActual.batches)
      expect(sharedActual.callbackReadsAfterUnsubscribe).toEqual(
        sharedActual.callbackReads,
      )
      expect(separateActual.batchesAfterUnsubscribe).toEqual(
        separateActual.batches,
      )
      expect(separateActual.callbackReadsAfterUnsubscribe).toEqual(
        separateActual.callbackReads,
      )
      expect(sharedActual.initialLogicalStarts).toBe(2)
      expect(separateActual.initialLogicalStarts).toBe(2)
      expect(sharedActual.initialPhysicalStarts).toBe(1)
      expect(separateActual.initialPhysicalStarts).toBe(2)
      expect(sharedActual.initialDeduplications).toBe(1)
      expect(separateActual.initialDeduplications).toBe(0)
      expect(sharedActual.retainedOwnerRowKeys).toEqual(expectedKeys)
      expect(separateActual.retainedOwnerRowKeys).toEqual(expectedKeys)
      expect(sharedActual.retainedOwnerReady).toBe(true)
      expect(separateActual.retainedOwnerReady).toBe(true)
      expect(sharedActual.coOwnerRowKeys).toEqual(expectedKeys)
      expect(separateActual.coOwnerRowKeys).toEqual(expectedKeys)
      expect(sharedActual.coOwnerBatches).toEqual([])
      expect(separateActual.coOwnerBatches).toEqual([expectedKeys, []])
      expect(sharedActual.coOwnerCallbackReads).toEqual([])
      expect(separateActual.coOwnerCallbackReads).toEqual([
        expectedKeys,
        expectedKeys,
      ])
      expect(sharedActual.coOwnerBatchesAfterUnsubscribe).toEqual(
        sharedActual.coOwnerBatches,
      )
      expect(sharedActual.coOwnerCallbackReadsAfterUnsubscribe).toEqual(
        sharedActual.coOwnerCallbackReads,
      )
      expect(separateActual.coOwnerBatchesAfterUnsubscribe).toEqual(
        separateActual.coOwnerBatches,
      )
      expect(separateActual.coOwnerCallbackReadsAfterUnsubscribe).toEqual(
        separateActual.coOwnerCallbackReads,
      )
      expect(sharedActual.coOwnerLogicalStarts).toBe(3)
      expect(separateActual.coOwnerLogicalStarts).toBe(3)
      expect(sharedActual.coOwnerPhysicalStarts).toBe(1)
      expect(separateActual.coOwnerPhysicalStarts).toBe(3)
      expect(sharedActual.coOwnerDeduplications).toBe(2)
      expect(separateActual.coOwnerDeduplications).toBe(0)
      expect(sharedActual.remountRowKeys).toEqual(expectedKeys)
      expect(separateActual.remountRowKeys).toEqual(expectedKeys)
      expect(sharedActual.remountBatches).toEqual([expectedKeys, []])
      expect(separateActual.remountBatches).toEqual([expectedKeys, []])
      expect(sharedActual.remountCallbackReads).toEqual([
        expectedKeys,
        expectedKeys,
      ])
      expect(separateActual.remountCallbackReads).toEqual([
        expectedKeys,
        expectedKeys,
      ])
      expect(sharedActual.remountBatchesAfterUnsubscribe).toEqual(
        sharedActual.remountBatches,
      )
      expect(sharedActual.remountCallbackReadsAfterUnsubscribe).toEqual(
        sharedActual.remountCallbackReads,
      )
      expect(separateActual.remountBatchesAfterUnsubscribe).toEqual(
        separateActual.remountBatches,
      )
      expect(separateActual.remountCallbackReadsAfterUnsubscribe).toEqual(
        separateActual.remountCallbackReads,
      )
      expect(sharedActual.totalLogicalStarts).toBe(4)
      expect(separateActual.totalLogicalStarts).toBe(4)
      expect(sharedActual.logicalReleases).toBe(4)
      expect(separateActual.logicalReleases).toBe(4)
      expect(sharedActual.totalPhysicalStarts).toBe(2)
      expect(separateActual.totalPhysicalStarts).toBe(4)
      expect(sharedActual.totalDeduplications).toBe(2)
      expect(separateActual.totalDeduplications).toBe(0)
      expect(
        sharedActual.totalPhysicalStarts + sharedActual.totalDeduplications,
      ).toBe(sharedActual.totalLogicalStarts)
      expect(
        separateActual.totalPhysicalStarts + separateActual.totalDeduplications,
      ).toBe(separateActual.totalLogicalStarts)
    },
  )
}
