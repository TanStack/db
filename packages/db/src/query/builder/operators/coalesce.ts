import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import { registerOperator } from "../../compiler/registry.js"
import type { BasicExpression } from "../../ir.js"
import type { CompiledExpression } from "../../compiler/registry.js"

// ============================================================
// TYPES
// ============================================================

// Helper type for any expression-like value
type ExpressionLike = BasicExpression | any

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function coalesce(...args: Array<ExpressionLike>): BasicExpression<any> {
  return new Func(
    `coalesce`,
    args.map((arg) => toExpression(arg))
  )
}

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
// AUTO-REGISTRATION
// ============================================================

registerOperator(`coalesce`, coalesceEvaluatorFactory)
