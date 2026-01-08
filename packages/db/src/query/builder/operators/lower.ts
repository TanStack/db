import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { transform } from './factories.js'
import type { EvaluatorFactory } from '../../ir.js'
import type { ExpressionLike, StringFunctionReturnType } from './types.js'

const lowerFactory = /* #__PURE__*/ transform<unknown, unknown>((v) =>
  typeof v === `string` ? v.toLowerCase() : v,
) as EvaluatorFactory

export function lower<T extends ExpressionLike>(
  arg: T,
): StringFunctionReturnType<T> {
  return new Func(
    `lower`,
    [toExpression(arg)],
    lowerFactory,
  ) as StringFunctionReturnType<T>
}
