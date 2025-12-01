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

// Overloads for and() - support 2 or more arguments
export function and(
  left: ExpressionLike,
  right: ExpressionLike
): BasicExpression<boolean>
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean>
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean> {
  const allArgs = [left, right, ...rest]
  return new Func(
    `and`,
    allArgs.map((arg) => toExpression(arg))
  )
}

// ============================================================
// EVALUATOR
// ============================================================

function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

function andEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  return (data: any) => {
    // 3-valued logic for AND:
    // - false AND anything = false (short-circuit)
    // - null AND false = false
    // - null AND anything (except false) = null
    // - anything (except false) AND null = null
    // - true AND true = true
    let hasUnknown = false
    for (const compiledArg of compiledArgs) {
      const result = compiledArg(data)
      if (result === false) {
        return false
      }
      if (isUnknown(result)) {
        hasUnknown = true
      }
    }
    // If we got here, no operand was false
    // If any operand was null, return null (UNKNOWN)
    if (hasUnknown) {
      return null
    }

    return true
  }
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerOperator(`and`, andEvaluatorFactory)
