import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { CompiledExpression } from '../../ir.js'
import type { ExpressionLike, NumericFunctionReturnType } from './types.js'

// ============================================================
// EVALUATOR
// ============================================================

function lengthEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean,
): CompiledExpression {
  const arg = compiledArgs[0]!

  return (data: any) => {
    const value = arg(data)
    if (typeof value === `string`) {
      return value.length
    }
    if (Array.isArray(value)) {
      return value.length
    }
    return 0
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function length<T extends ExpressionLike>(
  arg: T,
): NumericFunctionReturnType<T> {
  return new Func(
    `length`,
    [toExpression(arg)],
    lengthEvaluatorFactory,
  ) as NumericFunctionReturnType<T>
}
