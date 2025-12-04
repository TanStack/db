import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import type { CompiledExpression } from "../../ir.js"
import type { ExpressionLike, StringFunctionReturnType } from "./types.js"

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
// BUILDER FUNCTION
// ============================================================

export function lower<T extends ExpressionLike>(
  arg: T
): StringFunctionReturnType<T> {
  return new Func(
    `lower`,
    [toExpression(arg)],
    lowerEvaluatorFactory
  ) as StringFunctionReturnType<T>
}
