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

export function isUndefined(value: ExpressionLike): BasicExpression<boolean> {
  return new Func(`isUndefined`, [toExpression(value)])
}

// ============================================================
// EVALUATOR
// ============================================================

function isUndefinedEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const arg = compiledArgs[0]!

  return (data: any) => {
    const value = arg(data)
    return value === undefined
  }
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerOperator(`isUndefined`, isUndefinedEvaluatorFactory)
