import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { booleanOp } from './factories.js'
import type { BasicExpression } from '../../ir.js'
import type { ExpressionLike } from './types.js'

// AND: short-circuits on false, returns true if all are true
const andFactory = /* #__PURE__*/ booleanOp({
  shortCircuit: false,
  default: true,
})

// Overloads for and() - support 2 or more arguments, or an array
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
): BasicExpression<boolean>
export function and(
  left: ExpressionLike,
  right: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean>
export function and(args: Array<ExpressionLike>): BasicExpression<boolean>
export function and(
  leftOrArgs: ExpressionLike | Array<ExpressionLike>,
  right?: ExpressionLike,
  ...rest: Array<ExpressionLike>
): BasicExpression<boolean> {
  // Handle array overload
  if (Array.isArray(leftOrArgs) && right === undefined) {
    return new Func(
      `and`,
      leftOrArgs.map((arg) => toExpression(arg)),
      andFactory,
    )
  }
  // Handle variadic overload
  const allArgs = [leftOrArgs, right!, ...rest]
  return new Func(
    `and`,
    allArgs.map((arg) => toExpression(arg)),
    andFactory,
  )
}
