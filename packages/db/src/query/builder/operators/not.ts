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

function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

function notEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const arg = compiledArgs[0]!

  return (data: any) => {
    // 3-valued logic for NOT:
    // - NOT null = null
    // - NOT true = false
    // - NOT false = true
    const result = arg(data)
    if (isUnknown(result)) {
      return null
    }
    return !result
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function not(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`not`, [toExpression(value)], notEvaluatorFactory)
}
