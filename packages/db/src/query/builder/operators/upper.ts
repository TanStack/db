import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import type { CompiledExpression } from "../../ir.js"
import type { ExpressionLike, StringFunctionReturnType } from "./types.js"

// ============================================================
// EVALUATOR
// ============================================================

function upperEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const arg = compiledArgs[0]!

  return (data: any) => {
    const value = arg(data)
    return typeof value === `string` ? value.toUpperCase() : value
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function upper<T extends ExpressionLike>(
  arg: T
): StringFunctionReturnType<T> {
  return new Func(
    `upper`,
    [toExpression(arg)],
    upperEvaluatorFactory
  ) as StringFunctionReturnType<T>
}
