import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { comparison } from './factories.js'
import type { Aggregate, BasicExpression, EvaluatorFactory } from '../../ir.js'
import type { ComparisonOperand } from './types.js'

// Factory using the comparison helper - cast to EvaluatorFactory for Func constructor
const ltFactory = /* #__PURE__*/ comparison<number>((a, b) => a < b) as EvaluatorFactory

export function lt<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function lt<T>(left: Aggregate<T>, right: unknown): BasicExpression<boolean>
export function lt(left: unknown, right: unknown): BasicExpression<boolean> {
  return new Func(`lt`, [toExpression(left), toExpression(right)], ltFactory)
}
