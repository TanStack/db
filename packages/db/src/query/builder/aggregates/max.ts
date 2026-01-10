import { groupByOperators } from '@tanstack/db-ivm'
import { Aggregate } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { AggregateReturnType, ExpressionLike } from '../operators/types.js'

// ============================================================
// CONFIG
// ============================================================

const maxConfig = {
  factory: groupByOperators.max,
  valueTransform: `numericOrDate` as const,
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function max<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(
    `max`,
    [toExpression(arg)],
    maxConfig,
  ) as AggregateReturnType<T>
}
