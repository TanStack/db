import { Func } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import { areValuesEqual, normalizeValue } from "../../../utils/comparison.js"
import type {
  Aggregate,
  BasicExpression,
  CompiledExpression,
} from "../../ir.js"
import type { RefProxy } from "../ref-proxy.js"
import type { RefLeaf } from "../types.js"

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

type ComparisonOperandPrimitive<T extends string | number | boolean> =
  | T
  | BasicExpression<T>
  | undefined
  | null

// ============================================================
// EVALUATOR FACTORY
// ============================================================

function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

function eqEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean
): CompiledExpression {
  const argA = compiledArgs[0]!
  const argB = compiledArgs[1]!

  return (data: any) => {
    const a = normalizeValue(argA(data))
    const b = normalizeValue(argB(data))

    // 3-valued logic: comparison with null/undefined returns UNKNOWN
    if (isUnknown(a) || isUnknown(b)) {
      return null
    }

    return areValuesEqual(a, b)
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function eq<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>
): BasicExpression<boolean>
export function eq<T extends string | number | boolean>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>
): BasicExpression<boolean>
export function eq<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function eq(left: any, right: any): BasicExpression<boolean> {
  return new Func(
    `eq`,
    [toExpression(left), toExpression(right)],
    eqEvaluatorFactory
  )
}
