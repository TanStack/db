import { JoinConditionMustBeEqualityError } from '../errors.js'
import type { BasicExpression } from './ir.js'

/** A join key has one component for each equality in the conjunction. */
export function getJoinConditions(
  expression: BasicExpression,
): Array<readonly [BasicExpression, BasicExpression]> {
  if (expression.type === `func`) {
    if (expression.name === `eq` && expression.args.length === 2) {
      return [[expression.args[0]!, expression.args[1]!]]
    }
    if (expression.name === `and` && expression.args.length > 0) {
      return expression.args.flatMap(getJoinConditions)
    }
  }
  throw new JoinConditionMustBeEqualityError()
}
