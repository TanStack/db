/**
 * Persisted restore cannot weaken a complete source snapshot. At the first
 * source result and refresh fulfillment, public and durable rows must reflect
 * replacement, even
 * when the result arrived before restore. A scoped source removes only its own
 * ownership; a peer's omitted row survives. A collection-wide source replaces
 * every row. An ownerless direct-write row omitted by a later complete,
 * unbounded response is removed too (Query "Direct Writes and Query Sync").
 * Authority: the shared eager-source READY-3/PUB-7 replacement law,
 * docs/collections/query-collection.md ("Direct Writes and Query Sync", "Initial
 * Data"), and persistence's durable acceptance contract. The maintainer chose
 * shared persistence conformance as this crossing's owner on 2026-11-09.
 *
 * Network-first initial rendering changes when saved rows may be shown, not
 * the later complete result or its durability. At deadline fallback, before any
 * source response, saved rows and ownership stay intact. Authority: the glossary's
 * network-first initial-render contract and persisted-readiness oracle. That
 * owner retains empty/failed restore, remote-failure, and exact deadline laws.
 *
 * The model abstracts source scopes to `source` and `peer`. These are ownership
 * edges, not subscriptions or provider identities. Whole-Collection adapters
 * expose rows only; scoped adapters also expose their ownership projection.
 * The model has no cache, sync queue, or hydration algorithm.
 *
 * Limits: three string keys, numeric values, one eager persisted sync run and
 * local-only reopen. No on-demand windows, concurrent writers, failed I/O, or
 * intermediate-publication claim. A disjoint optimistic insert can persist
 * across restore and the first source commit. After its settlement, that
 * unconfirmed insert drops (optimistic-history-oracle.ts); replacement has
 * the same set answer. The mutation axis changes scheduling, not that answer. Drivers and host controls live in
 * persisted-startup-driver.ts and persisted-startup-host.ts.
 */
import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { expectedEagerRowScans } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'

export type PersistedStartupHistory = {
  previous: number
  next: number
  peer: boolean
  // Omit the source ownership edge; the independent peer edge may remain.
  previousOwner?: `none`
  response: `before-restore` | `after-restore` | `after-deadline`
  mutation?: `persisting`
  initialRender?: `network-first`
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
  fallback?: StartupSnapshot
  fallbackDurable?: StartupSnapshot
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

// Empty and nonempty durable baselines and any next subset include omissions, an empty
// answer, equal membership, and changed values on overlap. Dropping the timing
// axis loses the startup race; dropping peers admits a scoped global truncate.
// A cached result is already available, so its receiving grammar restricts it
// to before-restore. Duplicate keys and collection-wide peers are not legal.
export const persistedStartupMembershipArb = (scope: StartupScope) =>
  fc.oneof(
    fc.record({
      previous: fc.constant(0),
      next: fc.integer({ min: 0, max: 7 }),
      peer: fc.constant(false),
    }),
    fc.record({
      previous: fc.integer({ min: 1, max: 7 }),
      next: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 7 })),
      peer: scope === `scoped` ? fc.boolean() : fc.constant(false),
    }),
  )
// A deadline fallback requires a nonempty saved baseline (empty restore stays
// loading), network-first enabled, and a held
// source result. Ordinary responses retain both restore orders. The deadline's
// exact threshold belongs to the persisted-readiness oracle; here zero expires
// the wait while the source is held, and 60 seconds keeps it pending otherwise.
export const persistedStartupRenderArb = fc.boolean()
export function withStartupRender<H extends PersistedStartupHistory>(
  h: H,
  networkFirst: boolean,
  fallback: boolean,
): H {
  return {
    ...h,
    ...(networkFirst ? { initialRender: `network-first` as const } : {}),
    response:
      networkFirst && fallback && h.previous !== 0
        ? `after-deadline`
        : h.response,
  }
}
// A direct record preserves the same finite language as the former chained
// render grammar and also admits context-free fixed and constructed histories.
// Cache-origin constraints remain in the receiving Query grammar.
export const persistedStartupHistoryArb = (
  scope: StartupScope,
): fc.Arbitrary<PersistedStartupHistory> =>
  fc
    .record(
      {
        previous: fc.integer({ min: 0, max: 7 }),
        next: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 7 })),
        peer: scope === `scoped` ? fc.boolean() : fc.constant(false),
        response: fc.constantFrom(
          `before-restore` as const,
          `after-restore` as const,
          `after-deadline` as const,
        ),
        mutation: fc.constant(`persisting` as const),
        initialRender: fc.constant(`network-first` as const),
      },
      { requiredKeys: [`previous`, `next`, `peer`, `response`] },
    )
    .filter(
      (h) =>
        (!h.peer || h.previous !== 0) &&
        (h.response !== `after-deadline` ||
          (h.initialRender === `network-first` && h.previous !== 0)),
    )

// These are inputs to the same judgment as generated histories. Receivers may
// add adapter-specific origins, but never supply hand-written expected answers.
const baseStartupHistories: Array<PersistedStartupHistory> = [
  { previous: 0, next: 7, peer: false, response: `before-restore` },
  { previous: 1, next: 2, peer: false, response: `before-restore` },
  { previous: 1, next: 0, peer: false, response: `before-restore` },
  { previous: 3, next: 6, peer: false, response: `before-restore` },
  { previous: 3, next: 6, peer: false, response: `after-restore` },
]

export const withStartupMutations = <H extends PersistedStartupHistory>(
  histories: Array<H>,
): Array<H> =>
  histories.flatMap((h) => [h, { ...h, mutation: `persisting` as const }])

// Normalize only identical inputs. A persisting mutation remains a distinct
// action even with no saved rows: it holds source publication until settlement.
export const uniqueStartupHistories = <H extends PersistedStartupHistory>(
  histories: Array<H>,
): Array<H> => [
  ...new Map(histories.map((h) => [JSON.stringify(h), h])).values(),
]

export const startupReachedStates = (
  h: PersistedStartupHistory,
): Array<string> => [
  h.response === `before-restore`
    ? `response-before-restore`
    : `restore-before-response`,
  ...(h.initialRender
    ? [
        h.response === `after-deadline`
          ? `network-first-fallback`
          : `network-first-source-result`,
      ]
    : []),
  ...(h.mutation ? [`persisting-mutation`] : []),
  ...(h.previous === 0 ? [`empty-baseline`] : []),
  ...(h.next === 0 ? [`empty-result`] : []),
  ...(h.next & h.previous ? [`overlapping-update`] : []),
  ...(h.previous & ~h.next ? [`omitted-row`] : []),
  ...(h.peer ? [`peer-owner`] : []),
  ...(h.previousOwner === `none` &&
  (h.peer ? (h.previous & (h.previous - 1)) !== 0 : h.previous !== 0)
    ? [`ownerless-baseline`]
    : []),
]
export const startupRequiredStates = (scope: StartupScope): Array<string> => [
  `response-before-restore`,
  `restore-before-response`,
  `network-first-source-result`,
  `network-first-fallback`,
  `empty-result`,
  `empty-baseline`,
  `overlapping-update`,
  `omitted-row`,
  `persisting-mutation`,
  ...(scope === `scoped` ? [`peer-owner`, `ownerless-baseline`] : []),
]

export const persistedStartupHistories = uniqueStartupHistories(
  withStartupMutations(
    baseStartupHistories.flatMap((h) => [
      h,
      withStartupRender(h, true, false),
      withStartupRender(h, true, true),
    ]),
  ),
)

// Before any source result, timeout changes readiness only. Saved rows and
// ownership must survive intact, both publicly and durably. Reusing replacement
// with the old membership/value derives this cut without a second state model.
export function expectedStartupFallback(
  h: PersistedStartupHistory,
  scope: StartupScope,
): StartupSnapshot {
  const saved = expectedPersistedStartup({ ...h, next: h.previous }, scope)
  return {
    ...saved,
    rows: startupRows(h.previous, 1),
    ...(saved.owners && h.previousOwner === `none`
      ? {
          owners: saved.owners.map(([key, owners]): [string, Array<string>] => [
            key,
            owners.filter((owner) => owner !== `source`),
          ]),
        }
      : {}),
  }
}
export function persistedStartupFallbackViolations(
  h: PersistedStartupHistory,
  scope: StartupScope,
  cut: string,
  actual: StartupSnapshot | undefined,
): Array<string> {
  const expected =
    h.response === `after-deadline`
      ? expectedStartupFallback(h, scope)
      : undefined
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : [
        `${cut}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      ]
}

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
  for (const cut of [`fallback`, `fallbackDurable`] as const)
    violations.push(
      ...persistedStartupFallbackViolations(h, scope, cut, observation[cut]),
    )
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
  model: [expectedPersistedStartup, expectedStartupFallback],
  grammar: [
    persistedStartupMembershipArb,
    persistedStartupRenderArb,
    withStartupRender,
    withStartupMutations,
    uniqueStartupHistories,
    persistedStartupHistoryArb,
  ],
  check: [
    persistedStartupFallbackViolations,
    persistedStartupCutViolations,
    persistedStartupPremiseViolations,
    persistedStartupViolations,
  ],
})
