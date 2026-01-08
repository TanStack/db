import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { areValuesEqual, normalizeValue } from '../../../utils/comparison.js'
import { isUnknown } from './factories.js'
import type { Aggregate, BasicExpression, EvaluatorFactory } from '../../ir.js'
import type { ComparisonOperand } from './types.js'

// EQ needs a custom factory because it uses value normalization for proper
// comparison of Dates, BigInts, etc.
const eqFactory: EvaluatorFactory = (compiledArgs) => {
  const argA = compiledArgs[0]!
  const argB = compiledArgs[1]!

  return (data: unknown) => {
    const a = normalizeValue(argA(data))
    const b = normalizeValue(argB(data))

    // 3-valued logic: comparison with null/undefined returns UNKNOWN
    if (isUnknown(a) || isUnknown(b)) {
      return null
    }

    return areValuesEqual(a, b)
  }
}

export function eq<T>(
  left: ComparisonOperand<T>,
  right: ComparisonOperand<T>,
): BasicExpression<boolean>
export function eq<T>(
  left: Aggregate<T>,
  right: unknown,
): BasicExpression<boolean>
export function eq(left: unknown, right: unknown): BasicExpression<boolean> {
  return new Func(`eq`, [toExpression(left), toExpression(right)], eqFactory)
}
