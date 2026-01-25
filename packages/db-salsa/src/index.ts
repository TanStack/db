/**
 * @tanstack/db-salsa
 *
 * Salsa-style incremental computation for TanStack DB.
 *
 * This package provides fine-grained dependency tracking and memoization,
 * inspired by the Salsa framework used in rust-analyzer. Key features:
 *
 * - **Automatic dependency discovery**: Dependencies are tracked at runtime
 *   during query execution, not declared statically.
 *
 * - **Revision-based invalidation**: Each mutation increments a global revision.
 *   Queries can quickly check if their cached result is still valid.
 *
 * - **Selective recomputation**: When inputs change, only truly affected
 *   queries are recomputed.
 *
 * - **Debug observability**: "Why did this query re-run?" is always answerable.
 *
 * @example
 * ```ts
 * import { Database } from '@tanstack/db-salsa'
 *
 * const db = new Database()
 *
 * // Create tracked inputs
 * const firstName = db.input('firstName', 'John')
 * const lastName = db.input('lastName', 'Doe')
 *
 * // Create memoized queries
 * const fullName = db.query('fullName', () => {
 *   return `${firstName.get()} ${lastName.get()}`
 * })
 *
 * const greeting = db.query('greeting', () => {
 *   return `Hello, ${fullName.read()}!`
 * })
 *
 * // First read computes the value
 * console.log(greeting.read()) // "Hello, John Doe!"
 *
 * // Subsequent reads use cached value
 * console.log(greeting.read()) // Cache hit!
 *
 * // Changing an input invalidates dependents
 * firstName.set('Jane')
 * console.log(greeting.read()) // Recomputes: "Hello, Jane Doe!"
 * ```
 *
 * @packageDocumentation
 */

// Core types
export {
  type Revision,
  type QueryId,
  type Deps,
  type DepEdge,
  type MemoEntry,
  type TrackedInput,
  type CacheStatus,
  type StaleReason,
  type RecomputeEvent,
  type RecomputeListener,
  type QueryHandle,
  type QueryOptions,
  type GraphSnapshot,
  revision,
  queryId,
  queryIdType,
  queryIdKey,
  emptyDeps,
  addDep,
  createMemoEntry,
  INITIAL_REVISION,
} from './types.js'

// Execution context
export {
  type ExecutionContext,
  createExecutionContext,
  currentContext,
  pushContext,
  popContext,
  recordDependency,
  isCancelled,
  getAbortSignal,
  cancelCurrentExecution,
  withContext,
  withContextAsync,
  getElapsedTime,
  contextDepth,
  wouldCycle,
  getQueryCallStack,
} from './context.js'

// Database and handles
export {
  type DatabaseConfig,
  type QueryFn,
  Database,
  InputHandle,
} from './database.js'

// Debug and devtools
export {
  type RecomputeExplanation,
  type PerformanceStats,
  type DevtoolsHook,
  explainRecompute,
  toDot,
  getPerformanceStats,
  createDebugLogger,
  formatDeps,
  printQueryStats,
  traceRecomputeRoot,
  createDevtoolsHook,
  installDevtools,
} from './debug.js'

// TanStack DB integration
export {
  type CollectionAdapter,
  type SalsaLiveQuery,
  type PaginatedQueryResult,
  type QueryMetrics,
  createCollectionAdapter,
  createSalsaQuery,
  createPaginatedQuery,
  createCancelableQuery,
  batchUpdates,
  createMetricsTracker,
} from './integration.js'
