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

// Pooled live queries for framework hooks
export {
  pooledLiveQueries,
  type PooledLiveQueries,
} from './pooled-live-query.js'

// Grouping without aggregates
export { groupKeys, type GroupKeys } from './builder/group-keys.js'
export type { OperatorCallback } from './builder/types.js'

// Operator code for query IR built by hand: `IR.Aggregate` takes the grouping
// compiler, and `IR.IncludesSubquery` the include runtime.
export {
  grouping as groupingCompiler,
  type Grouping,
} from './compiler/grouping.js'
export {
  includesRuntime,
  type IncludesRuntime,
} from './live/includes-runtime.js'

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
} from './builder/functions.js'
export { include, materialize, toArray } from './builder/include-functions.js'

// Ref proxy utilities
export type { Ref } from './builder/types.js'

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

export {
  type LiveQueryCollectionConfig,
  type LiveQueryHookConfig,
} from './live/types.js'
export { type LiveQueryCollectionUtils } from './live/collection-config-builder.js'
export {
  UnhashableQueryIRError,
  canonicalizeQueryIR,
  getLoadSubsetDemandKey,
  getQueryIdentity,
  getStableQueryBuilderHash,
  getStableQueryIRHash,
  getStableValueHash,
  type DemandKey,
  type QueryIdentity,
} from './ir-stable-identity.js'

export { DeduplicatedLoadSubset } from './subset-dedupe.js'
