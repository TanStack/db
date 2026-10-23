import { processJoins } from '../compiler/joins.js'
import { validateJoinConditions } from '../join-conditions.js'
import { applyOptimizations } from '../optimizer-joins.js'
import { materializeCompilation } from '../live/materialized-pipeline.js'
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
  materialize: typeof materializeCompilation
  validate: typeof validateJoinConditions
}

/** A function that builds one join type's operator. */
export type JoinOperatorFunction<TJoinType extends JoinType> = <
  TContext extends Context,
  TSource extends Source,
>(
  source: TSource,
  on: JoinOnCallback<
    MergeContextForJoinCallback<TContext, SchemaFromSource<TSource>>
  >,
) => JoinOperator<TContext, TSource, TJoinType>

function joinOperator<TJoinType extends JoinType>(
  type: TJoinType,
): JoinOperatorFunction<TJoinType> {
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
    materialize: materializeCompilation,
    validate: validateJoinConditions,
  })
}

export const leftJoin: JoinOperatorFunction<`left`> = joinOperator(`left`)
export const rightJoin: JoinOperatorFunction<`right`> = joinOperator(`right`)
export const innerJoin: JoinOperatorFunction<`inner`> = joinOperator(`inner`)
export const fullJoin: JoinOperatorFunction<`full`> = joinOperator(`full`)

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
