import { includesRuntime } from '../live/includes-runtime.js'
import {
  IncludeWrapper,
  MaterializeWrapper,
  ToArrayWrapper,
} from './functions.js'
import type { SingleResult } from '../../types.js'
import type { BaseQueryBuilder, QueryBuilder } from './index.js'
import type { Context, GetInlineResult } from './types.js'

// The include functions carry the include materializer. They live apart from
// the expression functions, which core modules import, so only apps that
// include subqueries bundle it.

export function toArray<TContext extends Context>(
  query: QueryBuilder<TContext>,
): ToArrayWrapper<GetInlineResult<TContext>> {
  return new ToArrayWrapper(query, includesRuntime)
}

/**
 * Materialize an includes subquery into a plain value on the parent row.
 *
 * - For multi-row subqueries, the parent receives an `Array<T>` snapshot
 *   (equivalent to `toArray()`).
 * - For `findOne()` subqueries, the parent receives a single `T | undefined`
 *   value — `undefined` when no child matches.
 *
 * The snapshot updates reactively: parent rows re-emit when the underlying
 * children change.
 *
 * @example
 * ```ts
 * // Multi-row: produces Array<Issue> on each project
 * select(({ p }) => ({
 *   ...p,
 *   issues: materialize(
 *     q.from({ i: issues }).where(({ i }) => eq(i.projectId, p.id)),
 *   ),
 * }))
 *
 * // Singleton: produces Author | undefined on each post
 * select(({ p }) => ({
 *   ...p,
 *   author: materialize(
 *     q.from({ a: authors }).where(({ a }) => eq(a.id, p.authorId)).findOne(),
 *   ),
 * }))
 * ```
 */
export function materialize<TContext extends Context>(
  query: QueryBuilder<TContext>,
): MaterializeWrapper<
  GetInlineResult<TContext>,
  TContext extends SingleResult ? true : false
> {
  return new MaterializeWrapper(query, includesRuntime)
}

/**
 * Includes a correlated subquery as a live child Collection on each parent
 * row. Use `toArray()` or `materialize()` for inline values instead.
 *
 * @example
 * ```ts
 * select(({ p }) => ({
 *   ...p,
 *   issues: include(
 *     q.from({ i: issues }).where(({ i }) => eq(i.projectId, p.id)),
 *   ),
 * }))
 * ```
 */
export function include<TContext extends Context>(
  query: QueryBuilder<TContext>,
): IncludeWrapper<TContext> {
  // Every QueryBuilder is a BaseQueryBuilder; the public type hides internals.
  return new IncludeWrapper(
    query as unknown as BaseQueryBuilder<any>,
    includesRuntime,
  )
}
