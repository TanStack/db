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

// Overloads for or() - support 2 or more arguments
export function or(
  left: ExpressionLike,
  right: ExpressionLike
): BasicExpression<boolean>
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean>
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean> {
  const allArgs = [left, right, ...rest]
  return new Func(
    `or`,
    allArgs.map((arg) => toExpression(arg))
  )
}

// ============================================================
// EVALUATOR
// ============================================================

function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

function orEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  return (data: any) => {
    // 3-valued logic for OR:
    // - true OR anything = true (short-circuit)
    // - null OR anything (except true) = null
    // - false OR false = false
    let hasUnknown = false
    for (const compiledArg of compiledArgs) {
      const result = compiledArg(data)
      if (result === true) {
        return true
      }
      if (isUnknown(result)) {
        hasUnknown = true
      }
    }
    // If we got here, no operand was true
    // If any operand was null, return null (UNKNOWN)
    if (hasUnknown) {
      return null
    }

    return false
  }
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerOperator(`or`, orEvaluatorFactory)
