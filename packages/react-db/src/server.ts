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
  id: string
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
   * Unique identifier for this query. Required for hydration to work.
   * Must match the id used in the client-side useLiveQuery call.
   */
  id: string

  /**
   * The query to execute
   */
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | QueryBuilder<TContext>
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
 *   id: 'todos',
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
  const { id, query } = options

  // Create a temporary collection for this query
  const config: LiveQueryCollectionConfig<TContext> = {
    id,
    query,
    startSync: false, // Don't auto-start, we'll preload manually
  }

  const collection = createLiveQueryCollection(config)

  try {
    // Preload the collection data
    await collection.preload()

    // Extract the data
    const data = collection.toArray

    // Store in server context
    serverContext.queries.set(id, {
      id,
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
