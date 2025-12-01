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

// Helper type to determine numeric function return type based on input nullability
type NumericFunctionReturnType<_T> = BasicExpression<number | undefined | null>

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function length<T extends ExpressionLike>(
  arg: T
): NumericFunctionReturnType<T> {
  return new Func(`length`, [toExpression(arg)]) as NumericFunctionReturnType<T>
}

// ============================================================
// EVALUATOR
// ============================================================

function lengthEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
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
// AUTO-REGISTRATION
// ============================================================

registerOperator(`length`, lengthEvaluatorFactory)
