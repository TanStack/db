import { Query, queryOnce } from '@tanstack/db'
import { isSupabaseCollection } from './db'
import { isAggregateOnlySelect, queryIrToSearch } from './postgrest-filters'
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
import type { SerializedQueryIR } from './serialize'
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

/** Run an aggregate-only query on PostgREST, shaped like TanStack's result */
async function executeServerAggregate(
  supabase: SupabaseClient,
  ir: SerializedQueryIR,
): Promise<unknown> {
  // A single aggregate row has nothing to order, and Postgres rejects ORDER BY
  // on a column outside the aggregates.
  const rows = await executeQuery(supabase, { ...ir, orderBy: undefined })
  return ir.singleResult ? rows[0] : rows
}

// ── Server aggregate detection ──────────────────────────────────────

/**
 * Clauses the server aggregate path reproduces exactly: filters, paging, and
 * the no-op order/distinct on its single row. findOne is unwrapped.
 */
const SERVER_AGGREGATE_CLAUSES = new Set([
  'from',
  'select',
  'where',
  'orderBy',
  'limit',
  'offset',
  'distinct',
  'singleResult',
])

/** Clauses a subquery source may set and still be pushed down: its filters */
const FILTER_ONLY_CLAUSES = new Set(['from', 'where'])

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
 * A Supabase table, or a subquery that only filters one (its where is pushed
 * down). A collection this package did not create has no table to query.
 */
function isFilteredTable(from: IR.From): boolean {
  if (from.type === 'collectionRef') {
    return isSupabaseCollection(from.collection)
  }
  return (
    from.type === 'queryRef' &&
    setsOnly(from.query, FILTER_ONLY_CLAUSES) &&
    isFilteredTable(from.query.from)
  )
}

/**
 * Whether PostgREST alone produces the query's exact result: one row of
 * aggregates over a single, optionally filtered table. executeQuery returns
 * PostgREST's response as-is, so anything else (grouping, joins, unions,
 * functional clauses, plain or computed select fields) is left to TanStack DB.
 * This is an allow-list so that clauses added to the IR later default to the
 * client-side path.
 */
function isServerAggregate(
  ir: IR.QueryIR,
  serialized: SerializedQueryIR,
): boolean {
  return (
    setsOnly(ir, SERVER_AGGREGATE_CLAUSES) &&
    isFilteredTable(ir.from) &&
    isAggregateOnlySelect(serialized.select)
  )
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Execute a TanStack DB query against Supabase in a one-shot manner.
 *
 * Experimental: this reads TanStack DB's internal query representation, which
 * can change between releases.
 *
 * A query whose select contains only aggregates (count/sum/avg/min/max) over
 * a single Supabase table, with no grouping, join, or functional clause, is
 * translated to a single PostgREST request and computed by the server. It
 * relies on PostgREST aggregate functions, which must be enabled with
 * `pgrst.db_aggregates_enabled`.
 *
 * Every other query, including groupBy and having, runs through TanStack DB's
 * own `queryOnce` over the collections: filters, ordering, and limits are
 * pushed to PostgREST where possible, and the remaining operations (grouping,
 * having, distinct, computed select expressions) are applied client-side over
 * the fetched rows.
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
  if (isServerAggregate(ir, serialized)) {
    return executeServerAggregate(supabase, serialized) as Promise<
      InferResultType<ExtractContext<TQuery>>
    >
  }
  return queryOnce(callback as any) as Promise<
    InferResultType<ExtractContext<TQuery>>
  >
}
