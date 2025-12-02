/**
 * GroupBy and Having Shape Processors
 *
 * This file is tree-shakable: if you don't use groupBy/having in your query shape,
 * this code won't be bundled.
 */

import { shapeRegistry } from "./core.js"
import type { BasicExpression } from "../ir.js"
import type { ProcessorContext } from "./types.js"

/**
 * Process groupBy shape into IR
 */
function processGroupBy(
  _key: string,
  value: BasicExpression<any> | BasicExpression<any>[],
  ir: any,
  _context: ProcessorContext
) {
  const groupByArray = Array.isArray(value) ? value : [value]

  const existingGroupBy = ir.groupBy || []
  return {
    ...ir,
    groupBy: [...existingGroupBy, ...groupByArray],
  }
}

/**
 * Process having shape into IR
 */
function processHaving(
  _key: string,
  value: BasicExpression<boolean>,
  ir: any,
  _context: ProcessorContext
) {
  const existingHaving = ir.having || []
  return {
    ...ir,
    having: [...existingHaving, value],
  }
}

// Register the processors
shapeRegistry.register("groupBy", processGroupBy)
shapeRegistry.register("having", processHaving)

// Export for explicit import
export { processGroupBy, processHaving }
