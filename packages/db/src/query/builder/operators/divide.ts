import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { numeric } from './factories.js'
import type { EvaluatorFactory } from '../../ir.js'
import type { BinaryNumericReturnType, ExpressionLike } from './types.js'

// Division returns null for division by zero
const divideFactory = /* #__PURE__*/ numeric((a, b) => (b !== 0 ? a / b : null)) as EvaluatorFactory

export function divide<T1 extends ExpressionLike, T2 extends ExpressionLike>(
  left: T1,
  right: T2,
): BinaryNumericReturnType<T1, T2> {
  return new Func(
    `divide`,
    [toExpression(left), toExpression(right)],
    divideFactory,
  ) as BinaryNumericReturnType<T1, T2>
}
