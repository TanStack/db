/**
 * Working example of the tree-shakable functional query API
 *
 * This file demonstrates the key features and can be run to verify functionality.
 */

import { query, from, where, select, compileQuery } from "./index.js"
import { CollectionImpl } from "../../collection/index.js"
import { Func, Value, type BasicExpression } from "../ir.js"

// Mock collection type for demonstration
type User = {
  id: number
  name: string
  email: string
  active: boolean
  age: number
}

// Mock collection (in real usage, this would be a real collection)
declare const usersCollection: CollectionImpl<User, any, any, any, any>

// Helper function to create equality expressions
function eq(left: BasicExpression, right: any): Func<boolean> {
  const rightExpr =
    right instanceof Value || right instanceof Func
      ? right
      : new Value(right)
  return new Func("eq", [left, rightExpr])
}

// Example 1: Simple query (only FROM)
// Bundle size: core.ts + from.ts only
const allUsers = query(from({ users: usersCollection }))

console.log("Query 1 - All users:", allUsers.clauses.map((c) => c.clauseType))

// Example 2: Filtered query (FROM + WHERE)
// Bundle size: core.ts + from.ts + where.ts
const activeUsers = query(
  from({ users: usersCollection }),
  where(({ users }) => eq((users as any).active, true))
)

console.log(
  "Query 2 - Active users:",
  activeUsers.clauses.map((c) => c.clauseType)
)

// Example 3: Projected query (FROM + WHERE + SELECT)
// Bundle size: core.ts + from.ts + where.ts + select.ts
const userNames = query(
  from({ users: usersCollection }),
  where(({ users }) => eq((users as any).active, true)),
  select(({ users }) => ({
    name: (users as any).name,
    email: (users as any).email,
  }))
)

console.log("Query 3 - User names:", userNames.clauses.map((c) => c.clauseType))

// Example 4: Compile to IR
const ir = compileQuery(userNames)

console.log("\nCompiled IR structure:")
console.log("- Has FROM:", !!ir.from)
console.log("- Has WHERE:", !!ir.where && ir.where.length > 0)
console.log("- Has SELECT:", !!ir.select)

// Tree-shaking demonstration:
console.log("\n🌳 Tree-Shaking Benefits:")
console.log("If you only import 'from':")
console.log("  import { query, from } from '@tanstack/db/query/functional'")
console.log("  ✅ Bundled: core.ts, from.ts")
console.log("  ❌ NOT bundled: where.ts, select.ts, join.ts, groupBy.ts, etc.")
console.log("\nIf you import 'from' and 'where':")
console.log("  import { query, from, where } from '@tanstack/db/query/functional'")
console.log("  ✅ Bundled: core.ts, from.ts, where.ts")
console.log("  ❌ NOT bundled: select.ts, join.ts, groupBy.ts, etc.")
