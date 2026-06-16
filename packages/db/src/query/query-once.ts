import { createLiveQueryCollection } from './live-query-collection.js'
import type {
  ExtractContext,
  InitialQueryBuilder,
  QueryBuilder,
} from './builder/index.js'
import type {
  Context,
  InferResultType,
  RootObjectResultConstraint,
  RootQueryBuilder,
  RootQueryFn,
} from './builder/types.js'

/**
 * Configuration options for queryOnce
 */
export interface QueryOnceConfig<TContext extends Context> {
  /**
   * Query builder function that defines the query
   */
  query:
    | ((
        q: InitialQueryBuilder,
      ) => QueryBuilder<TContext> & RootObjectResultConstraint<TContext>)
    | (QueryBuilder<TContext> & RootObjectResultConstraint<TContext>)
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
export function queryOnce<
  TQueryFn extends (q: InitialQueryBuilder) => QueryBuilder<any>,
  TQuery extends QueryBuilder<any> = ReturnType<TQueryFn>,
>(
  queryFn: TQueryFn & RootQueryFn<TQuery>,
): Promise<InferResultType<ExtractContext<TQuery>>>

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
export function queryOnce<TQuery extends QueryBuilder<any>>(
  config: QueryOnceConfig<ExtractContext<TQuery>> & {
    query: RootQueryFn<TQuery> | RootQueryBuilder<TQuery>
  },
): Promise<InferResultType<ExtractContext<TQuery>>>

// Implementation
export async function queryOnce<TContext extends Context>(
  configOrQuery:
    | QueryOnceConfig<TContext>
    | ((
        q: InitialQueryBuilder,
      ) => QueryBuilder<TContext> & RootObjectResultConstraint<TContext>),
): Promise<InferResultType<TContext>> {
  // Normalize input
  const config: QueryOnceConfig<TContext> =
    typeof configOrQuery === `function`
      ? { query: configOrQuery }
      : configOrQuery

  const query = (q: InitialQueryBuilder) => {
    const queryConfig = config.query
    return typeof queryConfig === `function` ? queryConfig(q) : queryConfig
  }

  // Create collection with minimal GC time; preload handles sync start
  const collection = createLiveQueryCollection({
    query,
    gcTime: 1, // Cleanup in next tick when no subscribers (0 disables GC)
  })

  try {
    // Wait for initial data load
    await collection.preload()

    // Check if this is a single-result query (findOne was called)
    const isSingleResult =
      (collection.config as { singleResult?: boolean }).singleResult === true

    // Extract and return results
    if (isSingleResult) {
      const first = collection.values().next().value as
        | InferResultType<TContext>
        | undefined
      return first as InferResultType<TContext>
    }
    return collection.toArray as unknown as InferResultType<TContext>
  } finally {
    // Always cleanup, even on error
    await collection.cleanup()
  }
}
