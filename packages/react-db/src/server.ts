import { createLiveQueryCollection } from "@tanstack/db"
import type {
  Context,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"

/**
 * Server context for managing live query prefetching and dehydration
 */
export interface ServerContext {
  queries: Map<string, DehydratedQuery>
}

/**
 * Dehydrated query result that can be serialized and sent to the client
 */
export interface DehydratedQuery<T = any> {
  hydrateId: string
  data: T
  timestamp: number
}

/**
 * Dehydrated state containing all prefetched queries
 */
export interface DehydratedState {
  queries: Array<DehydratedQuery>
}

/**
 * Options for prefetching a live query
 */
export interface PrefetchLiveQueryOptions<TContext extends Context> {
  /**
   * Unique identifier for SSR hydration matching. Required for hydration to work.
   * Must match the hydrateId used in the client-side useLiveQuery call.
   */
  hydrateId: string

  /**
   * The query to execute
   */
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | QueryBuilder<TContext>

  /**
   * Optional transform function to apply to the query results before dehydration.
   * Useful for serialization (e.g., converting Date objects to ISO strings).
   * Should return an array of rows; non-arrays are normalized to a single-element array.
   *
   * @example
   * ```tsx
   * transform: (rows) => rows.map(row => ({
   *   ...row,
   *   createdAt: row.createdAt.toISOString()
   * }))
   * ```
   */
  transform?: (rows: Array<any>) => Array<any> | any
}

/**
 * Create a new server context for managing queries during SSR/RSC
 */
export function createServerContext(): ServerContext {
  return {
    queries: new Map(),
  }
}

/**
 * Prefetch a live query on the server and store the result in the server context
 *
 * @example
 * ```tsx
 * const serverContext = createServerContext()
 *
 * await prefetchLiveQuery(serverContext, {
 *   hydrateId: 'todos',
 *   query: (q) => q.from({ todos: todosCollection })
 * })
 *
 * const dehydratedState = dehydrate(serverContext)
 * ```
 */
export async function prefetchLiveQuery<TContext extends Context>(
  serverContext: ServerContext,
  options: PrefetchLiveQueryOptions<TContext>
): Promise<void> {
  const { hydrateId, query, transform } = options

  // Create a temporary collection for this query
  const config: LiveQueryCollectionConfig<TContext> = {
    id: hydrateId, // Use hydrateId as the collection id (temporary, server-side only)
    query,
    startSync: false, // Don't auto-start, we'll preload manually
  }

  const collection = createLiveQueryCollection(config)

  try {
    // Wait for the collection to be ready with data
    const base = await collection.toArrayWhenReady()

    // Apply optional transform (e.g., for serialization)
    const out = transform ? transform(base as Array<any>) : base
    // Normalize to array (defensive)
    const data = Array.isArray(out) ? out : [out]

    // Store in server context
    serverContext.queries.set(hydrateId, {
      hydrateId,
      data,
      timestamp: Date.now(),
    })
  } finally {
    // Clean up the collection
    await collection.cleanup()
  }
}

/**
 * Serialize the server context into a dehydrated state that can be sent to the client
 *
 * @example
 * ```tsx
 * const dehydratedState = dehydrate(serverContext)
 * return { props: { dehydratedState } }
 * ```
 */
export function dehydrate(serverContext: ServerContext): DehydratedState {
  return {
    queries: Array.from(serverContext.queries.values()),
  }
}
