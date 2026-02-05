import { createLiveQueryCollection } from './live-query-collection.js'
import type { InitialQueryBuilder, QueryBuilder } from './builder/index.js'
import type { Context, InferResultType } from './builder/types.js'

/**
 * Configuration options for queryOnce
 */
export interface QueryOnceConfig<TContext extends Context> {
  /**
   * Query builder function that defines the query
   */
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | QueryBuilder<TContext>
  // Future: timeout, signal, etc.
}

// Overload 1: Simple query function returning array (non-single result)
/**
 * Executes a one-shot query and returns the results as an array.
 *
 * This function creates a live query collection, preloads it, extracts the results,
 * and automatically cleans up the collection. It's ideal for:
 * - AI/LLM context building
 * - Data export
 * - Background processing
 * - Testing
 *
 * @param queryFn - A function that receives the query builder and returns a query
 * @returns A promise that resolves to an array of query results
 *
 * @example
 * ```typescript
 * // Basic query
 * const users = await queryOnce((q) =>
 *   q.from({ user: usersCollection })
 * )
 *
 * // With filtering and projection
 * const activeUserNames = await queryOnce((q) =>
 *   q.from({ user: usersCollection })
 *    .where(({ user }) => eq(user.active, true))
 *    .select(({ user }) => ({ name: user.name }))
 * )
 * ```
 */
export function queryOnce<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
): Promise<InferResultType<TContext>>

// Overload 2: Config object form returning array (non-single result)
/**
 * Executes a one-shot query using a configuration object.
 *
 * @param config - Configuration object with the query function
 * @returns A promise that resolves to an array of query results
 *
 * @example
 * ```typescript
 * const recentOrders = await queryOnce({
 *   query: (q) =>
 *     q.from({ order: ordersCollection })
 *      .orderBy(({ order }) => desc(order.createdAt))
 *      .limit(100),
 * })
 * ```
 */
export function queryOnce<TContext extends Context>(
  config: QueryOnceConfig<TContext>,
): Promise<InferResultType<TContext>>

// Implementation
export async function queryOnce<TContext extends Context>(
  configOrQuery:
    | QueryOnceConfig<TContext>
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>),
): Promise<InferResultType<TContext>> {
  // Normalize input
  const config: QueryOnceConfig<TContext> =
    typeof configOrQuery === `function`
      ? { query: configOrQuery }
      : configOrQuery

  // Create collection with minimal GC time and start sync immediately
  const collection = createLiveQueryCollection({
    query: config.query,
    startSync: true,
    gcTime: 1, // Cleanup in next tick when no subscribers (0 disables GC)
  })

  try {
    // Wait for initial data load
    await collection.preload()

    // Check if this is a single-result query (findOne was called)
    const isSingleResult = (collection.config as { singleResult?: boolean })
      .singleResult

    // Extract and return results
    if (isSingleResult) {
      const entries = Array.from(collection.values())
      return entries[0] as InferResultType<TContext>
    }
    return collection.toArray as InferResultType<TContext>
  } finally {
    // Always cleanup, even on error
    await collection.cleanup()
  }
}
