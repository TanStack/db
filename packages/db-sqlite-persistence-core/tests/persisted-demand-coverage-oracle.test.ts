import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BTreeIndex,
  IR,
  createCollection,
  createLiveQueryCollection,
  createLiveQueryObserver,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../src/index.js'
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
import type { Row, Upstream } from './helpers/demand-coverage-driver.js'
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
 * Limits: Electric, Query DB, React, and Solid have receiving witnesses in
 * their packages, not here. Resets are a source truncate, scoped recovery,
 * a schema reset, a refetch, and cache-claim expiry; Electric's must-refetch
 * is in its witness. There is no coordinator other than the default
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
// Two covered demands, D (`group = 'a'`) and E (`group = 'b'`), and an
// offline network in session 2 with a 1000 ms wait. Fixed history:
//
// - t = 0: query 1 starts D's load. This also starts the sync run.
// - t = 300: query 1 is cleaned up, releasing D. Its upstream load aborts.
// - t = 400: query 2 starts a new load of D.
// - t = 600: query 3 starts E's load.
//
// Model: each load settles from SQLite at its own start plus the wait, so
// query 2 at 1400 and query 3 at 1600. Release keeps coverage. Checkpoints
// sit 1 ms either side of 1000, 1400, and 1600 to reject a deadline measured
// from the sync run, carried over from the released load, or dropped with
// coverage on release. Each query's rows are compared when it is ready, so a
// load cannot settle on rows from a sibling demand's restore.
//
// Ablation: removing the release removes the "release clears coverage" and
// "deadline carried over" distinctions; removing query 3 removes the second
// independent deadline; removing the 1 ms offsets lets a displaced deadline
// pass.
// ===========================================================================

type LifecycleDesign = {
  name: string
  deadlineFrom: `load` | `sync-run`
  releaseKeepsCoverage: boolean
}

const LIFECYCLE_LAW: LifecycleDesign = {
  name: `persisted demand coverage`,
  deadlineFrom: `load`,
  releaseKeepsCoverage: true,
}

const LIFECYCLE_CHECKPOINTS = [999, 1000, 1399, 1400, 1599, 1600] as const

type LifecycleObservation = {
  query2: ReadonlyArray<string> | `loading`
  query3: ReadonlyArray<string> | `loading`
}

const QUERY2_ROWS = rowLabels([A1, A2])
const QUERY3_ROWS = [`b1:v1`]

function expectedLifecycle(
  design: LifecycleDesign = LIFECYCLE_LAW,
): Record<number, LifecycleObservation> {
  const waitMs = 1000
  const readyAt = (startAt: number, releasedEarlier: boolean) => {
    if (releasedEarlier && !design.releaseKeepsCoverage) return Infinity
    return (design.deadlineFrom === `load` ? startAt : 0) + waitMs
  }
  const query2At = readyAt(400, true)
  const query3At = readyAt(600, false)
  return Object.fromEntries(
    LIFECYCLE_CHECKPOINTS.map((t) => [
      t,
      {
        query2: t >= query2At ? QUERY2_ROWS : `loading`,
        query3: t >= query3At ? QUERY3_ROWS : `loading`,
      },
    ]),
  )
}

async function runLifecycle(): Promise<{
  query1Aborted: boolean | undefined
  observations: Record<number, LifecycleObservation>
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  {
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const { collection, upstream } = onDemandSource(adapter, 0)
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
  const observations: Record<number, LifecycleObservation> = {}
  let query1Aborted: boolean | undefined
  return withCleanup(async () => {
    let now = 0
    const advanceTo = async (t: number) => {
      await vi.advanceTimersByTimeAsync(t - now)
      now = t
      await drain()
    }
    const record = () => {
      const rowsWhenReady = (query: typeof query2) =>
        query?.status === `ready`
          ? rowLabels(query.toArray as Array<Row>)
          : (`loading` as const)
      observations[now] = {
        query2: rowsWhenReady(query2),
        query3: rowsWhenReady(query3),
      }
    }
    void query1.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await advanceTo(300)
    await query1.cleanup()
    await drain()
    query1Aborted = upstream.calls[0]!.signal?.aborted
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
      record()
    }
    return { query1Aborted, observations }
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
// Two fixed histories, both offline in session 2 after session 1 covered D.
//
// - Rotation: a load of D settles from SQLite, its query is released, and
//   the source starts scoped recovery, which rotates the persisted cache
//   generation. Coverage belongs to one generation (the law record's
//   "Invalidation" section), and the new generation holds no rows, so a new
//   load of D waits for the network: it is still loading after the wait.
// - Refetch: a load of D with `refetch: true`. A refetch starts a new
//   acquisition whose promise waits for its own applied rows
//   (`ARCHITECTURE.md`, "Demand grouping and ownership"), so coverage cannot
//   settle it: it is still pending after the wait. A positive witness checks
//   that the refetch load reached the source with D's demand key.
//
// The wrong designs "coverage outlives a rotation in the same sync run" and
// "a refetch settles on coverage" make each history settle instead.
//
// Two more histories cover a schema reset and an optimistic write:
//
// - Schema reset: session 2 opens the same database with an adapter whose
//   `schemaVersion` differs. The reset deletes the rows and their collection
//   metadata, so D has no coverage and waits for the network.
// - Optimistic write: offline, D settles from SQLite, then the app inserts a
//   row of D whose mutation handler rejects. The row shows while the handler
//   runs and leaves when it rejects (optimistic overlay rules), and the query
//   stays ready throughout. Coverage never undoes or replaces optimistic
//   state.
//
// A claim history covers cache-claim expiry. Session 1's load writes its
// rows, then the adapter clock passes the cache claim's lifetime, and only
// then does the load settle. Recording coverage reads SQLite under that
// expired claim. Rows that applied cannot turn into a failed load, so the
// query must not enter `error`, and the wrapper must recover the claim. In
// a second claim history, session 2's claim expires after its restore read
// and before its coverage check. An expired claim cannot vouch for the
// restored rows, so D waits for the network instead of settling or failing.
//
// A further history checks that opting in keeps a synchronous answer
// synchronous. The source writes its rows and returns `true`. A second request
// for D, while D is already hydrated in this sync run, must report `true` to
// core, as it did before the opt-in existed, rather than a promise that waits
// for a coverage record.
// ===========================================================================

type SessionResetObservation = {
  firstLoadReady: boolean
  laterLoadSettled: boolean
}

const SESSION_RESET_LAW: SessionResetObservation = {
  firstLoadReady: true,
  laterLoadSettled: false,
}

async function coverD(
  driver: SQLiteDriver,
  rows: ReadonlyArray<Row> = [A1, A2],
): Promise<ReturnType<typeof getLoadSubsetDemandKey>> {
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
    return getLoadSubsetDemandKey(upstream.calls[0]!)
  }, [() => query.cleanup(), () => collection.cleanup()])
}

// An empty covered demand isolates the generation check: no row count can
// end its coverage after a rotation, so only the generation does.
async function runSessionReset(
  kind: `rotation` | `refetch`,
  rows: ReadonlyArray<Row> = [A1, A2],
): Promise<SessionResetObservation> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const keyD = await coverD(driver, rows)
  useFakeClock()
  const waitMs = kind === `rotation` ? 0 : 1000
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    waitMs,
  )
  const first = filterQuery(collection, `a`)
  let second: ReturnType<typeof filterQuery> | undefined
  let subscription: { unsubscribe: () => void } | undefined
  return withCleanup(async () => {
    void first.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(waitMs)
    await drain()
    const firstLoadReady = first.status === `ready`
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
      const callsBefore = upstream.calls.length
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
      await vi.waitFor(() =>
        expect(upstream.calls.length).toBeGreaterThan(callsBefore),
      )
      // Positive witness: the refetch reached the source as D's demand.
      const refetchLoad = upstream.calls[upstream.calls.length - 1]!
      expect(refetchLoad.refetch).toBe(true)
      expect(getLoadSubsetDemandKey(refetchLoad)).toBe(keyD)
    }
    await drain()
    await vi.advanceTimersByTimeAsync(waitMs + 1)
    await drain()
    return { firstLoadReady, laterLoadSettled: later.settled }
  }, [
    () => vi.useRealTimers(),
    () => subscription?.unsubscribe(),
    () => first.cleanup(),
    () => second?.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runSchemaReset(): Promise<{ settledAfterWait: boolean }> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  // An empty covered demand: no row count can end its coverage, so only the
  // reset's removal of collection metadata does.
  await coverD(driver, [])
  useFakeClock()
  // The SQLite adapter owns the schema version; a new one resets the rows.
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver, schemaVersion: 99 }),
    0,
  )
  const query = filterQuery(collection, `a`)
  const state = trackPreload(query)
  return withCleanup(async () => {
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    return { settledAfterWait: state() !== `pending` }
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

type OptimisticObservation = {
  settledBeforeWrite: Array<string>
  duringWrite: Array<string>
  afterRollback: Array<string>
  readyThroughout: boolean
}

async function runOptimisticWrite(): Promise<OptimisticObservation> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  await coverD(driver)
  useFakeClock()
  let rejectWrite!: (error: unknown) => void
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
    {
      onInsert: () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject
        }),
    },
  )
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    const ids = () => query.toArray.map((row) => row.id).sort()
    let readyThroughout = query.status === `ready`
    const settledBeforeWrite = ids()
    const transaction = collection.insert({
      id: `a9`,
      group: `a`,
      rank: 9,
      value: `local`,
    })
    void transaction.isPersisted.promise.catch(() => undefined)
    await drain()
    readyThroughout &&= query.status === `ready`
    const duringWrite = ids()
    rejectWrite(new Error(`offline write`))
    await drain()
    readyThroughout &&= query.status === `ready`
    return {
      settledBeforeWrite,
      duringWrite,
      afterRollback: ids(),
      readyThroughout,
    }
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runClaimExpiredBeforeRecord(): Promise<{
  queryStatus: string
  rows: Array<string>
}> {
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
    await new Promise((resolve) => setTimeout(resolve, 300))
    return {
      queryStatus: query.status,
      rows: query.toArray.map((row) => row.id).sort(),
    }
  }, [() => query.cleanup(), () => collection.cleanup()])
}

async function runClaimExpiredBeforeCheck(): Promise<{
  status: string
  reacquired: boolean
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  await coverD(driver)
  const clock = { now: Date.now() }
  const base = new SQLiteCorePersistenceAdapter({
    driver,
    now: () => clock.now,
    cacheGenerationClaimTtlMs: 60_000,
  })
  // The restore publishes D's rows under a live claim. The claim expires
  // just before the first read of D after that, the coverage check.
  const holder: { collection?: Collection<Row, string, any> } = {}
  const reads = { afterRestore: 0 }
  const adapter = new Proxy(base, {
    get(target, property) {
      if (property === `loadSubset`) {
        return (...args: Parameters<typeof target.loadSubset>) => {
          if ((holder.collection?.toArray.length ?? 0) > 0) {
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
  holder.collection = collection
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    // Claim recovery may rotate the cache and reacquire D, a second load.
    await vi.waitFor(() => expect(upstream.calls.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 300))
    // Positive witness: the coverage check read D after the claim expired.
    expect(reads.afterRestore).toBeGreaterThan(0)
    // Claim recovery rotates the cache, so D loads again.
    return { status: query.status, reacquired: upstream.calls.length > 1 }
  }, [() => query.cleanup(), () => collection.cleanup()])
}

async function runSynchronousAnswer(): Promise<{
  sourceCalls: number
  secondResult: `true` | `promise` | `none`
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  let sourceCalls = 0
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `demand-coverage-synchronous`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
      persistence: { adapter: new SQLiteCorePersistenceAdapter({ driver }) },
      sync: {
        sync: ({ begin, write, commit }) => ({
          loadSubset: () => {
            sourceCalls++
            begin()
            for (const value of [A1, A2]) write({ type: `insert`, value })
            commit()
            return true
          },
        }),
      },
    }),
  )
  const first = filterQuery(collection, `a`)
  let subscription: { unsubscribe: () => void } | undefined
  return withCleanup(async () => {
    await first.preload()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const callsBefore = sourceCalls
    const second = { result: `none` as `true` | `promise` | `none` }
    const changes = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription = changes
    ;(
      changes as unknown as { requestSnapshot: (options: object) => unknown }
    ).requestSnapshot({
      where: new IR.Func(`eq`, [new IR.PropRef([`group`]), new IR.Value(`a`)]),
      onLoadSubsetResult: (result: true | Promise<void>) => {
        second.result = result === true ? `true` : `promise`
      },
    })
    return {
      sourceCalls: sourceCalls - callsBefore,
      secondResult: second.result,
    }
  }, [
    () => subscription?.unsubscribe(),
    () => first.cleanup(),
    () => collection.cleanup(),
  ])
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
//   The coverage record must count those rows, so a later deletion of one of
//   them ends coverage. The wrong design "count before the rows are durable"
//   records too few rows, and the demand then settles from SQLite after the
//   deletion.
// - A load released during the coverage check owns no wait: the source
//   Collection stops loading at release, not when the wait would have ended.
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

async function runCoverageReadFailsAfterLoad(): Promise<{
  status: string
  rows: Array<string>
  failedReads: number
}> {
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
    await new Promise((resolve) => setTimeout(resolve, 300))
    return {
      status: query.status,
      rows: query.toArray.map((row) => row.id).sort(),
      failedReads: reads.failed,
    }
  }, [() => query.cleanup(), () => collection.cleanup()])
}

async function runCoverageReadFailsDuringCheck(): Promise<{
  beforeAnswer: string
  afterAnswer: string
  failedReads: number
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  await coverD(driver)
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
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 300))
    const beforeAnswer = query.status
    await upstream.answer([A1, A2])
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      beforeAnswer,
      afterAnswer: query.status,
      failedReads: reads.failed,
    }
  }, [() => query.cleanup(), () => collection.cleanup()])
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

async function runSynchronousAnswerThenDelete(
  deleteAfterwards: boolean,
): Promise<{ settledOffline: boolean }> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  {
    const handles: { remove?: (row: Row) => void } = {}
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
          sync: ({ begin, write, commit }) => {
            handles.remove = (row) => {
              begin()
              write({ type: `delete`, value: row })
              commit()
            }
            return {
              loadSubset: () => {
                begin()
                for (const value of [A1, A2]) write({ type: `insert`, value })
                commit()
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
      await new Promise((resolve) => setTimeout(resolve, 100))
      // Positive witness: the synchronous answer applied both rows.
      expect(query.toArray.map((row) => row.id).sort()).toEqual([`a1`, `a2`])
      if (deleteAfterwards) {
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
  const state = trackPreload(query)
  return withCleanup(async () => {
    await vi.waitFor(() => expect(upstream.calls.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { settledOffline: state() === `resolved` }
  }, [() => query.cleanup(), () => collection.cleanup()])
}

// An unordered demand keeps its row count when the source deletes one of
// its rows and adds another, so it stays covered (maintainer decision,
// 2026-10-26: unordered demands keep the row-count rule). This rejects the
// wrong design "every demand must hold the keys it held", which the window
// law needs and unordered demands do not.
async function runUnorderedRowReplaced(): Promise<{
  settledOffline: boolean
  rows?: Array<string>
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  {
    const { collection, upstream } = onDemandSource(
      new SQLiteCorePersistenceAdapter({ driver }),
      0,
    )
    const query = filterQuery(collection, `a`)
    await withCleanup(async () => {
      const preload = query.preload()
      await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
      await upstream.answer([A1, A2])
      await preload
      await upstream.remove([A1])
      await upstream.write([{ id: `a3`, group: `a`, rank: 3, value: `v1` }])
      await new Promise((resolve) => setTimeout(resolve, 50))
      // Positive witness: D lost a1 and gained a3 while it was active.
      expect(query.toArray.map((row) => row.id).sort()).toEqual([`a2`, `a3`])
    }, [() => query.cleanup(), () => collection.cleanup()])
  }
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = filterQuery(collection, `a`)
  const state = trackPreload(query)
  return withCleanup(async () => {
    await vi.waitFor(() => expect(upstream.calls.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 300))
    return state() === `resolved`
      ? {
          settledOffline: true,
          rows: query.toArray.map((row) => row.id).sort(),
        }
      : { settledOffline: false }
  }, [() => query.cleanup(), () => collection.cleanup()])
}

// A truncate while the coverage read of an empty load is in flight. The
// load is obsolete when its record would be written, so it records nothing,
// and an offline load of D waits. Only an empty demand shows a late record:
// for one with rows, the truncate leaves fewer rows than it would record.
async function runTruncateDuringCoverageRead(): Promise<{
  settledOffline: boolean
  heldReads: number
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const state = { armed: false }
  const { adapter, reads } = controlledReads(
    new SQLiteCorePersistenceAdapter({ driver }),
    () => state.armed,
    `hold`,
  )
  {
    const { collection, upstream } = onDemandSource(adapter, 0)
    const query = filterQuery(collection, `a`)
    await withCleanup(async () => {
      void query.preload().catch(() => undefined)
      await vi.waitFor(() => expect(upstream.pendingCount()).toBe(1))
      // The next read after the answer is the coverage read.
      state.armed = true
      await upstream.answer([])
      await vi.waitFor(() => expect(reads.held).toBe(1))
      // The truncate commits behind the held read, so do not await it yet.
      const truncated = upstream.truncate()
      reads.release()
      await truncated
      await new Promise((resolve) => setTimeout(resolve, 100))
    }, [() => query.cleanup(), () => collection.cleanup()])
  }
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = filterQuery(collection, `a`)
  const preload = trackPreload(query)
  return withCleanup(async () => {
    await vi.waitFor(() => expect(upstream.calls.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { settledOffline: preload() === `resolved`, heldReads: reads.held }
  }, [() => query.cleanup(), () => collection.cleanup()])
}

// The wait runs from the load's start, not from the end of the coverage
// check. A coverage read that outlasts the wait therefore settles D as soon
// as it returns.
async function runCoverageReadOutlastsWait(): Promise<{
  settledWhenReadReturns: boolean
  heldReads: number
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  await coverD(driver)
  useFakeClock()
  const holder: { collection?: Collection<Row, string, any> } = {}
  const { adapter, reads } = controlledReads(
    new SQLiteCorePersistenceAdapter({ driver }),
    () => (holder.collection?.toArray.length ?? 0) > 0,
    `hold`,
  )
  const { collection, upstream } = onDemandSource(adapter, 1000)
  holder.collection = collection
  const query = filterQuery(collection, `a`)
  const preload = trackPreload(query)
  return withCleanup(async () => {
    await untilUpstreamCalled(upstream, 1)
    for (let i = 0; i < 200 && reads.held === 0; i++) await drain()
    await vi.advanceTimersByTimeAsync(1000)
    reads.release()
    await drain()
    return {
      settledWhenReadReturns: preload() === `resolved`,
      heldReads: reads.held,
    }
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

// The wait also runs from before the load's cache-claim renewal. A renewal
// held past the wait lets D settle as soon as the coverage check passes.
async function runClaimRenewalOutlastsWait(): Promise<{
  settledAfterRenewal: boolean
  heldRenewals: number
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  await coverD(driver)
  useFakeClock()
  // A claim that lasts 30 s is inside the 60 s renewal window from the
  // start, so the first load renews it.
  const base = new SQLiteCorePersistenceAdapter({
    driver,
    cacheGenerationClaimTtlMs: 30_000,
  })
  // Startup renews the claim before any load; the load's own renewal is
  // the next one, so hold that.
  const renewals = { seen: 0, held: 0, release: () => {} }
  const adapter = new Proxy(base, {
    get(target, property) {
      if (property === `renewCacheGenerationClaim`) {
        return (
          ...args: Parameters<
            NonNullable<typeof target.renewCacheGenerationClaim>
          >
        ) => {
          if (++renewals.seen !== 2) {
            return target.renewCacheGenerationClaim(...args)
          }
          renewals.held++
          return new Promise<void>((resolve) => {
            renewals.release = resolve
          }).then(() => target.renewCacheGenerationClaim(...args))
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === `function` ? value.bind(target) : value
    },
  })
  const { collection, upstream } = onDemandSource(adapter, 1000)
  const query = filterQuery(collection, `a`)
  const preload = trackPreload(query)
  return withCleanup(async () => {
    for (let i = 0; i < 200 && renewals.held === 0; i++) await drain()
    // Positive witness: the load had started, and its renewal held it
    // before it reached the source.
    expect(collection.isLoadingSubset).toBe(true)
    expect(upstream.calls.length).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    renewals.release()
    await drain()
    return {
      settledAfterRenewal: preload() === `resolved`,
      heldRenewals: renewals.held,
    }
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runReleaseDuringCoverageCheck(): Promise<{
  loadingAfterRelease: boolean
  heldReads: number
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  await coverD(driver)
  useFakeClock()
  const holder: { collection?: Collection<Row, string, any> } = {}
  const { adapter, reads } = controlledReads(
    new SQLiteCorePersistenceAdapter({ driver }),
    () => (holder.collection?.toArray.length ?? 0) > 0,
    `hold`,
  )
  const { collection, upstream } = onDemandSource(adapter, 1000)
  holder.collection = collection
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    for (let i = 0; i < 200 && reads.held === 0; i++) await drain()
    // The coverage check is in flight; release the demand now.
    await query.cleanup()
    await drain()
    reads.release()
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    return {
      loadingAfterRelease: collection.isLoadingSubset,
      heldReads: reads.held,
    }
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
// the network-first wait may release only when the query's demand on C has
// settled from SQLite, so the same joined query must have covered it in
// session 1. Collection readiness stays false: P's Collection never becomes
// ready offline.
//
// Model: released exactly when C is covered; `isReady` is false in both
// cases; the released rows are the joined row from session 1. The wrong
// design "an on-demand opt-in permits fallback on its own" releases without
// coverage.
//
// The rows are read when the wait releases, because that is the snapshot a
// Suspense render shows. Session 2 also reads the joined query through an
// outer live query (`nested`), which must already show the joined row at
// release.
//
// A query can reach C through more than one live query. In `two-readers` the
// outer query reads the joined query and also joins C itself on another key,
// so it has two demands on C. Persisted readiness requires every demand the
// query reaches on C to have settled (`docs/contributing/glossary.md`,
// "persisted readiness"). The history `covered by the inner query only`
// covers just the joined query's demand, so the wait must not release. It
// rejects the wrong design "the first live query reached on C stands for
// all of them".
//
// A source failure is not coverage. When C reports an error while its
// never-covered demand is pending, the wait must not release a local render:
// that would show rows that no load proved complete. This rejects the wrong
// design "a source failure permits fallback for every source". The demand
// still waits for its upstream load, so the wait neither releases nor
// rejects (the law record's limit "Uncovered demand while offline").
//
// A source failure does not block a covered demand either. In the failure
// histories C waits 1000 ms, and P or C reports an error at once. Before the
// wait passes nothing releases. After it, the covered demand has settled from
// SQLite, so every condition of the gate holds and the wait releases the
// joined row, even though the live query reports the source error. This
// rejects the wrong design "a source error blocks every on-demand demand",
// which leaves the wait pending with nothing left to change it. The observer's
// synchronous gate, `isInitialRenderReady`, must agree with the wait.
// ===========================================================================

type ChildHistory =
  | `covered by the same joined query`
  | `covered by the inner query only`
  | `never requested`
type JoinedShape = `flat` | `nested` | `two-readers`
type JoinedFailure = `none` | `on-demand source fails` | `eager source fails`
// A failure history observes before and after C's 1000 ms wait.
type JoinedCheckpoint = `before the wait` | `after the wait`

// `initialRenderReleased` is the network-first wait; `collectionReady` is the
// live query's own readiness, which needs P's Collection to be ready.
type JoinedObservation = {
  initialRenderReleased: boolean
  initialRenderRejected: boolean
  initialRenderReady: boolean
  collectionReady: boolean
  rows: unknown
}

const JOINED_ROW = { id: `p1`, parentValue: `parent`, childValue: `child` }

function expectedJoined(
  history: ChildHistory,
  optInPermitsAlone = false,
  checkpoint: JoinedCheckpoint = `after the wait`,
): JoinedObservation {
  const covered = history === `covered by the same joined query`
  const released =
    checkpoint === `after the wait` && (covered || optInPermitsAlone)
  return {
    initialRenderReleased: released,
    initialRenderRejected: false,
    initialRenderReady: released,
    collectionReady: false,
    rows: released ? (covered ? [JOINED_ROW] : []) : undefined,
  }
}

type Parent = { id: string; value: string }
type Child = { id: string; parentId: string; value: string }

function eagerParents(adapter: SQLiteCorePersistenceAdapter, online: boolean) {
  const source = { markError: (_error: unknown) => {} }
  const collection = createCollection(
    persistedCollectionOptions<Parent, string>({
      id: `demand-coverage-parents`,
      getKey: (row) => row.id,
      initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
      persistence: { adapter },
      sync: {
        sync: ({ begin, write, commit, markReady, markError }) => {
          source.markError = markError
          if (online) {
            begin()
            write({ type: `insert`, value: { id: `p1`, value: `parent` } })
            commit()
            markReady()
          }
          return {}
        },
      },
    }),
  )
  return { collection, source }
}

function onDemandChildren(
  adapter: SQLiteCorePersistenceAdapter,
  online: boolean,
  waitMs = 0,
) {
  const calls: Array<LoadSubsetOptions> = []
  const source = { markError: (_error: unknown) => {} }
  const collection = createCollection(
    persistedCollectionOptions<Child, string>({
      id: `demand-coverage-children`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: waitMs },
      persistence: { adapter },
      sync: {
        sync: ({ begin, write, commit, markError }) => {
          source.markError = markError
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              calls.push(options)
              if (!online) return new Promise<void>(() => {})
              // The source may return more rows than requested.
              begin()
              write({
                type: `insert`,
                value: { id: `c1`, parentId: `p1`, value: `child` },
              })
              return Promise.resolve(commit()).then(() => undefined)
            },
          }
        },
      },
    }),
  )
  return { collection, calls, source }
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
  failure: JoinedFailure = `none`,
): Promise<Record<JoinedCheckpoint, JoinedObservation>> {
  const driver = createDriver(new DatabaseSync(`:memory:`))

  // Session 1 is online. Both Collections share one adapter, as an
  // application does. The children load only through the session-1 query.
  {
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const { collection: parents } = eagerParents(adapter, true)
    const children = onDemandChildren(adapter, true)
    const session1 =
      history === `never requested`
        ? undefined
        : history === `covered by the inner query only`
          ? shapedQuery(`flat`, parents, children.collection)
          : shapedQuery(shape, parents, children.collection)
    await withCleanup(async () => {
      if (session1) await session1.query.preload()
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
    }, [
      () => session1?.query.cleanup(),
      () => session1?.inner.cleanup(),
      () => children.collection.cleanup(),
      () => parents.cleanup(),
    ])
  }

  useFakeClock()
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  const eager = eagerParents(adapter, false)
  const parents = eager.collection
  const waitMs = failure === `none` ? 0 : 1000
  const children = onDemandChildren(adapter, false, waitMs)
  const { inner, query } = shapedQuery(shape, parents, children.collection)
  const observer = createLiveQueryObserver(query)
  const unsubscribe = observer.subscribe(() => {})
  // Virtual row properties (`$key`, `$synced`, ...) are not part of the law.
  const visibleRows = () =>
    (observer.getSnapshot().data as Array<object>).map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => !key.startsWith(`$`)),
      ),
    )
  const initialRender: {
    released: boolean
    rejected: boolean
    rows?: unknown
  } = { released: false, rejected: false }
  void observer.preloadForInitialRender().then(
    () => {
      initialRender.released = true
      initialRender.rows = visibleRows()
    },
    () => (initialRender.rejected = true),
  )
  const observe = (): JoinedObservation => ({
    initialRenderReleased: initialRender.released,
    initialRenderRejected: initialRender.rejected,
    initialRenderReady: observer.isInitialRenderReady(),
    collectionReady: observer.getSnapshot().isReady,
    rows: initialRender.rows,
  })
  return withCleanup(async () => {
    for (let i = 0; i < 200 && children.calls.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    // Positive witness: session 2 reached the on-demand side's demand.
    expect(children.calls.length).toBeGreaterThan(0)
    await drain()
    if (failure !== `none`) {
      const failing =
        failure === `on-demand source fails` ? children.source : eager.source
      failing.markError(new Error(`offline stream failed`))
      await drain()
    }
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    const beforeWait = observe()
    await vi.advanceTimersByTimeAsync(waitMs)
    await drain()
    // A late checkpoint: nothing else is scheduled to change the outcome.
    await vi.advanceTimersByTimeAsync(10_000)
    await drain()
    return { 'before the wait': beforeWait, 'after the wait': observe() }
  }, [
    () => vi.useRealTimers(),
    unsubscribe,
    () => observer.dispose(),
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
// settle from SQLite. Session 1 loads W online over `a1` (rank 1), `a2`
// (rank 2), and `a3` (rank 3), so W holds `a1` and `a2`. Then one tail event
// happens:
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
//
// Law: W settles from SQLite only when its restore holds the same rows that
// it held when it settled. Coverage proves that window complete; a window
// that lost, gained, or replaced a row is not the proven one. A swap keeps
// the same rows in a new order, so W stays covered and shows the new order.
// The wrong designs "a window counts only rows" and "a window ignores its
// tie-boundary" accept a row moved out or in. The last two histories keep
// the boundary row, so its tie-boundary load key does not change; they
// reject "a window counts only rows" by the row count alone.
//
// Two more histories move the window to its next page offline. Page 2 is
// covered only when session 1 loaded it too. Each runs with and without an
// index on `rank`. With one, core continues the window with a cursor from the
// restored boundary; without one, it reloads the longer prefix `limit 4`. The
// wrong designs "a demand key ignores offset and cursor" and "a demand key
// ignores its limit" would then settle a page that session 1 never loaded. A
// positive witness checks which load the move sent.
// ===========================================================================

type WindowHistory =
  | `unchanged`
  | `row-deleted`
  | `row-moved-out`
  | `row-moved-in`
  | `rows-swapped`
  | `row-replaced`
  | `row-gained-under-limit`
const WINDOW_HISTORIES: ReadonlyArray<WindowHistory> = [
  `unchanged`,
  `row-deleted`,
  `row-moved-out`,
  `row-moved-in`,
  `rows-swapped`,
  `row-replaced`,
  `row-gained-under-limit`,
]

const A3: Row = { id: `a3`, group: `a`, rank: 3, value: `v1` }

// The rows W held when it settled in session 1.
const windowHeld = (history: WindowHistory): ReadonlyArray<string> =>
  history === `row-gained-under-limit` ? [`a1`] : [`a1`, `a2`]

// Each history's restored rows, in rank order. The window is covered exactly
// when these are the rows it held when it settled, in any order.
const WINDOW_RESTORED: Record<WindowHistory, ReadonlyArray<string>> = {
  unchanged: [`a1`, `a2`],
  'row-deleted': [`a2`, `a3`],
  'row-moved-out': [`a1`, `a3`],
  'row-moved-in': [`a0`, `a1`],
  'rows-swapped': [`a2`, `a1`],
  'row-replaced': [`a15`, `a2`],
  'row-gained-under-limit': [`a0`, `a1`],
}

function expectedWindow(history: WindowHistory): {
  ready: boolean
  rows?: ReadonlyArray<string>
} {
  const restored = WINDOW_RESTORED[history]
  const held = windowHeld(history)
  const sameRows =
    restored.length === held.length && held.every((id) => restored.includes(id))
  return sameRows ? { ready: true, rows: restored } : { ready: false }
}

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
): Promise<{ ready: boolean; rows?: ReadonlyArray<string> }> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  {
    const { collection, upstream } = onDemandSource(
      new SQLiteCorePersistenceAdapter({ driver }),
      0,
    )
    const query = windowQuery(collection)
    await withCleanup(async () => {
      await answerUntil(
        upstream,
        history === `row-gained-under-limit` ? [A1] : [A1, A2, A3],
        query.preload(),
      )
      // Positive witness: W holds the rows of this history online.
      expect(query.toArray.map((row) => row.id)).toEqual(windowHeld(history))
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (history === `row-deleted`) await upstream.remove([A1])
      if (history === `row-moved-out`) {
        await upstream.update([{ ...A2, rank: 10 }])
      }
      if (history === `row-moved-in`) {
        await upstream.write([{ id: `a0`, group: `a`, rank: 0, value: `v1` }])
      }
      if (history === `rows-swapped`) {
        await upstream.update([
          { ...A1, rank: 2 },
          { ...A2, rank: 1 },
        ])
      }
      if (history === `row-replaced`) {
        await upstream.remove([A1])
        await upstream.write([
          { id: `a15`, group: `a`, rank: 1.5, value: `v1` },
        ])
      }
      if (history === `row-gained-under-limit`) {
        await upstream.write([{ id: `a0`, group: `a`, rank: 0, value: `v1` }])
      }
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
    return query.status === `ready`
      ? { ready: true, rows: query.toArray.map((row) => row.id) }
      : { ready: false }
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

// Ties at the boundary. Session 1 loads W over `a1` (rank 1), `a2` and `a2b`
// (both rank 2), and `a3` (rank 3), so W holds `a1` and `a2`, and its
// tie-boundary load is the demand "group a, rank 2", which held `a2` and
// `a2b`. Model: W is a limited demand and a tie-boundary demand, and it
// settles only when both are covered. The window must hold the same rows
// (the window law); the tie-boundary demand is unordered, so it must hold at
// least the rows it held (the row-count rule). The model orders ties by key.
//
// - `tie-unchanged`: nothing; W settles on `a1`, `a2`.
// - `tie-row-outside-deleted`: the source deletes `a2b`. W keeps its rows,
//   but its tie-boundary demand lost one, so W waits. This rejects "a window
//   ignores its tie-boundary load".
// - `tie-row-added`: the source adds `a2c` at rank 2. W keeps its rows, and
//   its tie-boundary demand gained one, so W settles. This rejects "every
//   demand must hold the keys it held".
// - `tie-row-inside-deleted`: the source deletes `a2`, so W holds `a1` and
//   `a2b`, a different window, and waits.
type TieHistory =
  | `tie-unchanged`
  | `tie-row-outside-deleted`
  | `tie-row-added`
  | `tie-row-inside-deleted`
const TIE_HISTORIES: ReadonlyArray<TieHistory> = [
  `tie-unchanged`,
  `tie-row-outside-deleted`,
  `tie-row-added`,
  `tie-row-inside-deleted`,
]
const A2B: Row = { id: `a2b`, group: `a`, rank: 2, value: `v1` }

function expectedTieWindow(history: TieHistory): {
  ready: boolean
  rows?: ReadonlyArray<string>
} {
  const held = [`a1`, `a2`]
  const tieRowsHeld = 2
  const rows = [
    [`a1`, 1],
    [`a2`, 2],
    [`a2b`, 2],
    [`a3`, 3],
    ...(history === `tie-row-added` ? [[`a2c`, 2] as const] : []),
  ].filter(
    ([id]) =>
      !(history === `tie-row-outside-deleted` && id === `a2b`) &&
      !(history === `tie-row-inside-deleted` && id === `a2`),
  ) as Array<readonly [string, number]>
  rows.sort(([a, x], [b, y]) => x - y || (a < b ? -1 : 1))
  const window = rows.slice(0, 2).map(([id]) => id)
  const boundary = rows[1]![1]
  const tieRows = rows.filter(([, rank]) => rank === boundary).length
  const sameRows = held.every((id) => window.includes(id))
  return sameRows && tieRows >= tieRowsHeld
    ? { ready: true, rows: window }
    : { ready: false }
}

async function runTieWindow(history: TieHistory): Promise<{
  held: ReadonlyArray<string>
  tieLoads: number
  ready: boolean
  rows?: ReadonlyArray<string>
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  let held: ReadonlyArray<string> = []
  let tieLoads = 0
  {
    const { collection, upstream } = onDemandSource(
      new SQLiteCorePersistenceAdapter({ driver }),
      0,
    )
    const query = windowQuery(collection)
    await withCleanup(async () => {
      await answerUntil(upstream, [A1, A2, A2B, A3], query.preload())
      held = query.toArray.map((row) => row.id)
      tieLoads = upstream.calls.filter(
        (call) => call.limit === undefined,
      ).length
      await new Promise((resolve) => setTimeout(resolve, 50))
      const tieRows = [A2, A2B]
      const inside = tieRows.find((row) => held.includes(row.id))!
      const outside = tieRows.find((row) => !held.includes(row.id))!
      if (history === `tie-row-outside-deleted`)
        await upstream.remove([outside])
      if (history === `tie-row-inside-deleted`) await upstream.remove([inside])
      if (history === `tie-row-added`) {
        await upstream.write([{ id: `a2c`, group: `a`, rank: 2, value: `v1` }])
      }
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
    return {
      held,
      tieLoads,
      ...(query.status === `ready`
        ? { ready: true, rows: query.toArray.map((row) => row.id) }
        : { ready: false }),
    }
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

async function runNextPage(
  session1LoadsPageTwo: boolean,
  indexed = true,
): Promise<{ pageTwoSettled: boolean; rows?: ReadonlyArray<string> }> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const A4: Row = { id: `a4`, group: `a`, rank: 4, value: `v1` }
  const all = [A1, A2, A3, A4]
  {
    const { collection, upstream } = onDemandSource(
      new SQLiteCorePersistenceAdapter({ driver }),
      0,
    )
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
        // Positive witness: session 1 reached page 2.
        expect(query.toArray.map((row) => row.id)).toEqual([`a3`, `a4`])
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
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await untilUpstreamCalled(upstream, 1)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    // Positive witness: page 1 settled from SQLite.
    expect(query.status).toBe(`ready`)
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
    return moved.settled
      ? {
          pageTwoSettled: true,
          rows: query.toArray.map((row) => row.id),
        }
      : { pageTwoSettled: false }
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

  it(`preserves a primary failure when cleanup also fails`, async () => {
    const mismatch = new Error(`wrong rows`)
    const cleanupFailure = new Error(`cleanup failed`)
    await expect(
      withCleanup(
        () => Promise.reject(mismatch),
        [
          () => {
            throw cleanupFailure
          },
        ],
      ),
    ).rejects.toMatchObject({
      cause: mismatch,
      errors: [mismatch, cleanupFailure],
    })
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

  it.each([
    {
      ...LIFECYCLE_LAW,
      name: `deadline from the sync run`,
      deadlineFrom: `sync-run`,
    },
    {
      ...LIFECYCLE_LAW,
      name: `release clears coverage`,
      releaseKeepsCoverage: false,
    },
  ] satisfies ReadonlyArray<LifecycleDesign>)(
    `distinguishes the lifecycle law from the wrong design: $name`,
    (design) => {
      expect(expectedLifecycle(design)).not.toEqual(expectedLifecycle())
    },
  )

  it(`distinguishes the joined law from an opt-in that permits fallback alone`, () => {
    expect(expectedJoined(`never requested`, true)).not.toEqual(
      expectedJoined(`never requested`),
    )
  })

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

  it(`gives each load of a covered demand its own wait and keeps coverage across release`, async () => {
    quietConsole()
    const actual = await runLifecycle()
    expect(actual.query1Aborted).toBe(true)
    expect(actual.observations).toEqual(expectedLifecycle())
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
    `releases the joined network-first wait only when the on-demand side is covered: %s, %s`,
    async (history, shape) => {
      quietConsole()
      const actual = await runJoined(history, shape)
      expect(actual[`after the wait`]).toEqual(expectedJoined(history))
    },
  )

  it.each(
    ([`on-demand source fails`, `eager source fails`] as const).flatMap(
      (failure) =>
        ([`covered by the same joined query`, `never requested`] as const).map(
          (history) => [failure, history] as const,
        ),
    ),
  )(
    `releases the joined wait after a source failure only when the on-demand demand settles: %s, %s`,
    async (failure, history) => {
      quietConsole()
      expect(await runJoined(history, `flat`, failure)).toEqual({
        'before the wait': expectedJoined(history, false, `before the wait`),
        'after the wait': expectedJoined(history),
      })
    },
  )

  it(`does not settle D from SQLite after a schema reset`, async () => {
    quietConsole()
    expect(await runSchemaReset()).toEqual({ settledAfterWait: false })
  })

  it(`keeps an optimistic write's overlay rules on a demand settled from SQLite`, async () => {
    quietConsole()
    expect(await runOptimisticWrite()).toEqual({
      settledBeforeWrite: [`a1`, `a2`],
      duringWrite: [`a1`, `a2`, `a9`],
      afterRollback: [`a1`, `a2`],
      readyThroughout: true,
    })
  })

  it(`does not fail a load whose rows applied when the cache claim expires before its coverage record`, async () => {
    quietConsole()
    expect(await runClaimExpiredBeforeRecord()).toEqual({
      queryStatus: `ready`,
      rows: [`a1`, `a2`],
    })
  })

  it(`waits for the network when the cache claim expires before the coverage check`, async () => {
    quietConsole()
    expect(await runClaimExpiredBeforeCheck()).toEqual({
      status: `loading`,
      reacquired: true,
    })
  })

  it(`keeps a synchronous answer for an already hydrated demand synchronous`, async () => {
    quietConsole()
    // Positive witness: the second request reached the source.
    expect(await runSynchronousAnswer()).toEqual({
      sourceCalls: 1,
      secondResult: `true`,
    })
  })

  it(`settles a load as its upstream load did when the coverage read after it fails`, async () => {
    quietConsole()
    expect(await runCoverageReadFailsAfterLoad()).toEqual({
      status: `ready`,
      rows: [`a1`, `a2`],
      failedReads: 1,
    })
  })

  it(`waits for the upstream load when the coverage check read fails`, async () => {
    quietConsole()
    expect(await runCoverageReadFailsDuringCheck()).toEqual({
      beforeAnswer: `loading`,
      afterAnswer: `ready`,
      failedReads: 1,
    })
  })

  it.each([
    [false, { settledOffline: true }],
    [true, { settledOffline: false }],
  ] as const)(
    `counts a synchronous answer's rows in its coverage (row deleted afterwards: %s)`,
    async (deleteAfterwards, expected) => {
      quietConsole()
      expect(await runSynchronousAnswerThenDelete(deleteAfterwards)).toEqual(
        expected,
      )
    },
  )

  it(`keeps an unordered demand covered when it loses one row and gains another`, async () => {
    quietConsole()
    expect(await runUnorderedRowReplaced()).toEqual({
      settledOffline: true,
      rows: [`a2`, `a3`],
    })
  })

  it(`records nothing for an empty load that a truncate makes obsolete during its coverage read`, async () => {
    quietConsole()
    expect(await runTruncateDuringCoverageRead()).toEqual({
      settledOffline: false,
      heldReads: 1,
    })
  })

  it(`measures the wait from the load's start, not the end of the coverage read`, async () => {
    quietConsole()
    expect(await runCoverageReadOutlastsWait()).toEqual({
      settledWhenReadReturns: true,
      heldReads: 1,
    })
  })

  it(`measures the wait from before the load's cache-claim renewal`, async () => {
    quietConsole()
    expect(await runClaimRenewalOutlastsWait()).toEqual({
      settledAfterRenewal: true,
      heldRenewals: 1,
    })
  })

  it(`stops loading at release during the coverage check`, async () => {
    quietConsole()
    expect(await runReleaseDuringCoverageCheck()).toEqual({
      loadingAfterRelease: false,
      heldReads: 1,
    })
  })

  it.each([`rotation`, `refetch`] as const)(
    `does not settle a later load of D from SQLite after a %s in the same session`,
    async (kind) => {
      quietConsole()
      expect(await runSessionReset(kind)).toEqual(SESSION_RESET_LAW)
      expect(await runSessionReset(kind, [])).toEqual(SESSION_RESET_LAW)
    },
  )
  it(`distinguishes the window law from "a window counts only rows"`, () => {
    // Counting rows accepts every history that keeps at least the held count.
    const countOnly = (history: WindowHistory) =>
      WINDOW_RESTORED[history].length >= windowHeld(history).length
    expect(
      WINDOW_HISTORIES.filter(
        (history) => countOnly(history) !== expectedWindow(history).ready,
      ),
    ).toEqual([
      `row-deleted`,
      `row-moved-out`,
      `row-moved-in`,
      `row-replaced`,
      `row-gained-under-limit`,
    ])
  })

  it.each(WINDOW_HISTORIES)(
    `settles an ordered window from SQLite only while it holds its covered rows: %s`,
    async (history) => {
      quietConsole()
      expect(await runWindow(history)).toEqual(expectedWindow(history))
    },
  )

  it.each(TIE_HISTORIES)(
    `settles a window with a tie at its boundary only while both of its demands are covered: %s`,
    async (history) => {
      quietConsole()
      const { held, tieLoads, ...observed } = await runTieWindow(history)
      // Positive witness: W held a1 and a2 and sent a tie-boundary load.
      expect(held).toEqual([`a1`, `a2`])
      expect(tieLoads).toBeGreaterThan(0)
      expect(observed).toEqual(expectedTieWindow(history))
    },
  )

  it.each([
    [true, { pageTwoSettled: true, rows: [`a3`, `a4`] }],
    [false, { pageTwoSettled: false }],
  ] as const)(
    `moves a window offline to a page only when that page is covered (session 1 loaded page 2: %s)`,
    async (session1LoadsPageTwo, expected) => {
      quietConsole()
      expect(await runNextPage(session1LoadsPageTwo)).toEqual(expected)
      expect(await runNextPage(session1LoadsPageTwo, false)).toEqual(expected)
    },
  )
})
