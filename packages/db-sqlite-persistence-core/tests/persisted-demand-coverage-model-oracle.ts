import { getLoadSubsetDemandKey } from '@tanstack/db'
import type { LoadSubsetOptions } from '@tanstack/db'

/**
 * # The persisted demand coverage model
 *
 * Law (`docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * the glossary's "persisted demand coverage", and law 6 in
 * `packages/db/src/query/live/ARCHITECTURE.md`): an opted-in persisted wrapper
 * over an on-demand source settles a load from SQLite only when its exact
 * demand has coverage. A current load of that demand recorded coverage when it
 * settled; no truncate or reset ended it since; SQLite still holds at least as
 * many of the demand's rows as it recorded; and a limited load still holds the
 * same rows. A covered load settles from SQLite once the wait has passed or
 * its upstream load has failed. Any other load waits for its upstream load,
 * and fails with it.
 *
 * This module is the one judgment that the generated campaign and every
 * receiving driver share (ORC-014, ORC-016). A driver records what happened at
 * its own production boundary and passes that record here. No driver states
 * an expected result.
 *
 * ## The record a driver supplies
 *
 * - The online session's source log: the rows the source wrote or deleted,
 *   its truncates, and each load it settled, with whether a truncate came
 *   between the source receiving that load and settling it. A load with a
 *   truncate in between is obsolete and records nothing.
 * - For each live query of the offline session: what it reads (`QuerySpec`),
 *   the loads the source received for it, and what it showed.
 * - How the offline session's source answered, and whether the checkpoint is
 *   after the wait.
 *
 * The model reads which loads the offline session sent from that record
 * rather than predicting them. When core sends a window's tie-boundary load,
 * and for which boundary, is core's scheduling, which the law leaves open.
 *
 * ## Abstractions (ORC-009)
 *
 * - The model's SQLite rows are every row the source wrote since its last
 *   truncate. A source write reaches SQLite whether or not a load asked for
 *   it.
 * - To read a load's rows, the model evaluates the load's own filter, order,
 *   and limit over those rows. Ties break by key, as the SQLite adapter's
 *   `ORDER BY ..., key ASC` does.
 * - A record holds a row count and, for a limited load, its row keys. The
 *   production record holds the same facts; the model computes them itself.
 *
 * Limits: no cursor or offset loads, no joins, and one opted-in Collection.
 */

export type RowState = { group: string; rank: number }

/** One fact from the online session's source. */
export type SourceEvent =
  | { type: `rows`; rows: ReadonlyArray<readonly [string, RowState]> }
  | { type: `delete`; id: string }
  | { type: `truncate` }
  | { type: `settled`; load: LoadSubsetOptions; current: boolean }

/** What a live query reads: one group, optionally ordered by rank and limited. */
export type QuerySpec = { group: string; orderByRank?: boolean; limit?: number }

/** How the offline session's source answered its loads. */
export type OfflineUpstream = `never answers` | `fails at once`

export type QueryObservation = {
  status: `ready` | `loading` | `error`
  rows?: ReadonlyArray<string>
}

export type CoverageReach =
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
  | `covered load waits for the deadline`
  | `uncovered load fails with its upstream`

export type CoverageRecord = {
  events: ReadonlyArray<SourceEvent>
  queries: Readonly<
    Record<
      string,
      {
        spec: QuerySpec
        sent: ReadonlyArray<LoadSubsetOptions>
        observed: QueryObservation
      }
    >
  >
  upstream: OfflineUpstream
  waitPassed: boolean
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

const byRankThenKey = (x: ModelRow, y: ModelRow) =>
  x.rank - y.rank || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
const byKey = (x: ModelRow, y: ModelRow) =>
  x.id < y.id ? -1 : x.id > y.id ? 1 : 0

// The rows a load reads from SQLite, in its order.
function readLoad(
  load: LoadSubsetOptions,
  sqlite: ReadonlyMap<string, RowState>,
): Array<string> {
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
    return byKey(x, y)
  })
  const ids = rows.map((row) => row.id)
  return load.limit === undefined ? ids : ids.slice(0, load.limit)
}

// The rows a live query shows over the given rows.
function readQuery(
  spec: QuerySpec,
  sqlite: ReadonlyMap<string, RowState>,
): Array<string> {
  const rows = [...sqlite]
    .map(([id, state]): ModelRow => ({ id, ...state }))
    .filter((row) => row.group === spec.group)
    .sort(spec.orderByRank ? byRankThenKey : byKey)
  const ids = rows.map((row) => row.id)
  return spec.limit === undefined ? ids : ids.slice(0, spec.limit)
}

// The demand identity the law uses: two loads cover each other only with the
// same key.
const demandKey = (load: LoadSubsetOptions): string =>
  String(getLoadSubsetDemandKey(load))
const rowsKey = (ids: ReadonlyArray<string>) => JSON.stringify([...ids].sort())

/**
 * The model: replay the online session's source log, then judge each query of
 * the offline session from the loads it sent.
 */
export function expectedObservations(
  record: CoverageRecord,
  reach: (state: CoverageReach) => void = () => {},
): Record<string, QueryObservation> {
  const sqlite = new Map<string, RowState>()
  const records = new Map<string, { count: number; rows?: string }>()
  for (const event of record.events) {
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
        const rows = readLoad(event.load, sqlite)
        records.set(key, {
          count: rows.length,
          rows: event.load.limit === undefined ? undefined : rowsKey(rows),
        })
      }
    }
  }
  const covered = (load: LoadSubsetOptions): boolean => {
    const stored = records.get(demandKey(load))
    if (stored === undefined) return false
    const rows = readLoad(load, sqlite)
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
  const expected: Record<string, QueryObservation> = {}
  for (const [name, query] of Object.entries(record.queries)) {
    // Positive witness: the offline session asked its source for the query.
    if (query.sent.length === 0) {
      throw new Error(`the offline session sent no load for query ${name}`)
    }
    const coverage = query.sent.map(covered)
    const window = query.spec.limit !== undefined
    if (window && coverage[0] && coverage.includes(false)) {
      reach(`tie-boundary load uncovered`)
    }
    if (!coverage.every(Boolean)) {
      reach(`uncovered offline`)
      if (record.upstream === `fails at once`) {
        reach(`uncovered load fails with its upstream`)
      }
      // An uncovered load waits for its upstream load and fails with it.
      expected[name] = {
        status: record.upstream === `fails at once` ? `error` : `loading`,
      }
      continue
    }
    reach(window ? `window covered offline` : `covered offline`)
    if (!record.waitPassed && record.upstream === `never answers`) {
      reach(`covered load waits for the deadline`)
    }
    // A covered load settles once the wait has passed or its upstream failed.
    expected[name] =
      record.waitPassed || record.upstream === `fails at once`
        ? { status: `ready`, rows: readQuery(query.spec, sqlite) }
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
  for (const [name, query] of Object.entries(record.queries)) {
    const want = expected[name]!
    const got = query.observed
    const rows = (observation: QueryObservation) =>
      observation.rows === undefined
        ? undefined
        : query.spec.orderByRank
          ? [...observation.rows]
          : [...observation.rows].sort()
    const same =
      want.status === got.status &&
      (want.status !== `ready` ||
        JSON.stringify(rows(want)) === JSON.stringify(rows(got)))
    if (!same) {
      violations.push(
        `query ${name}: expected ${JSON.stringify(want)}, observed ${JSON.stringify(got)}`,
      )
    }
  }
  return violations
}
