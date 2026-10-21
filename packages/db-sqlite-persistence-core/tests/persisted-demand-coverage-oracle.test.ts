import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { SQLiteDriver } from '../src/index.js'

/**
 * # When may an on-demand query settle on rows from SQLite?
 *
 * Law (proposed; issue #2102 item 1,
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
 *    upstream load has failed.
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
 * Limits: no Electric or Query DB source (they need receiving witnesses), no
 * cache-claim rotation, truncate, must-refetch, or schema reset, no ordered
 * window or cursor page in session 2, no failure that arrives before the
 * persisted subset restore publishes, no framework rendering, and no native
 * host. Every block is a bounded enumeration or fixed history, not a
 * generated campaign, so ORC-007 does not apply.
 */

type Row = { id: string; group: string; rank: number; value: string }

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
//
// Session 2 asks for D again with a configured wait of 0 ms or 1000 ms. Its
// upstream load follows one schedule:
//
// - `pending`: the network never answers (offline).
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
// `settled-empty` rejects "nonempty rows count"; `settled` carries every
// positive case. The 1000 ms wait rejects "wait ignored" and "half deadline".
// `fails-early` rejects "failure errors a covered demand"; `answers-late`
// rejects "upstream aborted after SQLite"; `fails-late` rejects "late
// failure undoes a settlement"; `answers-empty-late` checks that an empty
// answer settles an uncovered demand and leaves a covered one unchanged;
// `answers-early` checks that the network wins before the deadline.
// Excluded: a session-2 event before the restore checkpoint, which this
// driver cannot schedule (see Limits).
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
] as const
type CoverageHistory = (typeof COVERAGE_HISTORIES)[number]

const UPSTREAM_SCHEDULES = [
  `pending`,
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

function toBinding(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

// An in-memory driver that meets the driver contract's serialization rule
// (`tests/contracts/sqlite-driver-contract.ts`): work outside a transaction
// waits behind an active transaction, so two Collections can share one
// connection. Work inside the transaction uses the transaction driver.
function createDriver(database: DatabaseSync): SQLiteDriver {
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const direct: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toBinding))
      return Promise.resolve()
    },
    transaction: (transaction) => transaction(direct),
  }
  return {
    exec: (sql) => serialize(() => direct.exec(sql)),
    query: (sql, params) => serialize(() => direct.query(sql, params)),
    run: (sql, params) => serialize(() => direct.run(sql, params)),
    transaction: (transaction) =>
      serialize(async () => {
        database.exec(`BEGIN IMMEDIATE`)
        try {
          const result = await transaction(direct)
          database.exec(`COMMIT`)
          return result
        } catch (error) {
          database.exec(`ROLLBACK`)
          throw error
        }
      }),
  }
}

// ORC-010: run a check, then every cleanup. A cleanup failure never replaces
// the primary failure; both survive in one AggregateError.
async function withCleanup<T>(
  check: () => Promise<T>,
  cleanups: ReadonlyArray<() => unknown>,
): Promise<T> {
  let result: T | undefined
  let primary: { error: unknown } | undefined
  try {
    result = await check()
  } catch (error) {
    primary = { error }
  }
  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  if (primary) {
    if (cleanupFailures.length === 0) throw primary.error
    throw new AggregateError(
      [primary.error, ...cleanupFailures],
      `Demand-coverage check and cleanup both failed`,
      { cause: primary.error },
    )
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0]
  if (cleanupFailures.length > 1) {
    throw new AggregateError(cleanupFailures, `Demand-coverage cleanup failed`)
  }
  return result as T
}

function useFakeClock(): void {
  vi.useFakeTimers({
    toFake: [
      `setTimeout`,
      `clearTimeout`,
      `setInterval`,
      `clearInterval`,
      `Date`,
    ],
  })
}

async function drain(): Promise<void> {
  for (let i = 0; i < 25; i++) await vi.advanceTimersByTimeAsync(0)
}

type Upstream = {
  calls: Array<LoadSubsetOptions>
  pendingCount: () => number
  answer: (rows: ReadonlyArray<Row>) => Promise<void>
  fail: (error: unknown) => void
}

// A generic on-demand source. Each load waits until the test answers or
// fails it. An answer writes the rows in one sync transaction and settles
// every pending load after its applied receipt.
function onDemandSource(
  adapter: SQLiteCorePersistenceAdapter,
  waitMs: number,
): { collection: Collection<Row, string, any>; upstream: Upstream } {
  const pending: Array<{
    resolve: () => void
    reject: (error: unknown) => void
  }> = []
  let write: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  const upstream: Upstream = {
    calls: [],
    pendingCount: () => pending.length,
    answer: async (rows) => {
      await write?.(rows)
      for (const load of pending.splice(0)) load.resolve()
    },
    fail: (error) => {
      for (const load of pending.splice(0)) load.reject(error)
    },
  }
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `demand-coverage-source`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: waitMs },
      persistence: { adapter },
      sync: {
        sync: (params) => {
          write = (rows) => {
            params.begin()
            for (const value of rows) params.write({ type: `insert`, value })
            return params.commit()
          }
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              upstream.calls.push(options)
              return new Promise<void>((resolve, reject) => {
                pending.push({ resolve, reject })
              })
            },
          }
        },
      },
    }),
  )
  return { collection, upstream }
}

function filterQuery(source: Collection<Row, string, any>, group: string) {
  return createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, group)),
  )
}

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
    // Answer each upstream load in turn until preload settles; a window
    // sends its limited load and then its tie-boundary load.
    for (;;) {
      await vi.waitFor(() =>
        expect(isSettled() || upstream.pendingCount() > 0).toBe(true),
      )
      if (isSettled()) break
      if (history === `failed`) {
        upstream.fail(new Error(`session 1 upstream failed`))
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
        await upstream.answer(SESSION_1_ROWS[history])
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (history === `settled-empty` || history === `settled`) await preload
    else await preload.catch(() => undefined)
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

function trackPreload(query: Collection<any, any, any>) {
  const state = { value: `pending` as Observation[`preload`] }
  void query.preload().then(
    () => (state.value = `resolved`),
    () => (state.value = `rejected`),
  )
  return () => state.value
}

async function untilUpstreamCalled(upstream: Upstream, count = 1) {
  for (let i = 0; i < 200 && upstream.calls.length < count; i++) {
    await vi.advanceTimersByTimeAsync(0)
  }
  if (upstream.calls.length < count) {
    throw new Error(
      `checkpoint not reached: upstream load ${count} never started`,
    )
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
    new SQLiteCorePersistenceAdapter({ driver }),
    cell.waitMs,
  )
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
        cell.history === `failed` ||
        cell.history === `durable-write-failed`,
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
// ===========================================================================

type ChildHistory = `covered by the same joined query` | `never requested`

// `initialRenderReleased` is the network-first wait; `collectionReady` is the
// live query's own readiness, which needs P's Collection to be ready.
type JoinedObservation = {
  initialRenderReleased: boolean
  collectionReady: boolean
  rows: unknown
}

const JOINED_ROW = { id: `p1`, parentValue: `parent`, childValue: `child` }

function expectedJoined(
  history: ChildHistory,
  optInPermitsAlone = false,
): JoinedObservation {
  const covered = history === `covered by the same joined query`
  const released = covered || optInPermitsAlone
  return {
    initialRenderReleased: released,
    collectionReady: false,
    rows: released ? (covered ? [JOINED_ROW] : []) : undefined,
  }
}

type Parent = { id: string; value: string }
type Child = { id: string; parentId: string; value: string }

function eagerParents(adapter: SQLiteCorePersistenceAdapter, online: boolean) {
  return createCollection(
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
            markReady()
          }
          return {}
        },
      },
    }),
  )
}

function onDemandChildren(
  adapter: SQLiteCorePersistenceAdapter,
  online: boolean,
) {
  const calls: Array<LoadSubsetOptions> = []
  const collection = createCollection(
    persistedCollectionOptions<Child, string>({
      id: `demand-coverage-children`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: 0 },
      persistence: { adapter },
      sync: {
        sync: ({ begin, write, commit }) => ({
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
        }),
      },
    }),
  )
  return { collection, calls }
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

async function runJoined(history: ChildHistory): Promise<JoinedObservation> {
  const covered = history === `covered by the same joined query`
  const driver = createDriver(new DatabaseSync(`:memory:`))

  // Session 1 is online. Both Collections share one adapter, as an
  // application does. The children load only through the joined query.
  {
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const parents = eagerParents(adapter, true)
    const children = onDemandChildren(adapter, true)
    const query = covered ? joined(parents, children.collection) : undefined
    await withCleanup(async () => {
      if (query) await query.preload()
      else await parents.preload()
      // Positive witness: session 1 loaded the children only when covered.
      expect(children.calls.length > 0).toBe(covered)
    }, [
      () => query?.cleanup(),
      () => children.collection.cleanup(),
      () => parents.cleanup(),
    ])
  }

  useFakeClock()
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  const parents = eagerParents(adapter, false)
  const children = onDemandChildren(adapter, false)
  const query = joined(parents, children.collection)
  const observer = createLiveQueryObserver(query)
  const unsubscribe = observer.subscribe(() => {})
  const initialRender = { released: false }
  void observer.preloadForInitialRender().then(
    () => (initialRender.released = true),
    () => undefined,
  )
  return withCleanup(async () => {
    for (let i = 0; i < 200 && children.calls.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    // Positive witness: session 2 reached the on-demand side's demand.
    expect(children.calls.length).toBeGreaterThan(0)
    await drain()
    await vi.advanceTimersByTimeAsync(1)
    await drain()
    return {
      initialRenderReleased: initialRender.released,
      collectionReady: observer.getSnapshot().isReady,
      rows: initialRender.released ? observer.getSnapshot().data : undefined,
    }
  }, [
    () => vi.useRealTimers(),
    unsubscribe,
    () => observer.dispose(),
    () => query.cleanup(),
    () => children.collection.cleanup(),
    () => parents.cleanup(),
  ])
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function quietConsole(): void {
  vi.spyOn(console, `warn`).mockImplementation(() => {})
  vi.spyOn(console, `error`).mockImplementation(() => {})
}

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
    `covered by the same joined query`,
    `never requested`,
  ] as const satisfies ReadonlyArray<ChildHistory>)(
    `releases the joined network-first wait only when the on-demand side is covered: %s`,
    async (history) => {
      quietConsole()
      expect(await runJoined(history)).toEqual(expectedJoined(history))
    },
  )
})
