/**
 * Dependency Tracking Context
 *
 * This module implements automatic dependency discovery during query execution.
 * When a query reads from an input or another query, the dependency is automatically
 * recorded in the current execution context.
 *
 * Key design decisions (following Salsa):
 * - Context is stored in a stack to support nested query calls
 * - Dependencies are discovered at runtime, not declared statically
 * - Each query execution gets a fresh context to track its specific deps
 */

import {
  
  
  
  
  addDep,
  emptyDeps
} from './types.js'
import type {DepEdge, Deps, QueryId, Revision} from './types.js';

/**
 * Execution context for a single query invocation.
 * Tracks all dependencies read during the query's execution.
 */
export interface ExecutionContext {
  /** The query being executed */
  readonly queryId: QueryId
  /** Mutable deps being accumulated */
  deps: Deps
  /** Whether this execution has been cancelled */
  cancelled: boolean
  /** Abort controller for cancellation propagation */
  readonly abortController: AbortController
  /** Start time for profiling */
  readonly startTime: number
}

/**
 * Create a new execution context.
 */
export function createExecutionContext(queryId: QueryId): ExecutionContext {
  return {
    queryId,
    deps: emptyDeps(),
    cancelled: false,
    abortController: new AbortController(),
    startTime: performance.now(),
  }
}

/**
 * Stack of active execution contexts.
 * The topmost context is the currently executing query.
 */
const contextStack: Array<ExecutionContext> = []

/**
 * Get the current execution context, if any.
 */
export function currentContext(): ExecutionContext | undefined {
  return contextStack[contextStack.length - 1]
}

/**
 * Push a new execution context onto the stack.
 * Called when a query starts executing.
 */
export function pushContext(ctx: ExecutionContext): void {
  contextStack.push(ctx)
}

/**
 * Pop the current execution context from the stack.
 * Called when a query finishes executing.
 * Returns the popped context.
 */
export function popContext(): ExecutionContext | undefined {
  return contextStack.pop()
}

/**
 * Record that the current query read from a dependency.
 * This is called automatically when reading inputs or other queries.
 *
 * @param id The query/input that was read
 * @param atRevision The revision at which it was read
 */
export function recordDependency(id: QueryId, atRevision: Revision): void {
  const ctx = currentContext()
  if (ctx) {
    // Don't record self-dependencies
    if (id !== ctx.queryId) {
      const edge: DepEdge = { id, atRevision }
      ctx.deps = addDep(ctx.deps, edge)
    }
  }
}

/**
 * Check if the current execution has been cancelled.
 * Queries should check this periodically for long-running computations.
 */
export function isCancelled(): boolean {
  const ctx = currentContext()
  return ctx?.cancelled ?? false
}

/**
 * Get the abort signal for the current execution.
 * Can be passed to fetch() or other cancellable operations.
 */
export function getAbortSignal(): AbortSignal | undefined {
  return currentContext()?.abortController.signal
}

/**
 * Cancel the current execution context.
 * This will cause isCancelled() to return true and abort the signal.
 */
export function cancelCurrentExecution(): void {
  const ctx = currentContext()
  if (ctx) {
    ctx.cancelled = true
    ctx.abortController.abort()
  }
}

/**
 * Run a function within a new execution context.
 * Dependencies read during execution are tracked.
 *
 * @param queryId The ID of the query being executed
 * @param fn The function to execute
 * @returns The result and collected dependencies
 */
export function withContext<T>(
  queryId: QueryId,
  fn: () => T
): { result: T; context: ExecutionContext } {
  const ctx = createExecutionContext(queryId)
  pushContext(ctx)
  try {
    const result = fn()
    return { result, context: ctx }
  } finally {
    popContext()
  }
}

/**
 * Run an async function within a new execution context.
 * Dependencies read during execution are tracked.
 *
 * Note: For async queries, dependencies are only tracked for synchronous
 * portions of the execution. Async operations should explicitly record
 * their dependencies.
 *
 * @param queryId The ID of the query being executed
 * @param fn The async function to execute
 * @returns The result and collected dependencies
 */
export async function withContextAsync<T>(
  queryId: QueryId,
  fn: () => Promise<T>
): Promise<{ result: T; context: ExecutionContext }> {
  const ctx = createExecutionContext(queryId)
  pushContext(ctx)
  try {
    const result = await fn()
    return { result, context: ctx }
  } finally {
    popContext()
  }
}

/**
 * Get the elapsed time since the current context started.
 */
export function getElapsedTime(): number {
  const ctx = currentContext()
  return ctx ? performance.now() - ctx.startTime : 0
}

/**
 * Depth of the current context stack.
 * Useful for debugging nested query calls.
 */
export function contextDepth(): number {
  return contextStack.length
}

/**
 * Check for potential dependency cycles.
 * Returns true if the given queryId is already in the context stack.
 */
export function wouldCycle(queryId: QueryId): boolean {
  return contextStack.some((ctx) => ctx.queryId === queryId)
}

/**
 * Get the call stack of currently executing queries.
 * Useful for debugging.
 */
export function getQueryCallStack(): Array<QueryId> {
  return contextStack.map((ctx) => ctx.queryId)
}
