import { groupByOperators } from '@tanstack/db-ivm'
import { Aggregate } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { AggregateReturnType, ExpressionLike } from '../operators/types.js'

// ============================================================
// CONFIG
// ============================================================

const minConfig = {
  factory: groupByOperators.min,
  valueTransform: `numericOrDate` as const,
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function min<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(
    `min`,
    [toExpression(arg)],
    minConfig,
  ) as AggregateReturnType<T>
}
