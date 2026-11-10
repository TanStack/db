import { grouping } from '../compiler/grouping.js'
import type { Grouping } from '../compiler/grouping.js'
import type { Context, GroupByCallback, OperatorCallback } from './types.js'

/**
 * Group keys for `query.groupBy(...)` when the query has no aggregate.
 * Aggregates such as `count` bring the grouping compiler themselves.
 */
export interface GroupKeys<TContext extends Context> {
  callback: GroupByCallback<TContext>
  grouping: Grouping
}

export function groupKeys<TContext extends Context = any>(
  callback: OperatorCallback<TContext, GroupByCallback<TContext>>,
): GroupKeys<TContext> {
  return { callback, grouping }
}
