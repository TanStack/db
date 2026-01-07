import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { BasicExpression, CompiledExpression } from '../../ir.js'

// ============================================================
// TYPES
// ============================================================

// Helper type for any expression-like value
type ExpressionLike = BasicExpression | any

// ============================================================
// EVALUATOR
// ============================================================

function concatEvaluatorFactory(
  compiledArgs: Array<CompiledExpression>,
  _isSingleRow: boolean,
): CompiledExpression {
  return (data: any) => {
    return compiledArgs
      .map((evaluator) => {
        const arg = evaluator(data)
        try {
          return String(arg ?? ``)
        } catch {
          try {
            return JSON.stringify(arg) || ``
          } catch {
            return `[object]`
          }
        }
      })
      .join(``)
  }
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function concat(
  ...args: Array<ExpressionLike>
): BasicExpression<string> {
  return new Func(
    `concat`,
    args.map((arg) => toExpression(arg)),
    concatEvaluatorFactory,
  )
}
