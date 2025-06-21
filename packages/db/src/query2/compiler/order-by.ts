import { orderBy } from "@electric-sql/d2mini"
import { evaluateExpression } from "./evaluators.js"
import type { OrderBy } from "../ir.js"
import type { NamespacedAndKeyedStream, NamespacedRow } from "../../types.js"

/**
 * Processes the ORDER BY clause
 */
export function processOrderBy(
  pipeline: NamespacedAndKeyedStream,
  orderByClause: OrderBy
): NamespacedAndKeyedStream {
  // Create a value extractor function for the orderBy operator
  const valueExtractor = (namespacedRow: NamespacedRow) => {
    if (orderByClause.length > 1) {
      // For multiple orderBy columns, create a composite key
      return orderByClause.map((clause) =>
        evaluateExpression(clause.expression, namespacedRow)
      )
    } else if (orderByClause.length === 1) {
      // For a single orderBy column, use the value directly
      const clause = orderByClause[0]!
      return evaluateExpression(clause.expression, namespacedRow)
    }

    // Default case - no ordering
    return null
  }

  // Create comparator functions
  const ascComparator = (a: any, b: any): number => {
    // Handle null/undefined
    if (a == null && b == null) return 0
    if (a == null) return -1
    if (b == null) return 1

    // if a and b are both strings, compare them based on locale
    if (typeof a === `string` && typeof b === `string`) {
      return a.localeCompare(b)
    }

    // if a and b are both arrays, compare them element by element
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const result = ascComparator(a[i], b[i])
        if (result !== 0) {
          return result
        }
      }
      // All elements are equal up to the minimum length
      return a.length - b.length
    }

    // If both are dates, compare them
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime()
    }

    // If at least one of the values is an object, convert to strings
    const bothObjects = typeof a === `object` && typeof b === `object`
    const notNull = a !== null && b !== null
    if (bothObjects && notNull) {
      return a.toString().localeCompare(b.toString())
    }

    if (a < b) return -1
    if (a > b) return 1
    return 0
  }

  const descComparator = (a: unknown, b: unknown): number => {
    return ascComparator(b, a)
  }

  // Create a multi-property comparator that respects the order and direction of each property
  const makeComparator = () => {
    return (a: unknown, b: unknown) => {
      // If we're comparing arrays (multiple properties), compare each property in order
      if (orderByClause.length > 1) {
        const arrayA = a as Array<unknown>
        const arrayB = b as Array<unknown>
        for (let i = 0; i < orderByClause.length; i++) {
          const direction = orderByClause[i]!.direction
          const compareFn =
            direction === `desc` ? descComparator : ascComparator
          const result = compareFn(arrayA[i], arrayB[i])
          if (result !== 0) {
            return result
          }
        }
        return arrayA.length - arrayB.length
      }

      // Single property comparison
      if (orderByClause.length === 1) {
        const direction = orderByClause[0]!.direction
        return direction === `desc` ? descComparator(a, b) : ascComparator(a, b)
      }

      return ascComparator(a, b)
    }
  }

  const comparator = makeComparator()

  // Apply the orderBy operator
  return pipeline.pipe(orderBy(valueExtractor, { comparator }))
}
