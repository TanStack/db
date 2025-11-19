import { Func, PropRef, Value } from "../ir.js"
import type { BasicExpression, OrderBy } from "../ir.js"

/**
 * Determines if a WHERE clause is a valid BasicExpression that can be normalized
 * and used for collection subscriptions.
 *
 * This function validates that the expression has a valid BasicExpression structure
 * (values, references, or functions with valid arguments). All operators are allowed
 * since downstream systems (filtering, indexing) handle unsupported operators gracefully.
 *
 * @param whereClause - The WHERE clause to check
 * @returns True if the clause is a valid BasicExpression structure
 */
export function isConvertibleToCollectionFilter(
  whereClause: BasicExpression<boolean>
): boolean {
  const tpe = whereClause.type
  if (tpe === `func`) {
    // Recursively check all arguments are valid BasicExpressions
    return whereClause.args.every((arg) =>
      isConvertibleToCollectionFilter(arg as BasicExpression<boolean>)
    )
  }
  return [`val`, `ref`].includes(tpe)
}

/**
 * Normalizes a WHERE clause expression by removing table aliases from property references.
 *
 * This function recursively traverses an expression tree and creates new BasicExpression
 * instances with normalized paths. The main transformation is removing the collection alias
 * from property reference paths (e.g., `['user', 'id']` becomes `['id']` when `collectionAlias`
 * is `'user'`), which is needed when converting query-level expressions to collection-level
 * expressions for subscriptions.
 *
 * @param whereClause - The WHERE clause expression to normalize
 * @param collectionAlias - The alias of the collection being filtered (to strip from paths)
 * @returns A new BasicExpression with normalized paths
 *
 * @example
 * // Input: ref with path ['user', 'id'] where collectionAlias is 'user'
 * // Output: ref with path ['id']
 */
export function convertToBasicExpression(
  whereClause: BasicExpression<boolean>,
  collectionAlias: string
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
      const convertedArg = convertToBasicExpression(
        arg as BasicExpression<boolean>,
        collectionAlias
      )
      args.push(convertedArg)
    }
    return new Func(whereClause.name, args)
  }
}

export function convertOrderByToBasicExpression(
  orderBy: OrderBy,
  collectionAlias: string
): OrderBy {
  const normalizedOrderBy = orderBy.map((clause) => {
    const basicExp = convertToBasicExpression(
      clause.expression,
      collectionAlias
    )

    return {
      ...clause,
      expression: basicExp,
    }
  })

  return normalizedOrderBy
}
