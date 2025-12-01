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

// Helper type to determine string function return type based on input nullability
type StringFunctionReturnType<_T> = BasicExpression<string | undefined | null>

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function lower<T extends ExpressionLike>(
  arg: T
): StringFunctionReturnType<T> {
  return new Func(`lower`, [toExpression(arg)]) as StringFunctionReturnType<T>
}

// ============================================================
// EVALUATOR
// ============================================================

function lowerEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const arg = compiledArgs[0]!

  return (data: any) => {
    const value = arg(data)
    return typeof value === `string` ? value.toLowerCase() : value
  }
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerOperator(`lower`, lowerEvaluatorFactory)
