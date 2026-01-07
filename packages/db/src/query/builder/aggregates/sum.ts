import { groupByOperators } from '@tanstack/db-ivm'
import { Aggregate } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { AggregateReturnType, ExpressionLike } from '../operators/types.js'

// ============================================================
// CONFIG
// ============================================================

const sumConfig = {
  factory: groupByOperators.sum,
  valueTransform: `numeric` as const,
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function sum<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(
    `sum`,
    [toExpression(arg)],
    sumConfig,
  ) as AggregateReturnType<T>
}
