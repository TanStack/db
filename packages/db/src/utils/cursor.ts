import {
  and,
  eq,
  gt,
  isNull,
  isUndefined,
  lt,
  not,
  or,
} from '../query/builder/functions.js'
import { Value } from '../query/ir.js'
import type { BasicExpression, OrderBy } from '../query/ir.js'

/**
 * Builds a cursor expression for paginating through ordered results.
 * For multi-column orderBy, creates a composite cursor that respects all columns.
 *
 * For [col1 ASC, col2 DESC] with values [v1, v2], produces:
 *   or(
 *     gt(col1, v1),                         // col1 > v1
 *     and(eq(col1, v1), lt(col2, v2))       // col1 = v1 AND col2 < v2 (DESC)
 *   )
 *
 * This creates a precise cursor that works with composite indexes on the backend.
 *
 * @param orderBy - The order-by clauses defining sort columns and directions
 * @param values - The cursor values corresponding to each order-by column
 * @returns A filter expression for rows after the cursor position, or undefined if empty
 */
export function buildCursor(
  orderBy: OrderBy,
  values: Array<unknown>,
): BasicExpression<boolean> | undefined {
  if (values.length === 0 || orderBy.length === 0) {
    return undefined
  }

  // For multi-column, build the composite cursor:
  // or(
  //   gt(col1, v1),
  //   and(eq(col1, v1), gt(col2, v2)),
  //   and(eq(col1, v1), eq(col2, v2), gt(col3, v3)),
  //   ...
  // )
  const clauses: Array<BasicExpression<boolean>> = []

  for (let i = 0; i < orderBy.length && i < values.length; i++) {
    const clause = orderBy[i]!
    const value = values[i]

    // Build equality conditions for all previous columns
    const eqConditions: Array<BasicExpression<boolean>> = []
    for (let j = 0; j < i; j++) {
      const prevClause = orderBy[j]!
      const prevValue = values[j]
      eqConditions.push(buildCursorEquality(prevClause.expression, prevValue))
    }

    // Add the comparison for the current column (respecting direction)
    const comparison = cursorAfter(clause, value)

    if (eqConditions.length === 0) {
      // First column: just the comparison
      clauses.push(comparison)
    } else {
      // Subsequent columns: and(eq(prev...), comparison)
      // We need to spread into and() which expects at least 2 args
      const allConditions = [...eqConditions, comparison]
      clauses.push(allConditions.reduce((acc, cond) => and(acc, cond)))
    }
  }

  // Combine all clauses with OR
  if (clauses.length === 1) {
    return clauses[0]!
  }
  // Use reduce to combine with or() which expects exactly 2 args
  return clauses.reduce((acc, clause) => or(acc, clause))
}

/**
 * Whether the public predicate IR can express this boundary's comparison.
 * Unsupported values must use an unbounded boundary fetch and local TotalOrder
 * refinement rather than a plausible but different provider order.
 */
export function canExpressCursorOrder(
  orderBy: OrderBy,
  values: ReadonlyArray<unknown>,
): boolean {
  return orderBy.every((clause, index) => {
    const value = values[index]
    if (value == null) return true
    if (value instanceof Date) return Number.isFinite(value.getTime())
    if (typeof value === `string`) {
      return clause.compareOptions.stringSort === `lexical`
    }
    return (
      typeof value === `number` ||
      typeof value === `bigint` ||
      typeof value === `boolean`
    )
  })
}

function cursorNullish(expression: BasicExpression): BasicExpression<boolean> {
  return or(isNull(expression), isUndefined(expression))
}

export function buildCursorEquality(
  expression: BasicExpression,
  value: unknown,
): BasicExpression<boolean> {
  return value == null
    ? cursorNullish(expression)
    : eq(expression, new Value(value))
}

function cursorAfter(
  clause: OrderBy[number],
  value: unknown,
): BasicExpression<boolean> {
  const { expression, compareOptions } = clause
  const nullish = cursorNullish(expression)

  if (value == null) {
    return compareOptions.nulls === `first` ? not(nullish) : new Value(false)
  }

  const compare =
    compareOptions.direction === `asc`
      ? gt(expression, new Value(value))
      : lt(expression, new Value(value))
  return compareOptions.nulls === `last`
    ? or(compare, nullish)
    : and(not(nullish), compare)
}
