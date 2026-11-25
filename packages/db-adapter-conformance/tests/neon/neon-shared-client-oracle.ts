/**
 * # Can exact-query Collections share one Neon client independently?
 *
 * Each Collection shows its own complete query result. Cleaning up one sync
 * run releases its subscription and callbacks exactly once; its peer keeps
 * its rows, readiness and subsequent delivery. The reusable-client and exact-
 * query contracts are public RealtimeCollectionConfig/client/query docs and
 * RawLiveQuerySubscription.unsubscribe; Collection cleanup owns only its run.
 *
 * This law differs from Direct's table-union/passive-cache law. Two distinct
 * Neon query fingerprints receive independent authoritative answers. The model
 * below projects each answer to three string keys and numeric values. It stores
 * no client, query-cache, listener, SDK or adapter state. No failure, renewal,
 * persistence, mutation, same-query cache or deployed-service claim follows.
 */
import fc from 'fast-check'
import { startupRows } from '../persisted-startup-oracle'
import type { StartupRow } from '../persisted-startup-oracle'

export const neonSharedStates = [
  `join-before-readiness`,
  `join-after-readiness`,
  `first-retired`,
  `second-retired`,
  `equal-membership`,
  `partial-membership`,
  `disjoint-membership`,
  `empty-later-result`,
  `empty-first-result`,
  `empty-peer-result`,
] as const
export type NeonSharedState = (typeof neonSharedStates)[number]
export type NeonSharedHistory = {
  join: `before-ready` | `after-ready`
  first: number
  second: number
  next: number
  retire: 0 | 1
}
// Both answers can be empty, equal, overlapping or disjoint. Joining before
// readiness distinguishes cross-subscription gates; either cleanup distinguishes
// ownership. A later answer may omit every key. Cleanup before SDK acquisition
// is excluded: this grammar judges two acquired logical subscriptions.
export const neonSharedHistoryArb: fc.Arbitrary<NeonSharedHistory> = fc.record({
  join: fc.constantFrom(`before-ready` as const, `after-ready` as const),
  first: fc.integer({ min: 0, max: 7 }),
  second: fc.integer({ min: 0, max: 7 }),
  next: fc.integer({ min: 0, max: 7 }),
  retire: fc.constantFrom(0 as const, 1 as const),
})
export type NeonSharedCut = {
  rows: Array<Array<StartupRow>>
  statuses: Array<string>
}
export type NeonSharedResource = {
  name: string
  syncRun: number
  releases: number
}
export type NeonSharedObservation = {
  joined: NeonSharedCut
  both: NeonSharedCut
  retired: NeonSharedCut
  later: NeonSharedCut
  beforeRetirement: Array<NeonSharedResource>
  atRetirement: Array<NeonSharedResource>
  finalResources: Array<NeonSharedResource>
  clientCloseCalls: number
  reached: Array<NeonSharedState>
  cleanupErrors?: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
}
// An authored answer replaces only its own query. Peer cleanup removes only
// that Collection's public snapshot; it cannot change the survivor's answer.
export function neonSharedModel(h: NeonSharedHistory) {
  const first = startupRows(h.first, 1),
    second = startupRows(h.second, 2)
  const remaining = (rows: Array<StartupRow>): NeonSharedCut => ({
    rows: h.retire === 0 ? [[], rows] : [rows, []],
    statuses:
      h.retire === 0 ? [`cleaned-up`, `ready`] : [`ready`, `cleaned-up`],
  })
  return {
    joined: {
      rows: [h.join === `after-ready` ? first : [], []],
      statuses: [h.join === `after-ready` ? `ready` : `loading`, `loading`],
    },
    both: { rows: [first, second], statuses: [`ready`, `ready`] },
    retired: remaining(h.retire === 0 ? second : first),
    later: remaining(startupRows(h.next, 3)),
  }
}
// Compare every public cut plus each acquisition's release count. Allocation
// shape remains free. Distinct ledger entries retain duplicate teardown calls.
export function neonSharedViolations(
  h: NeonSharedHistory,
  raw: NeonSharedObservation,
) {
  const expected = neonSharedModel(h)
  const failures = [...(raw.browserErrors ?? [])]
  for (const cut of [`joined`, `both`, `retired`, `later`] as const)
    if (JSON.stringify(raw[cut]) !== JSON.stringify(expected[cut]))
      failures.push(`${cut} public snapshot`)
  if (raw.clientCloseCalls !== 0) failures.push(`adapter closed shared client`)
  if (raw.beforeRetirement.some((resource) => resource.releases !== 0))
    failures.push(`active query resource released`)
  if (
    raw.beforeRetirement.filter((r) => r.name === `raw subscription`).length !==
    2
  )
    failures.push(`two acquired SDK subscriptions`)
  for (let index = 0; index < raw.atRetirement.length; index++) {
    const resource = raw.atRetirement[index]!
    const before = raw.beforeRetirement[index]
    if (
      !before ||
      resource.name !== before.name ||
      resource.syncRun !== before.syncRun
    )
      failures.push(`resource ledger identity`)
    const expectedReleases =
      resource.syncRun === h.retire + 1 ? 1 : before?.releases
    if (resource.releases !== expectedReleases)
      failures.push(`peer resource release ${index}`)
  }
  if (raw.atRetirement.length !== raw.beforeRetirement.length)
    failures.push(`resource ledger cardinality`)
  for (const resource of raw.finalResources)
    if (resource.releases !== 1) failures.push(`final resource release`)
  if (raw.finalResources.length !== raw.beforeRetirement.length)
    failures.push(`final resource ledger cardinality`)
  return failures
}
