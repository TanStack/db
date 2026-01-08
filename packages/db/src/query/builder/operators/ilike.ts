import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { pattern } from './factories.js'
import { evaluateLike } from './like.js'
import type { BasicExpression, EvaluatorFactory } from '../../ir.js'
import type { ExpressionLike, StringLike } from './types.js'

const ilikeFactory = /* #__PURE__*/ pattern((value, patternStr) =>
  evaluateLike(value, patternStr, true),
) as EvaluatorFactory

export function ilike(
  left: StringLike,
  right: StringLike,
): BasicExpression<boolean>
export function ilike(
  left: ExpressionLike,
  right: ExpressionLike,
): BasicExpression<boolean>
export function ilike(left: unknown, right: unknown): BasicExpression<boolean> {
  return new Func(
    `ilike`,
    [toExpression(left), toExpression(right)],
    ilikeFactory,
  )
}
