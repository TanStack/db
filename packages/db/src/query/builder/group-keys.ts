import { grouping } from '../compiler/grouping.js'
import type { Grouping } from '../compiler/grouping.js'
import type { Context, GroupByCallback, OperatorCallback } from './types.js'

/**
 * Group keys for `query.groupBy(...)` when the query has no aggregate.
 * Aggregates such as `count` bring the grouping compiler themselves.
 */
export interface GroupKeys<TContext extends Context, TKeys = any> {
  callback: GroupByCallback<TContext, TKeys>
  grouping: Grouping
}

export function groupKeys<TContext extends Context = any, TKeys = any>(
  callback: (
    refs: Parameters<OperatorCallback<TContext, GroupByCallback<TContext>>>[0],
  ) => TKeys,
): GroupKeys<TContext, TKeys> {
  return { callback, grouping }
}
