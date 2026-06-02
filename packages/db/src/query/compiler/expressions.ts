import { Func, PropRef, Value } from '../ir.js'
import { defaultComparator } from '../../utils/comparison.js'
import type { BasicExpression, OrderBy } from '../ir.js'

/**
 * Normalizes a WHERE clause expression into a canonical form.
 *
 * Recursively traverses an expression tree and creates new BasicExpression instances with:
 * - **Normalized paths** — the collection alias is removed from property reference paths
 *   (e.g. `['user', 'id']` becomes `['id']` when `collectionAlias` is `'user'`), needed when
 *   converting query-level expressions to collection-level expressions for subscriptions.
 * - **Canonical set-membership order** — `in` value arrays are sorted. `in` is unordered, so
 *   without this the same value set in a different order produces a distinct serialized
 *   predicate (and `loadSubset` queryKey / cache key) and refetches identical data.
 *
 * @param whereClause - The WHERE clause expression to normalize
 * @param collectionAlias - The alias of the collection being filtered (to strip from paths)
 * @returns A new, canonicalized BasicExpression
 *
 * @example
 * // Input: ref with path ['user', 'id'] where collectionAlias is 'user'
 * // Output: ref with path ['id']
 */
export function normalizeExpressionPaths(
  whereClause: BasicExpression<boolean>,
  collectionAlias: string,
): BasicExpression<boolean> {
  const tpe = whereClause.type
  if (tpe === `val`) {
    return new Value(whereClause.value)
  } else if (tpe === `ref`) {
    const path = whereClause.path
    if (Array.isArray(path)) {
      if (path[0] === collectionAlias && path.length > 1) {
        // Remove the table alias from the path for single-collection queries
        return new PropRef(path.slice(1))
      } else if (path.length === 1 && path[0] !== undefined) {
        // Single field reference
        return new PropRef([path[0]])
      }
    }
    // Fallback for non-array paths
    return new PropRef(Array.isArray(path) ? path : [String(path)])
  } else {
    // Recursively convert all arguments
    const args: Array<BasicExpression> = []
    for (const arg of whereClause.args) {
      const convertedArg = normalizeExpressionPaths(
        arg as BasicExpression<boolean>,
        collectionAlias,
      )
      args.push(convertedArg)
    }
    if (
      whereClause.name === `in` &&
      args.length === 2 &&
      args[1]?.type === `val` &&
      Array.isArray(args[1].value)
    ) {
      args[1] = new Value([...args[1].value].sort(defaultComparator))
    }
    return new Func(whereClause.name, args)
  }
}

export function normalizeOrderByPaths(
  orderBy: OrderBy,
  collectionAlias: string,
): OrderBy {
  const normalizedOrderBy = orderBy.map((clause) => {
    const basicExp = normalizeExpressionPaths(
      clause.expression,
      collectionAlias,
    )

    return {
      ...clause,
      expression: basicExp,
    }
  })

  return normalizedOrderBy
}
