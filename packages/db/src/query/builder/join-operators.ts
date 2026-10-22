import { processJoins } from '../compiler/joins.js'
import { validateJoinConditions } from '../join-conditions.js'
import { applyOptimizations } from '../optimizer-joins.js'
import type {
  Context,
  JoinOnCallback,
  MergeContextForJoinCallback,
  SchemaFromSource,
  Source,
} from './types.js'

export type JoinType = `inner` | `left` | `right` | `full`

/**
 * A join step for `query.join(...)`. Importing a join operator is what brings
 * the join compiler into a bundle.
 */
export interface JoinOperator<
  TContext extends Context,
  TSource extends Source,
  TJoinType extends JoinType,
> {
  source: TSource
  on: JoinOnCallback<
    MergeContextForJoinCallback<TContext, SchemaFromSource<TSource>>
  >
  type: TJoinType
  compile: typeof processJoins
  optimize: typeof applyOptimizations
  validate: typeof validateJoinConditions
}

function joinOperator<TJoinType extends JoinType>(type: TJoinType) {
  return <TContext extends Context, TSource extends Source>(
    source: TSource,
    on: JoinOnCallback<
      MergeContextForJoinCallback<TContext, SchemaFromSource<TSource>>
    >,
  ): JoinOperator<TContext, TSource, TJoinType> => ({
    source,
    on,
    type,
    compile: processJoins,
    optimize: applyOptimizations,
    validate: validateJoinConditions,
  })
}

export const leftJoin = joinOperator(`left`)
export const rightJoin = joinOperator(`right`)
export const innerJoin = joinOperator(`inner`)
export const fullJoin = joinOperator(`full`)

/** A join whose type is chosen at run time. */
export function joinOf<
  TJoinType extends JoinType,
  TContext extends Context,
  TSource extends Source,
>(
  type: TJoinType,
  source: TSource,
  on: JoinOnCallback<
    MergeContextForJoinCallback<TContext, SchemaFromSource<TSource>>
  >,
): JoinOperator<TContext, TSource, TJoinType> {
  return joinOperator(type)<TContext, TSource>(source, on)
}
