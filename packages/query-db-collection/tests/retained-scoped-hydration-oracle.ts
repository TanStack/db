/**
 * An on-demand persisted Collection restores active demand, rather than every
 * saved row. Revalidating one retained Query cannot publish an unrequested
 * scope. Authority: SQLite persistence guide, "Persist a collection" (on-demand
 * demand restore), and Query "QueryFn and Predicate Push-Down" / "Direct Writes
 * and Query Sync" (exact-scope revalidation and scope-local omission).
 *
 * The model is set selection, independent of Query owners, hydration queues,
 * and persistence scans. Two disjoint authored scopes contain two keys each.
 * A saved ownerless direct row may belong to either scope. A later complete
 * response removes an omitted direct row only in its own scope. The unrequested
 * scope stays durable and becomes public only when its own demand is acquired.
 * A one-row ordered demand cannot prove omission of an ownerless direct row;
 * nor can it retire ownership of the retained unbounded Query.
 *
 * Limits: one cold reopen, two disjoint scopes, unbounded or one-row demand,
 * numeric values, one
 * persisted writer, and successful I/O. No peer writer, overlapping predicate,
 * cache rotation, or intermediate-publication claim beyond the held response.
 */
import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration'

export type RetainedScope = `a` | `b`
export type ScopedHydrationRow = {
  id: string
  scope: RetainedScope
  value: number
}
export type ScopedHydrationHistory = {
  first: RetainedScope
  window: `all` | `one`
  previous: number
  otherPrevious: number
  next: number
  otherNext: number
  ownerless: `none` | `first` | `other`
  value: number
}
export const otherRetainedScope = (scope: RetainedScope): RetainedScope =>
  scope === `a` ? `b` : `a`
export const scopedHydrationRows = (
  scope: RetainedScope,
  mask: number,
  value: number,
): Array<ScopedHydrationRow> =>
  [0, 1].flatMap((index) =>
    mask & (1 << index) ? [{ id: `${scope}${index}`, scope, value }] : [],
  )
export function scopedSavedRows(
  h: ScopedHydrationHistory,
): Array<ScopedHydrationRow> {
  return [
    ...scopedHydrationRows(h.first, h.previous, 1),
    ...scopedHydrationRows(otherRetainedScope(h.first), h.otherPrevious, 1),
    ...(h.ownerless === `none`
      ? []
      : [
          {
            id: `saved-direct`,
            scope:
              h.ownerless === `first` ? h.first : otherRetainedScope(h.first),
            value: 1,
          },
        ]),
  ]
}
export const sortScopedRows = (rows: Iterable<ScopedHydrationRow>) =>
  [...rows]
    .map(({ id, scope, value }) => ({ id, scope, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
export const scopedHydrationPage = (
  rows: Array<ScopedHydrationRow>,
  window: `all` | `one`,
) => (window === `all` ? rows : sortScopedRows(rows).reverse().slice(0, 1))
export type ScopedHydrationObservation = {
  pending: Array<ScopedHydrationRow>
  first: Array<ScopedHydrationRow>
  firstDurable: Array<ScopedHydrationRow>
  second: Array<ScopedHydrationRow>
  secondDurable: Array<ScopedHydrationRow>
  retainedScopes: number
  fetches: number
  hydrateCalls: number
  scanCalls: number
}
export function expectedScopedHydration(h: ScopedHydrationHistory) {
  const saved = scopedSavedRows(h)
  const fetched = scopedHydrationPage(
    scopedHydrationRows(h.first, h.next, h.value),
    h.window,
  )
  const pending = scopedHydrationPage(
    saved.filter((row) => row.scope === h.first),
    h.window,
  )
  const overlay = (
    before: Array<ScopedHydrationRow>,
    after: Array<ScopedHydrationRow>,
  ) =>
    sortScopedRows(
      new Map([...before, ...after].map((row) => [row.id, row])).values(),
    )
  const first = h.window === `all` ? fetched : overlay(pending, fetched)
  const other = scopedHydrationRows(
    otherRetainedScope(h.first),
    h.otherNext,
    h.value,
  )
  return {
    pending: sortScopedRows(pending),
    first: sortScopedRows(first),
    firstDurable:
      h.window === `all`
        ? sortScopedRows([
            ...first,
            ...saved.filter((row) => row.scope !== h.first),
          ])
        : overlay(saved, fetched),
    second: sortScopedRows([...first, ...other]),
    secondDurable:
      h.window === `all`
        ? sortScopedRows([...first, ...other])
        : overlay(
            saved.filter((row) => row.scope === h.first),
            [...fetched, ...other],
          ),
  }
}
export function scopedHydrationViolations(
  h: ScopedHydrationHistory,
  actual: ScopedHydrationObservation,
): Array<string> {
  const expected = expectedScopedHydration(h)
  const violations: Array<string> = []
  for (const cut of [
    `pending`,
    `first`,
    `firstDurable`,
    `second`,
    `secondDurable`,
  ] as const)
    if (JSON.stringify(actual[cut]) !== JSON.stringify(expected[cut]))
      violations.push(
        `${cut}: expected ${JSON.stringify(expected[cut])}, got ${JSON.stringify(actual[cut])}`,
      )
  if (actual.retainedScopes !== 2)
    violations.push(`two retained scopes not reached`)
  if (actual.fetches !== 2)
    violations.push(`expected two exact-scope fetches, got ${actual.fetches}`)
  return violations
}
export const scopedHydrationHistoryArb: fc.Arbitrary<ScopedHydrationHistory> =
  fc.record({
    first: fc.constantFrom(`a`, `b`),
    window: fc.constantFrom(`all`, `one`),
    previous: fc.integer({ min: 0, max: 3 }),
    otherPrevious: fc.integer({ min: 0, max: 3 }),
    next: fc.integer({ min: 0, max: 3 }),
    otherNext: fc.integer({ min: 0, max: 3 }),
    ownerless: fc.constantFrom(`none`, `first`, `other`),
    value: fc.integer({ min: -10, max: 10 }),
  })
export const scopedHydrationHistories: Array<ScopedHydrationHistory> = (
  [`a`, `b`] as const
).flatMap((first) =>
  ([`all`, `one`] as const).flatMap((window) =>
    ([`none`, `first`, `other`] as const).flatMap((ownerless) =>
      [0, 3].flatMap((previous) =>
        [0, 1].map((next) => ({
          first,
          window,
          previous,
          otherPrevious: 3,
          next,
          otherNext: 2,
          ownerless,
          value: 9,
        })),
      ),
    ),
  ),
)
export const scopedHydrationStates = [
  `first-a`,
  `first-b`,
  `empty-result`,
  `nonempty-result`,
  `unrequested-saved-rows`,
  `omitted-owned-row`,
  `ownerless-first`,
  `ownerless-other`,
  `no-ownerless`,
  `unbounded`,
  `limited`,
  `limited-ownerless-restored`,
] as const
export function scopedHydrationReached(
  h: ScopedHydrationHistory,
): Array<string> {
  return [
    `first-${h.first}`,
    h.window === `all` ? `unbounded` : `limited`,
    h.next ? `nonempty-result` : `empty-result`,
    ...(h.otherPrevious ? [`unrequested-saved-rows`] : []),
    ...(h.previous & ~h.next ? [`omitted-owned-row`] : []),
    h.ownerless === `none` ? `no-ownerless` : `ownerless-${h.ownerless}`,
    ...(h.window === `one` && h.ownerless === `first`
      ? [`limited-ownerless-restored`]
      : []),
  ]
}
declareOracle({
  model: [expectedScopedHydration],
  grammar: [scopedHydrationHistoryArb, scopedHydrationHistories],
  check: [scopedHydrationViolations],
})

/**
 * A newly acquired cached Query does not override a continuously owned row
 * established by a later physical fetch. A manual cache edit establishes no
 * fetch order at all. A later physical refetch of the new Query may replace
 * that value. Authority: Query "Direct Writes and Query Sync", per-key fetch
 * order and cache edits without server-result authority. This is the primary
 * ownership oracle's first-claim law at the real persisted boundary.
 */
export type CachedPeerClaimHistory = {
  cache: `manual` | `older-fetch`
  cached: number
  current: number
  later: number
}
export type CachedPeerClaimObservation = {
  before: number | undefined
  claimed: number | undefined
  claimedDurable: number | undefined
  refetched: number | undefined
  refetchedDurable: number | undefined
  callsBeforeRefetch: number
  calls: number
}
export const cachedPeerClaimHistoryArb: fc.Arbitrary<CachedPeerClaimHistory> =
  fc.record({
    cache: fc.constantFrom(`manual`, `older-fetch`),
    cached: fc.integer({ min: -10, max: 10 }),
    current: fc.integer({ min: -10, max: 10 }),
    later: fc.integer({ min: -10, max: 10 }),
  })
export const cachedPeerClaimHistories: Array<CachedPeerClaimHistory> = (
  [`manual`, `older-fetch`] as const
).map((cache) => ({ cache, cached: 1, current: 2, later: 3 }))
export const cachedPeerClaimStates = [
  `manual`,
  `older-fetch`,
  `different-cached-value`,
  `later-value-change`,
] as const
export const cachedPeerClaimReached = (h: CachedPeerClaimHistory) => [
  h.cache,
  ...(h.cached !== h.current ? [`different-cached-value`] : []),
  ...(h.current !== h.later ? [`later-value-change`] : []),
]
export function expectedCachedPeerClaim(h: CachedPeerClaimHistory) {
  return {
    before: h.current,
    claimed: h.current,
    claimedDurable: h.current,
    refetched: h.later,
    refetchedDurable: h.later,
  }
}
export function cachedPeerClaimViolations(
  h: CachedPeerClaimHistory,
  actual: CachedPeerClaimObservation,
): Array<string> {
  const expected = expectedCachedPeerClaim(h)
  const violations: Array<string> = []
  for (const cut of [
    `before`,
    `claimed`,
    `claimedDurable`,
    `refetched`,
    `refetchedDurable`,
  ] as const)
    if (actual[cut] !== expected[cut])
      violations.push(`${cut}: expected ${expected[cut]}, got ${actual[cut]}`)
  if (actual.callsBeforeRefetch !== 1 || actual.calls !== 2)
    violations.push(`cached claim started an unexpected physical fetch`)
  return violations
}
declareOracle({
  model: [expectedCachedPeerClaim],
  grammar: [cachedPeerClaimHistoryArb, cachedPeerClaimHistories],
  check: [cachedPeerClaimViolations],
})
