import type { QueryIR } from "../ir.js"
import type {
  Context,
  SelectClause,
} from "./types.js"
import type {
  RefsForContext,
  SelectObject,
  ResultTypeFromSelect,
} from "../builder/types.js"
import { createRefProxy, toExpression } from "../builder/ref-proxy.js"
import { registry } from "./core.js"
import {
  Aggregate as AggregateExpr,
  Func as FuncExpr,
  PropRef,
  Value as ValueExpr,
  isExpressionLike,
} from "../ir.js"
import type { Aggregate, BasicExpression } from "../ir.js"

/**
 * select - Creates a SELECT clause
 *
 * Projects specific columns or computed values from the query.
 * The callback receives table references based on the FROM clause (and any joins).
 *
 * Type inference: The refs parameter is typed based on the context, and the
 * return type of the callback determines the result type of the query.
 *
 * @param callback - A function that receives table references and returns an object with selected fields
 * @returns A SelectClause that can be passed to query()
 *
 * @example
 * ```ts
 * // Select specific columns
 * const q = query(
 *   from({ users: usersCollection }),
 *   select(({ users }) => ({
 *     name: users.name,
 *     email: users.email
 *   }))
 * )
 *
 * // Select with computed values
 * const q = query(
 *   from({ users: usersCollection }),
 *   select(({ users }) => ({
 *     fullName: concat(users.firstName, ' ', users.lastName),
 *     ageInMonths: mul(users.age, 12)
 *   }))
 * )
 * ```
 */
export function select<TContext extends Context, TSelectObject extends SelectObject>(
  callback: (refs: RefsForContext<TContext>) => TSelectObject
): SelectClause<TContext, ResultTypeFromSelect<TSelectObject>> {
  return {
    clauseType: "select",
    callback,
    _context: undefined as any, // Type-level only
  }
}

/**
 * Compiler for SELECT clauses
 *
 * Converts a SELECT clause to IR by:
 * 1. Creating ref proxies for all available tables
 * 2. Calling the callback to get the select object
 * 3. Building the nested select IR structure
 */
function compileSelect(
  clause: SelectClause<any, any>,
  ir: Partial<QueryIR>,
  context: any
): Partial<QueryIR> {
  // Get the list of available table aliases
  const aliases = getAliasesFromIR(ir)

  // Create ref proxy for the callback
  const refProxy = createRefProxy(aliases)

  // Call the callback to get the select object
  const selectObject = clause.callback(refProxy as any)

  // Build the nested select IR
  const select = buildNestedSelect(selectObject)

  return {
    ...ir,
    select,
    fnSelect: undefined, // Remove fnSelect if it exists
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

/**
 * Helper to build nested select IR from a select object
 * (Copied from builder implementation)
 */
function buildNestedSelect(obj: any): any {
  if (!isPlainObject(obj)) return toExpr(obj)
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k === `string` && k.startsWith(`__SPREAD_SENTINEL__`)) {
      // Preserve sentinel key and its value
      out[k] = v
      continue
    }
    out[k] = buildNestedSelect(v)
  }
  return out
}

/**
 * Helper to ensure we have a BasicExpression/Aggregate for a value
 * (Copied from builder implementation)
 */
function toExpr(value: any): BasicExpression | Aggregate {
  if (value === undefined) return toExpression(null)
  if (
    value instanceof AggregateExpr ||
    value instanceof FuncExpr ||
    value instanceof PropRef ||
    value instanceof ValueExpr
  ) {
    return value as BasicExpression | Aggregate
  }
  return toExpression(value)
}

/**
 * Helper to check if a value is a plain object
 * (Copied from builder implementation)
 */
function isPlainObject(value: any): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === `object` &&
    !isExpressionLike(value) &&
    !value.__refProxy
  )
}

// Auto-register the SELECT compiler when this module is imported
registry.register("select", compileSelect as any)
