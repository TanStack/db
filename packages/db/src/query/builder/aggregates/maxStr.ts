import { groupByOperators } from "@tanstack/db-ivm"
import { Aggregate } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import type { ExpressionLike } from "../operators/types.js"

// ============================================================
// CONFIG
// ============================================================

const maxStrConfig = {
  factory: groupByOperators.max,
  valueTransform: `raw` as const, // Preserves string values, no numeric coercion
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

/**
 * String-typed max aggregate for lexicographic comparison.
 *
 * Unlike `max()` which coerces values to numbers, `maxStr()` preserves
 * string values for proper lexicographic comparison. This is essential
 * for ISO 8601 date strings which sort correctly as strings.
 *
 * @example
 * ```typescript
 * // Get the latest timestamp for each group
 * query
 *   .from({ events: eventsCollection })
 *   .groupBy(({ events }) => events.userId)
 *   .select(({ events }) => ({
 *     userId: events.userId,
 *     lastEvent: maxStr(events.createdAt),
 *   }))
 * ```
 */
export function maxStr<T extends ExpressionLike>(
  arg: T
): Aggregate<string | null | undefined> {
  return new Aggregate(`maxStr`, [toExpression(arg)], maxStrConfig)
}
