import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { BasicExpression, EvaluatorFactory } from '../../ir.js'
import type { ExpressionLike } from './types.js'

// CONCAT joins all arguments as strings
const concatFactory: EvaluatorFactory = (compiledArgs) => {
  return (data: unknown) => {
    return compiledArgs
      .map((evaluator) => {
        const arg = evaluator(data)
        return String(arg ?? ``)
      })
      .join(``)
  }
}

export function concat(
  ...args: Array<ExpressionLike>
): BasicExpression<string> {
  return new Func(
    `concat`,
    args.map((arg) => toExpression(arg)),
    concatFactory,
  )
}
