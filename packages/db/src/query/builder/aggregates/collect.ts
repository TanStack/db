import { groupByOperators } from "@tanstack/db-ivm"
import { Aggregate } from "../../ir.js"
import { toExpression } from "../ref-proxy.js"
import type { ExpressionLike, ExtractType } from "../operators/types.js"

// ============================================================
// CONFIG
// ============================================================

const collectConfig = {
  factory: groupByOperators.collect,
  valueTransform: `raw` as const,
}

// ============================================================
// BUILDER FUNCTION
// ============================================================

/**
 * Collects all values in a group into an array.
 * Similar to SQL's array_agg or GROUP_CONCAT.
 *
 * @example
 * ```typescript
 * // Collect all posts for each user
 * query
 *   .from({ posts: postsCollection })
 *   .groupBy(({ posts }) => posts.userId)
 *   .select(({ posts }) => ({
 *     userId: posts.userId,
 *     allPosts: collect(posts),
 *   }))
 * ```
 */
export function collect<T extends ExpressionLike>(
  arg: T
): Aggregate<Array<ExtractType<T>>> {
  return new Aggregate(`collect`, [toExpression(arg)], collectConfig)
}
