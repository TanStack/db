// Main exports for the new query builder system

// Query builder exports
export {
  BaseQueryBuilder,
  Query,
  type InitialQueryBuilder,
  type QueryBuilder,
  type Context,
  type ContextSchema,
  type Source,
  type GetResult,
  type InferResultType,
  type ExtractContext,
  type QueryResult,
  // Types needed for declaration emit (https://github.com/TanStack/db/issues/1012)
  type ContextFromSource,
  type ContextFromUnionBranches,
  type ContextFromUnionSource,
  type SchemaFromSource,
  type SingleSource,
  type InferCollectionType,
  type MergeContextWithJoinType,
  type MergeContextForJoinCallback,
  type ApplyJoinOptionalityToMergedSchema,
  type ResultTypeFromSelect,
  type WithResult,
  type JoinOnCallback,
  type RefsForContext,
  type WhereCallback,
  type OrderByCallback,
  type GroupByCallback,
  type SelectObject,
  type FunctionalHavingRow,
  type Prettify,
} from './builder/index.js'

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
  inArray,
  like,
  ilike,
  isUndefined,
  isNull,
  // Functions
  upper,
  lower,
  length,
  concat,
  coalesce,
  caseWhen,
  add,
  subtract,
  multiply,
  divide,
  // Aggregates
  count,
  avg,
  sum,
  min,
  max,
  // Includes helpers
  toArray,
  materialize,
} from './builder/functions.js'

// Ref proxy utilities
export type { Ref } from './builder/types.js'
export { toExpression } from './builder/ref-proxy.js'
export type { ExpressionLike } from './builder/functions.js'

// Custom aggregate functions
export type { Aggregate } from './ir.js'
export {
  registerAggregate,
  unregisterAggregate,
  getRegisteredAggregates,
  createAggregate,
  BUILTIN_AGGREGATE_NAMES,
} from './aggregates.js'
export type {
  AggregateContext,
  AggregateEntry,
  CustomAggregateImpl,
  CustomAggregateFactory,
} from './aggregates.js'

// Compiler
export { compileQuery } from './compiler/index.js'
export {
  compileExpression,
  compileSingleRowExpression,
  toBooleanPredicate,
} from './compiler/evaluators.js'

// Live query collection utilities
export {
  createLiveQueryCollection,
  liveQueryCollectionOptions,
} from './live-query-collection.js'

// One-shot query execution
export { queryOnce, type QueryOnceConfig } from './query-once.js'

export { type LiveQueryCollectionConfig } from './live/types.js'
export { type LiveQueryCollectionUtils } from './live/collection-config-builder.js'

// Predicate utilities for predicate push-down
export {
  isWhereSubset,
  unionWherePredicates,
  minusWherePredicates,
  isOrderBySubset,
  isLimitSubset,
  isOffsetLimitSubset,
  isPredicateSubset,
} from './predicate-utils.js'

export { DeduplicatedLoadSubset } from './subset-dedupe.js'
