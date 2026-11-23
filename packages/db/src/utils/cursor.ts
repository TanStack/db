import {
  and,
  eq,
  gt,
  gte,
  isNull,
  isUndefined,
  lt,
  lte,
  not,
  or,
} from '../query/builder/functions.js'
import { Value } from '../query/ir.js'
import { codedMessage, devBuild } from '../error-message.js'
import type { BasicExpression, OrderBy, OrderByClause } from '../query/ir.js'
import type { CustomStringCollation } from '../types.js'

function isNullish(
  expression: OrderByClause[`expression`],
): BasicExpression<boolean> {
  return or(isNull(expression), isUndefined(expression))
}

/** The custom collation a provider is trusted to apply to this order term. */
function trustedCollationOf({
  compareOptions: options,
}: OrderByClause): CustomStringCollation | undefined {
  return options.stringSort === `custom` && options.trustProviderOrder
    ? {
        stringSort: `custom`,
        compare: options.compare,
        trustProviderOrder: true,
      }
    : undefined
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
  const comparison = operator(
    clause.expression,
    new Value(value),
    typeof value === `string` ? trustedCollationOf(clause) : undefined,
  )
  return clause.compareOptions.nulls === `last`
    ? or(comparison, nullish)
    : comparison
}

/**
 * Build a continuation cursor from the leading order term.
 * Trailing terms order the complete leading-value tie loaded separately.
 */
export function buildCursor(
  orderBy: OrderBy,
  values: Array<unknown>,
): BasicExpression<boolean> | undefined {
  if (values.length === 0) return undefined
  if (orderBy.length === 0 || values.length !== 1) {
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Only leading-column cursors are supported`
        : codedMessage(169),
    )
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
  // Distinct strings can tie under a collation, and all of them are the
  // boundary's ties.
  const collation =
    typeof value === `string` ? trustedCollationOf(orderBy[0]!) : undefined
  if (collation) {
    return and(
      gte(expression, new Value(value), collation),
      lte(expression, new Value(value), collation),
    )
  }
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
  if (orderBy.length === 0 || values.length !== 1) return false
  const value = values[0]
  if (value == null) return false
  if (value instanceof Date) return Number.isFinite(value.getTime())
  if (typeof value === `string`) {
    const options = orderBy[0]!.compareOptions
    return (
      options.stringSort === `lexical` ||
      (options.stringSort === `custom` && options.trustProviderOrder === true)
    )
  }
  return (
    (typeof value === `number` && Number.isFinite(value)) ||
    typeof value === `bigint` ||
    typeof value === `boolean`
  )
}
