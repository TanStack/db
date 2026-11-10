import { parseOrderByExpression } from '@tanstack/db'
import {
  appendLimit,
  appendOrder,
  paramsToSearch,
  toPostgrestParams,
} from './common'
import type { LoadSubsetOptions } from '@tanstack/db'

/**
 * Encode the params that identify a cached subset — where filters, order, and
 * limit. Deliberately excludes `select`, `cursor`, and `offset`: those are the
 * per-page request details, not part of what distinguishes one subset from
 * another. This is the shared core of the request URL and the query key, so the
 * two cannot drift.
 */
export function subsetParamsToSearch(
  options: LoadSubsetOptions,
): URLSearchParams {
  const { where, orderBy, limit } = options
  const search = paramsToSearch(toPostgrestParams(where, { mergeIn: true }))
  appendOrder(
    search,
    parseOrderByExpression(orderBy).map((sort) => ({
      column: sort.field.join('.'),
      ascending: sort.direction === 'asc',
      nulls: sort.nulls,
    })),
  )
  // `limit: 0` is a real, distinct subset (an empty window). Guard on
  // `undefined`, not falsiness, so it does not collide with the unlimited query
  // on one cache key — otherwise the empty limit-0 result would take over and
  // delete every row the unlimited query owns.
  if (limit !== undefined) {
    appendLimit(search, limit)
  }
  return search
}
