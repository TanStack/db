import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import { evaluateLike } from "./like.js"
import type { BasicExpression, CompiledExpression } from "../../ir.js"

// ============================================================
// TYPES
// ============================================================

type StringRef =
  | BasicExpression<string>
  | BasicExpression<string | null>
  | BasicExpression<string | undefined>
type StringLike = StringRef | string | null | undefined | any

// ============================================================
// EVALUATOR
// ============================================================

function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

function ilikeEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const valueEvaluator = compiledArgs[0]!
  const patternEvaluator = compiledArgs[1]!

  return (data: any) => {
    const value = valueEvaluator(data)
    const pattern = patternEvaluator(data)
    // In 3-valued logic, if value or pattern is null/undefined, return UNKNOWN
    if (isUnknown(value) || isUnknown(pattern)) {
      return null
    }
    return evaluateLike(value, pattern, true)
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function ilike(
  left: StringLike,
  right: StringLike
): BasicExpression<boolean> {
  return new Func(
    `ilike`,
    [toExpression(left), toExpression(right)],
    ilikeEvaluatorFactory
  )
}
