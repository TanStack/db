/**
 * Receiving grammar for the primary persisted-demand coverage law. Each first
 * sync run establishes facts through actual Direct loads and HTTP checkpoints;
 * a fresh SDK and reopened SQLite database receive the second sync run.
 * These histories carry premises only. The primary model judges every result.
 *
 * The bounded product keeps completed, empty, never-requested, overlapping,
 * pending, failed and subsequently changed demand distinct. Removing any first
 * run loses that distinction. The second run either waits across a 1000 ms
 * deadline, uses a zero wait, or receives a real stream rejection before a
 * 60000 ms wait. A checkpoint cannot precede its HTTP request. A pending first
 * load cannot record completion, and no history seeds coverage metadata.
 * Further histories supply a first remote checkpoint after reopen. Direct may
 * then replace its cache with the confirmed SDK table, ending older coverage.
 * An exact refresh must lose omitted rows; a disjoint B replacement must not
 * leave old A coverage usable. An empty mapper supplies no checkpoint authority.
 * One delayed durable observation crosses the public wait deadline, preserving
 * the earlier public cut rather than mixing observations from different times.
 */
export type DirectDemandFirst =
  | `covered`
  | `empty`
  | `never`
  | `overlap`
  | `incomplete`
  | `failed`
  | `deleted`
  | `window-covered`
  | `window-replaced`
  | `covered-overlap`

export type DirectDemandHistory = {
  first: DirectDemandFirst
  second: `held` | `rejected` | `empty-mapper`
  waitMs: number
  /** Hold the durable observation across a public readiness deadline. */
  slowDurableRead?: true
  transition?: `refresh-exact` | `load-other` | `load-other-then-reject-saved`
}

export const directDemandHistories: Array<DirectDemandHistory> = (
  [
    `covered`,
    `empty`,
    `never`,
    `overlap`,
    `incomplete`,
    `failed`,
    `deleted`,
    `window-covered`,
    `window-replaced`,
  ] as const
).flatMap((first) => [
  { first, second: `held` as const, waitMs: 0 },
  { first, second: `held` as const, waitMs: 1000 },
  { first, second: `rejected` as const, waitMs: 60_000 },
])
for (const transition of [`refresh-exact`, `load-other`] as const)
  for (const waitMs of [0, 1000])
    directDemandHistories.push({
      first: `covered`,
      second: `held`,
      waitMs,
      transition,
    })
for (const waitMs of [0, 1000]) {
  directDemandHistories.push(
    {
      first: `window-covered`,
      second: `held`,
      waitMs,
      transition: `refresh-exact`,
    },
    {
      first: `covered-overlap`,
      second: `held`,
      waitMs,
      transition: `load-other-then-reject-saved`,
    },
    { first: `covered`, second: `empty-mapper`, waitMs },
  )
}
directDemandHistories.push({
  first: `covered`,
  second: `held`,
  waitMs: 1000,
  slowDurableRead: true,
})

export const directDemandStates = [
  `covered offline`,
  `uncovered offline`,
  `covered but short of rows`,
  `window covered offline`,
  `window holds other rows`,
  `tie-boundary load uncovered`,
  `covered load waits for the deadline`,
  `uncovered load fails with its upstream`,
  `completed exact first load`,
  `completed empty first load`,
  `pending exact first load`,
  `failed exact first load`,
  `overlapping first load`,
  `closed and reopened storage`,
  `exact remote refresh omits a saved row`,
  `other demand checkpoint after saved load`,
  `coverage recorded twice`,
  `coverage ended by a snapshot`,
  `overlapping demands completed`,
  `empty mapper after saved load`,
  `saved demand failed after cache eviction`,
  `durable observation crossed the public wait deadline`,
] as const
