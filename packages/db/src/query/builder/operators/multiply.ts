import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { numeric } from './factories.js'
import type { EvaluatorFactory } from '../../ir.js'
import type { BinaryNumericReturnType, ExpressionLike } from './types.js'

const multiplyFactory = /* #__PURE__*/ numeric(
  (a, b) => a * b,
) as EvaluatorFactory

export function multiply<T1 extends ExpressionLike, T2 extends ExpressionLike>(
  left: T1,
  right: T2,
): BinaryNumericReturnType<T1, T2> {
  return new Func(
    `multiply`,
    [toExpression(left), toExpression(right)],
    multiplyFactory,
  ) as BinaryNumericReturnType<T1, T2>
}
