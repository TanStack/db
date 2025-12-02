/**
 * Join Shape Processor
 *
 * This file is tree-shakable: if you don't use joins in your query shape,
 * this code won't be bundled.
 *
 * To use joins, import this file:
 * ```ts
 * import '@tanstack/db/query/functional/join'
 * ```
 *
 * Or it will be auto-imported when you use `join` in your shape.
 */

import { shapeRegistry } from "./core.js"
import type { CollectionImpl } from "../../collection/index.js"
import { CollectionRef as CollectionRefClass } from "../ir.js"
import type { JoinClause } from "../ir.js"
import type { JoinShape, ProcessorContext } from "./types.js"

/**
 * Process join shape into IR JoinClauses
 */
function processJoin(
  _key: string,
  value: JoinShape,
  ir: any,
  _context: ProcessorContext
) {
  const joinClauses: JoinClause[] = []

  for (const [alias, joinDef] of Object.entries(value)) {
    const { collection, on, type = "left" } = joinDef

    if (!collection || typeof collection !== "object") {
      throw new Error(`Invalid join source: ${alias} is not a Collection`)
    }

    const fromRef = new CollectionRefClass(collection as CollectionImpl, alias)

    // Extract left/right from the ON expression
    // For now, assume it's an eq() expression with two args
    let left = on
    let right = on
    if (on && "args" in on && Array.isArray((on as any).args)) {
      const args = (on as any).args
      left = args[0]
      right = args[1]
    }

    joinClauses.push({
      from: fromRef,
      type,
      left,
      right,
    })
  }

  const existingJoins = ir.join || []
  return {
    ...ir,
    join: [...existingJoins, ...joinClauses],
  }
}

// Register the join processor
shapeRegistry.register("join", processJoin)

// Export for explicit import
export { processJoin }
