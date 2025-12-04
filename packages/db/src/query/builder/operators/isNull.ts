import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import type { BasicExpression, CompiledExpression } from "../../ir.js"

// ============================================================
// TYPES
// ============================================================

// Helper type for any expression-like value
type ExpressionLike = BasicExpression | any

// ============================================================
// EVALUATOR
// ============================================================

function isNullEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const arg = compiledArgs[0]!

  return (data: any) => {
    const value = arg(data)
    return value === null
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function isNull(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`isNull`, [toExpression(value)], isNullEvaluatorFactory)
}
