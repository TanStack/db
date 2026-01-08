import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { booleanOp } from './factories.js'
import type { BasicExpression } from '../../ir.js'
import type { ExpressionLike } from './types.js'

// OR: short-circuits on true, returns false if all are false
const orFactory = /* #__PURE__*/ booleanOp({
  shortCircuit: true,
  default: false,
})

// Overloads for or() - support 2 or more arguments, or an array
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
): BasicExpression<boolean>
export function or(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean>
export function or(args: Array<ExpressionLike>): BasicExpression<boolean>
export function or(
  leftOrArgs: ExpressionLike | Array<ExpressionLike>,
  right?: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean> {
  // Handle array overload
  if (Array.isArray(leftOrArgs) && right === undefined) {
    return new Func(
      `or`,
      leftOrArgs.map((arg) => toExpression(arg)),
      orFactory,
    )
  }
  // Handle variadic overload
  const allArgs = [leftOrArgs, right!, ...rest]
  return new Func(
    `or`,
    allArgs.map((arg) => toExpression(arg)),
    orFactory,
  )
}
