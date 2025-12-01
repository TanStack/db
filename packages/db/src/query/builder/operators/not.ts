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

export function not(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`not`, [toExpression(value)])
}

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
// AUTO-REGISTRATION
// ============================================================

registerOperator(`not`, notEvaluatorFactory)
