import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { BasicExpression, CompiledExpression } from '../../ir.js'

// ============================================================
// TYPES
// ============================================================

// Helper type for any expression-like value
type ExpressionLike = BasicExpression | any

// Helper type for binary numeric operations (combines nullability of both operands)
type BinaryNumericReturnType<_T1, _T2> = BasicExpression<
  number | undefined | null
>

// ============================================================
// EVALUATOR
// ============================================================

function divideEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean,
): CompiledExpression {
  const argA = compiledArgs[0]!
  const argB = compiledArgs[1]!

  return (data: any) => {
    const a = argA(data)
    const b = argB(data)
    const divisor = b ?? 0
    return divisor !== 0 ? (a ?? 0) / divisor : null
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function divide<T1 extends ExpressionLike, T2 extends ExpressionLike>(
  left: T1,
  right: T2,
): BinaryNumericReturnType<T1, T2> {
  return new Func(
    `divide`,
    [toExpression(left), toExpression(right)],
    divideEvaluatorFactory,
  ) as BinaryNumericReturnType<T1, T2>
}
