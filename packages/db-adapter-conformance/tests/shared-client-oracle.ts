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
 * checkpoint. Active peers additionally compose request-scoped rejection,
 * changed rejection, healthy-peer update/deletion and changed/unchanged
 * recovery. A bounded application status listener may change the requested
 * streams before a Collection's ready listener runs. Its real SDK wait then
 * remains pending until the successor checkpoint. Cleanup releases that run's
 * pending work while a peer keeps syncing; a later checkpoint cannot supply
 * the missing cleanup cancellation. No persistence, mutation, deployed service
 * or subset claim.
 */
import fc from 'fast-check'
import { startupRows } from './persisted-startup-oracle'
import { streamHealthViolations } from './stream-health-oracle'
import type { StartupRow } from './persisted-startup-oracle'
import type { StreamProblem } from './stream-health-oracle'

export type SharedClientHistory = {
  join: `passive` | `active`
  first: number
  second: number
  next: number
  retire: 0 | 1
  waitReentry?: `before-cleanup` | `after-checkpoint`
  failure?: {
    stream: 0 | 1
    repeat: boolean
    peer: `update` | `delete`
    recovery: `none` | `unchanged` | `changed`
  }
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
      waitReentry: fc.constantFrom(
        `before-cleanup` as const,
        `after-checkpoint` as const,
      ),
    }),
    fc.record(
      {
        join: fc.constant(`active` as const),
        first: fc.integer({ min: 1, max: 7 }),
        second: fc.integer({ min: 1, max: 7 }),
        next: fc.integer({ min: 0, max: 7 }),
        retire: fc.constantFrom(0 as const, 1 as const),
        failure: fc.option(
          fc.record({
            stream: fc.constantFrom(0 as const, 1 as const),
            repeat: fc.boolean(),
            peer: fc.constantFrom(`update` as const, `delete` as const),
            recovery: fc.constantFrom(
              `none` as const,
              `unchanged` as const,
              `changed` as const,
            ),
          }),
          { nil: undefined },
        ),
      },
      { requiredKeys: [`join`, `first`, `second`, `next`, `retire`] },
    ),
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
  `rejected-scope`,
  `changed-rejection`,
  `healthy-peer-update`,
  `healthy-peer-delete`,
  `recovered-changed`,
  `recovered-unchanged`,
  `failed-owner-retired`,
  `healthy-owner-retired`,
  `recovery-request-open`,
  `wait-pending-before-cleanup`,
  `wait-applied-before-cleanup`,
] as const
export type SharedClientState = (typeof sharedClientStates)[number]
export type SharedClientCut = {
  rows: [Array<StartupRow>, Array<StartupRow>]
  statuses: [string, string]
  terminalErrors: [boolean, boolean]
  newestIsLast: [boolean, boolean]
  targetSettled: boolean
  problems: [Array<StreamProblem>, Array<StreamProblem>]
}
export type SharedClientResource = {
  id: number
  owner: number
  kind: string
  releases: number
}
export type SharedClientWait = {
  owner: number
  signaled: boolean
  aborted: boolean
  outcome: `pending` | `fulfilled` | `rejected`
}
export type SharedClientObservation = {
  browserErrors?: ReadonlyArray<string>
  joined: SharedClientCut
  both: SharedClientCut
  failed?: SharedClientCut
  failedAgain?: SharedClientCut
  peer?: SharedClientCut
  recovered?: SharedClientCut
  recoveryPending?: SharedClientCut
  retired: SharedClientCut
  later: SharedClientCut
  resourcesBeforeRetirement: Array<SharedClientResource>
  resourcesAtRetirement: Array<SharedClientResource>
  finalResources: Array<SharedClientResource>
  requestedAtJoin: Array<string>
  requestedAfterRetirement: Array<string>
  finalProviderState: string
  waitsBeforeCleanup: Array<SharedClientWait>
  waitsAtCleanup: Array<SharedClientWait>
  reentered: boolean
  reached: Array<SharedClientState>
}
// Authored complete source membership determines all public rows. Both active
// Collections read the same table union, regardless of which requested a row.
// Resource ownership is separate: retiring a Collection never retires its peer.
export function sharedClientModel(h: SharedClientHistory) {
  const first = startupRows(h.first, 1)
  const both = startupRows(h.first | h.second, 2)
  const healthy = h.failure?.stream === 0 ? h.second : h.first
  const peerMask =
    h.failure?.peer === `delete` ? healthy & (healthy - 1) : healthy
  const failedRows = startupRows(healthy, 3)
  const peerRows = startupRows(peerMask, 4)
  const recoveredRows =
    h.failure?.recovery === `changed`
      ? startupRows(h.first | h.second, 5)
      : peerRows
  // Table membership comes from successful bucket support. It is independent
  // of scoped health: a rejected owner cannot freeze the healthy peer's table.
  // Unchanged recovery authors the same table union, including the empty union.
  const fault = h.failure
  const scopedProblems = (
    owner: number,
    repeated = false,
  ): Array<StreamProblem> =>
    fault?.stream === owner
      ? [
          { kind: `connection`, attempt: 1 },
          {
            kind: `stream`,
            stream: owner === 0 ? `alpha` : `beta`,
            messages: [3, ...(repeated ? [4] : [])].map(
              (v) => `rejected-${v}-${owner === 0 ? `alpha` : `beta`}`,
            ),
          },
        ]
      : []
  const failedProblems: [Array<StreamProblem>, Array<StreamProblem>] = [
    scopedProblems(0),
    scopedProblems(1),
  ]
  const peerProblems: SharedClientCut['problems'] = [
    scopedProblems(0, fault?.repeat),
    scopedProblems(1, fault?.repeat),
  ]
  // Reopening the shared transport starts a new outage for the healthy peer
  // too. Opening the request has delivered no successful checkpoint yet.
  const pendingProblems = peerProblems.map((problems) =>
    problems.some((problem) => problem.kind === `connection`)
      ? problems
      : [
          ...problems,
          { kind: `connection` as const, attempt: fault?.repeat ? 3 : 2 },
        ],
  ) as SharedClientCut['problems']
  const ready = (
    rows: Array<StartupRow>,
    health: SharedClientCut['problems'] = [[], []],
  ): SharedClientCut => ({
    rows: [rows, rows],
    statuses: [`ready`, `ready`],
    terminalErrors: [false, false],
    newestIsLast: [true, true],
    targetSettled: true,
    problems: health,
  })
  const beforeRetirement = fault
    ? fault.recovery === `none`
      ? peerRows
      : recoveredRows
    : both
  const retainedProblems =
    fault?.recovery === `none`
      ? peerProblems
      : ([[], []] as SharedClientCut['problems'])
  const next = startupRows(h.next, fault ? 6 : 3)
  const after = (
    rows: Array<StartupRow>,
    health: SharedClientCut['problems'] = [[], []],
  ): SharedClientCut => ({
    rows: h.retire === 0 ? [[], rows] : [rows, []],
    statuses:
      h.retire === 0 ? [`cleaned-up`, `ready`] : [`ready`, `cleaned-up`],
    targetSettled: true,
    terminalErrors: [false, false],
    newestIsLast: [true, true],
    problems: h.retire === 0 ? [[], health[1]] : [health[0], []],
  })
  return {
    joined: {
      rows: [first, h.join === `passive` ? first : []],
      statuses: [`ready`, h.join === `passive` ? `ready` : `loading`],
      targetSettled: h.join === `passive`,
      terminalErrors: [false, false] as [boolean, boolean],
      newestIsLast: [true, true] as [boolean, boolean],
      problems: [[], []] as SharedClientCut['problems'],
    },
    both: ready(both),
    ...(fault
      ? {
          failed: ready(failedRows, failedProblems),
          ...(fault.repeat
            ? { failedAgain: ready(failedRows, peerProblems) }
            : {}),
          peer: ready(peerRows, peerProblems),
          ...(fault.recovery !== `none`
            ? {
                recoveryPending: ready(peerRows, pendingProblems),
                recovered: ready(recoveredRows),
              }
            : {}),
        }
      : {}),
    retired: after(beforeRetirement, retainedProblems),
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
  const reportedAttempts = [new Set<number>(), new Set<number>()]
  for (const cut of [
    `joined`,
    `both`,
    `failed`,
    `failedAgain`,
    `peer`,
    `recoveryPending`,
    `recovered`,
    `retired`,
    `later`,
  ] as const) {
    const wanted = expected[cut]
    const actual = raw[cut]
    if (!wanted || !actual) {
      if (wanted !== actual) failures.push(`${cut} missing/unexpected cut`)
      continue
    }
    if (
      !same(actual.rows, wanted.rows) ||
      !same(actual.statuses, wanted.statuses) ||
      !same(actual.terminalErrors, wanted.terminalErrors) ||
      !same(actual.newestIsLast, wanted.newestIsLast) ||
      actual.targetSettled !== wanted.targetSettled
    )
      failures.push(`${cut} public snapshot`)
    for (const owner of [0, 1] as const) {
      const health = wanted.problems[owner]
      const attempts = new Set(
        actual.problems[owner].flatMap((problem) =>
          problem.kind === `connection` && problem.attempt !== undefined
            ? [problem.attempt]
            : [],
        ),
      )
      // Reporting a later retry is optional. Once reported, it belongs to the
      // same open failure frame until recovery or this Collection's cleanup.
      if (health.some((problem) => problem.kind === `connection`)) {
        for (const attempt of reportedAttempts[owner]!)
          if (!attempts.has(attempt))
            failures.push(`${cut}/${owner} reported retry disappeared`)
        for (const attempt of attempts) reportedAttempts[owner]!.add(attempt)
      } else reportedAttempts[owner]!.clear()
      failures.push(
        ...streamHealthViolations(
          {
            streams: health.flatMap((p) =>
              p.kind === `stream` ? [p.stream] : [],
            ),
            connection: health.some((p) => p.kind === `connection`),
          },
          actual.problems[owner],
        ).map((failure) => `${cut}/${owner} ${failure}`),
      )
      // Closing transport precedes resolving the successor's arguments. The
      // retained connection error therefore precedes every stream rejection.
      // Compare the full frame, not only relative stream-message order.
      const frame = (problems: ReadonlyArray<StreamProblem>) =>
        problems.flatMap((p) =>
          p.kind === `stream`
            ? (p.messages ?? []).map((message) => `${p.stream}:${message}`)
            : [p.kind === `connection` ? `connection:${p.attempt}` : p.kind],
        )
      const wantedFrame = frame(health)
      const observedFrame = frame(actual.problems[owner])
      // RETRY-1 permits extra reports for later attempts of the still-open
      // outage. They can occur only at the authored closes: C2 before E4,
      // and the recovery close after the final rejection. C1 stays mandatory.
      const pattern = wantedFrame.flatMap((token, index) => [
        ...(h.failure?.repeat && index === 2
          ? [{ token: `connection:2`, optional: true }]
          : []),
        { token, optional: false },
      ])
      if (
        cut === `recoveryPending` &&
        health.some((problem) => problem.kind === `stream`)
      )
        pattern.push({
          token: `connection:${h.failure?.repeat ? 3 : 2}`,
          optional: true,
        })
      let cursor = 0
      let ordered = true
      for (const expectedEntry of pattern) {
        if (observedFrame[cursor] === expectedEntry.token) cursor++
        else if (!expectedEntry.optional) ordered = false
      }
      if (!ordered || cursor !== observedFrame.length)
        failures.push(`${cut}/${owner} ordered failure frame`)
    }
  }
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
  // A pending SDK wait is run-owned work even after its lease releases. Keep
  // its actual settlement; ignoring released leases would erase this law.
  for (const wait of raw.waitsAtCleanup)
    if (wait.owner === h.retire && wait.outcome === `pending`)
      failures.push(`cleanup retained an unsettled SDK wait`)
  if (h.waitReentry && !raw.reentered)
    failures.push(`application ready-listener reentry did not run`)
  if (
    h.waitReentry &&
    raw.waitsBeforeCleanup.some(
      (wait) => wait.owner === h.retire && wait.outcome === `pending`,
    ) !==
      (h.waitReentry === `before-cleanup`)
  )
    failures.push(`SDK wait did not reach the declared pre-cleanup boundary`)
  if (raw.finalProviderState !== `idle`)
    failures.push(`final provider resources`)
  return failures
}
