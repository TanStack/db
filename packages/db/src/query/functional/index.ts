/**
 * Tree-shakable functional query API for TanStack DB
 *
 * This module provides a functional alternative to the method-chaining query builder.
 * Each clause is in a separate file, enabling tree-shaking: unused clauses aren't bundled.
 *
 * ## Auto-Registration Pattern
 *
 * Each clause file (from.ts, where.ts, select.ts) automatically registers its compiler
 * when imported. This enables the query() function to compile clauses to IR without
 * explicitly importing compilers.
 *
 * ## Type Inference
 *
 * Types flow through the functional composition:
 * - FROM establishes the base schema
 * - WHERE/SELECT see the schema from FROM
 * - SELECT establishes the result type
 *
 * ## Example
 *
 * ```ts
 * import { query, from, where, select } from '@tanstack/db/query/functional'
 * import { eq } from '@tanstack/db'
 *
 * const q = query(
 *   from({ users: usersCollection }),
 *   where(({ users }) => eq(users.active, true)),
 *   select(({ users }) => ({ name: users.name }))
 * )
 * ```
 *
 * ## Tree-Shaking
 *
 * If you only use `from` and `where`, the `select` clause and its compiler
 * won't be included in your bundle:
 *
 * ```ts
 * import { query, from, where } from '@tanstack/db/query/functional'
 * // select.ts is never imported, so it's not bundled
 * ```
 */

// Core query function and types
export { query, compileQuery, getQueryIR } from "./core.js"
export type { Query, Context, ClauseRegistry } from "./types.js"

// Clause functions - each import triggers auto-registration
export { from } from "./from.js"
export { where } from "./where.js"
export { select } from "./select.js"

// Type exports for advanced use cases
export type {
  FromClause,
  WhereClause,
  SelectClause,
  AnyClause,
  ExtractContext,
  GetResult,
} from "./types.js"
