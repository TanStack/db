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

function coalesceEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  return (data: any) => {
    for (const evaluator of compiledArgs) {
      const value = evaluator(data)
      if (value !== null && value !== undefined) {
        return value
      }
    }
    return null
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function coalesce(...args: Array<ExpressionLike>): BasicExpression<any> {
  return new Func(
    `coalesce`,
    args.map((arg) => toExpression(arg)),
    coalesceEvaluatorFactory
  )
}
