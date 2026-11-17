/**
 * Persisted receivers of the ownership oracle's fetch/write precedence law.
 * Saved rows are source-owned and retained until revalidation. A complete
 * response must remove an omitted saved row while preserving newer writes.
 * Histories cross raw rows and a derived select without an inverse cache
 * mapping, write before response versus before/after its held baseline read, four
 * write operations, and a later physical refetch. Insert/upsert also cross an
 * older result with a write authored while persisted restore is still held.
 * Update/delete require their saved target to be accepted first. Values vary
 * independently. These legality constraints avoid duplicate or invalid histories.
 * Three saved keys, one inserted key, one sync run, no failed I/O or peer claims.
 */
import { mergeDirectWritesOverFetch } from './direct-write-precedence-oracle'
import type {
  MergeRow,
  PrecedenceWrite,
} from './direct-write-precedence-oracle'

export type PrecedenceHistory = {
  shape: `raw` | `derived`
  origin?: `fetch` | `cache`
  laterFetch: boolean
  value: number
} & (
  | ((
      | { phase: `before-result` }
      | { phase: `before-fetch` }
      | {
          phase: `during-baseline`
          scanCut: `before-read` | `after-read`
        }
    ) & { op: `insert` | `update` | `delete` | `upsert` })
  | {
      phase: `before-restore`
      op: `insert` | `upsert`
    }
)
const baselineCuts = [
  { phase: `before-result` },
  { phase: `before-fetch` },
  { phase: `during-baseline`, scanCut: `before-read` },
  { phase: `during-baseline`, scanCut: `after-read` },
] as const
export const precedenceHistories: Array<PrecedenceHistory> = [
  ...([`raw`, `derived`] as const).flatMap((shape) =>
    baselineCuts.flatMap((cut) =>
      ([`insert`, `update`, `delete`, `upsert`] as const).flatMap((op) =>
        [false, true].map((laterFetch) => ({
          shape,
          ...cut,
          op,
          laterFetch,
          value: 9,
        })),
      ),
    ),
  ),
  ...([`raw`, `derived`] as const).flatMap((shape) =>
    ([`insert`, `upsert`] as const).flatMap((op) =>
      [false, true].map((laterFetch) => ({
        shape,
        phase: `before-restore` as const,
        op,
        laterFetch,
        value: 9,
      })),
    ),
  ),
  ...([`raw`, `derived`] as const).flatMap((shape) =>
    ([`before-read`, `after-read`] as const).flatMap((scanCut) =>
      ([`insert`, `update`, `delete`, `upsert`] as const).flatMap((op) =>
        [false, true].map((laterFetch) => ({
          shape,
          origin: `cache` as const,
          phase: `during-baseline` as const,
          scanCut,
          op,
          laterFetch,
          value: 9,
        })),
      ),
    ),
  ),
]
export const precedenceSaved: Array<MergeRow<number>> = [
  { id: `k`, value: 1 },
  { id: `z`, value: 1 },
  { id: `obsolete`, value: 1 },
]
export const precedenceFetched: Array<MergeRow<number>> = [
  { id: `k`, value: 2 },
  { id: `z`, value: 3 },
]
export const precedenceLater: Array<MergeRow<number>> = [
  { id: `k`, value: 6 },
  { id: `z`, value: 7 },
]
export function precedenceWrites(
  h: PrecedenceHistory,
): Array<PrecedenceWrite<number>> {
  const id = h.op === `insert` || h.op === `upsert` ? `new` : `k`
  return h.op === `delete` ? [{ id, deleted: true }] : [{ id, value: h.value }]
}
export type PrecedenceObservation = {
  afterWrite?: Array<MergeRow<number>>
  first: Array<MergeRow<number>>
  firstDurable: Array<MergeRow<number>>
  firstCache: Array<MergeRow<number>>
  later?: Array<MergeRow<number>>
  laterDurable?: Array<MergeRow<number>>
  scans: number
  heldScan: boolean
  heldRestore: boolean
  fetches: number
}
export const precedenceValues = (rows: Array<MergeRow<number>>) =>
  Object.fromEntries(rows.map((r) => [r.id, r.value]))
/** The same independent overlay predicts each captured public/cache/durable cut. */
export function expectedPersistedPrecedence(h: PrecedenceHistory) {
  const writes = precedenceWrites(h)
  const first = mergeDirectWritesOverFetch(
    precedenceFetched,
    h.phase === `before-fetch` ? [] : writes,
  )
  return {
    afterWrite:
      h.phase === `before-restore`
        ? undefined
        : mergeDirectWritesOverFetch(precedenceSaved, writes),
    first,
    firstDurable: first,
    firstCache: h.shape === `raw` ? first : precedenceValues(precedenceFetched),
    later: h.laterFetch ? precedenceValues(precedenceLater) : undefined,
    laterDurable: h.laterFetch ? precedenceValues(precedenceLater) : undefined,
  }
}
export function precedenceViolations(
  h: PrecedenceHistory,
  o: PrecedenceObservation,
): Array<string> {
  const failures: Array<string> = []
  const same = (
    cut: string,
    actual: Array<MergeRow<number>> | undefined,
    expected: Record<string, number>,
  ) => {
    if (
      !actual ||
      JSON.stringify(Object.entries(precedenceValues(actual)).sort()) !==
        JSON.stringify(Object.entries(expected).sort())
    )
      failures.push(
        `${cut}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      )
  }
  const expected = expectedPersistedPrecedence(h)
  // With restore held, saved rows are not yet promised as a public base. Those
  // histories compare the first complete applied result and its durable state;
  // the other histories also compare the accepted write while the source waits.
  if (h.phase !== `before-restore`)
    same(`afterWrite`, o.afterWrite, expected.afterWrite!)
  same(`first`, o.first, expected.first)
  same(`firstDurable`, o.firstDurable, expected.firstDurable)
  same(`firstCache`, o.firstCache, expected.firstCache)
  if (h.laterFetch) {
    same(`later`, o.later, expected.later!)
    same(`laterDurable`, o.laterDurable, expected.laterDurable!)
  }
  if (h.phase === `during-baseline` && !o.heldScan)
    failures.push(`missing held baseline scan`)
  if (h.phase === `before-restore` && !o.heldRestore)
    failures.push(`missing held persisted restore`)
  if (o.fetches !== (h.origin === `cache` ? 0 : 1) + (h.laterFetch ? 1 : 0))
    failures.push(`unexpected fetch count ${o.fetches}`)
  return failures
}
export const precedenceStates = [
  `raw`,
  `derived`,
  `fetched-result`,
  `cached-result`,
  `before-result`,
  `before-fetch`,
  `before-restore`,
  `during-baseline`,
  `before-read`,
  `after-read`,
  `insert`,
  `update`,
  `delete`,
  `upsert`,
  `later-fetch`,
]
export const precedenceReached = (h: PrecedenceHistory) => [
  h.shape,
  h.origin === `cache` ? `cached-result` : `fetched-result`,
  h.phase,
  ...(h.phase === `during-baseline` ? [h.scanCut] : []),
  h.op,
  ...(h.laterFetch ? [`later-fetch`] : []),
]
