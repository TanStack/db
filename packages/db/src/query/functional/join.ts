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
 * // All sources go in first argument - this gives you typed refs
 * const q = query(
 *   { users: usersCollection, posts: postsCollection },
 *   ({ users, posts }) => ({
 *     join: join({
 *       posts: { on: eq(posts.authorId, users.id), type: 'left' }
 *     }),
 *     where: eq(users.active, true),
 *     select: { name: users.name, title: posts.title }
 *   })
 * )
 * ```
 *
 * **Limitation:** Currently only supports simple equi-join conditions like
 * `eq(a.field, b.field)`. Complex conditions like `and(eq(...), eq(...))`
 * are not supported - the IR would need to be extended for arbitrary join
 * conditions.
 */

import type { CollectionImpl } from "../../collection/index.js"
import { CollectionRef as CollectionRefClass } from "../ir.js"
import type { BasicExpression, JoinClause } from "../ir.js"
import type { JoinShape, JoinClauseResult, ProcessorContext } from "./types.js"

/**
 * Check if an expression is a binary comparison (eq, neq, lt, gt, etc.)
 * These have an 'args' array with exactly 2 elements.
 */
function isBinaryExpression(
  expr: BasicExpression<boolean>
): expr is BasicExpression<boolean> & { args: [unknown, unknown] } {
  return (
    expr &&
    typeof expr === "object" &&
    "args" in expr &&
    Array.isArray((expr as any).args) &&
    (expr as any).args.length === 2
  )
}

/**
 * join - Creates a tree-shakable JOIN clause
 *
 * The alias in the shape must match a source in the query's sources object.
 * The collection is looked up from sources automatically.
 *
 * @param shape - Object mapping alias to join definition (on, type)
 * @returns JoinClauseResult with embedded processing logic
 */
export function join(shape: JoinShape): JoinClauseResult {
  return {
    __clause: "join",
    shape,
    process(ir, context: ProcessorContext) {
      const joinClauses: JoinClause[] = []

      for (const [alias, joinDef] of Object.entries(shape)) {
        const { on, type = "left" } = joinDef

        // Look up the collection from sources by alias
        const collection = context.sources[alias]
        if (!collection || typeof collection !== "object") {
          throw new Error(
            `Invalid join: "${alias}" not found in sources. ` +
              `Available sources: ${context.aliases.join(", ")}`
          )
        }

        const fromRef = new CollectionRefClass(
          collection as CollectionImpl,
          alias
        )

        // Extract left/right from the ON expression
        // The IR expects separate left/right expressions for equi-joins
        if (!isBinaryExpression(on)) {
          throw new Error(
            `Invalid join condition for "${alias}": only binary expressions ` +
              `like eq(left, right) are supported. Complex conditions like ` +
              `and(...) or or(...) require IR changes.`
          )
        }

        const [left, right] = on.args

        joinClauses.push({
          from: fromRef,
          type,
          left: left as BasicExpression,
          right: right as BasicExpression,
        })
      }

      const existingJoins = ir.join ?? []
      return {
        ...ir,
        join: [...existingJoins, ...joinClauses],
      }
    },
  }
}
