import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { BasicExpression, CompiledExpression } from '../../ir.js'

// ============================================================
// TYPES
// ============================================================

// Helper type for any expression-like value
type ExpressionLike = BasicExpression | any

// ============================================================
// EVALUATOR
// ============================================================

function isUndefinedEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean,
): CompiledExpression {
  const arg = compiledArgs[0]!

  return (data: any) => {
    const value = arg(data)
    return value === undefined
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function isUndefined(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(
    `isUndefined`,
    [toExpression(value)],
    isUndefinedEvaluatorFactory,
  )
}
