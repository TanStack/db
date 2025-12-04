import { groupByOperators } from "@tanstack/db-ivm"
import { Aggregate } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import type { AggregateReturnType, ExpressionLike } from "../operators/types.js"

// ============================================================
// CONFIG
// ============================================================

const avgConfig = {
  factory: groupByOperators.avg,
  valueTransform: `numeric` as const,
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function avg<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(
    `avg`,
    [toExpression(arg)],
    avgConfig
  ) as AggregateReturnType<T>
}
