import { Query, queryOnce } from '@tanstack/db'
import { parsedColumns } from './db'
import { isPushable, queryIrToSearch } from './postgrest-filters'
import { postgrestRequest } from './postgrest-request'
import { serializeQueryIR } from './serialize'
import type {
  BaseQueryBuilder,
  ExtractContext,
  IR,
  InferResultType,
  InitialQueryBuilder,
  QueryBuilder,
} from '@tanstack/db'
import type {
  SerializedExpression,
  SerializedQueryIR,
  SerializedSelect,
  SerializedWhere,
} from './serialize'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Execution ───────────────────────────────────────────────────────

/**
 * Execute a SerializedQueryIR against Supabase and return the results.
 *
 * Produces a single PostgREST request using resource embedding for joins
 * and aggregate syntax for count/sum/avg/min/max.
 */
export async function executeQuery(
  supabase: SupabaseClient,
  ir: SerializedQueryIR,
): Promise<Array<unknown>> {
  const { tableName, search } = queryIrToSearch(ir)
  // queryOnce only sends aggregate-only selects here, whose output is one
  // row, so the db-max-rows cap does not apply and no paging loop is needed.
  const { data } = await postgrestRequest<Array<unknown>>(supabase, tableName, {
    method: 'GET',
    search,
  })
  return data ?? []
}

type ServerAggregate = SerializedExpression & { type: 'agg' }

/**
 * Run an aggregate-only query on PostgREST and return TanStack DB's result for
 * it. TanStack DB aggregates an ungrouped query as one group of the matching
 * rows, with these rules (see `getAggregateFunction` in @tanstack/db):
 *
 * - no matching rows give no result row, where SQL gives one;
 * - `count` counts the non-null values, as SQL does;
 * - `sum` adds a null as 0, so an all-null column sums to 0, not null;
 * - `avg` divides that sum by the number of matching rows, nulls included.
 *
 * So the request also counts the matching rows, and asks for each average as
 * a sum.
 */
async function executeServerAggregate(
  supabase: SupabaseClient,
  ir: SerializedQueryIR,
  aggregates: Record<string, ServerAggregate>,
): Promise<unknown> {
  let rowsAlias = 'rows'
  while (rowsAlias in aggregates) rowsAlias = `_${rowsAlias}`
  const select: SerializedSelect = {
    [rowsAlias]: { type: 'agg', name: 'count', args: [] },
  }
  for (const [alias, aggregate] of Object.entries(aggregates)) {
    select[alias] =
      aggregate.name === 'avg' ? { ...aggregate, name: 'sum' } : aggregate
  }
  const [row] = (await executeQuery(supabase, {
    from: ir.from,
    where: ir.where,
    select,
  })) as Array<Record<string, number | null>>
  const rows = row?.[rowsAlias] ?? 0
  if (rows === 0) return ir.singleResult ? undefined : []

  const result: Record<string, number | null> = {}
  for (const [alias, { name }] of Object.entries(aggregates)) {
    const value = row![alias] ?? null
    result[alias] =
      name === 'count'
        ? value
        : name === 'sum'
          ? (value ?? 0)
          : (value ?? 0) / rows
  }
  return ir.singleResult ? result : [result]
}

// ── Server aggregate detection ──────────────────────────────────────

/**
 * Clauses the server aggregate path reproduces exactly. findOne is unwrapped.
 * TanStack DB rejects limit and offset without orderBy, and decides ordering
 * and distinct itself, so a query with any other clause runs through it.
 */
const SERVER_AGGREGATE_CLAUSES = new Set([
  'from',
  'select',
  'where',
  'singleResult',
])

/** Clauses a subquery source may set and still be pushed down: its filters */
const FILTER_ONLY_CLAUSES = new Set(['from', 'where'])

/**
 * The aggregates whose PostgREST result maps exactly onto TanStack DB's. A
 * `min` or `max` would compare text by the database collation and a null as
 * nothing, where TanStack DB compares JavaScript values and a null as 0.
 */
const SERVER_AGGREGATES = new Set(['count', 'sum', 'avg'])

/** Whether every clause the query sets is in `allowed` */
function setsOnly(query: IR.QueryIR, allowed: Set<string>): boolean {
  return Object.entries(query).every(
    ([clause, value]) =>
      allowed.has(clause) ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0),
  )
}

/**
 * The columns read through `parse` when `from` is a Supabase table, or a
 * subquery that only filters one (its where is pushed down). `null` for any
 * other source: a collection this package did not create has no table.
 */
function filteredTableParsedColumns(from: IR.From): Set<string> | null {
  if (from.type === 'collectionRef') {
    return parsedColumns(from.collection)
  }
  return from.type === 'queryRef' && setsOnly(from.query, FILTER_ONLY_CLAUSES)
    ? filteredTableParsedColumns(from.query.from)
    : null
}

/** The where clauses of the query and of its subquery sources */
function filtersOf(ir: SerializedQueryIR): Array<SerializedWhere> {
  return [
    ...(ir.where ?? []),
    ...(ir.from.type === 'subquery' ? filtersOf(ir.from.query) : []),
  ]
}

/** A filter PostgREST applies exactly, so no row needs filtering afterwards */
function isPushableFilter(where: SerializedWhere): boolean {
  if ('type' in where) return isPushable(where, { stripAlias: true })
  return !where.residual && isPushable(where.expression, { stripAlias: true })
}

/**
 * The select's aggregates when PostgREST can compute each one exactly: a
 * count, sum, or average of one plain column. A sum or average of a column
 * read through `parse` adds the parsed values in TanStack DB, so it is not.
 */
function serverAggregates(
  select: SerializedSelect | undefined,
  parsed: Set<string>,
): Record<string, ServerAggregate> | null {
  const entries = Object.entries(select ?? {})
  if (entries.length === 0) return null
  const aggregates: Record<string, ServerAggregate> = {}
  for (const [alias, value] of entries) {
    if (!('type' in value) || value.type !== 'agg') return null
    const [arg, ...rest] = value.args
    const column =
      arg?.type === 'ref' && arg.path.length === 2 ? arg.path[1]! : null
    if (
      !SERVER_AGGREGATES.has(value.name) ||
      column === null ||
      rest.length > 0 ||
      (value.name !== 'count' && parsed.has(column))
    ) {
      return null
    }
    aggregates[alias] = value
  }
  return aggregates
}

/**
 * The query's aggregates when PostgREST alone produces TanStack DB's exact
 * result: one row of counts, sums, and averages over a single, optionally
 * filtered table, with every filter pushed down. Anything else (grouping,
 * joins, unions, paging, functional clauses, plain or computed select fields,
 * filters PostgREST cannot apply) is left to TanStack DB. This is an
 * allow-list so that clauses added to the IR later default to that path.
 */
function serverAggregateOf(
  ir: IR.QueryIR,
  serialized: SerializedQueryIR,
): Record<string, ServerAggregate> | null {
  const parsed = filteredTableParsedColumns(ir.from)
  if (
    parsed === null ||
    !setsOnly(ir, SERVER_AGGREGATE_CLAUSES) ||
    !filtersOf(serialized).every(isPushableFilter)
  ) {
    return null
  }
  return serverAggregates(serialized.select, parsed)
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Execute a TanStack DB query against Supabase in a one-shot manner.
 *
 * Experimental: this reads TanStack DB's internal query representation, which
 * can change between releases.
 *
 * Either way it resolves to what TanStack DB's own `queryOnce` resolves to.
 * A query whose select holds only counts, sums, and averages of columns of a
 * single Supabase table, with filters PostgREST can apply and no grouping,
 * join, paging, or functional clause, is computed by the server in a single
 * PostgREST request. It relies on PostgREST aggregate functions, which must be
 * enabled with `pgrst.db_aggregates_enabled`.
 *
 * Every other query, including min, max, groupBy, and having, runs through
 * TanStack DB's `queryOnce` over the collections: filters, ordering, and
 * limits are pushed to PostgREST where possible, and the remaining operations
 * are applied client-side over the fetched rows.
 */
export const experimental_queryOnce = <
  TQueryFn extends (q: InitialQueryBuilder) => QueryBuilder<any>,
  TQuery extends QueryBuilder<any> = ReturnType<TQueryFn>,
>(
  callback: TQueryFn,
  supabase: SupabaseClient,
): Promise<InferResultType<ExtractContext<TQuery>>> => {
  const q = new Query()
  const ir = (callback(q) as unknown as BaseQueryBuilder)._getQuery()
  const serialized = serializeQueryIR(ir)
  const aggregates = serverAggregateOf(ir, serialized)
  if (aggregates) {
    return executeServerAggregate(supabase, serialized, aggregates) as Promise<
      InferResultType<ExtractContext<TQuery>>
    >
  }
  return queryOnce(callback as any) as Promise<
    InferResultType<ExtractContext<TQuery>>
  >
}
