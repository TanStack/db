import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { isUnknown } from './factories.js'
import type { BasicExpression, EvaluatorFactory } from '../../ir.js'
import type { ExpressionLike } from './types.js'

// IN requires a custom factory because it handles arrays specially
const inFactory: EvaluatorFactory = (compiledArgs) => {
  const valueEvaluator = compiledArgs[0]!
  const arrayEvaluator = compiledArgs[1]!

  return (data: unknown) => {
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

export function inArray(
  value: ExpressionLike,
  array: ExpressionLike,
): BasicExpression<boolean> {
  return new Func(
    `in`,
    [toExpression(value), toExpression(array)],
    inFactory,
  )
}
