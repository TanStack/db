import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type {
  Aggregate,
  BasicExpression,
  CompiledExpression,
} from '../../ir.js'
import type { RefProxy } from '../ref-proxy.js'
import type { RefLeaf } from '../types.js'

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
// EVALUATOR
// ============================================================

function isUnknown(value: any): boolean {
  return value === null || value === undefined
}

function lteEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean,
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
// BUILDER FUNCTION
// ============================================================

export function lte<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function lte<T extends string | number>(
  left: ComparisonOperandPrimitive<T>,
  right: ComparisonOperandPrimitive<T>,
): BasicExpression<boolean>
export function lte<T>(left: Aggregate<T>, right: any): BasicExpression<boolean>
export function lte(left: any, right: any): BasicExpression<boolean> {
  return new Func(
    `lte`,
    [toExpression(left), toExpression(right)],
    lteEvaluatorFactory,
  )
}
