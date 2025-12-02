import type { BasicExpression, QueryIR } from "../ir.js"
import type { Context, WhereClause } from "./types.js"
import type { RefsForContext } from "../builder/types.js"
import { createRefProxy } from "../builder/ref-proxy.js"
import { registry } from "./core.js"

/**
 * where - Creates a WHERE clause
 *
 * Filters rows based on a condition. The callback receives table references
 * based on the FROM clause (and any joins).
 *
 * Type inference: The refs parameter is typed based on the context from
 * previous clauses, so you get autocomplete for table names and columns.
 *
 * @param callback - A function that receives table references and returns a boolean expression
 * @returns A WhereClause that can be passed to query()
 *
 * @example
 * ```ts
 * // Simple condition
 * const q = query(
 *   from({ users: usersCollection }),
 *   where(({ users }) => eq(users.active, true))
 * )
 *
 * // Multiple conditions with and()
 * const q = query(
 *   from({ users: usersCollection }),
 *   where(({ users }) => and(
 *     gt(users.age, 18),
 *     eq(users.active, true)
 *   ))
 * )
 * ```
 */
export function where<TContext extends Context>(
  callback: (refs: RefsForContext<TContext>) => BasicExpression<boolean>
): WhereClause<TContext> {
  return {
    clauseType: "where",
    callback: callback as any,
    _context: undefined as any, // Type-level only
  }
}

/**
 * Compiler for WHERE clauses
 *
 * Converts a WHERE clause to IR by:
 * 1. Creating ref proxies for all available tables
 * 2. Calling the callback to get the expression
 * 3. Adding the expression to the IR
 */
function compileWhere(
  clause: WhereClause<any>,
  ir: Partial<QueryIR>,
  context: any
): Partial<QueryIR> {
  // Get the list of available table aliases from the FROM clause and joins
  const aliases = getAliasesFromIR(ir)

  // Create ref proxy for the callback
  const refProxy = createRefProxy(aliases)

  // Call the callback to get the expression
  const expression = clause.callback(refProxy as any)

  // Add to the where array
  const existingWhere = ir.where || []

  return {
    ...ir,
    where: [...existingWhere, expression],
  }
}

/**
 * Helper to extract table aliases from partial IR
 */
function getAliasesFromIR(ir: Partial<QueryIR>): Array<string> {
  const aliases: Array<string> = []

  // Add the from alias
  if (ir.from) {
    aliases.push(ir.from.alias)
  }

  // Add join aliases
  if (ir.join) {
    for (const join of ir.join) {
      aliases.push(join.from.alias)
    }
  }

  return aliases
}

// Auto-register the WHERE compiler when this module is imported
registry.register("where", compileWhere as any)
