/**
 * GroupBy and Having Clause Functions
 *
 * Tree-shakable: if you don't import groupBy() or having(), this code isn't bundled.
 *
 * @example
 * ```ts
 * import { query, groupBy, having } from '@tanstack/db/query/functional'
 * import { eq, count } from '@tanstack/db'
 *
 * const q = query(
 *   { orders: ordersCollection },
 *   ({ orders }) => ({
 *     groupBy: groupBy(orders.customerId),
 *     having: having(gt(count(orders.id), 5)),
 *     select: {
 *       customerId: orders.customerId,
 *       orderCount: count(orders.id)
 *     }
 *   })
 * )
 * ```
 */

import type { BasicExpression } from "../ir.js"
import type {
  GroupByClauseResult,
  HavingClauseResult,
  ProcessorContext,
} from "./types.js"

/**
 * groupBy - Creates a tree-shakable GROUP BY clause
 *
 * @param expressions - One or more expressions to group by
 * @returns GroupByClauseResult with embedded processing logic
 */
export function groupBy(
  ...expressions: BasicExpression<any>[]
): GroupByClauseResult {
  return {
    __clause: "groupBy",
    expressions,
    process(ir, _context: ProcessorContext) {
      const existingGroupBy = (ir as any).groupBy || []
      return {
        ...ir,
        groupBy: [...existingGroupBy, ...expressions],
      }
    },
  }
}

/**
 * having - Creates a tree-shakable HAVING clause
 *
 * @param condition - Boolean expression for the HAVING clause
 * @returns HavingClauseResult with embedded processing logic
 */
export function having(condition: BasicExpression<boolean>): HavingClauseResult {
  return {
    __clause: "having",
    condition,
    process(ir, _context: ProcessorContext) {
      const existingHaving = (ir as any).having || []
      return {
        ...ir,
        having: [...existingHaving, condition],
      }
    },
  }
}
