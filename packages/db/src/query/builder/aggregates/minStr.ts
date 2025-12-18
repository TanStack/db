import { groupByOperators } from "@tanstack/db-ivm"
import { Aggregate } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import type { ExpressionLike } from "../operators/types.js"

// ============================================================
// CONFIG
// ============================================================

const minStrConfig = {
  factory: groupByOperators.min,
  valueTransform: `raw` as const, // Preserves string values, no numeric coercion
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

/**
 * String-typed min aggregate for lexicographic comparison.
 *
 * Unlike `min()` which coerces values to numbers, `minStr()` preserves
 * string values for proper lexicographic comparison. This is essential
 * for ISO 8601 date strings which sort correctly as strings.
 *
 * @example
 * ```typescript
 * // Get the earliest timestamp for each group
 * query
 *   .from({ events: eventsCollection })
 *   .groupBy(({ events }) => events.userId)
 *   .select(({ events }) => ({
 *     userId: events.userId,
 *     firstEvent: minStr(events.createdAt),
 *   }))
 * ```
 */
export function minStr<T extends ExpressionLike>(
  arg: T
): Aggregate<string | null | undefined> {
  return new Aggregate(`minStr`, [toExpression(arg)], minStrConfig)
}
