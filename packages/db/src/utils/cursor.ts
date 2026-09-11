import {
  and,
  eq,
  gt,
  gte,
  isNull,
  isUndefined,
  lt,
  not,
  or,
} from '../query/builder/functions.js'
import { Value } from '../query/ir.js'
import type { BasicExpression, OrderBy, OrderByClause } from '../query/ir.js'

function isNullish(
  expression: OrderByClause[`expression`],
): BasicExpression<boolean> {
  return or(isNull(expression), isUndefined(expression))
}

function followsBoundary(
  clause: OrderByClause,
  value: unknown,
): BasicExpression<boolean> {
  const nullish = isNullish(clause.expression)
  if (value == null) {
    return clause.compareOptions.nulls === `first`
      ? not(nullish)
      : new Value(false)
  }

  const operator = clause.compareOptions.direction === `asc` ? gt : lt
  const comparison = operator(clause.expression, new Value(value))
  return clause.compareOptions.nulls === `last`
    ? or(comparison, nullish)
    : comparison
}

/** Build a single-column cursor; multi-column queries use prefix loading. */
export function buildCursor(
  orderBy: OrderBy,
  values: Array<unknown>,
): BasicExpression<boolean> | undefined {
  if (values.length === 0) return undefined
  if (orderBy.length !== 1 || values.length !== 1) {
    throw new Error(`Only single-column cursors are supported`)
  }
  return followsBoundary(orderBy[0]!, values[0])
}

/** Build the equality range that closes the first ordered boundary term. */
export function buildCursorCurrent(
  orderBy: OrderBy,
  values: ReadonlyArray<unknown>,
): BasicExpression<boolean> | undefined {
  const { expression } = orderBy[0] ?? {}
  if (!expression || values.length === 0) return undefined
  const value = values[0]
  if (value == null) return isNullish(expression)
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return undefined
    return and(
      gte(expression, new Value(value)),
      lt(expression, new Value(new Date(value.getTime() + 1))),
    )
  }
  if (typeof value === `object`) return undefined
  return eq(expression, new Value(value))
}

/**
 * Whether the public predicate IR can express this boundary's comparison.
 * Unsupported values must use an unbounded fetch rather than a provider order
 * that may differ from the local comparator.
 */
export function canExpressCursorOrder(
  orderBy: OrderBy,
  values: ReadonlyArray<unknown>,
): boolean {
  if (orderBy.length !== 1 || values.length !== 1) return false
  const value = values[0]
  if (value == null) return false
  if (value instanceof Date) return Number.isFinite(value.getTime())
  if (typeof value === `string`) {
    return orderBy[0]!.compareOptions.stringSort === `lexical`
  }
  return (
    (typeof value === `number` && Number.isFinite(value)) ||
    typeof value === `bigint` ||
    typeof value === `boolean`
  )
}
