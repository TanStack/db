import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import { registerOperator } from "../../compiler/registry.js"
import type { Aggregate, BasicExpression } from "../../ir.js"
import type { RefProxy } from "../ref-proxy.js"
import type { RefLeaf } from "../types.js"
import type { CompiledExpression } from "../../compiler/registry.js"

// ============================================================
// TYPES
// ============================================================

type ComparisonOperand<T> =
  | RefProxy<T>
  | RefLeaf<T>
  | T
  | BasicExpression<T>
  | undefined
  | null

type ComparisonOperandPrimitive<T extends string | number> =
  | T
  | BasicExpression<T>
  | undefined
  | null

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function lte<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>
): BasicExpression<boolean>
export function lte<T extends string | number>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>
): BasicExpression<boolean>
export function lte<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function lte(left: any, right: any): BasicExpression<boolean> {
  return new Func(`lte`, [toExpression(left), toExpression(right)])
}

// ============================================================
// EVALUATOR
// ============================================================

function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

function lteEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const argA = compiledArgs[0]!
  const argB = compiledArgs[1]!

  return (data: any) => {
    const a = argA(data)
    const b = argB(data)

    // In 3-valued logic, any comparison with null/undefined returns UNKNOWN
    if (isUnknown(a) || isUnknown(b)) {
      return null
    }

    return a <= b
  }
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerOperator(`lte`, lteEvaluatorFactory)
