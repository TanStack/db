import { Func, PropRef, Value } from "../ir.js"
import type { BasicExpression } from "../ir.js"

/**
 * Functions supported by the collection index system.
 * These are the only functions that can be used in WHERE clauses
 * that are pushed down to collection subscriptions for index optimization.
 */
export const SUPPORTED_COLLECTION_FUNCS = new Set([
  `eq`,
  `gt`,
  `lt`,
  `gte`,
  `lte`,
  `and`,
  `or`,
  `in`,
])

/**
 * Determines if a WHERE clause can be converted to collection-compatible BasicExpression format.
 * This checks if the expression only uses functions supported by the collection index system.
 *
 * @param whereClause - The WHERE clause to check
 * @returns True if the clause can be converted for collection index optimization
 */
export function isConvertibleToCollectionFilter(
  whereClause: BasicExpression<boolean>
): boolean {
  function checkExpression(expr: BasicExpression<boolean>): boolean {
    switch (expr.type) {
      case `val`:
        return true
      case `ref`:
        return true
      case `func`: {
        // Check if this function is supported
        if (!SUPPORTED_COLLECTION_FUNCS.has(expr.name)) {
          return false
        }
        // Recursively check all arguments
        return expr.args.every((arg) =>
          checkExpression(arg as BasicExpression<boolean>)
        )
      }
      default:
        return false
    }
  }

  return checkExpression(whereClause)
}

/**
 * Converts a WHERE clause to BasicExpression format compatible with collection indexes.
 * This function creates proper BasicExpression class instances that the collection
 * index system can understand.
 *
 * @param whereClause - The WHERE clause to convert
 * @param collectionAlias - The alias of the collection being filtered
 * @returns The converted BasicExpression or null if conversion fails
 */
export function convertToBasicExpression(
  whereClause: BasicExpression<boolean>,
  collectionAlias: string
): BasicExpression<boolean> | null {
  function convert(
    expr: BasicExpression<boolean>
  ): BasicExpression<boolean> | null {
    switch (expr.type) {
      case `val`:
        return new Value(expr.value)
      case `ref`: {
        const path = expr.path
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
      }
      case `func`: {
        if (!SUPPORTED_COLLECTION_FUNCS.has(expr.name)) return null
        const args: Array<BasicExpression> = []
        for (const arg of expr.args) {
          const conv = convert(arg)
          if (conv == null) return null
          args.push(conv)
        }
        return new Func(expr.name, args)
      }
      default:
        return null
    }
  }

  return convert(whereClause)
}
