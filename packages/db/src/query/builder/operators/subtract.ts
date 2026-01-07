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

function subtractEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean,
): CompiledExpression {
  const argA = compiledArgs[0]!
  const argB = compiledArgs[1]!

  return (data: any) => {
    const a = argA(data)
    const b = argB(data)
    return (a ?? 0) - (b ?? 0)
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function subtract<T1 extends ExpressionLike, T2 extends ExpressionLike>(
  left: T1,
  right: T2,
): BinaryNumericReturnType<T1, T2> {
  return new Func(
    `subtract`,
    [toExpression(left), toExpression(right)],
    subtractEvaluatorFactory,
  ) as BinaryNumericReturnType<T1, T2>
}
