import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { comparison } from './factories.js'
import type { Aggregate, BasicExpression, EvaluatorFactory } from '../../ir.js'
import type { ComparisonOperand } from './types.js'

// Factory using the comparison helper - cast to EvaluatorFactory for Func constructor
const gteFactory = /* #__PURE__*/ comparison<number>(
  (a, b) => a >= b,
) as EvaluatorFactory

export function gte<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function gte<T>(
  left: Aggregate<T>,
  right: unknown,
): BasicExpression<boolean>
export function gte(left: unknown, right: unknown): BasicExpression<boolean> {
  return new Func(`gte`, [toExpression(left), toExpression(right)], gteFactory)
}
