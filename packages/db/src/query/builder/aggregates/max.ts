import { groupByOperators } from "@tanstack/db-ivm"
import { Aggregate } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import { registerAggregate } from "../../compiler/aggregate-registry.js"
import type { AggregateReturnType, ExpressionLike } from "../operators/types.js"

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function max<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(`max`, [toExpression(arg)]) as AggregateReturnType<T>
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerAggregate(`max`, {
  factory: groupByOperators.max,
  valueTransform: `numericOrDate`,
})
