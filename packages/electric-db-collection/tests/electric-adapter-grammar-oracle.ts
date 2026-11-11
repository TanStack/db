// The Electric adapter oracle's pure grammar and comparison parts: the
// queued-presence and persistence-interleaving campaign grammars, their
// reconstruction checks, the durability-hold and interleaving comparisons, and
// the SDK reset-framing domain predicate. electric-oracle.property.test.ts runs
// them against production; electric-adapter-grammar.test.ts calibrates them
// without production. This module registers no tests.
import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { rowsFromMap } from './electric-adapter-support'
import type { OracleRow } from './electric-adapter-support'
import type { Message } from '@electric-sql/client'

export function isSdkResetFramedPartition(
  batches: Array<Array<Message<OracleRow>>>,
): boolean {
  // Model the installed SDK's HTTP 409 reset path: it publishes a synthetic
  // singleton reset, not the response body. See electric-sdk-framing.test.ts.
  // Arbitrary data/reset coalescing is outside this verified protocol domain;
  // this is not a claim that the SDK validates every other server response.
  return batches.every(
    (batch) =>
      batch.length <= 1 ||
      batch.every(
        (message) =>
          (message.headers as Record<string, unknown>).control !==
          `must-refetch`,
      ),
  )
}

export type QueuedPresenceHistory =
  `insert-update` | `update-update` | `delete-update` | `truncate-update`

export type QueuedPresenceCampaign = {
  histories: Array<QueuedPresenceHistory>
  names: [string, string]
}

export const queuedPresenceFixedSeed = 20_260_924
export const queuedPresenceHistories: ReadonlyArray<QueuedPresenceHistory> = [
  `insert-update`,
  `update-update`,
  `delete-update`,
  `truncate-update`,
]
export const queuedPresenceArbitraries: [
  fc.Arbitrary<Array<QueuedPresenceHistory>>,
  fc.Arbitrary<[string, string]>,
] = [
  fc.uniqueArray(fc.constantFrom(...queuedPresenceHistories), {
    minLength: queuedPresenceHistories.length,
    maxLength: queuedPresenceHistories.length,
  }),
  fc.tuple(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 })),
]

export function reconstructQueuedPresenceCampaign(
  value: unknown,
): QueuedPresenceCampaign {
  if (typeof value !== `object` || value === null) {
    throw new Error(`queued-presence campaign must be an object`)
  }
  const campaign = value as { histories?: unknown; names?: unknown }
  if (
    !Array.isArray(campaign.histories) ||
    campaign.histories.length !== queuedPresenceHistories.length ||
    new Set(campaign.histories).size !== queuedPresenceHistories.length ||
    !campaign.histories.every((history) =>
      queuedPresenceHistories.includes(history),
    )
  ) {
    throw new Error(
      `queued-presence histories must contain every supported transition exactly once`,
    )
  }
  if (
    !Array.isArray(campaign.names) ||
    campaign.names.length !== 2 ||
    !campaign.names.every(
      (name) => typeof name === `string` && name.length <= 12,
    )
  ) {
    throw new Error(`queued-presence names are outside the grammar`)
  }
  return campaign as unknown as QueuedPresenceCampaign
}

export function expectQueuedPresenceAtDurabilityHold(
  actual: Array<[string | number, string, string]>,
  history: QueuedPresenceHistory,
  gate: OracleRow,
): void {
  const expectedRows = new Map<string | number, OracleRow>([[1, gate]])
  if (history !== `insert-update`) {
    expectedRows.set(2, {
      id: 2,
      name: `baseline`,
      stable: `stable-2`,
    })
  }
  expect(actual).toEqual(rowsFromMap(expectedRows))
}

export type PersistenceInterleavingKind =
  `open-transaction-hydration` | `subset-supersedes-absence`

export type PersistenceInterleavingCampaign = {
  histories: Array<PersistenceInterleavingKind>
  names: [string, string]
}

export type PersistenceInterleavingObservation =
  | {
      kind: `open-transaction-hydration`
      hydrationStartedBeforeCommit: boolean
      hydrationOutcomeBeforeRelease: string
      cachedRowBeforeRelease: boolean
      hydrationOutcome: string
      publicRowsAtHydrationSettlement: Array<[string | number, string, string]>
      deliveryErrors: Array<string>
      publicRows: Array<[string | number, string, string]>
      durableRows: Array<[string | number, string, string]>
      status: string
      publicError: string | undefined
    }
  | {
      kind: `subset-supersedes-absence`
      publicRows: Array<[string | number, string, string]>
      durableRows: Array<[string | number, string, string]>
      status: string
      publicError: string | undefined
    }

export const persistenceInterleavingKinds: ReadonlyArray<PersistenceInterleavingKind> =
  [`open-transaction-hydration`, `subset-supersedes-absence`]

export const persistenceInterleavingCampaignArbitrary: fc.Arbitrary<PersistenceInterleavingCampaign> =
  fc.record({
    histories: fc.uniqueArray(
      fc.constantFrom(...persistenceInterleavingKinds),
      {
        minLength: persistenceInterleavingKinds.length,
        maxLength: persistenceInterleavingKinds.length,
      },
    ),
    names: fc.tuple(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.string({ minLength: 1, maxLength: 12 }),
    ),
  })

export function reconstructPersistenceInterleavingCampaign(
  value: unknown,
): PersistenceInterleavingCampaign {
  if (typeof value !== `object` || value === null) {
    throw new Error(`persistence-interleaving campaign must be an object`)
  }
  const campaign = value as { histories?: unknown; names?: unknown }
  if (
    !Array.isArray(campaign.histories) ||
    campaign.histories.length !== persistenceInterleavingKinds.length ||
    new Set(campaign.histories).size !== persistenceInterleavingKinds.length ||
    !campaign.histories.every((history) =>
      persistenceInterleavingKinds.includes(history),
    )
  ) {
    throw new Error(
      `persistence-interleaving histories must contain every supported schedule exactly once`,
    )
  }
  if (
    !Array.isArray(campaign.names) ||
    campaign.names.length !== 2 ||
    !campaign.names.every(
      (name) =>
        typeof name === `string` && name.length >= 1 && name.length <= 12,
    )
  ) {
    throw new Error(`persistence-interleaving names are outside the grammar`)
  }
  return campaign as PersistenceInterleavingCampaign
}

export function expectPersistenceInterleavingObservation(
  observation: PersistenceInterleavingObservation,
  names: [string, string],
): void {
  const rows: Array<[string | number, string, string]> = [
    [1, names[1], `stable-1`],
  ]
  if (observation.kind === `open-transaction-hydration`) {
    const rowsWithCache = [...rows, [2, `cached`, `stable-2`] as const]
    expect(observation, JSON.stringify(observation)).toEqual({
      kind: `open-transaction-hydration`,
      hydrationStartedBeforeCommit: false,
      hydrationOutcomeBeforeRelease: `pending`,
      cachedRowBeforeRelease: false,
      hydrationOutcome: `AbortError`,
      publicRowsAtHydrationSettlement: rowsWithCache,
      deliveryErrors: [],
      publicRows: rowsWithCache,
      durableRows: rowsWithCache,
      status: `ready`,
      publicError: undefined,
    })
    return
  }
  expect(observation, JSON.stringify(observation)).toEqual({
    kind: `subset-supersedes-absence`,
    publicRows: rows,
    durableRows: rows,
    status: `ready`,
    publicError: undefined,
  })
}
