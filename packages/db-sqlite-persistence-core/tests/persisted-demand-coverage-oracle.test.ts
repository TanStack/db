import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  createLiveQueryObserver,
  eq,
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
 *    cache generation, because an earlier load of it reached applied
 *    settlement;
 * 3. the configured wait has passed since the load started, or the demand's
 *    upstream load has failed.
 *
 * Otherwise the load waits for its upstream load, as it does without
 * persistence. The upstream load keeps running after a settlement from
 * SQLite, and its rows publish when they apply. A demand without coverage
 * never settles from SQLite, even when SQLite holds some matching rows.
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
 * window or later demand, no framework rendering, and no native host. The
 * matrix is a bounded enumeration, not a generated campaign.
 */

type Row = { id: string; group: string; value: string }

// ---------------------------------------------------------------------------
// History grammar
//
// Session 1 decides whether demand D (`group = 'a'`) has coverage and which
// rows SQLite holds for it:
//
// - `not-requested`: session 1 never asks for D.
// - `failed`: D's upstream load rejects, so it never reaches applied
//   settlement.
// - `overlapping-demand`: a different demand (`id = 'a1'`) settles. SQLite
//   holds `a1`, which matches D, but D itself has no coverage.
// - `settled-empty`: D settles with no rows. The empty answer is complete.
// - `settled`: D settles with `a1` and `a2`.
//
// Session 2 asks for D again with a configured wait of 0 ms or 1000 ms. Its
// upstream load then follows one schedule:
//
// - `pending`: the network never answers (offline).
// - `fails-early`: the load rejects before the wait passes.
// - `answers-early`: the load answers before the wait passes.
// - `answers-late`: the load answers after the wait passes.
//
// With a 0 ms wait, "early" events still follow the restore checkpoint, so
// they arrive after the wait has passed.
// ---------------------------------------------------------------------------

const COVERAGE_HISTORIES = [
  `not-requested`,
  `failed`,
  `overlapping-demand`,
  `settled-empty`,
  `settled`,
] as const
type CoverageHistory = (typeof COVERAGE_HISTORIES)[number]

const UPSTREAM_SCHEDULES = [
  `pending`,
  `fails-early`,
  `answers-early`,
  `answers-late`,
] as const
type UpstreamSchedule = (typeof UPSTREAM_SCHEDULES)[number]

const WAITS = [0, 1000] as const
type Wait = (typeof WAITS)[number]

type Cell = {
  history: CoverageHistory
  waitMs: Wait
  upstream: UpstreamSchedule
}

const SESSION_1_ROWS: Record<CoverageHistory, ReadonlyArray<Row>> = {
  'not-requested': [],
  failed: [],
  'overlapping-demand': [{ id: `a1`, group: `a`, value: `v1` }],
  'settled-empty': [],
  settled: [
    { id: `a1`, group: `a`, value: `v1` },
    { id: `a2`, group: `a`, value: `v1` },
  ],
}

// Session 2's upstream answer updates a1 and adds a3. It omits a2; an
// on-demand load reports rows, not deletions, so a2 stays.
const SESSION_2_ANSWER: ReadonlyArray<Row> = [
  { id: `a1`, group: `a`, value: `v2` },
  { id: `a3`, group: `a`, value: `v2` },
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
//   chance to publish.
// - `afterEarlyEvent`: after an early upstream answer or failure.
// - `beforeDeadline`: fake time is 1 ms before the wait passes.
// - `afterDeadline`: fake time has reached the wait.
// - `afterLateEvent`: after a late upstream answer.
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
// - failure separates `error` from `loading` for an uncovered demand.
//
// `Design` lets the calibration below express plausible wrong designs as
// variants of the same rule. The law is `LAW`.
// ---------------------------------------------------------------------------

type Design = {
  name: string
  isCovered: (history: CoverageHistory) => boolean
  // The wait is honored; `false` settles a covered demand at restore.
  honorsWait: boolean
  // Fraction of the wait after which a covered demand settles.
  deadlineFraction: number
  // A covered demand settles when its upstream load fails.
  failureSettlesCovered: boolean
  // Upstream rows still publish after a settlement from SQLite.
  upstreamContinues: boolean
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
  const answer = () => {
    if (state.failed) return
    if (state.settledFromSqlite && !design.upstreamContinues) return
    for (const row of SESSION_2_ANSWER) visible.set(row.id, row)
    state.rowsAtEarlySettle = undefined
    state.settled = true
  }

  // restored (t = 0)
  if (covered && (cell.waitMs === 0 || !design.honorsWait)) settleFromSqlite()
  if (design.settlesBeforeRestore && covered) state.rowsAtEarlySettle = []
  const restored = observe()

  // early event (t = 0)
  if (cell.upstream === `answers-early`) answer()
  if (cell.upstream === `fails-early`) {
    if (covered && design.failureSettlesCovered) settleFromSqlite()
    else if (!state.settled) state.failed = true
  }
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
  if (cell.upstream === `answers-late`) answer()
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
// preload state, and, when the model is ready, the exact sorted rows.
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

type Upstream = {
  calls: Array<LoadSubsetOptions>
  answer: (rows: ReadonlyArray<Row>) => Promise<void>
  fail: (error: unknown) => void
}

// A generic on-demand source. Each load waits until the test answers or
// fails it. An answer writes the rows in one sync transaction and settles
// the load after its applied receipt.
function onDemandSource(
  driver: SQLiteDriver,
  waitMs: number,
): { collection: Collection<Row, string, any>; upstream: Upstream } {
  const pending: Array<{
    resolve: () => void
    reject: (error: unknown) => void
  }> = []
  let write: ((rows: ReadonlyArray<Row>) => unknown) | undefined
  const upstream: Upstream = {
    calls: [],
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
      persistence: { adapter: new SQLiteCorePersistenceAdapter({ driver }) },
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

function demandD(source: Collection<Row, string, any>) {
  return createLiveQueryCollection((q) =>
    q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
  )
}

async function settleSession1(
  driver: SQLiteDriver,
  history: CoverageHistory,
): Promise<void> {
  if (history === `not-requested`) return
  const { collection, upstream } = onDemandSource(driver, 0)
  const query =
    history === `overlapping-demand`
      ? createLiveQueryCollection((q) =>
          q.from({ row: collection }).where(({ row }) => eq(row.id, `a1`)),
        )
      : demandD(collection)
  try {
    const preload = query.preload()
    await vi.waitFor(() => expect(upstream.calls.length).toBeGreaterThan(0))
    if (history === `failed`) {
      upstream.fail(new Error(`session 1 upstream failed`))
      await preload.catch(() => undefined)
    } else {
      await upstream.answer(SESSION_1_ROWS[history])
      await preload
    }
  } finally {
    await query.cleanup()
    await collection.cleanup()
  }
}

async function drain(): Promise<void> {
  for (let i = 0; i < 25; i++) await vi.advanceTimersByTimeAsync(0)
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
  await settleSession1(driver, cell.history)

  const actual: Partial<Trace> = {}
  vi.useFakeTimers({
    toFake: [
      `setTimeout`,
      `clearTimeout`,
      `setInterval`,
      `clearInterval`,
      `Date`,
    ],
  })
  // Session 2. Configuration throws before this point on an implementation
  // that rejects network-first for on-demand sources; that is a setup
  // failure, not a checkpoint mismatch.
  const { collection, upstream } = onDemandSource(driver, cell.waitMs)
  const query = demandD(collection)
  let preloadState: Observation[`preload`] = `pending`
  void query.preload().then(
    () => (preloadState = `resolved`),
    () => (preloadState = `rejected`),
  )
  const observe = () => observeQuery(query, () => preloadState)
  try {
    for (let i = 0; i < 200 && upstream.calls.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    if (upstream.calls.length === 0) {
      throw new Error(
        `checkpoint not reached: session 2 never started D's upstream load`,
      )
    }
    await drain()
    actual.restored = observe()

    if (cell.upstream === `answers-early`)
      await upstream.answer(SESSION_2_ANSWER)
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

    if (cell.upstream === `answers-late`)
      await upstream.answer(SESSION_2_ANSWER)
    await drain()
    actual.afterLateEvent = observe()
    return actual
  } finally {
    vi.useRealTimers()
    await query.cleanup()
    await collection.cleanup()
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe(`persisted demand coverage oracle`, () => {
  // -------------------------------------------------------------------------
  // Calibration: the comparison rejects wrong answers, and the matrix
  // distinguishes the law from plausible wrong designs (ORC-006, ORC-013).
  // These checks judge the model and comparison; production mutants are run
  // separately against an implementation.
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
      // Any finished local read counts as evidence.
      design: { ...LAW, name: `any local restore`, isCovered: () => true },
      witness: { history: `not-requested`, waitMs: 0, upstream: `pending` },
    },
    {
      // Nonempty local rows count as coverage.
      design: {
        ...LAW,
        name: `nonempty rows`,
        isCovered: (history) => SESSION_1_ROWS[history].length > 0,
      },
      witness: { history: `settled-empty`, waitMs: 0, upstream: `pending` },
    },
    {
      // A different settled demand covers D because its rows match D.
      design: {
        ...LAW,
        name: `overlapping demand`,
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
      design: { ...LAW, name: `ignores the wait`, honorsWait: false },
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
        name: `aborts upstream after SQLite`,
        upstreamContinues: false,
      },
      witness: { history: `settled`, waitMs: 0, upstream: `answers-late` },
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
  // Refinement: each cell runs both sessions and compares every checkpoint.
  // -------------------------------------------------------------------------

  it.each(ALL_CELLS.map((cell) => [cellName(cell), cell] as const))(
    `refines the model: %s`,
    async (_name, cell) => {
      vi.spyOn(console, `warn`).mockImplementation(() => {})
      vi.spyOn(console, `error`).mockImplementation(() => {})
      const actual = await runCell(cell)
      expect(firstMismatch(expectedTrace(cell), actual)).toBeUndefined()
    },
  )

  // -------------------------------------------------------------------------
  // Joined sources. An eager source A restored from SQLite and an on-demand
  // source B. Offline, the network-first wait may release only when B's
  // demands from this query settled from SQLite, so B must be covered by the
  // same joined query in session 1. Collection readiness stays false: A's
  // Collection never becomes ready offline.
  // -------------------------------------------------------------------------

  type Parent = { id: string; value: string }
  type Child = { id: string; parentId: string; value: string }

  function eagerParents(
    adapter: SQLiteCorePersistenceAdapter,
    online: boolean,
  ) {
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

  it.each([
    [`covered by the same joined query`, true],
    [`never requested`, false],
  ] as const)(
    `releases the joined network-first wait only when the on-demand side is covered: %s`,
    async (_name, childCovered) => {
      vi.spyOn(console, `warn`).mockImplementation(() => {})
      const driver = createDriver(new DatabaseSync(`:memory:`))

      // Session 1 is online. The parents always sync; the children are loaded
      // through the joined query only when they should be covered. Both
      // Collections share one adapter per session, as an application does.
      {
        const adapter = new SQLiteCorePersistenceAdapter({ driver })
        const parents = eagerParents(adapter, true)
        const children = onDemandChildren(adapter, true)
        const query = childCovered
          ? joined(parents, children.collection)
          : undefined
        try {
          if (query) await query.preload()
          else await parents.preload()
          // Positive witness: session 1 loaded the children only when covered.
          expect(children.calls.length > 0).toBe(childCovered)
        } finally {
          await query?.cleanup()
          await children.collection.cleanup()
          await parents.cleanup()
        }
      }

      // Session 2 is offline. Model: the wait is 0 ms, so the initial render
      // releases as soon as A has restored and B's covered demand settled.
      // Without coverage it stays pending. Collection readiness never holds.
      vi.useFakeTimers({
        toFake: [
          `setTimeout`,
          `clearTimeout`,
          `setInterval`,
          `clearInterval`,
          `Date`,
        ],
      })
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
      try {
        for (let i = 0; i < 200 && children.calls.length === 0; i++) {
          await vi.advanceTimersByTimeAsync(0)
        }
        // Positive witness: session 2 reached the on-demand side's demand.
        expect(children.calls.length).toBeGreaterThan(0)
        await drain()
        await vi.advanceTimersByTimeAsync(1)
        await drain()

        expect({
          released: initialRender.released,
          isReady: observer.getSnapshot().isReady,
          rows: initialRender.released
            ? observer.getSnapshot().data
            : undefined,
        }).toEqual(
          childCovered
            ? {
                released: true,
                isReady: false,
                rows: [
                  { id: `p1`, parentValue: `parent`, childValue: `child` },
                ],
              }
            : { released: false, isReady: false, rows: undefined },
        )
      } finally {
        vi.useRealTimers()
        unsubscribe()
        observer.dispose()
        await query.cleanup()
        await children.collection.cleanup()
        await parents.cleanup()
      }
    },
  )
})
