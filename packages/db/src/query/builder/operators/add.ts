import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { numeric } from './factories.js'
import type { EvaluatorFactory } from '../../ir.js'
import type { BinaryNumericReturnType, ExpressionLike } from './types.js'

const addFactory = /* #__PURE__*/ numeric((a, b) => a + b) as EvaluatorFactory

export function add<T1 extends ExpressionLike, T2 extends ExpressionLike>(
  left: T1,
  right: T2,
): BinaryNumericReturnType<T1, T2> {
  return new Func(
    `add`,
    [toExpression(left), toExpression(right)],
    addFactory,
  ) as BinaryNumericReturnType<T1, T2>
}
