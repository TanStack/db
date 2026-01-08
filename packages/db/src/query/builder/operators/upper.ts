import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { transform } from './factories.js'
import type { EvaluatorFactory } from '../../ir.js'
import type { ExpressionLike, StringFunctionReturnType } from './types.js'

const upperFactory = /* #__PURE__*/ transform<unknown, unknown>((v) =>
  typeof v === `string` ? v.toUpperCase() : v,
) as EvaluatorFactory

export function upper<T extends ExpressionLike>(
  arg: T,
): StringFunctionReturnType<T> {
  return new Func(
    `upper`,
    [toExpression(arg)],
    upperFactory,
  ) as StringFunctionReturnType<T>
}
