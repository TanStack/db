/**
 * Persisted restore cannot weaken a complete source snapshot. At startup and
 * refresh fulfillment, public and durable rows must reflect replacement, even
 * when the result arrived before restore. A scoped source removes only its own
 * ownership; a peer's omitted row survives. A collection-wide source replaces
 * every row. Authority: the shared eager-source READY-3/PUB-7 replacement law,
 * docs/collections/query-collection.md ("Direct Writes and Query Sync", "Initial
 * Data"), and persistence's durable acceptance contract. The maintainer chose
 * shared persistence conformance as this crossing's owner on 2026-11-09.
 *
 * The model abstracts source scopes to `source` and `peer`. These are ownership
 * edges, not subscriptions or provider identities. Whole-Collection adapters
 * expose rows only; scoped adapters also expose their ownership projection.
 * The model has no cache, sync queue, or hydration algorithm.
 *
 * Limits: three string keys, numeric values, one eager persisted sync run and
 * local-only reopen. No on-demand windows, concurrent writers, failed I/O, or
 * intermediate-publication claim. Drivers and host controls live in
 * ../tests/persisted-startup-driver.ts and persisted-startup-host.ts.
 */
import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { expectedEagerRowScans } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'

export type PersistedStartupHistory = {
  previous: number
  next: number
  peer: boolean
  response: `before-restore` | `after-restore`
}
export type StartupRow = { id: string; value: number }
export type StartupScope = `collection` | `scoped`
export type StartupSnapshot = {
  rows: Array<StartupRow>
  owners?: Array<[string, Array<string>]>
}
export type PersistedStartupObservation = {
  responseBeforeRestore: boolean
  startupRowReads: number
  startup: StartupSnapshot
  startupDurable: StartupSnapshot
  refresh: StartupSnapshot
  durable: StartupSnapshot
  reopened: Array<StartupRow>
}

export const startupRows = (mask: number, value: number): Array<StartupRow> =>
  [`a`, `b`, `c`].flatMap((id, index) =>
    mask & (1 << index) ? [{ id, value }] : [],
  )
export const sortedStartupRows = (
  values: Iterable<StartupRow>,
): Array<StartupRow> =>
  Array.from(values, ({ id, value }) => ({ id, value })).sort((a, b) =>
    a.id.localeCompare(b.id),
  )

// Replacement is set algebra: keep the complete answer, plus omitted rows
// supported by a surviving peer. An overlapping answer supplies the new value.
export function expectedPersistedStartup(
  h: PersistedStartupHistory,
  scope: StartupScope,
): StartupSnapshot {
  if (h.peer && scope === `collection`)
    throw new Error(`A collection-wide source has no independent peer scope`)
  const answer = startupRows(h.next, 2)
  const next = new Map(answer.map((row) => [row.id, row]))
  const peerKey = h.peer ? startupRows(h.previous, 1)[0]!.id : undefined
  if (peerKey && !next.has(peerKey))
    next.set(peerKey, { id: peerKey, value: 1 })
  return {
    rows: sortedStartupRows(next.values()),
    ...(scope === `scoped`
      ? {
          owners: [...next.keys()]
            .sort()
            .map((key): [string, Array<string>] => [
              key,
              [
                ...(answer.some((row) => row.id === key) ? [`source`] : []),
                ...(key === peerKey ? [`peer`] : []),
              ].sort(),
            ]),
        }
      : {}),
  }
}

// Nonempty durable baselines and any next subset include omissions, an empty
// answer, equal membership, and changed values on overlap. Dropping the timing
// axis loses the startup race; dropping peers admits a scoped global truncate.
// A cached result is already available, so its receiving grammar restricts it
// to before-restore. Duplicate keys and collection-wide peers are not legal.
export const persistedStartupMembershipArb = (scope: StartupScope) =>
  fc.record({
    previous: fc.integer({ min: 1, max: 7 }),
    next: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 7 })),
    peer: scope === `scoped` ? fc.boolean() : fc.constant(false),
  })
export const persistedStartupHistoryArb = (
  scope: StartupScope,
): fc.Arbitrary<PersistedStartupHistory> =>
  fc
    .tuple(
      persistedStartupMembershipArb(scope),
      fc.constantFrom(`before-restore` as const, `after-restore` as const),
    )
    .map(([membership, response]) => ({ ...membership, response }))

// These are inputs to the same judgment as generated histories. Receivers may
// add adapter-specific origins, but never supply hand-written expected answers.
export const persistedStartupHistories: Array<PersistedStartupHistory> = [
  { previous: 1, next: 2, peer: false, response: `before-restore` },
  { previous: 1, next: 0, peer: false, response: `before-restore` },
  { previous: 3, next: 6, peer: false, response: `before-restore` },
  { previous: 3, next: 6, peer: false, response: `after-restore` },
]

export class PersistedStartupViolation extends Error {
  constructor(readonly violations: Array<string>) {
    super(violations.join(`\n`))
    this.name = `PersistedStartupViolation`
  }
}

// Check each cut immediately. A later refresh or cleanup cannot erase a stale
// startup result. Ownership is checked only for a declared scoped source.
export function persistedStartupCutViolations(
  h: PersistedStartupHistory,
  scope: StartupScope,
  cut: string,
  actual: StartupSnapshot,
): Array<string> {
  const expected = expectedPersistedStartup(h, scope)
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : [
        `${cut}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      ]
}
export function persistedStartupPremiseViolations(
  h: PersistedStartupHistory,
  observation: Pick<
    PersistedStartupObservation,
    `responseBeforeRestore` | `startupRowReads`
  >,
): Array<string> {
  const violations: Array<string> = []
  if (observation.responseBeforeRestore !== (h.response === `before-restore`))
    violations.push(`response/restore premise was not reached`)
  // Reuse the reload owner's work law: one initial restore, zero reloads.
  const expectedReads = expectedEagerRowScans(1, 0)
  if (observation.startupRowReads !== expectedReads)
    violations.push(
      `startup row reads: expected ${expectedReads}, got ${observation.startupRowReads}`,
    )
  return violations
}
export function persistedStartupViolations(
  h: PersistedStartupHistory,
  scope: StartupScope,
  observation: PersistedStartupObservation,
): Array<string> {
  const violations = persistedStartupPremiseViolations(h, observation)
  for (const cut of [
    `startup`,
    `startupDurable`,
    `refresh`,
    `durable`,
  ] as const)
    violations.push(
      ...persistedStartupCutViolations(h, scope, cut, observation[cut]),
    )
  const expected = expectedPersistedStartup(h, scope)
  if (JSON.stringify(observation.reopened) !== JSON.stringify(expected.rows))
    violations.push(
      `reopen: expected ${JSON.stringify(expected.rows)}, got ${JSON.stringify(observation.reopened)}`,
    )
  return violations
}

declareOracle({
  model: [expectedPersistedStartup],
  grammar: [persistedStartupMembershipArb, persistedStartupHistoryArb],
  check: [
    persistedStartupCutViolations,
    persistedStartupPremiseViolations,
    persistedStartupViolations,
  ],
})
