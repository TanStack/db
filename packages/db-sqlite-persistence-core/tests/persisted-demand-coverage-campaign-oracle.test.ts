import { DatabaseSync } from 'node:sqlite'
import { fc } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
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
  realMacrotask,
  useFakeClock,
  withCleanup,
  withMacrotaskReads,
} from './helpers/demand-coverage-driver.js'
import type { Row } from './helpers/demand-coverage-driver.js'
import type { Collection, LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type { SQLiteDriver } from '../src/index.js'

/**
 * # Generated histories for persisted demand coverage
 *
 * Law: the persisted demand coverage law of
 * `tests/persisted-demand-coverage-oracle.test.ts` (its opening prose and
 * `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`).
 * That file checks fixed histories. This one generates longer online
 * histories, so that loads, live source writes, releases, and truncates
 * interleave in orders that no fixed history names, and checks one
 * consequence of the law in a later offline session:
 *
 * An offline load of a demand settles from SQLite exactly when an earlier
 * current load of that exact demand settled online, no truncate ended that
 * coverage, and SQLite still holds at least as many of the demand's rows as
 * when the load settled. It then shows the rows SQLite holds for the demand.
 * Every other demand waits for its upstream load.
 *
 * ## History grammar
 *
 * Rows `r1` to `r4` each belong to group `a` or `b` with a rank from 1 to 3,
 * so ranks can tie, or do not exist. Three live queries read demands:
 * `group = 'a'`, `group = 'b'`, and the window `w`, `group = 'a' orderBy
 * rank limit 2`, which core loads as a limited load and a tie-boundary load.
 * Session 1 is online and runs a generated command sequence:
 *
 * - `start d`: a live query starts reading demand d; its load waits.
 * - `answer d`: the source writes its rows of d and settles d's loads.
 * - `settle-oldest d`: the source settles d's oldest waiting load without
 *   writing rows. After a truncate that is the obsolete load, so this
 *   separates an obsolete load from the current one.
 * - `fail d`: the source rejects d's loads; the query is then released.
 * - `release d`: the live query of d is cleaned up, which aborts its load.
 * - `write id group rank`: the source inserts, moves, or re-ranks a row,
 *   without a load.
 * - `delete id`: the source deletes a row, without a load.
 * - `truncate`: the source truncates. Active demands load again.
 *
 * Each history also chooses whether the source honors abort. One that
 * ignores it keeps a load that the wrapper aborted at a truncate waiting, so
 * that obsolete load can still settle; this is the case in which an obsolete
 * load could wrongly record coverage.
 *
 * Session 2 reopens the same database offline, with a wait of 0, and reads
 * all three demands. Its source never answers.
 *
 * ## Model
 *
 * The model replays the source's log of what happened: the rows it wrote or
 * deleted, its truncates, and each load it settled. It keeps the rows SQLite
 * holds and each demand's recorded row count. A source write reaches SQLite
 * whether or not a load asked for it. A load is obsolete when a truncate came
 * between the source receiving it and settling it (law 6 in
 * `packages/db/src/query/live/ARCHITECTURE.md`); it records nothing. A
 * truncate also ends every coverage record and empties SQLite. A current load
 * that settles records how many rows SQLite holds for its exact demand, and
 * for a limited load which rows. A failed or released load records nothing.
 * Offline, a query is ready exactly when every load it sent in session 2 is
 * covered. When the wrapper asks for a demand again after a truncate, and
 * when core sends a window's tie-boundary load, is scheduling that the law
 * leaves open, so the model reads both from the logs instead of predicting
 * them.
 *
 * ## Observation and checkpoint
 *
 * After session 2 has waited 300 ms of real time, each live query's status
 * and its rows (the window's in order), compared exactly with the model.
 *
 * Declared reach (ORC-015): histories in which a demand is covered offline,
 * uncovered offline, covered but short of rows, ended by a truncate, settled
 * through an obsolete load, moved between demands, and recorded twice; a
 * window covered offline, a window that holds other rows than it recorded,
 * and a window whose tie-boundary load is uncovered. The fixed and random
 * campaigns run the same property with 40 histories each.
 *
 * Parts 2 and 3 sweep a storage failure over every adapter call and a
 * release over every step of a load; their laws are stated beside them.
 *
 * Limits: a session-1 wait long enough that no session-1 load settles from
 * SQLite except on failure; real timers in session 1, so checkpoints are
 * coarse; no cursor or offset loads (page moves are in the fixed oracle);
 * one process and the default coordinator; `node:sqlite` only.
 */

type Group = `a` | `b`
const IDS = [`r1`, `r2`, `r3`, `r4`] as const
type Id = (typeof IDS)[number]
type Rank = 1 | 2 | 3
type RowState = { group: Group; rank: Rank }
// The demands that live queries read: each group unordered, and the window
// `group = 'a' orderBy rank limit 2`.
type Demand = `a` | `b` | `w`
const DEMANDS: ReadonlyArray<Demand> = [`a`, `b`, `w`]
const groupOf = (demand: Demand): Group => (demand === `b` ? `b` : `a`)
const WINDOW_LIMIT = 2

type Command =
  | { type: `start`; demand: Demand }
  | { type: `answer`; demand: Demand }
  | { type: `settle-oldest`; demand: Demand }
  | { type: `fail`; demand: Demand }
  | { type: `release`; demand: Demand }
  | { type: `write`; id: Id; group: Group; rank: Rank }
  | { type: `delete`; id: Id }
  | { type: `truncate` }

type History = {
  // A source that honors abort drops a load that the wrapper aborts; one
  // that ignores it may still settle that load later.
  honorsAbort: boolean
  initial: Partial<Record<Id, RowState>>
  commands: ReadonlyArray<Command>
}

type Observation = Record<
  Demand,
  { ready: boolean; rows?: ReadonlyArray<string> }
>

// ---------------------------------------------------------------------------
// Model
//
// The model replays the source's log of what happened, not the commands:
// which rows the source wrote or deleted, when it truncated, and each load it
// settled. A load is current when no truncate came between the source
// receiving it and settling it, and obsolete otherwise (law 6). When the
// wrapper asks for a demand again after a truncate is its own scheduling,
// which the law leaves open, so the model does not predict it.
//
// Coverage is per exact demand (`getLoadSubsetDemandKey`, the law's demand
// identity). A current load that settles records how many rows SQLite holds
// for its demand, and for a limited load, which rows. Offline, a load is
// covered when its demand has a record, SQLite still holds at least that
// many of its rows, and a limited load holds the same rows. A query is ready
// offline exactly when every load it sent in session 2 is covered. The model
// reads those loads from session 2's log instead of predicting them: when a
// window sends its tie-boundary load, and for which boundary, follows from
// the restored rows and is core's scheduling.
//
// To read a demand's rows, the model evaluates the load's own filter, order,
// and limit over the rows SQLite holds. Ties in an order break by key, as the
// SQLite adapter's `ORDER BY ..., key ASC` does (an abstraction, ORC-009).
// ---------------------------------------------------------------------------

type SourceEvent =
  | { type: `rows`; rows: ReadonlyArray<readonly [Id, RowState]> }
  | { type: `delete`; id: Id }
  | { type: `truncate` }
  | { type: `settled`; load: LoadSubsetOptions; current: boolean }

type ReachState =
  | `covered offline`
  | `uncovered offline`
  | `covered but short of rows`
  | `coverage ended by a truncate`
  | `obsolete load settled`
  | `row moved between demands`
  | `coverage recorded twice`
  | `window covered offline`
  | `window holds other rows`
  | `tie-boundary load uncovered`

// The expression forms these loads carry (`packages/db/src/query/ir.ts`).
type Expr = {
  type?: string
  name?: string
  args?: ReadonlyArray<Expr>
  path?: ReadonlyArray<string>
  value?: unknown
}
type ModelRow = { id: Id; group: Group; rank: Rank }

function evaluate(expr: Expr, row: ModelRow): unknown {
  if (expr.type === `ref`) {
    return row[expr.path![expr.path!.length - 1] as keyof ModelRow]
  }
  if (expr.type === `val`) return expr.value
  const args = (expr.args ?? []).map((arg) => evaluate(arg, row))
  const [left, right] = args as [never, never]
  switch (expr.name) {
    case `eq`:
      return left === right
    case `gt`:
      return left > right
    case `gte`:
      return left >= right
    case `lt`:
      return left < right
    case `lte`:
      return left <= right
    case `and`:
      return args.every(Boolean)
    case `or`:
      return args.some(Boolean)
    case `not`:
      return !left
  }
  throw new Error(`unmodelled expression ${JSON.stringify(expr)}`)
}

// The rows a load reads from SQLite, in its order.
function readDemand(
  load: LoadSubsetOptions,
  sqlite: Map<Id, RowState>,
): Array<Id> {
  if (load.cursor !== undefined || load.offset !== undefined) {
    throw new Error(`unmodelled load ${demandKey(load)}`)
  }
  const where = load.where as Expr | undefined
  const rows = [...sqlite]
    .map(([id, state]): ModelRow => ({ id, ...state }))
    .filter((row) => where === undefined || evaluate(where, row) === true)
  const orderBy = (load.orderBy ?? []) as unknown as ReadonlyArray<{
    expression: Expr
    compareOptions?: { direction?: `asc` | `desc` }
  }>
  rows.sort((x, y) => {
    for (const { expression, compareOptions } of orderBy) {
      const a = evaluate(expression, x) as number
      const b = evaluate(expression, y) as number
      if (a !== b) {
        return (
          (a < b ? -1 : 1) * (compareOptions?.direction === `desc` ? -1 : 1)
        )
      }
    }
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
  })
  const ids = rows.map((row) => row.id)
  return load.limit === undefined ? ids : ids.slice(0, load.limit)
}

// The demand identity the law uses: two loads cover each other only with
// the same key.
const demandKey = (load: LoadSubsetOptions): string =>
  String(getLoadSubsetDemandKey(load))
const rowsKey = (ids: ReadonlyArray<Id>) => JSON.stringify([...ids].sort())
const windowRows = (sqlite: Map<Id, RowState>): Array<Id> =>
  [...sqlite]
    .filter(([, state]) => state.group === `a`)
    .sort(([x, a], [y, b]) => a.rank - b.rank || (x < y ? -1 : 1))
    .slice(0, WINDOW_LIMIT)
    .map(([id]) => id)

function expectedObservation(
  events: ReadonlyArray<SourceEvent>,
  sent: Record<Demand, ReadonlyArray<LoadSubsetOptions>>,
  reach: (state: ReachState) => void,
): Observation {
  // SQLite holds every row the source wrote since its last truncate; a
  // source write reaches it whether or not a load asked for the row.
  const sqlite = new Map<Id, RowState>()
  // Each demand's record: its row count and, for a limited load, its rows.
  const records = new Map<string, { count: number; rows?: string }>()
  for (const event of events) {
    switch (event.type) {
      case `rows`:
        for (const [id, state] of event.rows) {
          const before = sqlite.get(id)
          if (before !== undefined && before.group !== state.group) {
            reach(`row moved between demands`)
          }
          sqlite.set(id, state)
        }
        break
      case `delete`:
        sqlite.delete(event.id)
        break
      case `truncate`:
        if (records.size > 0) reach(`coverage ended by a truncate`)
        sqlite.clear()
        records.clear()
        break
      case `settled`: {
        if (!event.current) {
          reach(`obsolete load settled`)
          break
        }
        const key = demandKey(event.load)
        if (records.has(key)) reach(`coverage recorded twice`)
        const rows = readDemand(event.load, sqlite)
        records.set(key, {
          count: rows.length,
          rows: event.load.limit === undefined ? undefined : rowsKey(rows),
        })
      }
    }
  }
  const covered = (load: LoadSubsetOptions): boolean => {
    const record = records.get(demandKey(load))
    if (record === undefined) return false
    const rows = readDemand(load, sqlite)
    if (rows.length < record.count) {
      reach(`covered but short of rows`)
      return false
    }
    if (record.rows !== undefined && record.rows !== rowsKey(rows)) {
      reach(`window holds other rows`)
      return false
    }
    return true
  }
  const observation = {} as Observation
  for (const demand of DEMANDS) {
    const loads = sent[demand]
    // Positive witness: session 2 asked the offline source for the demand.
    if (loads.length === 0) {
      throw new Error(`session 2 sent no load for demand ${demand}`)
    }
    const coverage = loads.map(covered)
    if (demand === `w` && coverage[0] && coverage.includes(false)) {
      reach(`tie-boundary load uncovered`)
    }
    if (!coverage.every(Boolean)) {
      reach(`uncovered offline`)
      observation[demand] = { ready: false }
      continue
    }
    reach(demand === `w` ? `window covered offline` : `covered offline`)
    observation[demand] = {
      ready: true,
      rows:
        demand === `w`
          ? windowRows(sqlite)
          : [...sqlite]
              .filter(([, state]) => state.group === demand)
              .map(([id]) => id)
              .sort(),
    }
  }
  return observation
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

const rowFor = (
  id: Id,
  group: Group,
  rank: number = IDS.indexOf(id) + 1,
): Row => ({ id, group, rank, value: `v1` })

// The live query a demand label names.
function queryFor(source: Collection<Row, string, any>, demand: Demand) {
  if (demand !== `w`) return filterQuery(source, demand)
  return createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .where(({ row }) => eq(row.group, `a`))
      .orderBy(({ row }) => row.rank)
      .limit(WINDOW_LIMIT),
  )
}

// Which live query a load serves: the window's loads carry a limit or a
// rank bound; the others filter one group.
function demandOf(options: LoadSubsetOptions): Demand {
  const text = JSON.stringify(options.where)
  if (options.limit !== undefined || text.includes(`"rank"`)) return `w`
  if (text.includes(`"value":"a"`)) return `a`
  if (text.includes(`"value":"b"`)) return `b`
  throw new Error(`unexpected demand ${text}`)
}

type SyncParams = Parameters<SyncConfig<Row, string>[`sync`]>[0]
type Pending = {
  resolve: () => void
  reject: (error: unknown) => void
  options: LoadSubsetOptions
  // The source's truncate count when it received the load.
  epoch: number
}

// A generic on-demand source whose loads wait per demand. It writes only
// what the driver tells it to; the driver tracks which rows it wrote since
// the last truncate, so it never deletes a row the Collection lacks.
function campaignSource(
  driver: SQLiteDriver,
  online: boolean,
  waitMs: number,
  honorsAbort = true,
) {
  const pending = new Map<Demand, Array<Pending>>()
  const sent: Record<Demand, Array<LoadSubsetOptions>> = { a: [], b: [], w: [] }
  const events: Array<SourceEvent> = []
  let epoch = 0
  const settled = (load: Pending) => {
    events.push({
      type: `settled`,
      load: load.options,
      current: load.epoch === epoch,
    })
    load.resolve()
  }
  let params: SyncParams | undefined
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: `demand-coverage-campaign`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: { strategy: `network-first`, networkTimeoutMs: waitMs },
      persistence: { adapter: new SQLiteCorePersistenceAdapter({ driver }) },
      sync: {
        sync: (syncParams) => {
          params = syncParams
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              const demand = demandOf(options)
              sent[demand].push(options)
              if (!online) return new Promise<void>(() => {})
              return new Promise<void>((resolve, reject) => {
                const entry = { resolve, reject, options, epoch }
                pending.set(demand, [...(pending.get(demand) ?? []), entry])
                options.signal?.addEventListener(
                  `abort`,
                  () => {
                    if (!honorsAbort) return
                    pending.set(
                      demand,
                      (pending.get(demand) ?? []).filter((e) => e !== entry),
                    )
                    reject(new DOMException(`aborted`, `AbortError`))
                  },
                  { once: true },
                )
              })
            },
          }
        },
      },
    }),
  )
  const written = new Set<Id>()
  const commit = async (apply: (sync: SyncParams) => void): Promise<void> => {
    const sync = params!
    sync.begin()
    apply(sync)
    await sync.commit()
  }
  const writeRows = async (rows: ReadonlyArray<readonly [Id, RowState]>) => {
    await commit((sync) => {
      for (const [id, state] of rows) {
        sync.write({
          type: written.has(id) ? `update` : `insert`,
          value: rowFor(id, state.group, state.rank),
        })
        written.add(id)
      }
    })
    events.push({ type: `rows`, rows })
  }
  return {
    collection,
    sent,
    events,
    started: () => params !== undefined,
    hasPending: (demand: Demand) => (pending.get(demand)?.length ?? 0) > 0,
    async answer(demand: Demand, rows: ReadonlyArray<readonly [Id, RowState]>) {
      await writeRows(rows)
      for (const load of pending.get(demand)?.splice(0) ?? []) settled(load)
    },
    // A released demand's loads stop at the source either way.
    forget(demand: Demand) {
      pending.delete(demand)
    },
    settleOldest(demand: Demand) {
      const load = pending.get(demand)?.shift()
      if (load) settled(load)
    },
    fail(demand: Demand) {
      for (const load of pending.get(demand)?.splice(0) ?? []) {
        load.reject(new Error(`offline`))
      }
    },
    write: (id: Id, state: RowState) => writeRows([[id, state]]),
    async remove(id: Id) {
      if (!written.has(id)) return
      written.delete(id)
      await commit((sync) =>
        sync.write({ type: `delete`, value: rowFor(id, `a`) }),
      )
      events.push({ type: `delete`, id })
    },
    async truncate() {
      written.clear()
      epoch++
      await commit((sync) => sync.truncate())
      events.push({ type: `truncate` })
    },
  }
}

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

async function runHistory(history: History): Promise<{
  observation: Observation
  events: ReadonlyArray<SourceEvent>
  sent: Record<Demand, ReadonlyArray<LoadSubsetOptions>>
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const truth = new Map(
    Object.entries(history.initial) as Array<[Id, RowState]>,
  )
  let events: ReadonlyArray<SourceEvent> = []

  // Session 1 is online. Its wait is long, so a load settles from SQLite
  // only when its upstream load fails.
  {
    const source = campaignSource(driver, true, 60_000, history.honorsAbort)
    events = source.events
    const queries = new Map<Demand, ReturnType<typeof queryFor>>()
    // A reacquired load, or a window's tie-boundary load, reaches the source
    // shortly after an earlier load settles, so wait a little before a no-op.
    const untilPending = async (demand: Demand) => {
      if (!queries.has(demand)) return
      for (let i = 0; i < 10 && !source.hasPending(demand); i++) await settle(5)
    }
    const release = async (demand: Demand) => {
      const query = queries.get(demand)
      queries.delete(demand)
      await query?.cleanup()
      source.forget(demand)
      await settle()
    }
    await withCleanup(async () => {
      // An on-demand Collection starts its sync at the first preload, so a
      // source write before any load has a sync to write through.
      // The source never marks the Collection ready, so do not await it.
      void source.collection.preload().catch(() => undefined)
      for (let i = 0; i < 50 && !source.started(); i++) await settle(5)
      expect(source.started()).toBe(true)
      for (const command of history.commands) {
        switch (command.type) {
          case `start`: {
            if (queries.has(command.demand)) break
            const query = queryFor(source.collection, command.demand)
            queries.set(command.demand, query)
            void query.preload().catch(() => undefined)
            for (let i = 0; i < 50 && !source.hasPending(command.demand); i++) {
              await settle(5)
            }
            // Positive witness: the demand reached the source.
            expect(source.hasPending(command.demand)).toBe(true)
            break
          }
          case `answer`: {
            await untilPending(command.demand)
            if (!source.hasPending(command.demand)) break
            // A source may return more rows than a load asks for: it
            // answers with every row of the demand's group.
            const group = groupOf(command.demand)
            await source.answer(
              command.demand,
              [...truth].filter(([, state]) => state.group === group),
            )
            await settle()
            break
          }
          case `settle-oldest`:
            await untilPending(command.demand)
            source.settleOldest(command.demand)
            await settle()
            break
          case `fail`:
            if (!queries.has(command.demand)) break
            source.fail(command.demand)
            await settle()
            await release(command.demand)
            break
          case `release`:
            await release(command.demand)
            break
          case `write`: {
            const state = { group: command.group, rank: command.rank }
            truth.set(command.id, state)
            await source.write(command.id, state)
            await settle()
            break
          }
          case `delete`:
            truth.delete(command.id)
            await source.remove(command.id)
            await settle()
            break
          case `truncate`: {
            await source.truncate()
            // Active demands load again after the truncate; when is the
            // wrapper's scheduling, so the driver only gives it a moment.
            for (let i = 0; i < 50; i++) {
              if ([...queries.keys()].every((d) => source.hasPending(d))) break
              await settle(5)
            }
            break
          }
        }
      }
      await settle(50)
    }, [
      ...DEMANDS.map((demand) => () => queries.get(demand)?.cleanup()),
      () => source.collection.cleanup(),
    ])
  }

  // Session 2 is offline.
  const source = campaignSource(driver, false, 0)
  const queries = DEMANDS.map((demand) => queryFor(source.collection, demand))
  return withCleanup(async () => {
    for (const query of queries) void query.preload().catch(() => undefined)
    await settle(300)
    const observation = {} as Observation
    DEMANDS.forEach((demand, index) => {
      const query = queries[index]!
      const ids = query.toArray.map((row) => row.id)
      observation[demand] =
        query.status === `ready`
          ? { ready: true, rows: demand === `w` ? ids : ids.sort() }
          : { ready: false }
    })
    return { observation, events, sent: source.sent }
  }, [
    ...queries.map((query) => () => query.cleanup()),
    () => source.collection.cleanup(),
  ])
}

// ---------------------------------------------------------------------------
// Part 2: swept storage failures
//
// One history, with a storage failure swept over every call. Session 1
// covers D (`group = 'a'`) online with `a1` and `a2`; session 2 reads D
// offline. The adapter fails exactly one asynchronous call, the Nth call of
// one session, either before the call takes effect or after it took effect
// (the acknowledgement is lost). N runs over every call that the history
// makes without a failure, so every storage boundary on the path fails once.
//
// Laws:
// - Safety, for every N: if session 2 settles D from SQLite, it shows
//   exactly `a1` and `a2`. A failure never makes an incomplete restore look
//   complete.
// - A failed coverage read in session 1 (a read after the answer) keeps the
//   load's outcome: the session-1 query is ready on `a1` and `a2`, and with
//   no record session 2 waits.
// - A failed row write in session 1, before it takes effect, leaves no
//   coverage: session 2 waits.
// - A failed coverage check in session 2 (a read after the restore
//   published) proves nothing: session 2 waits and does not fail.
// Other failures, such as a startup read, a claim, or an acknowledgement
// lost after the write applied, are held only to safety.
// ---------------------------------------------------------------------------

type FailureTiming = `before effect` | `after effect`
type StorageCall = {
  session: 1 | 2
  method: string
  // A read after the answer (session 1) or after the restore (session 2).
  late: boolean
  rows: boolean
}

function failingAdapter(
  adapter: SQLiteCorePersistenceAdapter,
  session: 1 | 2,
  log: Array<StorageCall>,
  late: () => boolean,
  failAt: { index: number; timing: FailureTiming } | undefined,
): SQLiteCorePersistenceAdapter {
  return new Proxy(adapter, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      // The adapter's one synchronous method is not a storage call.
      if (typeof value !== `function` || property === `getCacheGenerationNow`) {
        return typeof value === `function` ? value.bind(target) : value
      }
      return (...args: Array<unknown>) => {
        const call = (): unknown => Reflect.apply(value, target, args)
        const index = log.length
        const tx = args[1] as { mutations?: Array<unknown> } | undefined
        const entry: StorageCall = {
          session,
          method: String(property),
          late: late(),
          rows:
            property === `applyCommittedTx` && (tx?.mutations?.length ?? 0) > 0,
        }
        log.push(entry)
        if (failAt?.index !== index) return call()
        const failure = new Error(`injected storage failure`)
        if (failAt.timing === `before effect`) return Promise.reject(failure)
        return Promise.resolve(call()).then(() => Promise.reject(failure))
      }
    },
  })
}

// Cleanup may report the injected failure, for example from a claim release.
// That is the failure doing its job; any other cleanup error still fails.
function fromInjectedFailure(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (cause.message.includes(`injected storage failure`)) return true
  }
  return false
}
const tolerateInjected = (cleanup: () => unknown) => async () => {
  try {
    await cleanup()
  } catch (error) {
    if (!fromInjectedFailure(error)) throw error
  }
}

type FaultObservation = {
  session1: { status: string; rows: Array<string> }
  session2: { status: string; rows: Array<string> }
}

async function runWithFault(
  failure: { session: 1 | 2; index: number; timing: FailureTiming } | undefined,
): Promise<FaultObservation & { calls: Array<StorageCall> }> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const calls: Array<StorageCall> = []
  const failAtFor = (session: 1 | 2) =>
    failure?.session === session ? failure : undefined
  const observe = (query: ReturnType<typeof filterQuery>) => ({
    status: query.status,
    rows: query.toArray.map((row) => row.id).sort(),
  })
  let session1: FaultObservation[`session1`]
  {
    const phase = { answered: false }
    const sessionCalls: Array<StorageCall> = []
    const { collection, upstream } = onDemandSource(
      failingAdapter(
        new SQLiteCorePersistenceAdapter({ driver }),
        1,
        sessionCalls,
        () => phase.answered,
        failAtFor(1),
      ),
      0,
    )
    const query = filterQuery(collection, `a`)
    session1 = await withCleanup(async () => {
      void query.preload().catch(() => undefined)
      for (let i = 0; i < 60 && upstream.pendingCount() === 0; i++) {
        await settle(5)
      }
      phase.answered = true
      if (upstream.pendingCount() > 0) {
        await upstream
          .answer([rowFor(`r1`, `a`), rowFor(`r2`, `a`)])
          .catch(() => undefined)
      }
      await settle(150)
      return observe(query)
    }, [
      tolerateInjected(() => query.cleanup()),
      tolerateInjected(() => collection.cleanup()),
    ])
    calls.push(...sessionCalls)
  }
  const holder: { collection?: { toArray: Array<unknown> } } = {}
  const sessionCalls: Array<StorageCall> = []
  const { collection } = onDemandSource(
    failingAdapter(
      new SQLiteCorePersistenceAdapter({ driver }),
      2,
      sessionCalls,
      () => (holder.collection?.toArray.length ?? 0) > 0,
      failAtFor(2),
    ),
    0,
  )
  holder.collection = collection
  const query = filterQuery(collection, `a`)
  const session2 = await withCleanup(async () => {
    void query.preload().catch(() => undefined)
    await settle(300)
    return observe(query)
  }, [
    tolerateInjected(() => query.cleanup()),
    tolerateInjected(() => collection.cleanup()),
  ])
  calls.push(...sessionCalls)
  return { session1, session2, calls }
}

// The law for one failure, given the call that failed.
function checkFault(
  failed: StorageCall,
  timing: FailureTiming,
  observed: FaultObservation,
  reach: (state: FaultReach) => void,
): void {
  if (observed.session2.status === `ready`) {
    expect(observed.session2.rows).toEqual([`r1`, `r2`])
  }
  if (failed.session === 1 && failed.method === `loadSubset` && failed.late) {
    reach(`coverage read failed`)
    expect(observed.session1).toEqual({ status: `ready`, rows: [`r1`, `r2`] })
    expect(observed.session2.status).toBe(`loading`)
  }
  if (failed.session === 1 && failed.rows && timing === `before effect`) {
    reach(`row write failed`)
    expect(observed.session2.status).toBe(`loading`)
  }
  if (failed.session === 2 && failed.method === `loadSubset` && failed.late) {
    reach(`coverage check failed`)
    expect(observed.session2.status).toBe(`loading`)
  }
}

type FaultReach =
  `coverage read failed` | `row write failed` | `coverage check failed`

// ---------------------------------------------------------------------------
// Part 3: swept releases
//
// A release can land at any await of a load. Session 1 covers D online. In
// session 2, with a 1000 ms wait and a fake clock, the live query of D is
// released after K steps, for every K up to the step at which the load would
// have settled; each step is one zero-length clock turn and one real
// macrotask, and reads answer on a later macrotask. Laws (a released load
// owns no wait; law 6 in `ARCHITECTURE.md`):
//
// - after the release, the source Collection is not loading a subset, and
//   it stays so when the clock passes the wait;
// - every upstream load that the release left behind was aborted, and no
//   upstream load starts after the release.
//
// Declared reach: a release before the load reached the source, while it
// waited on the source, and while a coverage read was in flight.
// ---------------------------------------------------------------------------

type ReleaseReach =
  | `released before the source load`
  | `released while the source load waited`
  | `released during a coverage read`

// Session 1 online: D loads `r1` and `r2` and records coverage.
async function coverGroupA(driver: SQLiteDriver): Promise<void> {
  const { collection, upstream } = onDemandSource(
    new SQLiteCorePersistenceAdapter({ driver }),
    0,
  )
  const query = filterQuery(collection, `a`)
  await withCleanup(async () => {
    const preload = query.preload()
    for (let i = 0; i < 60 && upstream.pendingCount() === 0; i++) {
      await settle(5)
    }
    await upstream.answer([rowFor(`r1`, `a`), rowFor(`r2`, `a`)])
    await preload
    await settle(50)
  }, [() => query.cleanup(), () => collection.cleanup()])
}

async function runReleaseAt(
  driver: SQLiteDriver,
  steps: number,
  reach: (state: ReleaseReach) => void,
): Promise<{ loadingAfterRelease: boolean; loadingAfterWait: boolean }> {
  useFakeClock()
  const reads = { restored: false, inFlight: 0 }
  const holder: { collection?: { toArray: Array<unknown> } } = {}
  const base = new SQLiteCorePersistenceAdapter({
    driver: withMacrotaskReads(driver),
  })
  const adapter = new Proxy(base, {
    get(target, property) {
      if (property === `loadSubset`) {
        return async (...args: Parameters<typeof target.loadSubset>) => {
          const late = (holder.collection?.toArray.length ?? 0) > 0
          if (late) reads.inFlight++
          try {
            // A read after the restore spans three macrotasks, so that some
            // step of the sweep releases while it is in flight.
            if (late) {
              await realMacrotask()
              await realMacrotask()
            }
            return await target.loadSubset(...args)
          } finally {
            if (late) reads.inFlight--
          }
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === `function` ? value.bind(target) : value
    },
  })
  const { collection, upstream } = onDemandSource(adapter, 1000)
  holder.collection = collection
  const query = filterQuery(collection, `a`)
  return withCleanup(async () => {
    void query.preload().catch(() => undefined)
    for (let i = 0; i < steps; i++) {
      await vi.advanceTimersByTimeAsync(0)
      await realMacrotask()
    }
    if (upstream.calls.length === 0) reach(`released before the source load`)
    else reach(`released while the source load waited`)
    if (reads.inFlight > 0) reach(`released during a coverage read`)
    const callsAtRelease = upstream.calls.length
    await query.cleanup()
    await drain()
    const loadingAfterRelease = collection.isLoadingSubset
    // Every upstream load left behind was aborted.
    expect(upstream.calls.filter((call) => !call.signal?.aborted)).toEqual([])
    await vi.advanceTimersByTimeAsync(2000)
    await drain()
    // A released demand starts no upstream load later.
    expect(upstream.calls.length).toBe(callsAtRelease)
    return { loadingAfterRelease, loadingAfterWait: collection.isLoadingSubset }
  }, [
    () => vi.useRealTimers(),
    () => query.cleanup(),
    () => collection.cleanup(),
  ])
}

// ---------------------------------------------------------------------------
// Generators and campaigns
// ---------------------------------------------------------------------------

const groupArb = fc.constantFrom<Group>(`a`, `b`)
const demandArb = fc.constantFrom<Demand>(`a`, `b`, `w`)
const rankArb = fc.constantFrom<Rank>(1, 2, 3)
const idArb = fc.constantFrom<Id>(...IDS)
const onDemand = <T extends Command[`type`]>(type: T, weight: number) => ({
  arbitrary: fc.record({ type: fc.constant(type), demand: demandArb }),
  weight,
})
const commandArb = fc.oneof(
  onDemand(`start`, 4),
  onDemand(`answer`, 4),
  onDemand(`settle-oldest`, 1),
  onDemand(`fail`, 1),
  onDemand(`release`, 2),
  {
    arbitrary: fc.record({
      type: fc.constant(`write` as const),
      id: idArb,
      group: groupArb,
      rank: rankArb,
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({ type: fc.constant(`delete` as const), id: idArb }),
    weight: 2,
  },
  { arbitrary: fc.constant({ type: `truncate` as const }), weight: 1 },
) as fc.Arbitrary<Command>

// A full load cycle answers twice, so that a window's tie-boundary load,
// which follows its limited load, settles too.
const cycle = (demand: Demand): ReadonlyArray<Command> => [
  { type: `start`, demand },
  { type: `answer`, demand },
  { type: `answer`, demand },
  { type: `release`, demand },
]

// Compound steps make the rarer orders likely: a covered demand that then
// loses, gains, or moves a row; a full load cycle, which a later cycle of
// the same demand records again; and a truncate while a load waits,
// answered or settled alone. Each is only a sequence of the commands above.
const stepArb: fc.Arbitrary<ReadonlyArray<Command>> = fc.oneof(
  { arbitrary: commandArb.map((command) => [command]), weight: 6 },
  {
    arbitrary: fc
      .tuple(
        demandArb,
        idArb,
        rankArb,
        fc.constantFrom(`move`, `delete`, `rerank`),
      )
      .map(([demand, id, rank, change]): ReadonlyArray<Command> => [
        { type: `write`, id, group: groupOf(demand), rank },
        ...cycle(demand),
        change === `delete`
          ? { type: `delete`, id }
          : {
              type: `write`,
              id,
              group:
                change === `move`
                  ? groupOf(demand) === `a`
                    ? `b`
                    : `a`
                  : groupOf(demand),
              rank: rank === 1 ? 3 : 1,
            },
      ]),
    weight: 3,
  },
  { arbitrary: demandArb.map(cycle), weight: 2 },
  {
    arbitrary: demandArb.map((demand): ReadonlyArray<Command> => [
      { type: `start`, demand },
      { type: `truncate` },
      { type: `answer`, demand },
    ]),
    weight: 1,
  },
  {
    arbitrary: demandArb.map((demand): ReadonlyArray<Command> => [
      { type: `start`, demand },
      { type: `truncate` },
      { type: `settle-oldest`, demand },
    ]),
    weight: 1,
  },
)
const historyArb: fc.Arbitrary<History> = fc.record({
  honorsAbort: fc.boolean(),
  initial: fc
    .record(
      Object.fromEntries(
        IDS.map((id) => [
          id,
          fc.option(fc.record({ group: groupArb, rank: rankArb }), {
            nil: undefined,
          }),
        ]),
      ) as Record<Id, fc.Arbitrary<RowState | undefined>>,
    )
    .map(
      (initial) =>
        Object.fromEntries(
          Object.entries(initial).filter(([, state]) => state !== undefined),
        ) as Partial<Record<Id, RowState>>,
    ),
  commands: fc
    .array(stepArb, { minLength: 2, maxLength: 8 })
    .map((steps) => steps.flat()),
})

const PROPERTY = `persisted-demand-coverage.history`
const RUNS = 40
const REACH_STATES: ReadonlyArray<ReachState> = [
  `covered offline`,
  `uncovered offline`,
  `covered but short of rows`,
  `coverage ended by a truncate`,
  `obsolete load settled`,
  `row moved between demands`,
  `coverage recorded twice`,
  `window covered offline`,
  `window holds other rows`,
  `tie-boundary load uncovered`,
]

async function campaign(options: Parameters<typeof fc.assert>[1]) {
  const reach = createOracleReach<ReachState>(PROPERTY, REACH_STATES)
  await fc.assert(
    fc.asyncProperty(historyArb, async (history) => {
      reach.beginHistory()
      const { observation, events, sent } = await runHistory(history)
      expect(observation).toEqual(
        expectedObservation(events, sent, (state) => reach.reach(state)),
      )
    }),
    options,
  )
  reach.assertReached()
  return reach.counts()
}

describe(`persisted demand coverage over generated histories`, () => {
  it(`keeps the law when any one storage call fails`, async () => {
    quietConsole()
    const baseline = await runWithFault(undefined)
    // Positive witness: without a failure, session 2 settles D offline.
    expect(baseline.session2).toEqual({ status: `ready`, rows: [`r1`, `r2`] })
    const reach = createOracleReach<FaultReach>(
      `persisted demand coverage storage failures`,
      [`coverage read failed`, `row write failed`, `coverage check failed`],
    )
    for (const session of [1, 2] as const) {
      const count = baseline.calls.filter((c) => c.session === session).length
      for (let index = 0; index < count; index++) {
        for (const timing of [`before effect`, `after effect`] as const) {
          reach.beginHistory()
          const run = await runWithFault({ session, index, timing })
          const failed = run.calls.filter((c) => c.session === session)[index]
          if (!failed) continue
          try {
            checkFault(failed, timing, run, (state) => reach.reach(state))
          } catch (error) {
            throw new Error(
              `failure at session ${session} call ${index} ` +
                `(${failed.method}, ${timing}, late: ${failed.late})`,
              { cause: error },
            )
          }
        }
      }
    }
    reach.assertReached()
  }, 600_000)

  it(`owns no wait after a release at any step of a load`, async () => {
    quietConsole()
    const driver = createDriver(new DatabaseSync(`:memory:`))
    await coverGroupA(driver)
    const reach = createOracleReach<ReleaseReach>(
      `persisted demand coverage releases`,
      [
        `released before the source load`,
        `released while the source load waited`,
        `released during a coverage read`,
      ],
    )
    for (let steps = 0; steps <= 24; steps++) {
      reach.beginHistory()
      const observed = await runReleaseAt(driver, steps, (state) =>
        reach.reach(state),
      )
      expect({ steps, ...observed }).toEqual({
        steps,
        loadingAfterRelease: false,
        loadingAfterWait: false,
      })
    }
    reach.assertReached()
  }, 300_000)

  it(`rejects a model that ignores lost rows, obsolete loads, or other window rows`, () => {
    // Calibration over the source log alone. A load covers a over two rows;
    // deleting one ends coverage; an obsolete load never covers; a window
    // that holds other rows than it recorded is not covered.
    const loadA: LoadSubsetOptions = {
      where: new IR.Func(`eq`, [new IR.PropRef([`group`]), new IR.Value(`a`)]),
    }
    const loadW = {
      ...loadA,
      orderBy: [
        {
          expression: new IR.PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ],
      limit: 2,
    } as unknown as LoadSubsetOptions
    const rows: SourceEvent = {
      type: `rows`,
      rows: [
        [`r1`, { group: `a`, rank: 1 }],
        [`r2`, { group: `a`, rank: 2 }],
      ],
    }
    const sent = { a: [loadA], b: [], w: [loadW] }
    const ignore = () => {}
    const covered: ReadonlyArray<SourceEvent> = [
      rows,
      { type: `settled`, load: loadA, current: true },
      { type: `settled`, load: loadW, current: true },
    ]
    const observe = (events: ReadonlyArray<SourceEvent>) =>
      expectedObservation(events, { ...sent, b: [loadA] }, ignore)
    expect(observe(covered).a).toEqual({ ready: true, rows: [`r1`, `r2`] })
    expect(observe([...covered, { type: `delete`, id: `r1` }]).a).toEqual({
      ready: false,
    })
    expect(
      observe([rows, { type: `settled`, load: loadA, current: false }]).a,
    ).toEqual({ ready: false })
    expect(observe(covered).w).toEqual({ ready: true, rows: [`r1`, `r2`] })
    expect(
      observe([
        ...covered,
        { type: `rows`, rows: [[`r3`, { group: `a`, rank: 0 as Rank }]] },
      ]).w,
    ).toEqual({ ready: false })
  })

  it.skipIf(oracleReplayRequested())(
    `refines the model over a fixed campaign`,
    async () => {
      quietConsole()
      await campaign({ seed: 2102, numRuns: oracleRuns(RUNS) })
    },
    120_000,
  )

  it(`refines the model over a random or replayed campaign`, async () => {
    quietConsole()
    await campaign(oraclePropertyOptions(RUNS, PROPERTY))
  }, 120_000)
})
