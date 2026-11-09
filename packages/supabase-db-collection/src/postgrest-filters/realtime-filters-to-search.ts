import { toPostgrestParams } from './common'
import type { PostgrestParam } from './common'
import type { LoadSubsetOptions } from '@tanstack/db'

type WhereExpression = LoadSubsetOptions['where']
type ColumnParam = Extract<PostgrestParam, { kind: 'column' }>

/**
 * Realtime `postgres_changes` accepts only a top-level column compared with one
 * of these operators (optionally negated with `not.`). Anything else — an
 * embedded column, an OR group, a function — cannot be pushed and forces the
 * catch-all.
 */
const REALTIME_OPERATOR = /^(?:not\.)?(?:eq|gt|gte|lt|lte|in|is)$/
/** Realtime rejects `in` filters with more than this many values. */
const MAX_IN_VALUES = 100

/**
 * Whether a rendered PostgREST param is expressible as a single Realtime
 * condition. Realtime shares PostgREST's WHERE grammar, so the shared renderer
 * already produced the exact `operator.value` wire form; this only rejects the
 * shapes Realtime cannot evaluate.
 */
const isRealtimeParam = (param: PostgrestParam): param is ColumnParam => {
  // OR groups and other embedded filters have no single-column Realtime form.
  if (param.kind !== 'column') {
    return false
  }
  if (!REALTIME_OPERATOR.test(param.operator)) {
    return false
  }
  // Realtime can only evaluate a top-level table column, never an embedded one.
  if (param.column.includes('.')) {
    return false
  }
  if (param.operator.endsWith('in')) {
    // An empty IN list matches nothing; the catch-all keeps the subscription
    // usable and lets the live query re-filter client-side.
    if (param.value === '()') {
      return false
    }
    // Splitting on commas overcounts values that quote a comma, which only ever
    // trips the limit early and falls back to the (correct) catch-all.
    const members = param.value.slice(1, -1).split(',')
    if (members.length > MAX_IN_VALUES) {
      return false
    }
  }
  return true
}

/**
 * Build the Realtime `postgres_changes` filters for a table's active queries.
 *
 * The result is a single `URLSearchParams` with one repeated `filter` entry per
 * active query, each value being that query's AND-ed conditions comma-joined
 * into Realtime's wire form (e.g. `active=eq.true,id=gt.5`). Conditions and
 * queries are sorted and deduplicated so an unchanged filter set produces a
 * stable `toString()` key. An empty `URLSearchParams` is the catch-all: it is
 * returned whenever any query is unfiltered or uses an expression Realtime
 * cannot evaluate, since a narrower subscription would drop rows that query
 * needs.
 */
export function realtimeFiltersToSearch(
  whereExpressions: Array<WhereExpression>,
): URLSearchParams {
  const groups = new Set<string>()

  for (const where of whereExpressions) {
    let params: Array<PostgrestParam>
    try {
      // `strict` throws on anything unpushable (server aggregates, functions);
      // `quoteScalars` matches the request path's quoting so reserved characters
      // survive the comma-joined condition list.
      params = toPostgrestParams(where, { quoteScalars: true, strict: true })
    } catch {
      return new URLSearchParams()
    }

    // A query with no pushable conditions matches every row, so the whole table
    // must fall back to the catch-all.
    if (params.length === 0) {
      return new URLSearchParams()
    }

    const conditions = new Set<string>()
    for (const param of params) {
      if (!isRealtimeParam(param)) {
        return new URLSearchParams()
      }
      conditions.add(`${param.column}=${param.operator}.${param.value}`)
    }
    groups.add(Array.from(conditions).sort().join(','))
  }

  const search = new URLSearchParams()
  for (const filter of Array.from(groups).sort()) {
    search.append('filter', filter)
  }
  return search
}
