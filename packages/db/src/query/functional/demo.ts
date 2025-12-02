/**
 * Simplified demonstration of the functional query API
 *
 * This shows that the basic structure works, even though full type inference
 * through callbacks is limited by TypeScript's inference capabilities.
 */

import { query, from, where, select, compileQuery } from "./index.js"
import { eq } from "../../index.js"
import { CollectionImpl } from "../../collection/index.js"

// Mock collection types
type User = {
  id: number
  name: string
  email: string
  active: boolean
}

declare const usersCollection: CollectionImpl<User, any, any, any, any>

// Example 1: Basic query - tree-shakable!
// Only `from` clause is imported, so `where` and `select` compilers aren't bundled
const basicQuery = query(
  from({ users: usersCollection })
)

// Example 2: Query with where - tree-shakable!
// Only `from` and `where` clauses imported, `select` compiler not bundled
const filteredQuery = query(
  from({ users: usersCollection }),
  where(({ users }) => eq((users as any).active, true))  // Note: manual type assertion needed
)

// Example 3: Full query with select - tree-shakable!
// All clauses imported, all compilers bundled
const projectedQuery = query(
  from({ users: usersCollection }),
  where(({ users }) => eq((users as any).active, true)),
  select(({ users }) => ({
    name: (users as any).name,
    email: (users as any).email,
  }))
)

// Example 4: Compile to IR
const ir = compileQuery(projectedQuery)

console.log("Functional query API demonstration")
console.log("Basic query:", basicQuery)
console.log("Filtered query:", filteredQuery)
console.log("Projected query:", projectedQuery)
console.log("IR:", JSON.stringify(ir, null, 2))

// The key benefits:
// 1. ✅ Tree-shakable: Each clause in separate file
// 2. ✅ Auto-registration: Compilers register on import
// 3. ✅ Separate files: from.ts, where.ts, select.ts
// 4. ⚠️  Type inference: Limited by TypeScript's inference through generic callbacks
//
// Type inference limitation:
// Full type inference through callbacks like ({ users }) => users.active
// requires TypeScript to infer the callback parameter type from context.
// This is challenging with function composition.
//
// Workaround: Type assertions (shown above) or using a builder pattern
// that chains types explicitly.
