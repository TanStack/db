import { Func } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import { transform } from './factories.js'
import type { EvaluatorFactory } from '../../ir.js'
import type { ExpressionLike, NumericFunctionReturnType } from './types.js'

const lengthFactory = /* #__PURE__*/ transform<unknown, number>((v) => {
  if (typeof v === `string`) return v.length
  if (Array.isArray(v)) return v.length
  return 0
}) as EvaluatorFactory

export function length<T extends ExpressionLike>(
  arg: T,
): NumericFunctionReturnType<T> {
  return new Func(
    `length`,
    [toExpression(arg)],
    lengthFactory,
  ) as NumericFunctionReturnType<T>
}
