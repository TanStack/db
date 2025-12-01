import { groupByOperators } from "@tanstack/db-ivm"
import { Aggregate } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import { registerAggregate } from "../../compiler/aggregate-registry.js"
import type { BasicExpression } from "../../ir.js"

// ============================================================
// TYPES
// ============================================================

// Helper type for any expression-like value
type ExpressionLike = BasicExpression | any

// Helper type for aggregate return type
type AggregateReturnType<_T> = Aggregate<number | null>

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function min<T extends ExpressionLike>(arg: T): AggregateReturnType<T> {
  return new Aggregate(`min`, [toExpression(arg)]) as AggregateReturnType<T>
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerAggregate(`min`, {
  factory: groupByOperators.min,
  valueTransform: `numericOrDate`,
})
