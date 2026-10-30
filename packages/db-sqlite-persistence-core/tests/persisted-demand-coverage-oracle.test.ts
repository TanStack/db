import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BTreeIndex,
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../src/index.js'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createSerializedNodeSqliteDriver as createDriver } from './helpers/node-sqlite-driver.js'
import {
  drain,
  filterQuery,
  onDemandSource,
  quietConsole,
  trackPreload,
  untilUpstreamCalled,
  useFakeClock,
  withCleanup,
  withMacrotaskReads,
} from './helpers/demand-coverage-driver.js'
import { coverageViolations } from './persisted-demand-coverage-model-oracle.js'
import type { Row, Upstream } from './helpers/demand-coverage-driver.js'
import type {
  CoverageReach,
  CoverageRecord,
  QueryObservation,
  QuerySpec,
  SourceEvent,
  WaitPremise,
} from './persisted-demand-coverage-model-oracle.js'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { SQLiteDriver } from '../src/index.js'

/**
 * # When may an on-demand query settle on rows from SQLite?
 *
 * Law (issue #2102 item 1,
 * `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the persisted-wrapper paragraph in
 * `packages/db/src/query/live/ARCHITECTURE.md`): an opted-in persisted
 * wrapper over an on-demand source may settle a demand's load from SQLite
 * when all three hold:
 *
 * 1. the persisted subset restore for the demand has published its rows in
 *    the current sync run, possibly none;
 * 2. the exact demand has persisted demand coverage in the current persisted
 *    cache generation, because an earlier load of the same demand key reached
 *    applied settlement with its rows durably committed;
 * 3. the configured wait has passed since that load started, or the load's
 *    upstream load has failed;
 * 4. the restore returned at least as many rows as SQLite held for the demand
 *    when the covered load settled (maintainer decision, 2026-10-26). A row
 *    deleted afterwards, by the source or by retention, ends coverage until
 *    the demand loads online again. An ordered window must hold the same
 *    rows it held then, in any order.
 *
 * Otherwise the load waits for its upstream load, as it does without
 * persistence. After a settlement from SQLite the upstream load keeps
 * running, and its rows publish when they apply; a later upstream failure
 * does not undo the settlement. Releasing the demand aborts its upstream
 * load. Coverage survives release: a later load of the same demand starts
 * its own wait and may settle from SQLite again.
 *
 * Sources combine for network-first initial rendering: a query may render
 * from local data when each source permits it. An eager source permits it
 * after its persisted restore; an on-demand source permits it after the
 * query's demands on it have settled.
 *
 * This file uses a generic on-demand source over the real persisted wrapper
 * and `SQLiteCorePersistenceAdapter` on `node:sqlite`. Each history has two
 * sessions over one database. Session 1 is online and creates coverage only
 * through real loads; nothing seeds coverage metadata. Session 2 controls
 * the upstream load and the clock.
 *
 * Coverage is bookkeeping: a coverage read that fails, or a release during
 * it, does not change the load's own outcome or lifetime (Part 2c).
 *
 * Two judgments live here. Part 1 is a bounded enumeration with its own trace
 * model, which predicts status, `preload()` state, and rows at five
 * checkpoints. Parts 2 to 4 are fixed histories judged by the model shared
 * with the generated campaign and every receiving driver,
 * `tests/persisted-demand-coverage-model-oracle.ts`. They record the
 * source's log and each query's loads and observation, and state no expected
 * answer (ORC-016). Two pinned checks whose laws other owners hold live in
 * `persisted-demand-coverage-supplemental.test.ts`.
 *
 * Limits: Electric, Query DB, React, and Solid have receiving witnesses in
 * their packages, not here. Resets are a source truncate, scoped recovery
 * (also followed by an online load in the same sync run), a schema reset, a
 * refetch, and cache-claim expiry; Electric's must-refetch is in its
 * witness, and snapshot transactions and aborted loads that resolve are in
 * the generated campaign. There is no coordinator other than the default
 * single-process one (multi-tab is out of scope, maintainer decision
 * 2026-10-26), and no native host. A failure before the persisted subset
 * restore publishes is not a legal history (Part 1). Every block is a
 * bounded enumeration or fixed history, not a generated campaign, so ORC-007
 * and ORC-015 do not apply here.
 */

// ===========================================================================
// Part 1: one demand, two sessions
// ===========================================================================

// ---------------------------------------------------------------------------
// History grammar
//
// Session 1 decides whether demand D (`group = 'a'`, no order or limit) has
// coverage and which rows SQLite holds for it:
//
// - `not-requested`: session 1 never asks for D.
// - `failed`: D's upstream load rejects, so it never reaches applied
//   settlement.
// - `overlapping-demand`: a different filter (`id = 'a1'`) settles. SQLite
//   holds `a1`, which matches D, but D has no coverage.
// - `other-window`: the same filter with `orderBy rank, limit 1` settles,
//   along with its tie-boundary load. SQLite holds `a1`. Neither demand key
//   is D's key, so D has no coverage.
// - `other-order`: the same filter with `orderBy rank` and no limit settles.
//   SQLite holds every row that matches D, but the ordered demand key is not
//   D's key, so D has no coverage. Exact keys are deliberately stricter than
//   row completeness.
// - `durable-write-failed`: D's upstream load answers with `a1` and `a2`,
//   but SQLite rejects the transaction that writes those rows. Neither the
//   rows nor coverage may become durable, so D has no coverage.
// - `settled-empty`: D settles with no rows. The empty answer is complete.
// - `settled`: D settles with `a1` and `a2`.
// - `truncated`: D settles with `a1` and `a2`, then the source truncates.
//   Coverage ends with the rows it described, so D has no coverage and
//   SQLite holds no rows. The truncate replays D; that load never answers.
// - `truncated-in-flight`: D's load writes `a1` and `a2`, the source
//   truncates, and only then does that load settle. The truncate made the
//   load obsolete (law 6 in `ARCHITECTURE.md`: an obsolete acquisition cannot
//   satisfy current demand), so its settlement records no coverage. SQLite
//   holds no rows, and the replayed load never answers.
// - `recovered-in-flight`: D's load writes `a1` and `a2`, the source starts
//   scoped recovery, which rotates the persisted cache generation, and only
//   then does that load settle. The obsolete load records no coverage in the
//   new generation, which holds no rows; the reacquired load never answers.
// - `settled-then-row-deleted`: D settles with `a1` and `a2`, then the
//   source deletes `a1`. SQLite holds `a2`, fewer rows than D had when it
//   settled, so D has no coverage.
// - `recovering-in-flight`: as `recovered-in-flight`, but the load settles
//   while scoped recovery is still pending. Recording coverage must not
//   change the outcome of a load whose rows applied: without the coverage
//   record, this history leaves the session-1 query ready, and the driver
//   checks that it does not enter `error`.
//
// Session 2 asks for D again with a configured wait of 0 ms or 1000 ms. Its
// upstream load follows one schedule:
//
// - `pending`: the network never answers (offline).
// - `fails-at-once`: the load rejects as soon as the wrapper forwards it, as
//   a fetch does when the device is offline, so it lands before the
//   `restored` checkpoint. Session 2's reads answer on a later macrotask, so
//   the rejection arrives while the wrapper still reads coverage. The wrapper
//   must observe it there: an unhandled rejection fails the run.
// - `fails-early`: the load rejects before the wait passes.
// - `answers-early`: the load answers before the wait passes.
// - `answers-late`: the load answers after the wait passes.
// - `answers-empty-late`: the load answers after the wait with no rows.
// - `fails-late`: the load rejects after the wait passes.
//
// With a 0 ms wait, "early" events still follow the restore checkpoint, so
// they arrive after the wait has passed.
//
// Ablation (ORC-004): each value is needed by a case below.
// `not-requested` and `failed` reject "any local read counts";
// `overlapping-demand` rejects "coverage per Collection" and "matching rows
// count"; `other-window` rejects "coverage keyed by filter only";
// `other-order` rejects "coverage ignores order";
// `durable-write-failed` rejects "coverage written before the rows commit";
// `settled-empty` rejects "nonempty rows count"; `truncated` rejects
// "coverage survives truncate"; `truncated-in-flight` and
// `recovered-in-flight` reject "any settled load records coverage", including
// a load that a reset made obsolete; `recovering-in-flight` rejects "a failed
// coverage record fails the load"; `settled-then-row-deleted` rejects
// "coverage ignores rows deleted after it settled";  `settled` carries every positive case. The 1000 ms wait rejects "wait ignored" and "half deadline".
// `fails-early` rejects "failure errors a covered demand"; `fails-at-once`
// rejects "a failure during the coverage check goes unobserved"; `answers-late`
// rejects "upstream aborted after SQLite"; `fails-late` rejects "late
// failure undoes a settlement"; `answers-empty-late` checks that an empty
// answer settles an uncovered demand and leaves a covered one unchanged;
// `answers-early` checks that the network wins before the deadline.
// Excluded: a session-2 event before the persisted subset restore publishes.
// The wrapper forwards a load upstream only after that restore is visible, so
// no upstream answer or failure can precede it. The driver checks this: the
// first session-2 load must see every restored row when it is forwarded.
// Also excluded, because it is not a
// legal history: a source truncate transaction kept open while a later load
// of D hydrates and records coverage. A truncate clears hydrated demand, so
// that load must hydrate, and the wrapper rejects a source transaction that
// crosses a hydration cycle (`InvalidPersistedCollectionConfigError`).
// ---------------------------------------------------------------------------

const COVERAGE_HISTORIES = [
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
type CoverageHistory = (typeof COVERAGE_HISTORIES)[number]

const UPSTREAM_SCHEDULES = [
  `pending`,
  `fails-at-once`,
  `fails-early`,
  `answers-early`,
  `answers-late`,
  `answers-empty-late`,
  `fails-late`,
] as const
type UpstreamSchedule = (typeof UPSTREAM_SCHEDULES)[number]

const WAITS = [0, 1000] as const
type Wait = (typeof WAITS)[number]

type Cell = {
  history: CoverageHistory
  waitMs: Wait
  upstream: UpstreamSchedule
}

const A1: Row = { id: `a1`, group: `a`, rank: 1, value: `v1` }
const A2: Row = { id: `a2`, group: `a`, rank: 2, value: `v1` }

const SESSION_1_ROWS: Record<CoverageHistory, ReadonlyArray<Row>> = {
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
const SESSION_2_ANSWER: ReadonlyArray<Row> = [
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

type Observation = {
  queryStatus: `loading` | `ready` | `error`
  preload: `pending` | `resolved` | `rejected`
  rows?: ReadonlyArray<string>
}

type Trace = {
  restored: Observation
  afterEarlyEvent: Observation
  beforeDeadline: Observation
  afterDeadline: Observation
  afterLateEvent: Observation
}

const CHECKPOINTS = [
  `restored`,
  `afterEarlyEvent`,
  `beforeDeadline`,
  `afterDeadline`,
  `afterLateEvent`,
] as const satisfies ReadonlyArray<keyof Trace>

function rowLabels(rows: Iterable<Row>): Array<string> {
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

type Design = {
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

const LAW: Design = {
  name: `persisted demand coverage`,
  isCovered: (history) => history === `settled` || history === `settled-empty`,
  honorsWait: true,
  deadlineFraction: 1,
  failureSettlesCovered: true,
  upstreamContinues: true,
  settlementSurvivesFailure: true,
  settlesBeforeRestore: false,
}

function expectedTrace(cell: Cell, design: Design = LAW): Trace {
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

function sameObservation(expected: Observation, actual: Observation): boolean {
  if (expected.queryStatus !== actual.queryStatus) return false
  if (expected.preload !== actual.preload) return false
  if (expected.rows === undefined) return true
  return (
    actual.rows !== undefined &&
    actual.rows.length === expected.rows.length &&
    expected.rows.every((row, index) => actual.rows![index] === row)
  )
}

function firstMismatch(
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

const ALL_CELLS: ReadonlyArray<Cell> = COVERAGE_HISTORIES.flatMap((history) =>
  WAITS.flatMap((waitMs) =>
    UPSTREAM_SCHEDULES.map((upstream) => ({ history, waitMs, upstream })),
  ),
)

function cellName(cell: Cell): string {
  return `${cell.history}, wait ${cell.waitMs} ms, upstream ${cell.upstream}`
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------
// The generic source, clock, and cleanup helpers live in
// `tests/helpers/demand-coverage-driver.ts`.

function session1Query(
  source: Collection<Row, string, any>,
  history: CoverageHistory,
) {
  if (history === `overlapping-demand`) {
    return createLiveQueryCollection((q) =>
      q.from({ row: source }).where(({ row }) => eq(row.id, `a1`)),
    )
  }
  if (history === `other-window`) {
    // A numeric order keeps the window expressible, so the wrapper sends a
    // limited load and a tie-boundary load instead of a full-source load.
    return createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.group, `a`))
        .orderBy(({ row }) => row.rank)
        .limit(1),
    )
  }
  if (history === `other-order`) {
    return createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.group, `a`))
        .orderBy(({ row }) => row.rank),
    )
  }
  return filterQuery(source, `a`)
}

// An adapter that rejects every committed transaction that writes rows.
// Transactions with only metadata pass, so an implementation that writes
// coverage separately from the rows makes coverage durable without them.
function rejectingRowWrites(adapter: SQLiteCorePersistenceAdapter) {
  const rejected = { count: 0 }
  const proxy = new Proxy(adapter, {
    get(target, property) {
      if (property === `applyCommittedTx`) {
        return (...args: Parameters<typeof target.applyCommittedTx>) => {
          if (args[1].mutations.length > 0) {
            rejected.count++
            return Promise.reject(new Error(`injected row-write failure`))
          }
          return target.applyCommittedTx(...args)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === `function` ? value.bind(target) : value
    },
  })
  return { adapter: proxy, rejected }
}

// Runs session 1 online and returns the demand keys it sent upstream.
async function settleSession1(
  driver: SQLiteDriver,
  history: CoverageHistory,
): Promise<Array<string | undefined>> {
  if (history === `not-requested`) return []
  const base = new SQLiteCorePersistenceAdapter({ driver })
  const writes =
    history === `durable-write-failed` ? rejectingRowWrites(base) : undefined
  const { collection, upstream } = onDemandSource(writes?.adapter ?? base, 0)
  const query = session1Query(collection, history)
  return withCleanup(async () => {
    const preloadState = { settled: false }
    const isSettled = () => preloadState.settled
    const preload = query.preload().finally(() => (preloadState.settled = true))
    // A failing history rejects before the loop below inspects the promise.
    void preload.catch(() => undefined)
    // Answer each upstream load in turn until preload settles; a window
    // sends its limited load and then its tie-boundary load.
    for (;;) {
      await vi.waitFor(() =>
        expect(isSettled() || upstream.pendingCount() > 0).toBe(true),
      )
      if (isSettled()) break
      if (history === `failed`) {
        upstream.fail(new Error(`session 1 upstream failed`))
      } else if (
        history === `truncated-in-flight` ||
        history === `recovered-in-flight`
      ) {
        const loadsBefore = upstream.calls.length
        await upstream.write([A1, A2])
        if (history === `truncated-in-flight`) await upstream.truncate()
        else await upstream.startScopedRecovery()
        // Positive witness: the reset reacquired D while its first load was
        // still pending.
        await vi.waitFor(() =>
          expect(upstream.calls.length).toBeGreaterThan(loadsBefore),
        )
        upstream.settleOldest()
        await new Promise((resolve) => setTimeout(resolve, 200))
        break
      } else if (history === `recovering-in-flight`) {
        await upstream.write([A1, A2])
        const recovery = upstream.startScopedRecovery()
        upstream.settleOldest()
        await recovery
        await new Promise((resolve) => setTimeout(resolve, 200))
        expect(query.status).not.toBe(`error`)
        break
      } else if (history === `durable-write-failed`) {
        await upstream.answer([A1, A2]).catch(() => undefined)
        // The load may reject or stay pending after a durable failure; the
        // law only needs the rows and coverage to stay out of SQLite.
        await Promise.race([
          preload.catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 200)),
        ])
        // Positive witness: SQLite really rejected the row write.
        expect(writes?.rejected.count).toBeGreaterThan(0)
        break
      } else {
        // This history deletes a1 only after D settles with both rows.
        await upstream.answer(
          history === `settled-then-row-deleted`
            ? [A1, A2]
            : SESSION_1_ROWS[history],
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (
      history === `settled-empty` ||
      history === `settled` ||
      history === `truncated` ||
      history === `settled-then-row-deleted`
    ) {
      await preload
    } else if (
      history !== `truncated-in-flight` &&
      history !== `recovered-in-flight` &&
      history !== `recovering-in-flight`
    ) {
      // The in-flight histories leave the reacquired load pending, so their
      // preload never settles.
      await preload.catch(() => undefined)
    }
    if (history === `settled-then-row-deleted`) {
      await upstream.remove([A1])
      // Positive witness: the delete reached the Collection.
      await vi.waitFor(() =>
        expect(collection.toArray.map((row) => row.id)).toEqual([`a2`]),
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (history === `truncated`) {
      const loadsBefore = upstream.calls.length
      await upstream.truncate()
      // Positive witness: the truncate replayed D, and that load stays
      // pending, so it cannot record coverage again.
      await vi.waitFor(() =>
        expect(upstream.calls.length).toBeGreaterThan(loadsBefore),
      )
      expect(upstream.pendingCount()).toBeGreaterThan(0)
    }
    return upstream.calls.map(getLoadSubsetDemandKey)
  }, [() => query.cleanup(), () => collection.cleanup()])
}

function observeQuery(
  query: Collection<any, any, any>,
  preload: () => Observation[`preload`],
): Observation {
  const status = query.status
  const queryStatus =
    status === `ready` || status === `error` ? status : `loading`
  return {
    queryStatus,
    preload: preload(),
    ...(queryStatus === `ready` ? { rows: rowLabels(query.toArray) } : {}),
  }
}

async function runCell(cell: Cell): Promise<Partial<Trace>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const session1Keys = await settleSession1(driver, cell.history)

  // Session 2. Configuration throws here on an implementation that rejects
  // network-first for on-demand sources; that is a setup failure, not a
  // checkpoint mismatch.
  useFakeClock()
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver: withMacrotaskReads(driver) }),
    cell.waitMs,
  )
  if (cell.upstream === `fails-at-once`) upstream.rejectAtOnce = true
  const query = filterQuery(collection, `a`)
  const preload = trackPreload(query)
  const observe = () => observeQuery(query, preload)
  const actual: Partial<Trace> = {}
  return withCleanup(async () => {
    await untilUpstreamCalled(upstream)
    // Positive witness: the session-1 history really did or did not send
    // D's exact demand key.
    const keyD = getLoadSubsetDemandKey(upstream.calls[0]!)
    expect(session1Keys.includes(keyD)).toBe(
      cell.history === `settled` ||
        cell.history === `settled-empty` ||
        cell.history === `truncated` ||
        cell.history === `truncated-in-flight` ||
        cell.history === `recovered-in-flight` ||
        cell.history === `recovering-in-flight` ||
        cell.history === `settled-then-row-deleted` ||
        cell.history === `failed` ||
        cell.history === `durable-write-failed`,
    )
    // The wrapper forwarded the load only after its restore was visible.
    expect(upstream.visibleAtCall[0]).toEqual(
      expect.arrayContaining(SESSION_1_ROWS[cell.history].map((row) => row.id)),
    )
    await drain()
    // Checkpoint witness: the persisted subset restore has published every
    // durable row that matches D. Missing rows mean the checkpoint was not
    // reached, not that the law was violated.
    const restoredIds = new Set(
      collection.toArray
        .filter((row) => row.group === `a`)
        .map((row) => row.id),
    )
    const missing = SESSION_1_ROWS[cell.history].filter(
      (row) => !restoredIds.has(row.id),
    )
    if (missing.length > 0) {
      throw new Error(
        `checkpoint not reached: restore had not published ${missing.map((row) => row.id).join(`, `)}`,
      )
    }
    actual.restored = observe()

    if (cell.upstream === `answers-early`) {
      await upstream.answer(SESSION_2_ANSWER)
    }
    if (cell.upstream === `fails-early`) upstream.fail(new Error(`offline`))
    await drain()
    actual.afterEarlyEvent = observe()

    if (cell.waitMs > 0) {
      await vi.advanceTimersByTimeAsync(cell.waitMs - 1)
      await drain()
    }
    actual.beforeDeadline = observe()

    await vi.advanceTimersByTimeAsync(cell.waitMs === 0 ? 0 : 1)
    await drain()
    actual.afterDeadline = observe()

    if (cell.upstream === `answers-late`) {
      await upstream.answer(SESSION_2_ANSWER)
    }
    if (cell.upstream === `answers-empty-late`) await upstream.answer([])
    if (cell.upstream === `fails-late`) upstream.fail(new Error(`offline`))
    await drain()
    actual.afterLateEvent = observe()
    return actual
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

// ===========================================================================
// Part 2: load lifecycle within one session
//
// Parts 2 to 4 are fixed histories. Each records what happened at the real
// wrapper (the source's log, each query's sent loads and observation, and the
// premises it injected) and passes that record to the shared judgment in
// `tests/persisted-demand-coverage-model-oracle.ts`. None states an expected
// answer (ORC-016); the model predicts each observation from the record.
//
// Two covered demands, D (`group = 'a'`) and E (`group = 'b'`), and an
// offline network in session 2 with a 1000 ms wait. Fixed history:
//
// - t = 0: query 1 starts D's load. This also starts the sync run.
// - t = 300: query 1 is cleaned up, releasing D. Its upstream load aborts.
// - t = 400: query 2 starts a new load of D.
// - t = 600: query 3 starts E's load.
//
// Each load measures its wait from its own start, so query 2 settles at 1400
// and query 3 at 1600, and release keeps coverage. Checkpoints sit 1 ms
// either side of 1000, 1400, and 1600, so a deadline measured from the sync
// run, carried over from the released load, or dropped with coverage on
// release changes an observation the judgment checks. Each query's rows are
// compared when it is ready, so a load cannot settle on rows from a sibling
// demand's restore.
// ===========================================================================

// The shared comparison. Every fixed history below is an input to it.
function judge(records: ReadonlyArray<CoverageRecord>): void {
  expect(records.length).toBeGreaterThan(0)
  for (const record of records) expect(coverageViolations(record)).toEqual([])
}

function observed(query: Collection<any, any, any>): QueryObservation {
  return query.status === `ready`
    ? {
        status: `ready`,
        rows: (query.toArray as Array<Row>).map((row) => row.id),
      }
    : { status: query.status === `error` ? `error` : `loading` }
}

// A load's wait has passed once this much time passed since its source
// received it; the wrapper starts the load before it forwards it.
function waitPassedAt(
  upstream: { arrivedAt: ReadonlyMap<LoadSubsetOptions, number> },
  waitMs: number,
  at = Date.now(),
): WaitPremise {
  return (load) => at - (upstream.arrivedAt.get(load) ?? Infinity) >= waitMs
}

const D: QuerySpec = { group: `a` }
const E: QuerySpec = { group: `b` }

// Marks the source's last settled load as one whose coverage read the
// history failed, a premise the driver injected.
function coverageReadFailed(events: Array<SourceEvent>): void {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.type === `settled`) {
      event.coverage = `read fails`
      return
    }
  }
  throw new Error(`no settled load to mark`)
}

const LIFECYCLE_CHECKPOINTS = [999, 1000, 1399, 1400, 1599, 1600] as const

async function runLifecycle(): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  let session1: ReadonlyArray<SourceEvent> = []
  {
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const { collection, upstream } = onDemandSource(adapter, 0)
    session1 = upstream.events
    const d = filterQuery(collection, `a`)
    const e = filterQuery(collection, `b`)
    await withCleanup(async () => {
      const loads = Promise.all([d.preload(), e.preload()])
      await vi.waitFor(() => expect(upstream.pendingCount()).toBe(2))
      await upstream.answer([
        A1,
        A2,
        { id: `b1`, group: `b`, rank: 1, value: `v1` },
      ])
      await loads
    }, [() => d.cleanup(), () => e.cleanup(), () => collection.cleanup()])
  }

  useFakeClock()
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    1000,
  )
  const query1 = filterQuery(collection, `a`)
  let query2: ReturnType<typeof filterQuery> | undefined
  let query3: ReturnType<typeof filterQuery> | undefined
  const records: Array<CoverageRecord> = []
  return withCleanup(async () => {
    let now = 0
    const advanceTo = async (t: number) => {
      await vi.advanceTimersByTimeAsync(t - now)
      now = t
      await drain()
    }
    void query1.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await advanceTo(300)
    await query1.cleanup()
    await drain()
    // Positive witness: the release aborted query 1's upstream load.
    expect(upstream.calls[0]!.signal?.aborted).toBe(true)
    await advanceTo(400)
    query2 = filterQuery(collection, `a`)
    void query2.preload()
    await untilUpstreamCalled(upstream, 2)
    await advanceTo(600)
    query3 = filterQuery(collection, `b`)
    void query3.preload()
    await untilUpstreamCalled(upstream, 3)
    for (const t of LIFECYCLE_CHECKPOINTS) {
      await advanceTo(t)
      records.push({
        events: [...session1, ...upstream.events],
        queries: {
          query2: {
            spec: D,
            sent: [upstream.calls[1]!],
            observed: observed(query2),
          },
          query3: {
            spec: E,
            sent: [upstream.calls[2]!],
            observed: observed(query3),
          },
        },
        upstream: `never answers`,
        waitPassed: waitPassedAt(upstream, 1000),
        // The offline source never calls `markReady()`.
        collection: { status: collection.status, sourceMarkedReady: false },
      })
    }
    return records
  }, [
    () => vi.useRealTimers(),
    () => query2?.cleanup(),
    () => query3?.cleanup(),
    () => collection.cleanup(),
  ])
}

// ===========================================================================
// Part 2b: resets and refetch within one session
//
// Session 1 covers D online. Then, in session 2:
//
// - Rotation: a load of D settles from SQLite, its query is released, and
//   the source starts scoped recovery, which ends the persisted cache
//   generation. A new load of D must wait for the network.
// - Refetch: a load of D with `refetch: true`, which never settles from
//   SQLite (`ARCHITECTURE.md`, "Demand grouping and ownership").
// - Schema reset: session 2 opens the database with another `schemaVersion`,
//   which deletes the rows and their metadata: a generation change.
// - Cache-claim expiry before the coverage record, and before the coverage
//   check. A read under an expired claim proves nothing, so the first load
//   records nothing yet settles as its upstream load did, and the second
//   load waits for the network. Both are premises the driver injects and
//   marks in the record.
//
// - Recovery reload: after scoped recovery, D loads online again and its
//   query is released; then D is asked for once more while the network is
//   silent. Scoped recovery leaves the rest of its sync run uncertified, and
//   its persisted subset restore publishes no rows, so the online load
//   records nothing and the last load must wait for the network.
//
// - Truncate inside the load: the source truncates synchronously inside its
//   own `loadSubset` call for D, then settles only that obsolete load. A
//   truncate came between the source receiving the load and settling it, so
//   the load records nothing, and session 2 waits.
//
// An empty covered demand isolates the generation check in the rotation
// history: no row count can end its coverage, so only the generation does.
// ===========================================================================

async function coverD(
  driver: SQLiteDriver,
  rows: ReadonlyArray<Row> = [A1, A2],
): Promise<{
  key: ReturnType<typeof getLoadSubsetDemandKey>
  events: Array<SourceEvent>
}> {
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    const preload = query.preload()
    await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
    await upstream.answer(rows)
    await preload
    return {
      key: getLoadSubsetDemandKey(upstream.calls[0]!),
      events: upstream.events,
    }
  }, [() => query.cleanup(), () => collection.cleanup()])
}

async function runSessionReset(
  kind: `rotation` | `refetch`,
  rows: ReadonlyArray<Row> = [A1, A2],
): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const session1 = await coverD(driver, rows)
  useFakeClock()
  const waitMs = kind === `rotation` ? 0 : 1000
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    waitMs,
  )
  const events = () => [...session1.events, ...upstream.events]
  const first = filterQuery(collection, `a`)
  let second: ReturnType<typeof filterQuery> | undefined
  let subscription: { unsubscribe: () => void } | undefined
  const records: Array<CoverageRecord> = []
  return withCleanup(async () => {
    void first.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(waitMs)
    await drain()
    records.push({
      events: events(),
      queries: {
        first: {
          spec: D,
          sent: [upstream.calls[0]!],
          observed: observed(first),
        },
      },
      upstream: `never answers`,
      waitPassed: waitPassedAt(upstream, waitMs),
    })
    const callsBefore = upstream.calls.length
    const later = { settled: false }
    if (kind === `rotation`) {
      await first.cleanup()
      await drain()
      await upstream.startScopedRecovery()
      await drain()
      second = filterQuery(collection, `a`)
      void second.preload().then(
        () => (later.settled = true),
        () => (later.settled = true),
      )
    } else {
      const changes = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription = changes
      ;(
        changes as unknown as {
          requestSnapshot: (options: object) => unknown
        }
      ).requestSnapshot({
        where: new IR.Func(`eq`, [
          new IR.PropRef([`group`]),
          new IR.Value(`a`),
        ]),
        refetch: true,
        onLoadSubsetResult: (result: true | Promise<void>) => {
          if (result === true) later.settled = true
          else
            void result.then(
              () => (later.settled = true),
              () => (later.settled = true),
            )
        },
      })
    }
    await vi.waitFor(() =>
      expect(upstream.calls.length).toBeGreaterThan(callsBefore),
    )
    if (kind === `refetch`) {
      // Positive witness: the refetch reached the source as D's demand.
      const refetchLoad = upstream.calls[upstream.calls.length - 1]!
      expect(refetchLoad.refetch).toBe(true)
      expect(getLoadSubsetDemandKey(refetchLoad)).toBe(session1.key)
    }
    await drain()
    await vi.advanceTimersByTimeAsync(waitMs + 1)
    await drain()
    records.push({
      events: events(),
      queries: {
        later: {
          spec: D,
          sent: upstream.calls.slice(callsBefore),
          observed: later.settled
            ? {
                status: `ready`,
                rows: collection.toArray
                  .filter((row) => row.group === `a`)
                  .map((row) => row.id),
              }
            : { status: `loading` },
        },
      },
      upstream: `never answers`,
      waitPassed: waitPassedAt(upstream, waitMs),
    })
    return records
  }, [
    () => vi.useRealTimers(),
    () => subscription?.unsubscribe(),
    () => first.cleanup(),
    () => second?.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runRecoveryReload(): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const session1 = await coverD(driver)
  useFakeClock()
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const queries: Array<ReturnType<typeof filterQuery>> = []
  const ask = async () => {
    const query = filterQuery(collection, `a`)
    queries.push(query)
    const calls = upstream.calls.length
    void query.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, calls + 1)
    await drain()
    return query
  }
  return withCleanup(async () => {
    // A first load of D starts the sync run, and so lets recovery start.
    const first = await ask()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    await first.cleanup()
    await drain()
    await upstream.startScopedRecovery()
    await drain()
    // The online load during scoped recovery.
    const online = await ask()
    await upstream.answer([A1, A2])
    await drain()
    // Positive witness: the online load settled.
    expect(online.status).toBe(`ready`)
    await online.cleanup()
    await drain()
    const callsBefore = upstream.calls.length
    const last = await ask()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    const record: CoverageRecord = {
      events: [...session1.events, ...upstream.events],
      queries: {
        last: {
          spec: D,
          sent: upstream.calls.slice(callsBefore),
          observed: observed(last),
        },
      },
      upstream: `never answers`,
      waitPassed: waitPassedAt(upstream, 0),
    }
    // Positive witness: the model saw D settle during scoped recovery.
    const reached = new Set<CoverageReach>()
    coverageViolations(record, (state) => reached.add(state))
    expect(reached.has(`covered during scoped recovery`)).toBe(true)
    return [record]
  }, [
    () => vi.useRealTimers(),
    ...[0, 1, 2].map((index) => () => queries[index]?.cleanup()),
    () => collection.cleanup(),
  ])
}

async function runTruncateInsideLoad(): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const session1: Array<SourceEvent> = []
  {
    const { collection, upstream } = onDemandSource(
      new SQLiteCorePersistenceAdapter({ driver }),
      0,
    )
    upstream.truncateInNextLoad = true
    const query = filterQuery(collection, `a`)
    await withCleanup(async () => {
      void query.preload().catch(() => undefined)
      await vi.waitFor(() => expect(upstream.pendingCount()).toBeGreaterThan(0))
      // Positive witness: the truncate ran inside the source's load call.
      expect(upstream.truncateInNextLoad).toBe(false)
      await upstream.write([A1, A2])
      upstream.settleOldest()
      await new Promise((resolve) => setTimeout(resolve, 200))
      session1.push(...upstream.events)
    }, [() => query.cleanup(), () => collection.cleanup()])
  }
  useFakeClock()
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    return [
      {
        events: [...session1, ...upstream.events],
        queries: {
          d: { spec: D, sent: [...upstream.calls], observed: observed(query) },
        },
        upstream: `never answers`,
        waitPassed: waitPassedAt(upstream, 0),
      },
    ]
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runSchemaReset(): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  // An empty covered demand: no row count can end its coverage, so only the
  // reset's removal of collection metadata does.
  const session1 = await coverD(driver, [])
  useFakeClock()
  // The SQLite adapter owns the schema version; a new one resets the rows.
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver, schemaVersion: 99 }),
    0,
  )
  const query = filterQuery(collection, `a`)
  void query.preload().catch(() => undefined)
  return withCleanup(async () => {
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    return [
      {
        // The new schema version is the premise: a generation change.
        events: [
          ...session1.events,
          { type: `generation ends` },
          ...upstream.events,
        ],
        queries: {
          d: { spec: D, sent: upstream.calls, observed: observed(query) },
        },
        upstream: `never answers`,
        waitPassed: waitPassedAt(upstream, 0),
      },
    ]
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runClaimExpiredBeforeRecord(): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const clock = { now: Date.now() }
  const adapter = new SQLiteCorePersistenceAdapter({
    driver,
    now: () => clock.now,
    cacheGenerationClaimTtlMs: 60_000,
  })
  const { collection, upstream } = onDemandSource(adapter, 0)
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
    await upstream.write([A1, A2])
    // The claim expires after the rows committed and before the load settles.
    clock.now += 10 * 60_000
    upstream.settleOldest()
    coverageReadFailed(upstream.events)
    await new Promise((resolve) => setTimeout(resolve, 300))
    return [
      {
        events: upstream.events,
        queries: {
          d: {
            spec: D,
            sent: upstream.calls.slice(0, 1),
            observed: observed(query),
          },
        },
        waitPassed: true,
      },
    ]
  }, [() => query.cleanup(), () => collection.cleanup()])
}

async function runClaimExpiredBeforeCheck(
  rows: ReadonlyArray<Row> = [A1, A2],
): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const session1 = await coverD(driver, rows)
  const clock = { now: Date.now() }
  const base = new SQLiteCorePersistenceAdapter({
    driver,
    now: () => clock.now,
    cacheGenerationClaimTtlMs: 60_000,
  })
  // The restore reads D under a live claim, and the wrapper forwards D's
  // load upstream only once that restore is visible. The claim expires just
  // before the next read of D, the coverage check. An empty covered demand
  // isolates the generation check: after claim recovery rotates the cache,
  // no row count can end the old record, so only its generation does.
  const holder: { upstream?: Upstream } = {}
  const reads = { afterRestore: 0 }
  const adapter = new Proxy(base, {
    get(target, property) {
      if (property === `loadSubset`) {
        return (...args: Parameters<typeof target.loadSubset>) => {
          if ((holder.upstream?.calls.length ?? 0) > 0) {
            if (++reads.afterRestore === 1) clock.now += 10 * 60_000
          }
          return target.loadSubset(...args)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === `function` ? value.bind(target) : value
    },
  })
  const { collection, upstream } = onDemandSource(adapter, 0)
  holder.upstream = upstream
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await vi.waitFor(() => expect(upstream.calls.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 300))
    // Positive witnesses: the coverage check read D after the claim expired,
    // and claim recovery, which rotates the cache, loaded D again.
    expect(reads.afterRestore).toBeGreaterThan(0)
    expect(upstream.calls.length).toBeGreaterThan(1)
    return [
      {
        events: [...session1.events, ...upstream.events],
        queries: {
          d: {
            spec: D,
            sent: upstream.calls,
            observed: observed(query),
            checkFails: true,
          },
        },
        upstream: `never answers`,
        waitPassed: true,
      },
    ]
  }, [() => query.cleanup(), () => collection.cleanup()])
}

// ===========================================================================
// Part 2c: coverage bookkeeping
//
// Coverage is bookkeeping beside a load, so it must not change the load's
// own outcome or lifetime (the law record's rules on applied loads):
//
// - A coverage read that fails after the load's rows applied records no
//   coverage. The load still settles as its upstream load did.
// - A coverage read that fails during the coverage check proves nothing, so
//   the load waits for its upstream load, as an uncovered load does.
// - A source that answers synchronously writes its rows before it returns.
//   Its coverage must count those rows, so a later deletion of one ends it.
//   The durable write lands a few macrotasks late, so a coverage read that
//   does not wait behind it would count too few rows.
// - An unordered demand that loses one row and gains another keeps its row
//   count, so it stays covered (maintainer decision, 2026-10-26).
// - A truncate during an empty load's coverage read leaves no coverage.
// - A coverage read or a cache-claim renewal that outlasts the wait lets D
//   settle as soon as it returns: the wait runs from the load's start.
//
// The release laws (a released load owns no wait and starts no upstream
// load) are swept over every step of a load in Part 3 of the campaign file.
// ===========================================================================

// An adapter whose reads the test can fail or hold. `next` applies to the
// first read after `armed()` returns true.
function controlledReads(
  adapter: SQLiteCorePersistenceAdapter,
  armed: () => boolean,
  next: `fail` | `hold`,
) {
  const reads = { failed: 0, held: 0, release: () => {} }
  let used = false
  const proxy = new Proxy(adapter, {
    get(target, property) {
      if (property === `loadSubset`) {
        return (...args: Parameters<typeof target.loadSubset>) => {
          if (used || !armed()) return target.loadSubset(...args)
          used = true
          if (next === `fail`) {
            reads.failed++
            return Promise.reject(new Error(`injected read failure`))
          }
          reads.held++
          return new Promise<void>((resolve) => {
            reads.release = resolve
          }).then(() => target.loadSubset(...args))
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === `function` ? value.bind(target) : value
    },
  })
  return { adapter: proxy, reads }
}

// Each durable write lands a few macrotasks late, as with a worker driver,
// so a coverage read that does not wait behind it would count too few rows.
function slowDurableWrites(adapter: SQLiteCorePersistenceAdapter) {
  return new Proxy(adapter, {
    get(target, property) {
      if (property === `applyCommittedTx`) {
        return async (...args: Parameters<typeof target.applyCommittedTx>) => {
          for (let i = 0; i < 3; i++) {
            await new Promise<void>((resolve) => setImmediate(resolve))
          }
          return target.applyCommittedTx(...args)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === `function` ? value.bind(target) : value
    },
  })
}

async function runCoverageReadFailsAfterLoad(): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const state = { armed: false }
  const { adapter, reads } = controlledReads(
    new SQLiteCorePersistenceAdapter({ driver }),
    () => state.armed,
    `fail`,
  )
  const { collection, upstream } = onDemandSource(adapter, 0)
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
    // The next read after the answer is the coverage read.
    state.armed = true
    await upstream.answer([A1, A2])
    coverageReadFailed(upstream.events)
    await new Promise((resolve) => setTimeout(resolve, 300))
    // Positive witness: the coverage read failed.
    expect(reads.failed).toBe(1)
    return [
      {
        events: upstream.events,
        queries: {
          d: { spec: D, sent: upstream.calls, observed: observed(query) },
        },
        waitPassed: true,
      },
    ]
  }, [() => query.cleanup(), () => collection.cleanup()])
}

async function runCoverageReadFailsDuringCheck(): Promise<
  Array<CoverageRecord>
> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const session1 = await coverD(driver)
  const holder: { collection?: Collection<Row, string, any> } = {}
  // The first read after the restore published D's rows is the check.
  const { adapter, reads } = controlledReads(
    new SQLiteCorePersistenceAdapter({ driver }),
    () => (holder.collection?.toArray.length ?? 0) > 0,
    `fail`,
  )
  const { collection, upstream } = onDemandSource(adapter, 0)
  holder.collection = collection
  const query = filterQuery(collection, `a`)
  const record = (): CoverageRecord => ({
    events: [...session1.events, ...upstream.events],
    queries: {
      d: {
        spec: D,
        sent: upstream.calls.slice(0, 1),
        observed: observed(query),
        checkFails: true,
      },
    },
    waitPassed: true,
  })
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 300))
    const beforeAnswer = record()
    await upstream.answer([A1, A2])
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Positive witness: the coverage check read failed.
    expect(reads.failed).toBe(1)
    return [beforeAnswer, record()]
  }, [() => query.cleanup(), () => collection.cleanup()])
}

// A source that answers D synchronously, then does nothing, deletes `a1`,
// or truncates at once, while the coverage read of that answer still waits
// behind the slow durable write. A synchronous answer's load has already
// settled, so core cannot abort it; only the reset check stops a coverage
// record of an empty answer that a truncate made obsolete.
async function runSynchronousAnswer(
  rows: ReadonlyArray<Row>,
  after: `nothing` | `delete` | `truncate`,
): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  // This source answers synchronously, so the driver records its log here.
  const session1: Array<SourceEvent> = []
  const records: Array<CoverageRecord> = []
  {
    const handles: {
      remove?: (row: Row) => void
      truncate?: () => void
    } = {}
    const sent: Array<LoadSubsetOptions> = []
    // Same ID as `onDemandSource`, so session 2 restores these rows.
    const collection = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `demand-coverage-source`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
        persistence: {
          adapter: slowDurableWrites(
            new SQLiteCorePersistenceAdapter({ driver }),
          ),
        },
        sync: {
          sync: ({ begin, write, commit, truncate }) => {
            handles.remove = (row) => {
              begin()
              write({ type: `delete`, value: row })
              commit()
              session1.push({ type: `delete`, id: row.id })
            }
            handles.truncate = () => {
              begin()
              truncate()
              commit()
              session1.push({ type: `truncate` })
            }
            return {
              loadSubset: (options: LoadSubsetOptions) => {
                sent.push(options)
                // After a truncate, core replays D; the source leaves that
                // load waiting, so only the reset check decides coverage.
                if (after === `truncate` && sent.length > 1) {
                  return new Promise<void>(() => {})
                }
                begin()
                for (const value of rows) write({ type: `insert`, value })
                commit()
                session1.push(
                  {
                    type: `rows`,
                    rows: rows.map(
                      (row) =>
                        [row.id, { group: row.group, rank: row.rank }] as const,
                    ),
                  },
                  { type: `settled`, load: options, current: true },
                )
                return true
              },
            }
          },
        },
      }),
    )
    const query = filterQuery(collection, `a`)
    await withCleanup(async () => {
      await query.preload()
      // Session 1's checkpoint precedes any truncate: a truncate replay keeps
      // an already ready query ready, which the model does not judge.
      const checkpoint = () =>
        records.push({
          events: [...session1],
          queries: {
            d: { spec: D, sent: [...sent], observed: observed(query) },
          },
          waitPassed: true,
        })
      if (after === `truncate`) {
        checkpoint()
        // The truncate lands while the answer's coverage read still waits.
        handles.truncate!()
        await new Promise((resolve) => setTimeout(resolve, 100))
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100))
        checkpoint()
      }
      if (after === `delete`) {
        handles.remove!(A1)
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }, [() => query.cleanup(), () => collection.cleanup()])
  }
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = filterQuery(collection, `a`)
  void query.preload().catch(() => undefined)
  return withCleanup(async () => {
    await vi.waitFor(() => expect(upstream.calls.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 300))
    records.push({
      events: [...session1, ...upstream.events],
      queries: {
        d: { spec: D, sent: upstream.calls, observed: observed(query) },
      },
      upstream: `never answers`,
      waitPassed: true,
    })
    return records
  }, [() => query.cleanup(), () => collection.cleanup()])
}

// Session 1 of D, followed by tail events from the source while D is still
// active, then an offline session 2 with a wait of 0. The judgment checks D
// at the end of session 1's answer and again offline.
async function runTailHistory(
  rows: ReadonlyArray<Row>,
  tail: (upstream: Upstream) => Promise<void>,
  options: { holdCoverageRead?: boolean } = {},
): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const records: Array<CoverageRecord> = []
  const state = { armed: false }
  const { adapter, reads } = controlledReads(
    new SQLiteCorePersistenceAdapter({ driver }),
    () => state.armed,
    `hold`,
  )
  let session1: ReadonlyArray<SourceEvent> = []
  {
    const { collection, upstream } = onDemandSource(
      options.holdCoverageRead
        ? adapter
        : new SQLiteCorePersistenceAdapter({ driver }),
      0,
    )
    session1 = upstream.events
    const query = filterQuery(collection, `a`)
    await withCleanup(async () => {
      void query.preload().catch(() => undefined)
      await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
      if (options.holdCoverageRead) {
        // The next read after the answer is the coverage read.
        state.armed = true
        await upstream.answer(rows)
        await vi.waitFor(() => expect(reads.held).toBe(1))
      } else {
        await upstream.answer(rows)
        await new Promise((resolve) => setTimeout(resolve, 50))
        records.push({
          events: [...upstream.events],
          queries: {
            d: {
              spec: D,
              sent: upstream.calls.slice(0, 1),
              observed: observed(query),
            },
          },
          waitPassed: true,
        })
      }
      await tail(upstream)
      if (options.holdCoverageRead) reads.release()
      await new Promise((resolve) => setTimeout(resolve, 100))
    }, [() => query.cleanup(), () => collection.cleanup()])
  }
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = filterQuery(collection, `a`)
  void query.preload().catch(() => undefined)
  return withCleanup(async () => {
    await vi.waitFor(() => expect(upstream.calls.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 300))
    records.push({
      events: [...session1, ...upstream.events],
      queries: {
        d: { spec: D, sent: upstream.calls, observed: observed(query) },
      },
      upstream: `never answers`,
      waitPassed: true,
    })
    return records
  }, [() => query.cleanup(), () => collection.cleanup()])
}

// An unordered demand that loses `a1` and gains `a3` while it is active.
const runUnorderedRowReplaced = () =>
  runTailHistory([A1, A2], async (upstream) => {
    await upstream.remove([A1])
    await upstream.write([{ id: `a3`, group: `a`, rank: 3, value: `v1` }])
  })

// A truncate while the coverage read of an empty load is in flight. The
// truncate commits behind the held read, so the history does not await it
// until the read is released.
const runTruncateDuringCoverageRead = () =>
  runTailHistory(
    [],
    async (upstream) => {
      void upstream.truncate()
      await Promise.resolve()
    },
    { holdCoverageRead: true },
  )

// A held step in session 2 (the coverage read, or the load's cache-claim
// renewal) that outlasts the 1000 ms wait. Once it returns, D must settle.
async function runHeldPastTheWait(
  held: `coverage read` | `claim renewal`,
): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const session1 = await coverD(driver)
  useFakeClock()
  const holder: { collection?: Collection<Row, string, any> } = {}
  const hold = { count: 0, release: () => {} }
  const reads = controlledReads(
    new SQLiteCorePersistenceAdapter({
      driver,
      // A claim that lasts 30 s is inside the 60 s renewal window from the
      // start, so the load renews it.
      ...(held === `claim renewal`
        ? { cacheGenerationClaimTtlMs: 30_000 }
        : {}),
    }),
    () =>
      held === `coverage read` && (holder.collection?.toArray.length ?? 0) > 0,
    `hold`,
  )
  // Startup renews the claim before any load; the load's own renewal is the
  // next one, so hold that.
  let renewalsSeen = 0
  const adapter = new Proxy(reads.adapter, {
    get(target, property) {
      if (
        held === `claim renewal` &&
        property === `renewCacheGenerationClaim`
      ) {
        return (
          ...args: Parameters<
            NonNullable<typeof target.renewCacheGenerationClaim>
          >
        ) => {
          if (++renewalsSeen !== 2)
            return target.renewCacheGenerationClaim(...args)
          hold.count++
          return new Promise<void>((resolve) => {
            hold.release = resolve
          }).then(() => target.renewCacheGenerationClaim(...args))
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === `function` ? value.bind(target) : value
    },
  })
  const { collection, upstream } = onDemandSource(adapter, 1000)
  holder.collection = collection
  const query = filterQuery(collection, `a`)
  void query.preload().catch(() => undefined)
  return withCleanup(async () => {
    const isHeld = () =>
      (held === `coverage read` ? reads.reads.held : hold.count) > 0
    for (let i = 0; i < 200 && !isHeld(); i++) await drain()
    // Positive witness: the load started and is held at the named step.
    expect(isHeld()).toBe(true)
    expect(collection.isLoadingSubset).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    if (held === `coverage read`) reads.reads.release()
    else hold.release()
    await drain()
    return [
      {
        events: [...session1.events, ...upstream.events],
        queries: {
          d: { spec: D, sent: upstream.calls, observed: observed(query) },
        },
        upstream: `never answers`,
        // The load started at t = 0, before the held step; the clock is now
        // past 1000 ms.
        waitPassed: true,
      },
    ]
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

// ===========================================================================
// Part 3: joined sources
//
// An eager source P restored from SQLite and an on-demand source C. Offline,
// P's Collection opens from its restored rows once its wait passes. The
// joined query is ready only when its demand on C has settled from SQLite,
// so the same joined query must have covered that demand in session 1.
//
// The shared judgment reads C's loads from session 2's record: the query is
// ready exactly when every one of them has settled, and it then shows P's
// rows joined with C's restored rows. The wrong design "an on-demand opt-in
// permits fallback on its own" makes the query ready without coverage; each
// never-requested history feeds that wrong observation to the judgment as a
// calibration.
//
// Session 2 also reads the joined query through an outer live query
// (`nested`), which must show the joined row when it is ready.
//
// A query can reach C through more than one live query. In `two-readers` the
// outer query reads the joined query and also joins C itself on another key,
// so it has two demands on C. The query is ready only when every demand it
// reaches on C has settled. The history `covered by the inner query only`
// covers just the joined query's demand, so the query must stay loading. It
// rejects the wrong design "the first live query reached on C stands for
// all of them".
//
// Source failures are not histories here. How a source error reaches a
// query's status is the source-health law, and its oracle owns that law
// (`packages/db/tests/source-health-oracle.test.ts`).
// ===========================================================================

type ChildHistory =
  | `covered by the same joined query`
  | `covered by the inner query only`
  | `never requested`
type JoinedShape = `flat` | `nested` | `two-readers`
// What the joined query reads: P's rows joined with C's rows on `parentId`.
const JOINED: QuerySpec = {
  join: { parents: `parents`, children: `children`, on: `parentId` },
  select: (parent, child) => ({
    id: parent.id,
    parentValue: parent.value,
    childValue: child.value,
  }),
}

type Parent = { id: string; value: string }
type Child = { id: string; parentId: string; value: string }

function eagerParents(adapter: SQLiteCorePersistenceAdapter, online: boolean) {
  // The source's own log, for the shared judgment.
  const events: Array<SourceEvent> = []
  const collection = createCollection(
    persistedCollectionOptions<Parent, string>({
      id: `demand-coverage-parents`,
      getKey: (row) => row.id,
      initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
      persistence: { adapter },
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          if (online) {
            begin()
            write({ type: `insert`, value: { id: `p1`, value: `parent` } })
            commit()
            events.push({
              type: `rows`,
              collection: `parents`,
              rows: [[`p1`, { value: `parent` }]],
            })
            markReady()
          }
          return {}
        },
      },
    }),
  )
  return { collection, events }
}

function onDemandChildren(
  adapter: SQLiteCorePersistenceAdapter,
  online: boolean,
) {
  const calls: Array<LoadSubsetOptions> = []
  // The source's own log, for the shared judgment, and when it received
  // each load.
  const events: Array<SourceEvent> = []
  const arrivedAt = new Map<LoadSubsetOptions, number>()
  const collection = createCollection(
    persistedCollectionOptions<Child, string>({
      id: `demand-coverage-children`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
      persistence: { adapter },
      sync: {
        sync: ({ begin, write, commit }) => {
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              calls.push(options)
              arrivedAt.set(options, Date.now())
              if (!online) return new Promise<void>(() => {})
              // The source may return more rows than requested.
              begin()
              write({
                type: `insert`,
                value: { id: `c1`, parentId: `p1`, value: `child` },
              })
              return Promise.resolve(commit()).then(() => {
                events.push(
                  {
                    type: `rows`,
                    collection: `children`,
                    rows: [[`c1`, { parentId: `p1`, value: `child` }]],
                  },
                  {
                    type: `settled`,
                    collection: `children`,
                    load: options,
                    current: true,
                  },
                )
              })
            },
          }
        },
      },
    }),
  )
  return { collection, calls, events, arrivedAt }
}

function shapedQuery(
  shape: JoinedShape,
  parents: Collection<Parent, string, any>,
  children: Collection<Child, string, any>,
) {
  const inner = joined(parents, children)
  if (shape === `flat`) return { inner, query: inner }
  const query =
    shape === `nested`
      ? createLiveQueryCollection((q) =>
          q.from({ row: inner }).select(({ row }) => ({
            id: row.id,
            parentValue: row.parentValue,
            childValue: row.childValue,
          })),
        )
      : // A second demand on C, keyed by value instead of parentId.
        createLiveQueryCollection((q) =>
          q
            .from({ row: inner })
            .join({ again: children }, ({ row, again }) =>
              eq(again.value, row.childValue),
            )
            .select(({ row }) => ({
              id: row.id,
              parentValue: row.parentValue,
              childValue: row.childValue,
            })),
        )
  return { inner, query }
}

function joined(
  parents: Collection<Parent, string, any>,
  children: Collection<Child, string, any>,
) {
  return createLiveQueryCollection((q) =>
    q
      .from({ parent: parents })
      .join({ child: children }, ({ parent, child }) =>
        eq(child.parentId, parent.id),
      )
      .select(({ parent, child }) => ({
        id: parent.id,
        parentValue: parent.value,
        childValue: child.value,
      })),
  )
}

async function runJoined(
  history: ChildHistory,
  shape: JoinedShape,
): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const session1: Array<SourceEvent> = []

  // Session 1 is online. Both Collections share one adapter, as an
  // application does. The children load only through the session-1 query.
  {
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const eagerOnline = eagerParents(adapter, true)
    const parents = eagerOnline.collection
    const children = onDemandChildren(adapter, true)
    const session1Query =
      history === `never requested`
        ? undefined
        : history === `covered by the inner query only`
          ? shapedQuery(`flat`, parents, children.collection)
          : shapedQuery(shape, parents, children.collection)
    await withCleanup(async () => {
      if (session1Query) await session1Query.query.preload()
      else await parents.preload()
      // Positive witness: session 1 sent each demand that the history
      // covers, and only those.
      const keys = new Set(children.calls.map(getLoadSubsetDemandKey))
      expect(keys.size).toBe(
        history === `never requested`
          ? 0
          : shape === `two-readers` &&
              history === `covered by the same joined query`
            ? 2
            : 1,
      )
      session1.push(...eagerOnline.events, ...children.events)
    }, [
      () => session1Query?.query.cleanup(),
      () => session1Query?.inner.cleanup(),
      () => children.collection.cleanup(),
      () => parents.cleanup(),
    ])
  }

  useFakeClock()
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  const parents = eagerParents(adapter, false).collection
  const children = onDemandChildren(adapter, false)
  const { inner, query } = shapedQuery(shape, parents, children.collection)

  const subscription = query.subscribeChanges(() => {})
  // Virtual row properties (`$key`, `$hasPendingWrites`, ...) are not part of the law.
  const visibleRows = () =>
    (query.toArray as Array<object>).map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => !key.startsWith(`$`)),
      ),
    )
  const observe = (): CoverageRecord => ({
    events: [...session1, ...children.events],
    queries: {
      joined: {
        spec: JOINED,
        sent: [...children.calls],
        observed:
          query.status === `ready`
            ? {
                status: `ready`,
                rows: visibleRows() as QueryObservation[`rows`],
              }
            : { status: query.status === `error` ? `error` : `loading` },
      },
    },
    upstream: `never answers`,
    waitPassed: waitPassedAt(children, 0),
    // The offline source never calls `markReady()`.
    collection: {
      status: children.collection.status,
      sourceMarkedReady: false,
    },
  })
  return withCleanup(async () => {
    for (let i = 0; i < 200 && children.calls.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    // Positive witness: session 2 reached the on-demand side's demand.
    expect(children.calls.length).toBeGreaterThan(0)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    const afterWait = observe()
    // A late checkpoint: nothing else is scheduled to change the outcome.
    await vi.advanceTimersByTimeAsync(10_000)
    await drain()
    return [afterWait, observe()]
  }, [
    () => vi.useRealTimers(),
    () => subscription.unsubscribe(),
    () => query.cleanup(),
    () => inner.cleanup(),
    () => children.collection.cleanup(),
    () => parents.cleanup(),
  ])
}

// ===========================================================================
// Part 4: ordered windows
//
// W is the window `group = 'a' orderBy rank limit 2`. An ordered window
// reaches the source as a limited load plus a tie-boundary load whose key is
// built from the restored boundary row, so both must be covered for W to
// settle from SQLite. The judgment reads both loads from session 2's record
// and judges each against its own demand's record: a limited load must hold
// the same rows (the window law, maintainer decision 2026-10-26); the
// unordered tie-boundary load must hold at least as many rows.
//
// Session 1 loads W online, and one tail event follows while W is active:
//
// - `unchanged`: nothing.
// - `row-deleted`: the source deletes `a1`.
// - `row-moved-out`: the source moves `a2` to rank 10.
// - `row-moved-in`: the source adds `a0` at rank 0.
// - `rows-swapped`: the source swaps the ranks of `a1` and `a2`.
// - `row-replaced`: the source deletes `a1` and adds `a15` at rank 1.5, so
//   W keeps its size and its boundary row `a2`.
// - `row-gained-under-limit`: session 1 has only `a1`, so W is not full.
//   The source then adds `a0` at rank 0, and `a1` stays the boundary row.
// - Ties at the boundary: session 1 has `a2` and `a2b` at rank 2, so W holds
//   one of them and its tie-boundary demand holds both. The source then
//   deletes the tie row outside W, deletes the one inside W, or adds `a2c` at
//   rank 2.
//
// The last two plain histories keep the boundary row, so the tie-boundary
// key does not change; they reject "a window counts only rows" by the row
// count alone. The tie histories reject "a window ignores its tie-boundary
// load" and "every demand must hold the keys it held".
//
// Two more histories move the window to its next page offline. Page 2 is
// covered only when session 1 loaded it too. Each runs with and without an
// index on `rank`. With one, core continues the window with a cursor from the
// restored boundary; without one, it reloads the longer prefix `limit 4`. The
// wrong designs "a demand key ignores offset and cursor" and "a demand key
// ignores its limit" would then settle a page that session 1 never loaded. A
// positive witness checks which load the move sent.
// ===========================================================================

const A0: Row = { id: `a0`, group: `a`, rank: 0, value: `v1` }
const A15: Row = { id: `a15`, group: `a`, rank: 1.5, value: `v1` }
const A2B: Row = { id: `a2b`, group: `a`, rank: 2, value: `v1` }
const A2C: Row = { id: `a2c`, group: `a`, rank: 2, value: `v1` }
const A3: Row = { id: `a3`, group: `a`, rank: 3, value: `v1` }
const A4: Row = { id: `a4`, group: `a`, rank: 4, value: `v1` }

const W: QuerySpec = { group: `a`, orderByRank: true, limit: 2 }

// Each history: the rows session 1 answers W with, and the tail event. A tie
// tail receives the rows W showed, to pick the tie row inside or outside it.
const WINDOW_HISTORIES = {
  unchanged: { rows: [A1, A2, A3], tail: async () => {} },
  'row-deleted': {
    rows: [A1, A2, A3],
    tail: (upstream: Upstream) => upstream.remove([A1]),
  },
  'row-moved-out': {
    rows: [A1, A2, A3],
    tail: (upstream: Upstream) => upstream.update([{ ...A2, rank: 10 }]),
  },
  'row-moved-in': {
    rows: [A1, A2, A3],
    tail: (upstream: Upstream) => upstream.write([A0]),
  },
  'rows-swapped': {
    rows: [A1, A2, A3],
    tail: (upstream: Upstream) =>
      upstream.update([
        { ...A1, rank: 2 },
        { ...A2, rank: 1 },
      ]),
  },
  'row-replaced': {
    rows: [A1, A2, A3],
    tail: async (upstream: Upstream) => {
      await upstream.remove([A1])
      await upstream.write([A15])
    },
  },
  'row-gained-under-limit': {
    rows: [A1],
    tail: (upstream: Upstream) => upstream.write([A0]),
  },
  'tie-unchanged': { rows: [A1, A2, A2B, A3], tail: async () => {} },
  'tie-row-outside-deleted': {
    rows: [A1, A2, A2B, A3],
    tail: (upstream: Upstream, shown: ReadonlyArray<string>) =>
      upstream.remove([A2, A2B].filter((row) => !shown.includes(row.id))),
  },
  'tie-row-inside-deleted': {
    rows: [A1, A2, A2B, A3],
    tail: (upstream: Upstream, shown: ReadonlyArray<string>) =>
      upstream.remove([A2, A2B].filter((row) => shown.includes(row.id))),
  },
  'tie-row-added': {
    rows: [A1, A2, A2B, A3],
    tail: (upstream: Upstream) => upstream.write([A2C]),
  },
} satisfies Record<
  string,
  {
    rows: ReadonlyArray<Row>
    tail: (upstream: Upstream, shown: ReadonlyArray<string>) => Promise<void>
  }
>
type WindowHistory = keyof typeof WINDOW_HISTORIES

function windowQuery(source: Collection<Row, string, any>) {
  return createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .where(({ row }) => eq(row.group, `a`))
      .orderBy(({ row }) => row.rank)
      .limit(2),
  )
}

// Session 1 answers each load with every row of group a until `done`
// settles; a source may return more rows than requested.
async function answerUntil(
  upstream: Upstream,
  rows: ReadonlyArray<Row>,
  done: Promise<unknown>,
) {
  const state = { settled: false }
  void Promise.resolve(done).then(
    () => (state.settled = true),
    () => (state.settled = true),
  )
  for (let i = 0; i < 100 && !state.settled; i++) {
    if (upstream.pendingCount() > 0) await upstream.answer(rows)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await done
}

async function runWindow(
  history: WindowHistory,
): Promise<Array<CoverageRecord>> {
  const { rows, tail } = WINDOW_HISTORIES[history]
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const records: Array<CoverageRecord> = []
  let session1: ReadonlyArray<SourceEvent> = []
  {
    const { collection, upstream } = onDemandSource(
      new SQLiteCorePersistenceAdapter({ driver }),
      0,
    )
    session1 = upstream.events
    const query = windowQuery(collection)
    await withCleanup(async () => {
      await answerUntil(upstream, rows, query.preload())
      records.push({
        events: [...upstream.events],
        queries: {
          w: { spec: W, sent: [...upstream.calls], observed: observed(query) },
        },
        waitPassed: true,
      })
      // Positive witness: when the window ends at a tie, W sent a
      // tie-boundary load.
      if (rows.includes(A2B)) {
        expect(upstream.calls.some((call) => call.limit === undefined)).toBe(
          true,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
      await tail(
        upstream,
        query.toArray.map((row) => row.id),
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
    }, [() => query.cleanup(), () => collection.cleanup()])
  }
  useFakeClock()
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = windowQuery(collection)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    records.push({
      events: [...session1, ...upstream.events],
      queries: {
        w: { spec: W, sent: upstream.calls, observed: observed(query) },
      },
      upstream: `never answers`,
      waitPassed: true,
    })
    return records
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runNextPage(
  session1LoadsPageTwo: boolean,
  indexed: boolean,
): Promise<Array<CoverageRecord>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const all = [A1, A2, A3, A4]
  const PAGE_TWO: QuerySpec = { ...W, offset: 2 }
  const records: Array<CoverageRecord> = []
  let session1: ReadonlyArray<SourceEvent> = []
  {
    const { collection, upstream } = onDemandSource(
      new SQLiteCorePersistenceAdapter({ driver }),
      0,
    )
    session1 = upstream.events
    if (indexed) {
      collection.createIndex((row) => row.rank, { indexType: BTreeIndex })
    }
    const query = windowQuery(collection)
    await withCleanup(async () => {
      await answerUntil(upstream, all, query.preload())
      if (session1LoadsPageTwo) {
        await answerUntil(
          upstream,
          all,
          Promise.resolve(query.utils.setWindow({ offset: 2, limit: 2 })),
        )
        records.push({
          events: [...upstream.events],
          queries: {
            w: {
              spec: PAGE_TWO,
              sent: [...upstream.calls],
              observed: observed(query),
            },
          },
          waitPassed: true,
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }, [() => query.cleanup(), () => collection.cleanup()])
  }
  useFakeClock()
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  if (indexed) {
    collection.createIndex((row) => row.rank, { indexType: BTreeIndex })
  }
  const query = windowQuery(collection)
  const events = () => [...session1, ...upstream.events]
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    records.push({
      events: events(),
      queries: {
        w: { spec: W, sent: [...upstream.calls], observed: observed(query) },
      },
      upstream: `never answers`,
      waitPassed: true,
    })
    const callsBefore = upstream.calls.length
    const moved = { settled: false }
    void Promise.resolve(query.utils.setWindow({ offset: 2, limit: 2 })).then(
      () => (moved.settled = true),
      () => (moved.settled = true),
    )
    await drain()
    // Positive witness: with an index, the move asked the source for page 2
    // with a cursor; without one, for the longer prefix `limit 4`.
    expect(
      upstream.calls
        .slice(callsBefore)
        .some((call) =>
          indexed
            ? call.cursor !== undefined
            : call.cursor === undefined && call.limit === 4,
        ),
    ).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    // The move's settlement is the observation for page 2.
    records.push({
      events: events(),
      queries: {
        w: {
          spec: PAGE_TWO,
          sent: [...upstream.calls],
          observed: moved.settled ? observed(query) : { status: `loading` },
        },
      },
      upstream: `never answers`,
      waitPassed: true,
    })
    return records
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

declareOracle({
  check: [coverageViolations, firstMismatch, sameObservation],
  model: [expectedTrace],
  grammar: [ALL_CELLS],
})

describe(`persisted demand coverage oracle`, () => {
  // -------------------------------------------------------------------------
  // Calibration: the comparison rejects wrong answers, and each block
  // distinguishes its law from plausible wrong designs at a named case
  // (ORC-006, ORC-013). These checks judge the models and comparisons;
  // production mutants run separately against an implementation.
  // -------------------------------------------------------------------------

  it(`rejects wrong observations at a checkpoint`, () => {
    const ready = {
      queryStatus: `ready`,
      preload: `resolved`,
      rows: [`a1:v1`, `a2:v1`],
    } as const
    expect(sameObservation(ready, ready)).toBe(true)
    expect(sameObservation(ready, { ...ready, rows: [`a1:v1`] })).toBe(false)
    expect(sameObservation(ready, { ...ready, rows: [`a2:v1`, `a1:v1`] })).toBe(
      false,
    )
    expect(sameObservation(ready, { ...ready, rows: [`a1:v1`, `a1:v1`] })).toBe(
      false,
    )
    expect(sameObservation(ready, { ...ready, preload: `pending` })).toBe(false)
    expect(
      sameObservation(ready, { queryStatus: `loading`, preload: `pending` }),
    ).toBe(false)
    expect(
      sameObservation(
        { queryStatus: `loading`, preload: `pending` },
        { queryStatus: `ready`, preload: `resolved`, rows: [] },
      ),
    ).toBe(false)
  })

  const wrongDesigns: ReadonlyArray<{ design: Design; witness: Cell }> = [
    {
      design: { ...LAW, name: `any local read counts`, isCovered: () => true },
      witness: { history: `not-requested`, waitMs: 0, upstream: `pending` },
    },
    {
      design: {
        ...LAW,
        name: `nonempty rows count`,
        isCovered: (history) => SESSION_1_ROWS[history].length > 0,
      },
      witness: { history: `settled-empty`, waitMs: 0, upstream: `pending` },
    },
    {
      // A Collection-wide flag set by any settled load, or rows that match D.
      design: {
        ...LAW,
        name: `coverage per Collection`,
        isCovered: (history) =>
          history !== `not-requested` && history !== `failed`,
      },
      witness: {
        history: `overlapping-demand`,
        waitMs: 0,
        upstream: `pending`,
      },
    },
    {
      design: {
        ...LAW,
        name: `coverage keyed by filter only`,
        isCovered: (history) =>
          LAW.isCovered(history) ||
          history === `other-window` ||
          history === `other-order`,
      },
      witness: { history: `other-window`, waitMs: 0, upstream: `pending` },
    },
    {
      // Honors limit but drops `orderBy` from the key.
      design: {
        ...LAW,
        name: `coverage ignores order`,
        isCovered: (history) =>
          LAW.isCovered(history) || history === `other-order`,
      },
      witness: { history: `other-order`, waitMs: 0, upstream: `pending` },
    },
    {
      design: {
        ...LAW,
        name: `coverage written before the rows commit`,
        isCovered: (history) =>
          LAW.isCovered(history) || history === `durable-write-failed`,
      },
      witness: {
        history: `durable-write-failed`,
        waitMs: 0,
        upstream: `pending`,
      },
    },
    {
      design: {
        ...LAW,
        name: `coverage survives truncate`,
        isCovered: (history) =>
          LAW.isCovered(history) || history === `truncated`,
      },
      witness: { history: `truncated`, waitMs: 0, upstream: `pending` },
    },
    {
      design: {
        ...LAW,
        name: `any settled load records coverage`,
        isCovered: (history) =>
          LAW.isCovered(history) ||
          history === `truncated-in-flight` ||
          history === `recovered-in-flight`,
      },
      witness: {
        history: `truncated-in-flight`,
        waitMs: 0,
        upstream: `pending`,
      },
    },
    {
      design: {
        ...LAW,
        name: `coverage ignores rows deleted after it settled`,
        isCovered: (history) =>
          LAW.isCovered(history) || history === `settled-then-row-deleted`,
      },
      witness: {
        history: `settled-then-row-deleted`,
        waitMs: 0,
        upstream: `pending`,
      },
    },
    {
      design: { ...LAW, name: `wait ignored`, honorsWait: false },
      witness: { history: `settled`, waitMs: 1000, upstream: `pending` },
    },
    {
      design: { ...LAW, name: `half deadline`, deadlineFraction: 0.5 },
      witness: { history: `settled`, waitMs: 1000, upstream: `pending` },
    },
    {
      design: {
        ...LAW,
        name: `failure errors a covered demand`,
        failureSettlesCovered: false,
      },
      witness: { history: `settled`, waitMs: 1000, upstream: `fails-early` },
    },
    {
      design: {
        ...LAW,
        name: `upstream aborted after SQLite`,
        upstreamContinues: false,
      },
      witness: { history: `settled`, waitMs: 0, upstream: `answers-late` },
    },
    {
      design: {
        ...LAW,
        name: `late failure undoes a settlement`,
        settlementSurvivesFailure: false,
      },
      witness: { history: `settled`, waitMs: 0, upstream: `fails-late` },
    },
    {
      design: {
        ...LAW,
        name: `settles before restore`,
        settlesBeforeRestore: true,
      },
      witness: { history: `settled`, waitMs: 0, upstream: `pending` },
    },
  ]

  it.each(wrongDesigns.map((entry) => [entry.design.name, entry] as const))(
    `distinguishes the law from the wrong design: %s`,
    (_name, { design, witness }) => {
      expect(ALL_CELLS).toContainEqual(witness)
      expect(
        firstMismatch(expectedTrace(witness), expectedTrace(witness, design)),
      ).toBeDefined()
    },
  )

  it(`enumerates every declared cell once`, () => {
    const names = ALL_CELLS.map(cellName)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(
      COVERAGE_HISTORIES.length * WAITS.length * UPSTREAM_SCHEDULES.length,
    )
  })

  // -------------------------------------------------------------------------
  // Refinement against production.
  // -------------------------------------------------------------------------

  it.each(ALL_CELLS.map((cell) => [cellName(cell), cell] as const))(
    `refines the model: %s`,
    async (_name, cell) => {
      quietConsole()
      const actual = await runCell(cell)
      expect(firstMismatch(expectedTrace(cell), actual)).toBeUndefined()
    },
  )

  // -------------------------------------------------------------------------
  // Parts 2 to 4: fixed histories judged by the shared model.
  // -------------------------------------------------------------------------

  it(`gives each load of a covered demand its own wait and keeps coverage across release`, async () => {
    quietConsole()
    const records = await runLifecycle()
    judge(records)
    // Checker calibration: a deadline measured from the sync run would show
    // query 2 ready at 1000 ms. The judgment must reject that observation.
    const at1000 = records[LIFECYCLE_CHECKPOINTS.indexOf(1000)]!
    const early = {
      ...at1000,
      queries: {
        ...at1000.queries,
        query2: {
          ...at1000.queries.query2!,
          observed: { status: `ready`, rows: [`a1`, `a2`] },
        },
      },
    } satisfies CoverageRecord
    expect(coverageViolations(early)).toHaveLength(1)
  })

  it.each([
    ...([`flat`, `nested`, `two-readers`] as const).flatMap(
      (shape: JoinedShape) =>
        ([`covered by the same joined query`, `never requested`] as const).map(
          (history: ChildHistory) => [history, shape] as const,
        ),
    ),
    // The inner-only history differs from full coverage only when the query
    // reaches C through two live queries.
    [`covered by the inner query only`, `two-readers`] as const,
  ])(
    `makes a joined query ready only when its on-demand demands settle: %s, %s`,
    async (history, shape) => {
      quietConsole()
      const records = await runJoined(history, shape)
      judge(records)
      // Checker calibration: an opt-in that permits fallback alone would
      // release a never-requested demand. The judgment must reject it.
      if (history === `never requested`) {
        const last = records[records.length - 1]!
        const released = {
          ...last,
          queries: {
            joined: {
              ...last.queries.joined!,
              observed: { status: `ready`, rows: [] },
            },
          },
        } satisfies CoverageRecord
        expect(coverageViolations(released)).toHaveLength(1)
      }
    },
  )

  it.each([
    [`a rotation`, () => runSessionReset(`rotation`)],
    [`a rotation of an empty demand`, () => runSessionReset(`rotation`, [])],
    [`a refetch`, () => runSessionReset(`refetch`)],
    [`a refetch of an empty demand`, () => runSessionReset(`refetch`, [])],
    [`a load after scoped recovery reloaded the demand`, runRecoveryReload],
    [`a truncate inside the source's load call`, runTruncateInsideLoad],
    [`a schema reset`, runSchemaReset],
    [
      `a cache claim that expires before the coverage record`,
      runClaimExpiredBeforeRecord,
    ],
    [
      `a cache claim that expires before the coverage check`,
      () => runClaimExpiredBeforeCheck(),
    ],
    [
      `a cache claim that expires before an empty demand's coverage check`,
      () => runClaimExpiredBeforeCheck([]),
    ],
  ] as const)(`judges a reset in the same session: %s`, async (_name, run) => {
    quietConsole()
    judge(await run())
  })

  it.each([
    [
      `a coverage read that fails after the load`,
      runCoverageReadFailsAfterLoad,
    ],
    [`a coverage check read that fails`, runCoverageReadFailsDuringCheck],
    [`a synchronous answer`, () => runSynchronousAnswer([A1, A2], `nothing`)],
    [
      `a synchronous answer, then a deletion`,
      () => runSynchronousAnswer([A1, A2], `delete`),
    ],
    [
      `an empty synchronous answer, then a truncate during its coverage read`,
      () => runSynchronousAnswer([], `truncate`),
    ],
    [
      `an unordered demand that loses a row and gains another`,
      runUnorderedRowReplaced,
    ],
    [
      `a truncate during an empty load's coverage read`,
      runTruncateDuringCoverageRead,
    ],
    [
      `a coverage read that outlasts the wait`,
      () => runHeldPastTheWait(`coverage read`),
    ],
    [
      `a cache-claim renewal that outlasts the wait`,
      () => runHeldPastTheWait(`claim renewal`),
    ],
  ] as const)(`judges coverage bookkeeping: %s`, async (_name, run) => {
    quietConsole()
    judge(await run())
  })

  it.each(Object.keys(WINDOW_HISTORIES) as Array<WindowHistory>)(
    `settles an ordered window from SQLite only while its demands are covered: %s`,
    async (history) => {
      quietConsole()
      judge(await runWindow(history))
    },
  )

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ] as const)(
    `moves a window offline to a page only when that page is covered (session 1 loaded page 2: %s, indexed: %s)`,
    async (session1LoadsPageTwo, indexed) => {
      quietConsole()
      judge(await runNextPage(session1LoadsPageTwo, indexed))
    },
  )
})
