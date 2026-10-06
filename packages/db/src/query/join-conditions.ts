import { JoinConditionMustBeEqualityError } from '../errors.js'
import type { BasicExpression } from './ir.js'

/** Validate join syntax and return its equality operands in source order. */
export function validateJoinConditions(
  expression: BasicExpression,
): Array<readonly [BasicExpression, BasicExpression]> {
  if (expression.type === `func`) {
    if (expression.name === `eq` && expression.args.length === 2) {
      return [[expression.args[0]!, expression.args[1]!]]
    }
    if (expression.name === `and` && expression.args.length > 0) {
      return expression.args.flatMap(validateJoinConditions)
    }
  }
  throw new JoinConditionMustBeEqualityError()
}
