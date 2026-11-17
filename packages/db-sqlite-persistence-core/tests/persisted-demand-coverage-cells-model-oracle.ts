/**
 * The Part 1 model of the persisted demand coverage oracle in
 * persisted-demand-coverage-oracle.test.ts: the session-1 coverage histories,
 * waits, and upstream schedules; the rows each history leaves; the observed
 * checkpoints; the independent model of one demand over two sessions, with
 * `Design` variants for its calibration; the refinement check; and the cells.
 * Owns nothing: the oracle test drives production with them, and
 * persisted-demand-coverage-calibration.test.ts calibrates the model and check.
 */
import type { Row } from './helpers/demand-coverage-driver.js'

export const COVERAGE_HISTORIES = [
  `not-requested`,
  `failed`,
  `overlapping-demand`,
  `other-window`,
  `other-order`,
  `durable-write-failed`,
  `settled-empty`,
  `settled`,
  `truncated`,
  `truncated-in-flight`,
  `recovered-in-flight`,
  `recovering-in-flight`,
  `settled-then-row-deleted`,
] as const
export type CoverageHistory = (typeof COVERAGE_HISTORIES)[number]

export const UPSTREAM_SCHEDULES = [
  `pending`,
  `fails-at-once`,
  `fails-early`,
  `answers-early`,
  `answers-late`,
  `answers-empty-late`,
  `fails-late`,
] as const
export type UpstreamSchedule = (typeof UPSTREAM_SCHEDULES)[number]

export const WAITS = [0, 1000] as const
export type Wait = (typeof WAITS)[number]

export type Cell = {
  history: CoverageHistory
  waitMs: Wait
  upstream: UpstreamSchedule
}

export const A1: Row = { id: `a1`, group: `a`, rank: 1, value: `v1` }
export const A2: Row = { id: `a2`, group: `a`, rank: 2, value: `v1` }

export const SESSION_1_ROWS: Record<CoverageHistory, ReadonlyArray<Row>> = {
  'not-requested': [],
  failed: [],
  'overlapping-demand': [A1],
  'other-window': [A1],
  'other-order': [A1, A2],
  // The upstream answer was A1 and A2, but no row became durable.
  'durable-write-failed': [],
  'settled-empty': [],
  settled: [A1, A2],
  truncated: [],
  'truncated-in-flight': [],
  'recovered-in-flight': [],
  'recovering-in-flight': [],
  'settled-then-row-deleted': [A2],
}

// Session 2's upstream answer updates a1 and adds a3. It omits a2; an
// on-demand load reports rows, not deletions, so a2 stays.
export const SESSION_2_ANSWER: ReadonlyArray<Row> = [
  { id: `a1`, group: `a`, rank: 1, value: `v2` },
  { id: `a3`, group: `a`, rank: 3, value: `v2` },
]

// ---------------------------------------------------------------------------
// Observations and checkpoints
//
// The query reads only D, so its initial-query readiness is D's load
// settlement. The model therefore predicts three public facts together:
// `query.status`, the state of the session-2 `preload()` promise, and, when
// ready, the exact rows. Rows are not compared while loading; this law does
// not govern partial results before settlement.
//
// Checkpoints, in order:
//
// - `restored`: the upstream load has started and microtasks have drained,
//   before fake time advances. The persisted subset restore has had every
//   chance to publish. A slower publication fails the ready cells here; it
//   cannot pass them.
// - `afterEarlyEvent`: after an early upstream answer or failure.
// - `beforeDeadline`: fake time is 1 ms before the wait passes.
// - `afterDeadline`: fake time has reached the wait.
// - `afterLateEvent`: after a late upstream answer or failure.
// ---------------------------------------------------------------------------

export type Observation = {
  queryStatus: `loading` | `ready` | `error`
  preload: `pending` | `resolved` | `rejected`
  rows?: ReadonlyArray<string>
}

export type Trace = {
  restored: Observation
  afterEarlyEvent: Observation
  beforeDeadline: Observation
  afterDeadline: Observation
  afterLateEvent: Observation
}

export const CHECKPOINTS = [
  `restored`,
  `afterEarlyEvent`,
  `beforeDeadline`,
  `afterDeadline`,
  `afterLateEvent`,
] as const satisfies ReadonlyArray<keyof Trace>

export function rowLabels(rows: Iterable<Row>): Array<string> {
  return Array.from(rows, (row) => `${row.id}:${row.value}`).sort()
}

// ---------------------------------------------------------------------------
// Independent model
//
// The model keeps four facts: whether D is covered, the rows visible to D,
// whether D's load has settled, and whether it failed. Coverage comes from
// the session-1 history label alone; the model never inspects SQLite or the
// wrapper. Each fact changes a later observation:
//
// - coverage decides whether the wait or an upstream failure settles D;
// - visible rows are the exact rows at settlement and after a later answer;
// - settlement separates `ready` from `loading`;
// - failure separates `error` from `loading` for an unsettled demand.
//
// Vocabulary (ORC-009): `covered` is persisted demand coverage; the initial
// visible rows are the persisted subset restore; `settled` is D's load
// settlement, observed through initial-query readiness and `preload()`.
//
// `Design` lets the calibration below express plausible wrong designs as
// variants of the same rule. The law is `LAW`.
// ---------------------------------------------------------------------------

export type Design = {
  name: string
  isCovered: (history: CoverageHistory) => boolean
  // `false` settles a covered demand at restore, ignoring the wait.
  honorsWait: boolean
  // Fraction of the wait after which a covered demand settles.
  deadlineFraction: number
  // A covered demand settles when its upstream load fails.
  failureSettlesCovered: boolean
  // Upstream rows still publish after a settlement from SQLite.
  upstreamContinues: boolean
  // A later upstream failure leaves a settled demand ready.
  settlementSurvivesFailure: boolean
  // Settles before the persisted subset restore publishes its rows.
  settlesBeforeRestore: boolean
}

export const LAW: Design = {
  name: `persisted demand coverage`,
  isCovered: (history) => history === `settled` || history === `settled-empty`,
  honorsWait: true,
  deadlineFraction: 1,
  failureSettlesCovered: true,
  upstreamContinues: true,
  settlementSurvivesFailure: true,
  settlesBeforeRestore: false,
}

export function expectedTrace(cell: Cell, design: Design = LAW): Trace {
  const covered = design.isCovered(cell.history)
  const visible = new Map(
    SESSION_1_ROWS[cell.history].map((row) => [row.id, row]),
  )
  const state = {
    settled: false,
    settledFromSqlite: false,
    failed: false,
    // Set only by the wrong design that settles before the restore publishes.
    rowsAtEarlySettle: undefined as Array<string> | undefined,
  }

  const observe = (): Observation => {
    if (state.failed) return { queryStatus: `error`, preload: `rejected` }
    if (!state.settled) return { queryStatus: `loading`, preload: `pending` }
    return {
      queryStatus: `ready`,
      preload: `resolved`,
      rows: state.rowsAtEarlySettle ?? rowLabels(visible.values()),
    }
  }
  const settleFromSqlite = () => {
    if (state.settled || state.failed) return
    state.settled = true
    state.settledFromSqlite = true
  }
  const answer = (rows: ReadonlyArray<Row>) => {
    if (state.failed) return
    if (state.settledFromSqlite && !design.upstreamContinues) return
    for (const row of rows) visible.set(row.id, row)
    state.rowsAtEarlySettle = undefined
    state.settled = true
  }
  const fail = () => {
    if (state.failed) return
    if (!state.settled) {
      if (covered && design.failureSettlesCovered) settleFromSqlite()
      else state.failed = true
    } else if (!design.settlementSurvivesFailure) {
      state.failed = true
    }
  }

  // restored (t = 0)
  if (covered && (cell.waitMs === 0 || !design.honorsWait)) settleFromSqlite()
  if (cell.upstream === `fails-at-once`) fail()
  if (design.settlesBeforeRestore && covered) state.rowsAtEarlySettle = []
  const restored = observe()

  // early event (t = 0)
  if (cell.upstream === `answers-early`) answer(SESSION_2_ANSWER)
  if (cell.upstream === `fails-early`) fail()
  const afterEarlyEvent = observe()

  // t = wait - 1
  if (
    covered &&
    cell.waitMs > 0 &&
    design.deadlineFraction * cell.waitMs <= cell.waitMs - 1
  ) {
    settleFromSqlite()
  }
  const beforeDeadline = cell.waitMs === 0 ? afterEarlyEvent : observe()

  // t = wait
  if (covered) settleFromSqlite()
  const afterDeadline = observe()

  // late event
  if (cell.upstream === `answers-late`) answer(SESSION_2_ANSWER)
  if (cell.upstream === `answers-empty-late`) answer([])
  if (cell.upstream === `fails-late`) fail()
  const afterLateEvent = observe()

  return {
    restored,
    afterEarlyEvent,
    beforeDeadline,
    afterDeadline,
    afterLateEvent,
  }
}

// ---------------------------------------------------------------------------
// Refinement check
//
// Production refines the model when every checkpoint agrees on status,
// preload state, and, when the model is ready, the exact sorted rows. The
// recorder keeps duplicates and order, so the comparison can reject both.
// ---------------------------------------------------------------------------

export function sameObservation(
  expected: Observation,
  actual: Observation,
): boolean {
  if (expected.queryStatus !== actual.queryStatus) return false
  if (expected.preload !== actual.preload) return false
  if (expected.rows === undefined) return true
  return (
    actual.rows !== undefined &&
    actual.rows.length === expected.rows.length &&
    expected.rows.every((row, index) => actual.rows![index] === row)
  )
}

export function firstMismatch(
  expected: Trace,
  actual: Partial<Trace>,
):
  | { checkpoint: keyof Trace; expected: Observation; actual?: Observation }
  | undefined {
  for (const checkpoint of CHECKPOINTS) {
    const observed = actual[checkpoint]
    if (!observed || !sameObservation(expected[checkpoint], observed)) {
      return { checkpoint, expected: expected[checkpoint], actual: observed }
    }
  }
  return undefined
}

export const ALL_CELLS: ReadonlyArray<Cell> = COVERAGE_HISTORIES.flatMap(
  (history) =>
    WAITS.flatMap((waitMs) =>
      UPSTREAM_SCHEDULES.map((upstream) => ({ history, waitMs, upstream })),
    ),
)

export function cellName(cell: Cell): string {
  return `${cell.history}, wait ${cell.waitMs} ms, upstream ${cell.upstream}`
}
