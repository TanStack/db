import { joinRuntime } from '../compiler/join-runtime.js'
import type { JoinRuntime } from '../compiler/join-runtime.js'
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
  runtime: JoinRuntime
}

/** A function that builds one join type's operator. */
export type JoinOperatorFunction<TJoinType extends JoinType> = <
  TSource extends Source,
  TContext extends Context = any,
>(
  source: TSource,
  on: JoinCondition<TContext, TSource>,
) => JoinOperator<TContext, TSource, TJoinType>

/**
 * A join condition. `.join()` supplies the query's context; when TypeScript
 * runs without noImplicitAny it skips that inference, and the condition is
 * then untyped, as other unannotated callbacks are in that mode.
 */
export type JoinCondition<
  TContext extends Context,
  TSource extends Source,
> = 0 extends 1 & TContext
  ? (refs: any) => any
  : JoinOnCallback<
      MergeContextForJoinCallback<TContext, SchemaFromSource<TSource>>
    >

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
    runtime: joinRuntime,
  })
}

export const leftJoin: JoinOperatorFunction<`left`> = joinOperator(`left`)
export const rightJoin: JoinOperatorFunction<`right`> = joinOperator(`right`)
export const innerJoin: JoinOperatorFunction<`inner`> = joinOperator(`inner`)
export const fullJoin: JoinOperatorFunction<`full`> = joinOperator(`full`)

/** A join whose type is chosen at run time. */
export function joinOf<
  TJoinType extends JoinType,
  TSource extends Source,
  TContext extends Context = any,
>(
  type: TJoinType,
  source: TSource,
  on: JoinCondition<TContext, TSource>,
): JoinOperator<TContext, TSource, TJoinType> {
  return joinOperator(type)<TSource, TContext>(source, on)
}
