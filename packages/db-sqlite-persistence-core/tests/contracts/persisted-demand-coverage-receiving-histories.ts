/**
 * The receiving histories as plain data: the rows, the session 1 steps, and the
 * session 2 setup of each history. Playwright loads this module, and it must
 * not import `@tanstack/db` (its tsconfig path reaches the TypeScript source,
 * which Playwright cannot transform), so it imports nothing at all.
 *
 * `persisted-demand-coverage-receiving-contract.ts` re-exports everything here
 * and holds the runners. The histories carry no expected results. The shared
 * judge (`persisted-demand-coverage-model-oracle.ts`) judges the records.
 */

export type Row = { id: string; group: string; rank: number; value: string }
export type Shape = `filter` | `window`

export const A1: Row = { id: `a1`, group: `a`, rank: 1, value: `v1` }
export const A2: Row = { id: `a2`, group: `a`, rank: 2, value: `v1` }
export const A3: Row = { id: `a3`, group: `a`, rank: 3, value: `v1` }
export const A15: Row = { id: `a15`, group: `a`, rank: 1.5, value: `v1` }

// The wait of an ordinary session 2 (premise).
export const SESSION_2_WAIT_MS = 1000
// The wait of the upstream-failure history (premise).
export const FAILURE_WAIT_MS = 60_000

export type Session1Step =
  { kind: `load` } | { kind: `remove`; row: Row } | { kind: `write`; row: Row }

export type Session2Upstream = `never-answers` | `fails-at-once`

export type ReceivingHistory = {
  id: string
  description: string
  shape: Shape
  session1: ReadonlyArray<Session1Step>
  session2: { waitMs: number; upstream: Session2Upstream }
}

const LOAD: Session1Step = { kind: `load` }

export const RECEIVING_HISTORIES: ReadonlyArray<ReceivingHistory> = [
  {
    id: `covered`,
    description: `covered demand settles offline with its restored rows`,
    shape: `filter`,
    // Session 1 loads D and the source answers a1 and a2.
    session1: [LOAD],
    session2: { waitMs: SESSION_2_WAIT_MS, upstream: `never-answers` },
  },
  {
    id: `never`,
    description: `never-loaded demand stays loading offline`,
    shape: `filter`,
    // Session 1 never asks for D.
    session1: [],
    session2: { waitMs: SESSION_2_WAIT_MS, upstream: `never-answers` },
  },
  {
    id: `deleted`,
    description: `covered demand stays loading after a source delete of one row`,
    shape: `filter`,
    // Session 1 loads D, then the source deletes a1.
    session1: [LOAD, { kind: `remove`, row: A1 }],
    session2: { waitMs: SESSION_2_WAIT_MS, upstream: `never-answers` },
  },
  {
    id: `window-covered`,
    description: `covered ordered window settles offline`,
    shape: `window`,
    // Session 1 loads `orderBy rank limit 2` with a1, a2, a3 in the source.
    session1: [LOAD],
    session2: { waitMs: SESSION_2_WAIT_MS, upstream: `never-answers` },
  },
  {
    id: `window-replaced`,
    description: `covered ordered window stays loading after a row replaced below the boundary`,
    shape: `window`,
    // After the load, the source deletes a1 and inserts a15 at rank 1.5.
    session1: [LOAD, { kind: `remove`, row: A1 }, { kind: `write`, row: A15 }],
    session2: { waitMs: SESSION_2_WAIT_MS, upstream: `never-answers` },
  },
  {
    id: `covered-upstream-fails-at-once`,
    description: `covered demand settles before the wait when its upstream load fails at once`,
    shape: `filter`,
    // As `covered`, but session 2's upstream load rejects as soon as it is
    // forwarded, and the wait is long enough to be distinguished from it.
    session1: [LOAD],
    session2: { waitMs: FAILURE_WAIT_MS, upstream: `fails-at-once` },
  },
]

/**
 * The histories a framework host runs. A hook observes readiness and rows
 * only, so it runs the filter histories without source removals.
 */
export const FRAMEWORK_HISTORY_IDS = [
  `covered`,
  `never`,
  `covered-upstream-fails-at-once`,
] as const

/** Looks up a history by its protocol id, for out-of-process hosts. */
export function receivingHistory(id: string): ReceivingHistory {
  const history = RECEIVING_HISTORIES.find((candidate) => candidate.id === id)
  if (!history) {
    throw new Error(`unknown persisted demand coverage history "${id}"`)
  }
  return history
}
