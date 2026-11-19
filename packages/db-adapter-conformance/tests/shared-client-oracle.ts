/**
 * # Can same-table source Collections share a provider independently?
 *
 * Every Collection on one client/table includes all rows synced for that
 * table. A passive eager Collection (no streams and no defaults) can show the
 * already-synced cache immediately. Ending either sync run releases only its
 * resources; a surviving stream owner keeps receiving later checkpoints.
 * Authority: PowerSync Direct's public table/streams option documentation,
 * docs/collections/powersync-direct-collection.md, and glossary cleanup.
 *
 * This composition extends the eager owner's fresh-source premise. It reuses
 * the startup owner's independent keyed-row judgment; it does not model SDK
 * subscription caches, bucket reduction, reconnects, or listener machinery.
 * Limits: two eager source Collections, one table, three numeric-valued keys,
 * passive or distinct explicit streams, one retirement and one later complete
 * checkpoint. No errors, persistence, mutation, remote service or subset claim.
 */
import fc from 'fast-check'
import { startupRows } from './persisted-startup-oracle'
import type { StartupRow } from './persisted-startup-oracle'

export type SharedClientHistory = {
  join: `passive` | `active`
  first: number
  second: number
  next: number
  retire: 0 | 1
}
// A passive peer can retire while its donor survives. Retiring the sole donor
// instead supplies no later remote-data premise, so it is outside this grammar.
// The masks include equal, partial and disjoint support, then empty/omitted
// later results. Removing these axes loses a distinct public table projection.
export const sharedClientHistoryArb: fc.Arbitrary<SharedClientHistory> =
  fc.oneof(
    fc.record({
      join: fc.constant(`passive` as const),
      first: fc.integer({ min: 1, max: 7 }),
      second: fc.constant(0),
      next: fc.integer({ min: 0, max: 7 }),
      retire: fc.constant(1 as const),
    }),
    fc.record({
      join: fc.constant(`active` as const),
      first: fc.integer({ min: 1, max: 7 }),
      second: fc.integer({ min: 1, max: 7 }),
      next: fc.integer({ min: 0, max: 7 }),
      retire: fc.constantFrom(0 as const, 1 as const),
    }),
  )
export const sharedClientStates = [
  `passive-cached-join`,
  `active-join`,
  `first-retired`,
  `second-retired`,
  `equal-support`,
  `partial-support`,
  `disjoint-support`,
  `later-omission`,
  `later-empty`,
] as const
export type SharedClientState = (typeof sharedClientStates)[number]
export type SharedClientCut = {
  rows: [Array<StartupRow>, Array<StartupRow>]
  statuses: [string, string]
  targetSettled: boolean
}
export type SharedClientResource = {
  id: number
  owner: number
  kind: string
  releases: number
}
export type SharedClientObservation = {
  browserErrors?: ReadonlyArray<string>
  joined: SharedClientCut
  both: SharedClientCut
  retired: SharedClientCut
  later: SharedClientCut
  resourcesBeforeRetirement: Array<SharedClientResource>
  resourcesAtRetirement: Array<SharedClientResource>
  finalResources: Array<SharedClientResource>
  requestedAtJoin: Array<string>
  requestedAfterRetirement: Array<string>
  finalProviderState: string
  reached: Array<SharedClientState>
}
// Authored complete source membership determines all public rows. Both active
// Collections read the same table union, regardless of which requested a row.
// Resource ownership is separate: retiring a Collection never retires its peer.
export function sharedClientModel(h: SharedClientHistory) {
  const first = startupRows(h.first, 1)
  const both = startupRows(h.first | h.second, 2)
  const next = startupRows(h.next, 3)
  const after = (rows: Array<StartupRow>): SharedClientCut => ({
    rows: h.retire === 0 ? [[], rows] : [rows, []],
    statuses:
      h.retire === 0 ? [`cleaned-up`, `ready`] : [`ready`, `cleaned-up`],
    targetSettled: true,
  })
  return {
    joined: {
      rows: [first, h.join === `passive` ? first : []],
      statuses: [`ready`, h.join === `passive` ? `ready` : `loading`],
      targetSettled: h.join === `passive`,
    },
    both: {
      rows: [both, both],
      statuses: [`ready`, `ready`],
      targetSettled: true,
    },
    retired: after(both),
    later: after(next),
    streams: h.join === `passive` ? [`alpha`] : [`alpha`, `beta`],
    survivingStreams: [h.retire === 0 ? `beta` : `alpha`],
  }
}
export function sharedClientViolations(
  h: SharedClientHistory,
  raw: SharedClientObservation,
) {
  const expected = sharedClientModel(h)
  const failures = [...(raw.browserErrors ?? [])]
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b)
  for (const cut of [`joined`, `both`, `retired`, `later`] as const)
    if (!same(raw[cut], expected[cut])) failures.push(`${cut} public snapshot`)
  if (!same(raw.requestedAtJoin, expected.streams))
    failures.push(`shared stream union`)
  if (!same(raw.requestedAfterRetirement, expected.survivingStreams))
    failures.push(`surviving stream ownership`)
  // Peer cleanup cannot release the survivor's resources. Compare its counts
  // across that action: a resource may lawfully have retired earlier already.
  // Allocation kinds/counts remain free. Requests and rows witness the path.
  for (const resource of raw.resourcesAtRetirement)
    if (resource.owner === h.retire && resource.releases !== 1)
      failures.push(`retired resource ${resource.owner}/${resource.kind}`)
  for (const before of raw.resourcesBeforeRetirement) {
    if (before.owner === h.retire) continue
    const after = raw.resourcesAtRetirement.find(
      (resource) => resource.id === before.id,
    )
    if (!after || after.releases !== before.releases)
      failures.push(`peer cleanup released survivor resource ${before.id}`)
  }
  for (const resource of raw.finalResources)
    if (resource.releases !== 1)
      failures.push(`final resource ${resource.owner}/${resource.kind}`)
  if (raw.finalProviderState !== `idle`)
    failures.push(`final provider resources`)
  return failures
}
