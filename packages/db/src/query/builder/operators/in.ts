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

function inEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const valueEvaluator = compiledArgs[0]!
  const arrayEvaluator = compiledArgs[1]!

  return (data: any) => {
    const value = valueEvaluator(data)
    const array = arrayEvaluator(data)
    // In 3-valued logic, if the value is null/undefined, return UNKNOWN
    if (isUnknown(value)) {
      return null
    }
    if (!Array.isArray(array)) {
      return false
    }
    return array.includes(value)
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function inArray(
  value: ExpressionLike,
  array: ExpressionLike
): BasicExpression<boolean> {
  return new Func(
    `in`,
    [toExpression(value), toExpression(array)],
    inEvaluatorFactory
  )
}
