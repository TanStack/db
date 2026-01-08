import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { pattern } from './factories.js'
import type { BasicExpression, EvaluatorFactory } from '../../ir.js'
import type { ExpressionLike, StringLike } from './types.js'

/**
 * Evaluates SQL LIKE patterns.
 * Exported for use by ilike.
 */
export function evaluateLike(
  value: unknown,
  patternStr: unknown,
  caseInsensitive: boolean = false,
): boolean {
  if (typeof value !== `string` || typeof patternStr !== `string`) {
    return false
  }

  const searchValue = caseInsensitive ? value.toLowerCase() : value
  const searchPattern = caseInsensitive ? patternStr.toLowerCase() : patternStr

  // Convert SQL LIKE pattern to regex
  // First escape all regex special chars except % and _
  let regexPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)

  // Then convert SQL wildcards to regex
  regexPattern = regexPattern.replace(/%/g, `.*`) // % matches any sequence
  regexPattern = regexPattern.replace(/_/g, `.`) // _ matches any single char

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(searchValue)
}

const likeFactory = /* #__PURE__*/ pattern((value, patternStr) =>
  evaluateLike(value, patternStr, false),
) as EvaluatorFactory

export function like(
  left: StringLike,
  right: StringLike,
): BasicExpression<boolean>
export function like(
  left: ExpressionLike,
  right: ExpressionLike,
): BasicExpression<boolean>
export function like(left: unknown, right: unknown): BasicExpression<boolean> {
  return new Func(
    `like`,
    [toExpression(left), toExpression(right)],
    likeFactory,
  )
}
