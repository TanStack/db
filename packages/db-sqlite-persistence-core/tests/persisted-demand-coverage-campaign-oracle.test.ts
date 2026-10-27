import { DatabaseSync } from 'node:sqlite'
import { fc } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
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
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'
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
 * Rows `r1` to `r4` each belong to group `a` or `b`, or do not exist. The two
 * demands are `group = 'a'` and `group = 'b'`, each read by a live query.
 * Session 1 is online and runs a generated command sequence:
 *
 * - `start d`: a live query starts reading demand d; its load waits.
 * - `answer d`: the source writes its rows of d and settles d's loads.
 * - `settle-oldest d`: the source settles d's oldest waiting load without
 *   writing rows. After a truncate that is the obsolete load, so this
 *   separates an obsolete load from the current one.
 * - `fail d`: the source rejects d's loads; the query is then released.
 * - `release d`: the live query of d is cleaned up, which aborts its load.
 * - `write id group`: the source inserts or moves a row, without a load.
 * - `delete id`: the source deletes a row, without a load.
 * - `truncate`: the source truncates. Active demands load again.
 *
 * Each history also chooses whether the source honors abort. One that
 * ignores it keeps a load that the wrapper aborted at a truncate waiting, so
 * that obsolete load can still settle; this is the case in which an obsolete
 * load could wrongly record coverage.
 *
 * Session 2 reopens the same database offline, with a wait of 0, and reads
 * both demands. Its source never answers.
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
 * that settles records how many rows SQLite holds for its demand. A failed or
 * released load records nothing. When the wrapper asks for a demand again
 * after a truncate is its own scheduling, which the law leaves open, so the
 * model reads it from the log instead of predicting it.
 *
 * ## Observation and checkpoint
 *
 * After session 2 has waited 300 ms of real time, each demand's live query
 * status and its rows, compared exactly with the model.
 *
 * Declared reach (ORC-015): histories in which a demand is covered offline,
 * uncovered offline, covered but short of rows, ended by a truncate, settled
 * through an obsolete load, moved between demands, and recorded twice. The
 * fixed and random campaigns run the same property with 40 histories each.
 *
 * Parts 2 and 3 sweep a storage failure over every adapter call and a
 * release over every step of a load; their laws are stated beside them.
 *
 * Limits: unordered demands only (ordered windows are in the fixed oracle);
 * a session-1 wait long enough that no session-1 load settles from SQLite
 * except on failure; real timers in session 1, so checkpoints are coarse;
 * one process and the default coordinator; `node:sqlite` only.
 */

type Group = `a` | `b`
const GROUPS: ReadonlyArray<Group> = [`a`, `b`]
const IDS = [`r1`, `r2`, `r3`, `r4`] as const
type Id = (typeof IDS)[number]

type Command =
  | { type: `start`; demand: Group }
  | { type: `answer`; demand: Group }
  | { type: `settle-oldest`; demand: Group }
  | { type: `fail`; demand: Group }
  | { type: `release`; demand: Group }
  | { type: `write`; id: Id; group: Group }
  | { type: `delete`; id: Id }
  | { type: `truncate` }

type History = {
  // A source that honors abort drops a load that the wrapper aborts; one
  // that ignores it may still settle that load later.
  honorsAbort: boolean
  initial: Partial<Record<Id, Group>>
  commands: ReadonlyArray<Command>
}

type Observation = Record<
  Group,
  { ready: boolean; rows?: ReadonlyArray<string> }
>

// ---------------------------------------------------------------------------
// Model
//
// The model replays the source's own log of what happened, not the commands:
// which rows the source wrote or deleted, when it truncated, and each load it
// settled. A load is current when no truncate came between the source
// receiving it and settling it, and obsolete otherwise (law 6). When the
// wrapper asks for a demand again after a truncate is its own scheduling,
// which the law leaves open, so the model does not predict it.
// ---------------------------------------------------------------------------

type SourceEvent =
  | { type: `rows`; rows: ReadonlyArray<readonly [Id, Group]> }
  | { type: `delete`; id: Id }
  | { type: `truncate` }
  | { type: `settled`; demand: Group; current: boolean }

type ReachState =
  | `covered offline`
  | `uncovered offline`
  | `covered but short of rows`
  | `coverage ended by a truncate`
  | `obsolete load settled`
  | `row moved between demands`
  | `coverage recorded twice`

const rowsOf = (rows: Map<Id, Group>, demand: Group): Array<Id> =>
  [...rows].filter(([, group]) => group === demand).map(([id]) => id)

function expectedObservation(
  events: ReadonlyArray<SourceEvent>,
  reach: (state: ReachState) => void,
): Observation {
  // SQLite holds every row the source wrote since its last truncate; a
  // source write reaches it whether or not a load asked for the row.
  const sqlite = new Map<Id, Group>()
  // Each demand's recorded row count.
  const coverage = new Map<Group, number>()
  for (const event of events) {
    switch (event.type) {
      case `rows`:
        for (const [id, group] of event.rows) {
          const before = sqlite.get(id)
          if (before !== undefined && before !== group) {
            reach(`row moved between demands`)
          }
          sqlite.set(id, group)
        }
        break
      case `delete`:
        sqlite.delete(event.id)
        break
      case `truncate`:
        if (coverage.size > 0) reach(`coverage ended by a truncate`)
        sqlite.clear()
        coverage.clear()
        break
      case `settled`:
        if (!event.current) {
          reach(`obsolete load settled`)
          break
        }
        if (coverage.has(event.demand)) reach(`coverage recorded twice`)
        coverage.set(event.demand, rowsOf(sqlite, event.demand).length)
    }
  }
  const observation = {} as Observation
  for (const demand of GROUPS) {
    const recorded = coverage.get(demand)
    const rows = rowsOf(sqlite, demand).sort()
    if (recorded === undefined) {
      reach(`uncovered offline`)
      observation[demand] = { ready: false }
    } else if (rows.length < recorded) {
      reach(`covered but short of rows`)
      observation[demand] = { ready: false }
    } else {
      reach(`covered offline`)
      observation[demand] = { ready: true, rows }
    }
  }
  return observation
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

const rowFor = (id: Id, group: Group): Row => ({
  id,
  group,
  rank: IDS.indexOf(id),
  value: `v1`,
})

// The demand a load reads: its `group = ...` filter value.
function demandOf(options: LoadSubsetOptions): Group {
  const value = (
    options.where as { args?: Array<{ value?: unknown }> } | undefined
  )?.args?.[1]?.value
  if (value !== `a` && value !== `b`) {
    throw new Error(`unexpected demand ${JSON.stringify(options.where)}`)
  }
  return value
}

type SyncParams = Parameters<SyncConfig<Row, string>[`sync`]>[0]
type Pending = {
  resolve: () => void
  reject: (error: unknown) => void
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
  const pending = new Map<Group, Array<Pending>>()
  const calls: Array<Group> = []
  const events: Array<SourceEvent> = []
  let epoch = 0
  const settled = (demand: Group, load: Pending) => {
    events.push({ type: `settled`, demand, current: load.epoch === epoch })
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
              calls.push(demand)
              if (!online) return new Promise<void>(() => {})
              return new Promise<void>((resolve, reject) => {
                const entry = { resolve, reject, epoch }
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
  return {
    collection,
    calls,
    events,
    started: () => params !== undefined,
    hasPending: (demand: Group) => (pending.get(demand)?.length ?? 0) > 0,
    async answer(demand: Group, rows: ReadonlyArray<Row>) {
      await commit((sync) => {
        for (const row of rows) {
          sync.write({
            type: written.has(row.id as Id) ? `update` : `insert`,
            value: row,
          })
          written.add(row.id as Id)
        }
      })
      events.push({
        type: `rows`,
        rows: rows.map((row) => [row.id as Id, row.group as Group] as const),
      })
      for (const load of pending.get(demand)?.splice(0) ?? []) {
        settled(demand, load)
      }
    },
    // A released demand's loads stop at the source either way.
    forget(demand: Group) {
      pending.delete(demand)
    },
    settleOldest(demand: Group) {
      const load = pending.get(demand)?.shift()
      if (load) settled(demand, load)
    },
    fail(demand: Group) {
      for (const load of pending.get(demand)?.splice(0) ?? []) {
        load.reject(new Error(`offline`))
      }
    },
    async write(row: Row) {
      await commit((sync) => {
        sync.write({
          type: written.has(row.id as Id) ? `update` : `insert`,
          value: row,
        })
        written.add(row.id as Id)
      })
      events.push({ type: `rows`, rows: [[row.id as Id, row.group as Group]] })
    },
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
}> {
  const driver = createDriver(new DatabaseSync(`:memory:`))
  const truth = new Map(Object.entries(history.initial) as Array<[Id, Group]>)
  let events: ReadonlyArray<SourceEvent> = []

  // Session 1 is online. Its wait is long, so a load settles from SQLite
  // only when its upstream load fails.
  {
    const source = campaignSource(driver, true, 60_000, history.honorsAbort)
    events = source.events
    const queries = new Map<Group, ReturnType<typeof filterQuery>>()
    // A reacquired load reaches the source shortly after the load it
    // replaces settles, so wait a little for one before a no-op.
    const untilPending = async (demand: Group) => {
      if (!queries.has(demand)) return
      for (let i = 0; i < 10 && !source.hasPending(demand); i++) await settle(5)
    }
    const release = async (demand: Group) => {
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
            const query = filterQuery(source.collection, command.demand)
            queries.set(command.demand, query)
            void query.preload().catch(() => undefined)
            for (let i = 0; i < 50 && !source.hasPending(command.demand); i++) {
              await settle(5)
            }
            // Positive witness: the demand reached the source.
            expect(source.hasPending(command.demand)).toBe(true)
            break
          }
          case `answer`:
            await untilPending(command.demand)
            if (!source.hasPending(command.demand)) break
            await source.answer(
              command.demand,
              [...truth]
                .filter(([, group]) => group === command.demand)
                .map(([id, group]) => rowFor(id, group)),
            )
            await settle()
            break
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
          case `write`:
            truth.set(command.id, command.group)
            await source.write(rowFor(command.id, command.group))
            await settle()
            break
          case `delete`:
            truth.delete(command.id)
            await source.remove(command.id)
            await settle()
            break
          case `truncate`: {
            await source.truncate()
            // Each active demand loads again after the truncate.
            for (let i = 0; i < 50; i++) {
              if ([...queries.keys()].every((d) => source.hasPending(d))) break
              await settle(5)
            }
            expect(
              [...queries.keys()].filter((d) => !source.hasPending(d)),
            ).toEqual([])
            break
          }
        }
      }
      await settle(50)
    }, [
      ...GROUPS.map((demand) => () => queries.get(demand)?.cleanup()),
      () => source.collection.cleanup(),
    ])
  }

  // Session 2 is offline.
  const source = campaignSource(driver, false, 0)
  const queries = GROUPS.map((demand) => filterQuery(source.collection, demand))
  return withCleanup(async () => {
    for (const query of queries) void query.preload().catch(() => undefined)
    await settle(300)
    // Positive witness: session 2 asked the offline source for both demands.
    expect(new Set(source.calls)).toEqual(new Set(GROUPS))
    const observation = {} as Observation
    GROUPS.forEach((demand, index) => {
      const query = queries[index]!
      observation[demand] =
        query.status === `ready`
          ? {
              ready: true,
              rows: query.toArray.map((row) => row.id).sort(),
            }
          : { ready: false }
    })
    return { observation, events }
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
const idArb = fc.constantFrom<Id>(...IDS)
const commandArb: fc.Arbitrary<Command> = fc.oneof(
  {
    arbitrary: fc.record({
      type: fc.constant(`start` as const),
      demand: groupArb,
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      type: fc.constant(`answer` as const),
      demand: groupArb,
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      type: fc.constant(`settle-oldest` as const),
      demand: groupArb,
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      type: fc.constant(`fail` as const),
      demand: groupArb,
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      type: fc.constant(`release` as const),
      demand: groupArb,
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      type: fc.constant(`write` as const),
      id: idArb,
      group: groupArb,
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({ type: fc.constant(`delete` as const), id: idArb }),
    weight: 2,
  },
  { arbitrary: fc.constant({ type: `truncate` as const }), weight: 1 },
)
// Compound steps make the rarer orders likely: a covered demand that then
// loses a row, a full load cycle, which a later cycle of the same demand
// records again, and a truncate while a load waits, answered or settled
// alone. Each is only a sequence of the commands above.
const stepArb: fc.Arbitrary<ReadonlyArray<Command>> = fc.oneof(
  { arbitrary: commandArb.map((command) => [command]), weight: 6 },
  {
    // Cover a demand over a row, then move that row away or delete it.
    arbitrary: fc
      .tuple(groupArb, idArb, fc.boolean())
      .map(([demand, id, move]): ReadonlyArray<Command> => [
        { type: `write`, id, group: demand },
        { type: `start`, demand },
        { type: `answer`, demand },
        { type: `release`, demand },
        move
          ? { type: `write`, id, group: demand === `a` ? `b` : `a` }
          : { type: `delete`, id },
      ]),
    weight: 2,
  },
  {
    arbitrary: groupArb.map((demand): ReadonlyArray<Command> => [
      { type: `start`, demand },
      { type: `answer`, demand },
      { type: `release`, demand },
    ]),
    weight: 2,
  },
  {
    arbitrary: groupArb.map((demand): ReadonlyArray<Command> => [
      { type: `start`, demand },
      { type: `truncate` },
      { type: `answer`, demand },
    ]),
    weight: 1,
  },
  {
    arbitrary: groupArb.map((demand): ReadonlyArray<Command> => [
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
          fc.constantFrom<Group | undefined>(`a`, `b`, undefined),
        ]),
      ) as Record<Id, fc.Arbitrary<Group | undefined>>,
    )
    .map(
      (initial) =>
        Object.fromEntries(
          Object.entries(initial).filter(([, group]) => group !== undefined),
        ) as Partial<Record<Id, Group>>,
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
]

async function campaign(options: Parameters<typeof fc.assert>[1]) {
  const reach = createOracleReach<ReachState>(PROPERTY, REACH_STATES)
  await fc.assert(
    fc.asyncProperty(historyArb, async (history) => {
      reach.beginHistory()
      const { observation, events } = await runHistory(history)
      expect(observation).toEqual(
        expectedObservation(events, (state) => reach.reach(state)),
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

  it(`rejects a model that ignores lost rows or obsolete loads`, () => {
    // Calibration: a load covers a over two rows, then one is deleted. An
    // obsolete load never covers.
    const covered: ReadonlyArray<SourceEvent> = [
      {
        type: `rows`,
        rows: [
          [`r1`, `a`],
          [`r2`, `a`],
        ],
      },
      { type: `settled`, demand: `a`, current: true },
    ]
    expect(expectedObservation(covered, () => {}).a).toEqual({
      ready: true,
      rows: [`r1`, `r2`],
    })
    expect(
      expectedObservation([...covered, { type: `delete`, id: `r1` }], () => {})
        .a,
    ).toEqual({ ready: false })
    expect(
      expectedObservation(
        [covered[0]!, { type: `settled`, demand: `a`, current: false }],
        () => {},
      ).a,
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
