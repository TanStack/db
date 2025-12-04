// Main exports for the new query builder system

// Query builder exports
export {
  BaseQueryBuilder,
  Query,
  type InitialQueryBuilder,
  type QueryBuilder,
  type Context,
  type Source,
  type GetResult,
  type InferResultType,
} from "./builder/index.js"

// Expression functions exports - now from operator modules for tree-shaking
export {
  // Comparison operators
  eq,
  gt,
  gte,
  lt,
  lte,
  // Boolean operators
  and,
  or,
  not,
  // Array/pattern operators
  inArray,
  like,
  ilike,
  // Null checking
  isUndefined,
  isNull,
  // String functions
  upper,
  lower,
  length,
  concat,
  coalesce,
  // Math functions
  add,
  subtract,
  multiply,
  divide,
} from "./builder/operators/index.js"

// Aggregates - now from aggregate modules for tree-shaking
export { count, avg, sum, min, max } from "./builder/aggregates/index.js"

// Types for custom operators and aggregates
// Custom operators: create a Func with your own factory as the 3rd argument
// Custom aggregates: create an Aggregate with your own config as the 3rd argument
export {
  Func,
  Aggregate,
  type EvaluatorFactory,
  type CompiledExpression,
  type AggregateConfig,
  type AggregateFactory,
  type ValueExtractor,
} from "./ir.js"

// Ref proxy utilities
export type { Ref } from "./builder/types.js"

// Compiler
export { compileQuery } from "./compiler/index.js"

// Live query collection utilities
export {
  createLiveQueryCollection,
  liveQueryCollectionOptions,
} from "./live-query-collection.js"

export { type LiveQueryCollectionConfig } from "./live/types.js"
export { type LiveQueryCollectionUtils } from "./live/collection-config-builder.js"

// Predicate utilities for predicate push-down
export {
  isWhereSubset,
  unionWherePredicates,
  minusWherePredicates,
  isOrderBySubset,
  isLimitSubset,
  isPredicateSubset,
} from "./predicate-utils.js"

export { DeduplicatedLoadSubset } from "./subset-dedupe.js"
