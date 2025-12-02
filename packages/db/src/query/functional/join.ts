/**
 * Join Clause Function
 *
 * Tree-shakable: if you don't import join(), this code isn't bundled.
 *
 * @example
 * ```ts
 * import { query, join } from '@tanstack/db/query/functional'
 * import { eq } from '@tanstack/db'
 *
 * const q = query(
 *   { users: usersCollection },
 *   ({ users }) => ({
 *     join: join({
 *       posts: {
 *         collection: postsCollection,
 *         on: eq(posts.authorId, users.id),
 *         type: 'left'
 *       }
 *     }),
 *     where: eq(users.active, true),
 *     select: { name: users.name }
 *   })
 * )
 * ```
 */

import type { CollectionImpl } from "../../collection/index.js"
import { CollectionRef as CollectionRefClass } from "../ir.js"
import type { JoinClause } from "../ir.js"
import type {
  JoinShape,
  JoinClauseResult,
  ProcessorContext,
} from "./types.js"

/**
 * join - Creates a tree-shakable JOIN clause
 *
 * @param shape - Object mapping alias to join definition
 * @returns JoinClauseResult with embedded processing logic
 */
export function join(shape: JoinShape): JoinClauseResult {
  return {
    __clause: "join",
    shape,
    process(ir, _context: ProcessorContext) {
      const joinClauses: JoinClause[] = []

      for (const [alias, joinDef] of Object.entries(shape)) {
        const { collection, on, type = "left" } = joinDef

        if (!collection || typeof collection !== "object") {
          throw new Error(`Invalid join source: ${alias} is not a Collection`)
        }

        const fromRef = new CollectionRefClass(
          collection as CollectionImpl,
          alias
        )

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

      const existingJoins = (ir as any).join || []
      return {
        ...ir,
        join: [...existingJoins, ...joinClauses],
      }
    },
  }
}
