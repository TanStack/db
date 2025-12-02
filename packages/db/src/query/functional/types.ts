import type { BasicExpression, QueryIR } from "../ir.js"
import type { Collection } from "../../collection/index.js"

/**
 * EdgeDB-style Functional Query API Types
 *
 * The key insight from EdgeDB: first argument establishes type context,
 * callback receives typed refs. This enables full type inference.
 */

// =============================================================================
// Source Types
// =============================================================================

/**
 * Sources - Map of alias to collection
 */
export type Sources = Record<string, Collection<any, any, any, any, any>>

/**
 * InferSchema - Extracts the schema type from a Sources object
 */
export type InferSchema<T extends Sources> = {
  [K in keyof T]: T[K] extends Collection<infer TData, any, any, any, any>
    ? TData
    : never
}

/**
 * RefProxy - Proxy object for accessing properties in expressions
 * This is what the callback receives for each source
 */
export type RefProxy<T> = {
  [K in keyof T]: T[K] extends object
    ? RefProxy<T[K]> & BasicExpression<T[K]>
    : BasicExpression<T[K]>
} & {
  __refProxy: true
  __path: string[]
}

/**
 * RefsFor - Creates RefProxy for each source in Sources
 */
export type RefsFor<T extends Sources> = {
  [K in keyof T]: T[K] extends Collection<infer TData, any, any, any, any>
    ? RefProxy<TData>
    : never
}

// =============================================================================
// Clause Function Types (for tree-shaking)
// =============================================================================

/**
 * ProcessorContext - Context passed to clause processors
 */
export interface ProcessorContext {
  sources: Sources
  aliases: string[]
}

/**
 * ClauseResult - Return type of clause functions like join(), groupBy()
 *
 * Clause functions return objects with embedded processing logic.
 * This enables tree-shaking: if you don't import join(), its code isn't bundled.
 */
export interface ClauseResult<TClause extends string = string> {
  readonly __clause: TClause
  readonly process: (
    ir: Partial<QueryIR>,
    context: ProcessorContext
  ) => Partial<QueryIR>
}

/**
 * Type guard to check if a value is a ClauseResult
 */
export function isClauseResult(value: unknown): value is ClauseResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "__clause" in value &&
    "process" in value &&
    typeof (value as ClauseResult).process === "function"
  )
}

// =============================================================================
// Shape Types (the callback's return type)
// =============================================================================

/**
 * OrderByShape - Shape for orderBy clause
 */
export type OrderByShape =
  | BasicExpression<any>
  | {
      expr: BasicExpression<any>
      direction?: "asc" | "desc"
      nulls?: "first" | "last"
    }

/**
 * JoinShape - Shape for join clauses (input to join() function)
 */
export interface JoinShape {
  [alias: string]: {
    collection: Collection<any, any, any, any, any>
    on: BasicExpression<boolean>
    type?: "inner" | "left" | "right" | "full"
  }
}

/**
 * JoinClauseResult - Return type of join() function
 */
export interface JoinClauseResult extends ClauseResult<"join"> {
  readonly shape: JoinShape
}

/**
 * GroupByClauseResult - Return type of groupBy() function
 */
export interface GroupByClauseResult extends ClauseResult<"groupBy"> {
  readonly expressions: BasicExpression<any>[]
}

/**
 * HavingClauseResult - Return type of having() function
 */
export interface HavingClauseResult extends ClauseResult<"having"> {
  readonly condition: BasicExpression<boolean>
}

/**
 * QueryShape - The object returned by the shape callback
 *
 * This is the "flat API" - all clauses in one object:
 * - where: WHERE clause (filter condition)
 * - select: SELECT clause (what to return)
 * - orderBy: ORDER BY clause
 * - limit: LIMIT clause
 * - offset: OFFSET clause
 * - distinct: DISTINCT flag
 * - join: JOIN clauses (tree-shakable)
 * - groupBy: GROUP BY clause (tree-shakable)
 * - having: HAVING clause (tree-shakable)
 *
 * Tree-shakable clauses use clause functions:
 * ```ts
 * import { query, join, groupBy } from '@tanstack/db/query/functional'
 *
 * query({ users }, ({ users }) => ({
 *   join: join({ posts: { collection: postsCollection, on: eq(...) } }),
 *   groupBy: groupBy(users.department),
 *   select: { name: users.name }
 * }))
 * ```
 */
export interface QueryShape<TSelect = any> {
  where?: BasicExpression<boolean>
  select?: TSelect
  orderBy?: OrderByShape | OrderByShape[]
  limit?: number
  offset?: number
  distinct?: boolean
  // Tree-shakable clauses - use clause functions:
  join?: JoinClauseResult
  groupBy?: GroupByClauseResult
  having?: HavingClauseResult
}

// =============================================================================
// Query Result Types
// =============================================================================

/**
 * Query - Represents a compiled query with its result type
 */
export interface Query<TResult> {
  readonly _sources: Sources
  readonly _shape: QueryShape<any>
  readonly _result: TResult // Phantom type for result inference
}

/**
 * InferResult - Infers the result type from a QueryShape
 */
export type InferResult<
  TSources extends Sources,
  TShape extends QueryShape<any>
> = TShape["select"] extends undefined
  ? InferSchema<TSources>[keyof TSources] // No select = return full row
  : TShape["select"] extends infer S
    ? S
    : never

// =============================================================================
// Shape Processor Registry (for core clauses)
// =============================================================================

/**
 * ShapeProcessor - Function that processes a shape key into IR
 */
export type ShapeProcessor = (
  key: string,
  value: any,
  ir: Partial<QueryIR>,
  context: ProcessorContext
) => Partial<QueryIR>

/**
 * ShapeRegistry - Registry of shape processors
 */
export interface ShapeRegistry {
  register(key: string, processor: ShapeProcessor): void
  process(
    shape: QueryShape,
    ir: Partial<QueryIR>,
    context: ProcessorContext
  ): QueryIR
}
