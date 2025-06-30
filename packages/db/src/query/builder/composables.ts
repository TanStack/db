import { BaseQueryBuilder } from "./index.js"
import type { InitialQueryBuilder, QueryBuilder } from "./index.js"
import type { NamespacedRow } from "../../types.js"
import type { RefProxyForNamespaceRow, SelectObject } from "./types.js"

/**
 * Create a reusable query builder that can be used in multiple places
 *
 * @param fn - A function that receives an initial query builder and returns a configured query
 * @returns A reusable query builder that can be used directly or extended further
 *
 * @example
 * ```ts
 * const activeUsersQuery = defineQuery((q) =>
 *   q.from({ user: usersCollection })
 *    .where(({ user }) => eq(user.active, true))
 * )
 *
 * // Use directly
 * const users = useLiveQuery(activeUsersQuery)
 *
 * // Extend further
 * const activeAdults = activeUsersQuery.where(({ user }) => gt(user.age, 18))
 * ```
 */
export function defineQuery<TQueryBuilder extends QueryBuilder<any>>(
  fn: (builder: InitialQueryBuilder) => TQueryBuilder
): TQueryBuilder {
  return fn(new BaseQueryBuilder())
}

/**
 * Create reusable, type-safe query components for specific table schemas
 *
 * @returns An object with `callback` and `select` methods for creating reusable components
 *
 * @example
 * ```ts
 * // Create reusable predicates
 * const userIsAdult = defineForRow<{ user: User }>().callback(({ user }) =>
 *   gt(user.age, 18)
 * )
 *
 * // Create reusable select transformations
 * const userInfo = defineForRow<{ user: User }>().select(({ user }) => ({
 *   id: user.id,
 *   name: upper(user.name)
 * }))
 *
 * // Use in queries
 * const query = useLiveQuery((q) =>
 *   q.from({ user: usersCollection })
 *    .where(userIsAdult)
 *    .select(userInfo)
 * )
 * ```
 */
export function defineForRow<TNamespaceRow extends NamespacedRow>() {
  /**
   * Create a reusable callback function for WHERE, HAVING, or other expression contexts
   *
   * @param fn - A function that receives table references and returns an expression
   * @returns A reusable callback function that can be used in query builders
   *
   * @example
   * ```ts
   * const userIsActive = defineForRow<{ user: User }>().callback(({ user }) =>
   *   eq(user.active, true)
   * )
   *
   * // Use in WHERE clauses
   * query.where(userIsActive)
   * ```
   */
  const callback = <TResult>(
    fn: (refs: RefProxyForNamespaceRow<TNamespaceRow>) => TResult
  ) => fn

  /**
   * Create a reusable select transformation for projecting and transforming data
   *
   * @param fn - A function that receives table references and returns a select object
   * @returns A reusable select transformation that can be used in query builders
   *
   * @example
   * ```ts
   * const userBasicInfo = defineForRow<{ user: User }>().select(({ user }) => ({
   *   id: user.id,
   *   name: user.name,
   *   displayName: upper(user.name)
   * }))
   *
   * // Use in SELECT clauses
   * query.select(userBasicInfo)
   * ```
   */
  const select = <TSelectObject extends SelectObject>(
    fn: (refs: RefProxyForNamespaceRow<TNamespaceRow>) => TSelectObject
  ) => fn

  return {
    callback,
    select,
  }
}
