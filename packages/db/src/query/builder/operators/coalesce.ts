import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { BasicExpression, EvaluatorFactory } from '../../ir.js'
import type { ExpressionLike } from './types.js'

// COALESCE returns the first non-null/undefined value
const coalesceFactory: EvaluatorFactory = (compiledArgs) => {
  return (data: unknown) => {
    for (const evaluator of compiledArgs) {
      const value = evaluator(data)
      if (value !== null && value !== undefined) {
        return value
      }
    }
    return null
  }
}

export function coalesce(...args: Array<ExpressionLike>): BasicExpression<any> {
  return new Func(
    `coalesce`,
    args.map((arg) => toExpression(arg)),
    coalesceFactory,
  )
}
