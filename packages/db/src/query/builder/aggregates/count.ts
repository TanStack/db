import { groupByOperators } from '@tanstack/db-ivm'
import { Aggregate } from '../../ir.js'
import { toExpression } from '../ref-proxy.js'
import type { ExpressionLike } from '../operators/types.js'

// ============================================================
// CONFIG
// ============================================================

const countConfig = {
  factory: groupByOperators.count,
  valueTransform: `raw` as const,
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function count(arg: ExpressionLike): Aggregate<number> {
  return new Aggregate(`count`, [toExpression(arg)], countConfig)
}
