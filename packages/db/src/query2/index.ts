// Main exports for the new query builder system

// Query builder exports
export {
  BaseQueryBuilder,
  buildQuery,
  type InitialQueryBuilder,
  type QueryBuilder,
  type Context,
  type Source,
  type GetResult,
} from "./query-builder/index.js"

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
  isIn as in,
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
} from "./query-builder/functions.js"

// Ref proxy utilities
export { val, toExpression, isRefProxy } from "./query-builder/ref-proxy.js"

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
