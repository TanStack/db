// Main exports for the query builder system

// Query builder exports
export {
  defineQuery,
  BaseQueryBuilder,
  type InitialQueryBuilder,
  type QueryBuilder,
  type Context,
  type Source,
  type GetResult,
} from "./builder/index.js"

// Expression functions exports
export {
  // Operators
  eq,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  isIn,
  like,
  ilike,
  // Functions
  upper,
  lower,
  length,
  concat,
  coalesce,
  add,
  // Aggregates
  count,
  avg,
  sum,
  min,
  max,
} from "./builder/functions.js"

// IR types (for advanced usage)
export type {
  Query,
  Expression,
  Agg,
  CollectionRef,
  QueryRef,
  JoinClause,
} from "./ir.js"

// Compiler
export { compileQuery } from "./compiler/index.js"

// Live query collection utilities
export {
  createLiveQueryCollection,
  liveQueryCollectionOptions,
  type LiveQueryCollectionConfig,
} from "./live-query-collection.js"
