import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
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

/**
 * Evaluates LIKE patterns
 */
function evaluateLike(
  value: any,
  pattern: any,
  caseInsensitive: boolean
): boolean {
  if (typeof value !== `string` || typeof pattern !== `string`) {
    return false
  }

  const searchValue = caseInsensitive ? value.toLowerCase() : value
  const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern

  // Convert SQL LIKE pattern to regex
  // First escape all regex special chars except % and _
  let regexPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)

  // Then convert SQL wildcards to regex
  regexPattern = regexPattern.replace(/%/g, `.*`) // % matches any sequence
  regexPattern = regexPattern.replace(/_/g, `.`) // _ matches any single char

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(searchValue)
}

function likeEvaluatorFactory(
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
    return evaluateLike(value, pattern, false)
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function like(
  left: StringLike,
  right: StringLike
): BasicExpression<boolean>
export function like(left: any, right: any): BasicExpression<boolean> {
  return new Func(
    `like`,
    [toExpression(left), toExpression(right)],
    likeEvaluatorFactory
  )
}

// Export for use by ilike
export { evaluateLike }
