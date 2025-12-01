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

// ============================================================
// BUILDER FUNCTION
// ============================================================

export function count(arg: ExpressionLike): Aggregate<number> {
  return new Aggregate(`count`, [toExpression(arg)])
}

// ============================================================
// AUTO-REGISTRATION
// ============================================================

registerAggregate(`count`, {
  factory: groupByOperators.count,
  valueTransform: `raw`,
})
