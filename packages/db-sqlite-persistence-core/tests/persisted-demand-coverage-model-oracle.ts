import { declareOracle } from '../../db/tests/oracle-declaration'
import type { CollectionStatus, LoadSubsetOptions } from '@tanstack/db'

/**
 * # The persisted demand coverage model
 *
 * Law (`docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * the glossary's "persisted demand coverage" and "network-first initial
 * render", and law 6 in `packages/db/src/query/live/ARCHITECTURE.md`): an
 * opted-in persisted wrapper over an on-demand source settles a load from
 * SQLite only when its exact demand has coverage. A current load of that
 * demand recorded coverage when it settled; no truncate or generation change
 * ended it since; SQLite still holds at least as many of the demand's rows
 * as it recorded; and a limited load still holds the same rows. A covered
 * load settles from SQLite once its wait has passed or its upstream load has
 * failed. A load with `refetch: true` is never covered. A snapshot
 * transaction replaces every synced row, as a truncate at its start does, so
 * it ends coverage too (the glossary's "snapshot transaction"). A load that
 * settles after core aborted it records nothing: its later outcome decides
 * nothing (the glossary's "abort"). Scoped recovery ends coverage and does
 * not certify the new generation for offline reuse
 * (`docs/collections/electric-collection.md`), so for the rest of that sync
 * run no load records coverage and none settles from SQLite; the persisted
 * subset restore publishes no rows then. A source whose full sync completed,
 * such as Electric's progressive mode, holds every row locally: it resumes
 * from those rows and settles every later load at once, so a query that
 * never ran is ready on its restored rows (`ARCHITECTURE.md`: "A source that
 * resumes from complete local rows settles its loads at once"), until a
 * truncate or generation change. Any other load waits
 * for its upstream load, and fails with it. A query is ready when every load
 * it sent has settled; a query over an eager and an on-demand source is ready
 * on the same condition for the on-demand loads, once the eager source has
 * opened from its restored rows. Settling loads from SQLite never changes the
 * on-demand Collection's own status: it stays as its source set it, so an
 * offline source that never called `markReady()` keeps it `loading` (the
 * guide's "only the load settles from SQLite").
 *
 * This module is the one judgment that the fixed oracle, the generated
 * campaign, and every receiving driver share (ORC-014, ORC-016). A driver
 * records what happened at its own production boundary and passes that record
 * here. No driver states an expected result.
 *
 * ## The record a driver supplies
 *
 * - The source log of every session so far, in order: the start of each
 *   sync run, the rows each source wrote or deleted, its truncates and
 *   snapshot transactions, the start of scoped recovery, the ends of a
 *   persisted cache generation (a schema reset), and each load it settled or
 *   failed. A settled load is current when no truncate, snapshot, or
 *   generation change came between the source receiving it and settling it,
 *   and obsolete otherwise; it is aborted when core aborted its signal before
 *   the source settled it. A driver that injected a failed coverage read
 *   marks the settled load whose coverage read failed.
 * - For each live query at the checkpoint: what it reads (`QuerySpec`), the
 *   loads the source received for it in this session, and what it showed.
 *   A driver that injected a failed coverage check marks the query.
 * - Optionally, the on-demand Collection's status at the checkpoint, and
 *   whether its source called `markReady()` in this session.
 * - Premises at the checkpoint: whether each load's wait has passed since
 *   that load started, and, for loads the log does not settle or fail, how
 *   the source answers. Each load measures its own wait: a window's
 *   tie-boundary load starts only after its limited load settles, so its
 *   wait ends later.
 *
 * The model reads which loads a session sent from that record rather than
 * predicting them. When core sends a window's tie-boundary load, and when the
 * wrapper asks for a demand again after a reset, is scheduling that the law
 * leaves open.
 *
 * ## Abstractions (ORC-009)
 *
 * - The model's SQLite rows for a Collection are every row its source wrote
 *   since the last truncate or generation change. A source write reaches
 *   SQLite whether or not a load asked for it.
 * - To read a load's rows, the model evaluates the load's own filter, cursor,
 *   order, and limit over those rows. Ties break by key, as the SQLite
 *   adapter's `ORDER BY ..., key ASC` does.
 * - A record holds a row count and, for a limited load, its row keys. The
 *   production record holds the same facts; the model computes them itself.
 * - Two loads have the same demand when their request data asks for the same
 *   rows: the same filter, order, limit, cursor, and offset, with an offset
 *   of 0 the same as none. The model compares that request data itself; it
 *   does not use core's demand key.
 * - Scoped recovery combines two production facts: it ends the persisted
 *   cache generation, and it leaves the rest of its sync run uncertified.
 * - `full sync completes` is a source fact, not a wrapper record: the source
 *   reached its first complete sync of every row (Electric's progressive
 *   `up-to-date`). The model predicts the source's later settlements from it
 *   rather than reading them from the log.
 * - Coverage is judged with the records at the checkpoint, not at the instant
 *   the load checked. No supplied history records a demand while another load
 *   of it waits to check.
 *
 * Limits: a join reads one eager and one on-demand Collection, and the
 * evaluator knows only the expression forms these histories send.
 */

export type RowState = { group?: string; rank?: number } & Readonly<
  Record<string, unknown>
>

/** The Collection a fact belongs to; most records have one, `source`. */
type InCollection = { collection?: string }

/** One fact from a source. */
export type SourceEvent = InCollection &
  (
    | { type: `rows`; rows: ReadonlyArray<readonly [string, RowState]> }
    | { type: `delete`; id: string }
    | { type: `truncate` }
    | {
        type: `snapshot`
        rows: ReadonlyArray<readonly [string, RowState]>
      }
    | { type: `generation ends` }
    | { type: `scoped recovery starts` }
    | { type: `sync run starts` }
    | { type: `full sync completes` }
    | {
        type: `settled`
        load: LoadSubsetOptions
        current: boolean
        aborted?: boolean
        coverage?: `recorded` | `read fails`
      }
    | { type: `failed`; load: LoadSubsetOptions }
  )

/**
 * What a live query reads: one group, optionally ordered by rank, and a
 * window of `limit` rows from `offset`.
 */
export type FilterSpec = {
  group: string
  orderByRank?: boolean
  limit?: number
  offset?: number
  collection?: string
}
/** An eager parent Collection joined with an on-demand child Collection. */
export type JoinSpec = {
  join: { parents: string; children: string; on: string }
  select: (
    parent: Readonly<Record<string, unknown>>,
    child: Readonly<Record<string, unknown>>,
  ) => Record<string, unknown>
}
export type QuerySpec = FilterSpec | JoinSpec

/** How a source answers the loads that its log neither settles nor fails. */
export type OfflineUpstream = `never answers` | `fails at once`

export type QueryObservation = {
  status: `ready` | `loading` | `error`
  rows?: ReadonlyArray<string | Readonly<Record<string, unknown>>>
}

export type CoverageReach =
  | `covered offline`
  | `uncovered offline`
  | `covered but short of rows`
  | `coverage ended by a truncate`
  | `coverage ended by a snapshot`
  | `aborted load settled`
  | `demand settled only by an aborted load`
  | `covered during scoped recovery`
  | `settled from a completed full sync`
  | `obsolete load settled`
  | `row moved between demands`
  | `coverage recorded twice`
  | `window covered offline`
  | `window holds other rows`
  | `tie-boundary load uncovered`
  | `covered load waits for the deadline`
  | `uncovered load fails with its upstream`

/** Whether a load's wait has passed: for every load, or per load. */
export type WaitPremise = boolean | ((load: LoadSubsetOptions) => boolean)

export type CoverageQuery = {
  spec: QuerySpec
  sent: ReadonlyArray<LoadSubsetOptions>
  observed: QueryObservation
  /** Overrides the record's premise for this query. */
  waitPassed?: WaitPremise
  /** The driver failed this query's coverage check read. */
  checkFails?: boolean
}

/** The on-demand Collection's own status, and what its source did. */
export type CollectionObservation = {
  status: CollectionStatus
  sourceMarkedReady: boolean
}

export type CoverageRecord = {
  events: ReadonlyArray<SourceEvent>
  queries: Readonly<Record<string, CoverageQuery>>
  collection?: CollectionObservation
  upstream?: OfflineUpstream
  waitPassed: WaitPremise
}

// The expression forms these loads carry (`packages/db/src/query/ir.ts`).
type Expr = {
  type?: string
  name?: string
  args?: ReadonlyArray<Expr>
  path?: ReadonlyArray<string>
  value?: unknown
}
type ModelRow = { id: string } & RowState

function evaluate(expr: Expr, row: ModelRow): unknown {
  if (expr.type === `ref`) return row[expr.path![expr.path!.length - 1]!]
  if (expr.type === `val`) return expr.value
  const args = (expr.args ?? []).map((arg) => evaluate(arg, row))
  const [left, right] = args as [never, never]
  switch (expr.name) {
    case `eq`:
      return left === right
    case `in`:
      return (right as ReadonlyArray<unknown>).includes(left)
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

const byKey = (x: ModelRow, y: ModelRow) =>
  x.id < y.id ? -1 : x.id > y.id ? 1 : 0
const byRankThenKey = (x: ModelRow, y: ModelRow) =>
  Number(x.rank) - Number(y.rank) || byKey(x, y)
const modelRows = (rows: ReadonlyMap<string, RowState>): Array<ModelRow> =>
  [...rows].map(([id, state]) => ({ ...state, id }))

// The rows a load reads from SQLite, in its order.
function readLoad(
  load: LoadSubsetOptions,
  rows: ReadonlyMap<string, RowState>,
): Array<string> {
  // A cursor and an offset describe the same continuation; a load that
  // carries both is read by its cursor (`LoadSubsetOptions`).
  const where = load.where as Expr | undefined
  const from = load.cursor?.whereFrom as Expr | undefined
  const matching = modelRows(rows).filter(
    (row) =>
      (where === undefined || evaluate(where, row) === true) &&
      (from === undefined || evaluate(from, row) === true),
  )
  const orderBy = (load.orderBy ?? []) as unknown as ReadonlyArray<{
    expression: Expr
    compareOptions?: { direction?: `asc` | `desc` }
  }>
  matching.sort((x, y) => {
    for (const { expression, compareOptions } of orderBy) {
      const a = evaluate(expression, x) as number
      const b = evaluate(expression, y) as number
      if (a !== b) {
        return (
          (a < b ? -1 : 1) * (compareOptions?.direction === `desc` ? -1 : 1)
        )
      }
    }
    return byKey(x, y)
  })
  const ids = matching.map((row) => row.id)
  const offset = from === undefined ? (load.offset ?? 0) : 0
  return load.limit === undefined
    ? ids.slice(offset)
    : ids.slice(offset, offset + load.limit)
}

// The rows a live query shows over the restored rows.
function readQuery(
  spec: QuerySpec,
  sqlite: (collection: string) => ReadonlyMap<string, RowState>,
): Array<string | Record<string, unknown>> {
  if (`join` in spec) {
    const { parents, children, on } = spec.join
    const childRows = modelRows(sqlite(children))
    return modelRows(sqlite(parents))
      .sort(byKey)
      .flatMap((parent) =>
        childRows
          .filter((child) => child[on] === parent.id)
          .sort(byKey)
          .map((child) => spec.select(parent, child)),
      )
  }
  const ids = modelRows(sqlite(spec.collection ?? `source`))
    .filter((row) => row.group === spec.group)
    .sort(spec.orderByRank ? byRankThenKey : byKey)
    .map((row) => row.id)
  const offset = spec.offset ?? 0
  return spec.limit === undefined
    ? ids.slice(offset)
    : ids.slice(offset, offset + spec.limit)
}

// The demand identity the law uses: two loads cover each other only when
// their request data asks for the same rows. An offset of 0 skips no rows.
const demandKey = (load: LoadSubsetOptions): string =>
  JSON.stringify([
    load.where,
    load.orderBy,
    load.limit,
    load.offset || undefined,
    load.cursor,
  ])
const rowsKey = (ids: ReadonlyArray<string>) => JSON.stringify([...ids].sort())
const isWindow = (spec: QuerySpec) =>
  !(`join` in spec) && spec.limit !== undefined
const loadsOf = (spec: QuerySpec) =>
  `join` in spec ? spec.join.children : (spec.collection ?? `source`)

/**
 * The model: replay the source log, then judge each query at the checkpoint
 * from the loads it sent.
 */
export function expectedObservations(
  record: CoverageRecord,
  reach: (state: CoverageReach) => void = () => {},
): Record<string, QueryObservation> {
  const sqlite = new Map<string, Map<string, RowState>>()
  const rowsIn = (collection = `source`) => {
    let rows = sqlite.get(collection)
    if (!rows) sqlite.set(collection, (rows = new Map()))
    return rows
  }
  const records = new Map<string, { count: number; rows?: string }>()
  const recordKey = (collection: string, load: LoadSubsetOptions) =>
    `${collection} ${demandKey(load)}`
  const settledByUpstream = new Set<LoadSubsetOptions>()
  const failed = new Set<LoadSubsetOptions>()
  // The Collections whose current sync run is in scoped recovery, and the
  // demands that settled online during it, which record nothing.
  const recovering = new Set<string>()
  const settledWhileRecovering = new Set<string>()
  // The Collections whose source completed a full sync of every row.
  const complete = new Set<string>()
  // Demands whose only settlement since their coverage ended was aborted.
  const settledOnlyAborted = new Set<string>()
  const writeRows = (
    collection: string,
    rows: ReadonlyArray<readonly [string, RowState]>,
  ) => {
    for (const [id, state] of rows) {
      const before = rowsIn(collection).get(id)
      if (before !== undefined && before.group !== state.group) {
        reach(`row moved between demands`)
      }
      rowsIn(collection).set(id, state)
    }
  }
  // A truncate, a snapshot, and a generation change empty SQLite and end
  // every coverage record of the Collection.
  const endCoverage = (collection: string, by: CoverageReach) => {
    if ([...records.keys()].some((key) => key.startsWith(`${collection} `))) {
      reach(by)
    }
    rowsIn(collection).clear()
    complete.delete(collection)
    for (const keys of [records, settledOnlyAborted]) {
      for (const key of [...keys.keys()]) {
        if (key.startsWith(`${collection} `)) keys.delete(key)
      }
    }
  }
  for (const event of record.events) {
    const collection = event.collection ?? `source`
    switch (event.type) {
      case `sync run starts`:
        recovering.delete(collection)
        break
      case `full sync completes`:
        complete.add(collection)
        break
      case `rows`:
        writeRows(collection, event.rows)
        break
      case `delete`:
        rowsIn(collection).delete(event.id)
        break
      case `truncate`:
      case `generation ends`:
        endCoverage(collection, `coverage ended by a truncate`)
        break
      case `scoped recovery starts`:
        endCoverage(collection, `coverage ended by a truncate`)
        recovering.add(collection)
        break
      case `snapshot`:
        endCoverage(collection, `coverage ended by a snapshot`)
        writeRows(collection, event.rows)
        break
      case `settled`: {
        settledByUpstream.add(event.load)
        if (!event.current) {
          reach(`obsolete load settled`)
          break
        }
        const key = recordKey(collection, event.load)
        if (event.aborted) {
          reach(`aborted load settled`)
          if (!records.has(key)) settledOnlyAborted.add(key)
          break
        }
        settledOnlyAborted.delete(key)
        if (recovering.has(collection)) {
          settledWhileRecovering.add(key)
          break
        }
        if (event.coverage === `read fails`) break
        if (records.has(key)) reach(`coverage recorded twice`)
        const rows = readLoad(event.load, rowsIn(collection))
        records.set(key, {
          count: rows.length,
          rows: event.load.limit === undefined ? undefined : rowsKey(rows),
        })
        break
      }
      case `failed`:
        failed.add(event.load)
    }
  }
  const expected: Record<string, QueryObservation> = {}
  for (const [name, query] of Object.entries(record.queries)) {
    const collection = loadsOf(query.spec)
    const covered = (load: LoadSubsetOptions): boolean => {
      if (load.refetch === true || query.checkFails) return false
      if (recovering.has(collection)) {
        if (settledWhileRecovering.has(recordKey(collection, load))) {
          reach(`covered during scoped recovery`)
        }
        return false
      }
      const stored = records.get(recordKey(collection, load))
      if (stored === undefined) {
        if (settledOnlyAborted.has(recordKey(collection, load))) {
          reach(`demand settled only by an aborted load`)
        }
        return false
      }
      const rows = readLoad(load, rowsIn(collection))
      if (rows.length < stored.count) {
        reach(`covered but short of rows`)
        return false
      }
      if (stored.rows !== undefined && stored.rows !== rowsKey(rows)) {
        reach(`window holds other rows`)
        return false
      }
      return true
    }
    // Positive witness: the query asked its source for data.
    if (query.sent.length === 0) {
      throw new Error(`no load was sent for query ${name}`)
    }
    const premise = query.waitPassed ?? record.waitPassed
    const waitPassed = (load: LoadSubsetOptions) =>
      typeof premise === `function` ? premise(load) : premise
    const loads = query.sent.map((load) => {
      if (complete.has(collection) && load.refetch !== true) {
        reach(`settled from a completed full sync`)
        return `settled` as const
      }
      if (settledByUpstream.has(load)) return `settled` as const
      const upstreamFailed =
        failed.has(load) || record.upstream === `fails at once`
      const isCovered = covered(load)
      if (isCovered) {
        reach(
          isWindow(query.spec) ? `window covered offline` : `covered offline`,
        )
        if (upstreamFailed || waitPassed(load)) return `settled` as const
        reach(`covered load waits for the deadline`)
        return `waiting` as const
      }
      reach(`uncovered offline`)
      if (upstreamFailed) {
        reach(`uncovered load fails with its upstream`)
        return `failed` as const
      }
      return `waiting` as const
    })
    if (
      isWindow(query.spec) &&
      loads[0] === `settled` &&
      loads.includes(`waiting`)
    ) {
      reach(`tie-boundary load uncovered`)
    }
    expected[name] = loads.includes(`failed`)
      ? { status: `error` }
      : loads.every((load) => load === `settled`)
        ? { status: `ready`, rows: readQuery(query.spec, rowsIn) }
        : { status: `loading` }
  }
  return expected
}

/**
 * The comparison: each query's observed status, and its rows when ready. An
 * unordered query's rows compare as a set; an ordered one's in order.
 */
export function coverageViolations(
  record: CoverageRecord,
  reach?: (state: CoverageReach) => void,
): Array<string> {
  const expected = expectedObservations(record, reach)
  const violations: Array<string> = []
  // The Collection's status is the source's: `ready` only after its
  // `markReady()`. These histories never fail the source's sync itself; that
  // is the source-health law's.
  if (record.collection) {
    const { status, sourceMarkedReady } = record.collection
    const want = sourceMarkedReady ? `ready` : `loading`
    if (status !== want) {
      violations.push(
        `on-demand Collection: expected status ${want}, observed ${status}`,
      )
    }
  }
  for (const [name, query] of Object.entries(record.queries)) {
    const want = expected[name]!
    const got = query.observed
    const ordered = !(`join` in query.spec) && query.spec.orderByRank === true
    const rows = (observation: QueryObservation) => {
      const list = (observation.rows ?? []).map((row) => JSON.stringify(row))
      return JSON.stringify(ordered ? list : list.sort())
    }
    const same =
      want.status === got.status &&
      (want.status !== `ready` || rows(want) === rows(got))
    if (!same) {
      violations.push(
        `query ${name}: expected ${JSON.stringify(want)}, observed ${JSON.stringify(got)}`,
      )
    }
  }
  return violations
}

declareOracle({ check: [coverageViolations], model: [expectedObservations] })
