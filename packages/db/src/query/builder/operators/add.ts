import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import { registerOperator } from "../../compiler/registry.js"
import type { CompiledExpression } from "../../compiler/registry.js"
import type { BinaryNumericReturnType, ExpressionLike } from "./types.js"

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function add<T1 extends ExpressionLike, T2 extends ExpressionLike>(
  left: T1,
  right: T2
): BinaryNumericReturnType<T1, T2> {
  return new Func(`add`, [
    toExpression(left),
    toExpression(right),
  ]) as BinaryNumericReturnType<T1, T2>
}

// ============================================================
// EVALUATOR
// ============================================================

function addEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const argA = compiledArgs[0]!
  const argB = compiledArgs[1]!

  return (data: any) => {
    const a = argA(data)
    const b = argB(data)
    return (a ?? 0) + (b ?? 0)
  }
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerOperator(`add`, addEvaluatorFactory)
