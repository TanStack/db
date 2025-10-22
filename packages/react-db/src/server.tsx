import { createContext, useContext, useMemo } from "react"
import { createLiveQueryCollection } from "@tanstack/db"
import type {
  Context,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  QueryBuilder,
} from "@tanstack/db"
import type { ReactNode } from "react"

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

  /**
   * How long the data should be considered fresh on the client (in milliseconds)
   * @default 0 (immediately stale, will refetch)
   */
  staleTime?: number
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

/**
 * React context for providing hydrated state to client components
 * @internal
 */
export const HydrationContext = createContext<DehydratedState | undefined>(
  undefined
)

/**
 * Hook to access hydrated data for a specific query
 * @internal
 */
export function useHydratedQuery<T = any>(id: string): T | undefined {
  const hydrationState = useContext(HydrationContext)

  return useMemo(() => {
    if (!hydrationState) return undefined

    const query = hydrationState.queries.find((q) => q.id === id)
    return query?.data as T | undefined
  }, [hydrationState, id])
}

/**
 * Boundary component that provides hydrated query data to child components
 *
 * This component should wrap your application or page component in SSR/RSC environments.
 * It makes the prefetched query data available to useLiveQuery hooks.
 *
 * @example
 * ```tsx
 * // In Next.js App Router (Server Component)
 * async function Page() {
 *   const serverContext = createServerContext()
 *   await prefetchLiveQuery(serverContext, {
 *     id: 'todos',
 *     query: (q) => q.from({ todos: todosCollection })
 *   })
 *
 *   return (
 *     <HydrationBoundary state={dehydrate(serverContext)}>
 *       <TodoList />
 *     </HydrationBoundary>
 *   )
 * }
 *
 * // In client component
 * 'use client'
 * function TodoList() {
 *   const { data } = useLiveQuery((q) => q.from({ todos: todosCollection }), {
 *     id: 'todos' // Must match the id used in prefetchLiveQuery
 *   })
 *   return <div>{data.map(todo => <Todo key={todo.id} {...todo} />)}</div>
 * }
 * ```
 */
export function HydrationBoundary({
  state,
  children,
}: {
  state: DehydratedState | undefined
  children: ReactNode
}) {
  return (
    <HydrationContext.Provider value={state}>
      {children}
    </HydrationContext.Provider>
  )
}

/**
 * Hydrate dehydrated state on the client
 *
 * This is useful for manual hydration in non-React contexts or for
 * integrating with other frameworks.
 *
 * @example
 * ```tsx
 * // Store in global state for access by useLiveQuery
 * hydrate(dehydratedState)
 * ```
 */
export function hydrate(dehydratedState: DehydratedState): void {
  // Store in a global that useLiveQuery can access
  if (typeof window !== `undefined`) {
    ;(window as any).__TANSTACK_DB_HYDRATED_STATE__ = dehydratedState
  }
}

/**
 * Get hydrated data from global state (for non-React contexts)
 * @internal
 */
export function getHydratedQuery<T = any>(id: string): T | undefined {
  if (typeof window === `undefined`) return undefined

  const state = (window as any).__TANSTACK_DB_HYDRATED_STATE__ as
    | DehydratedState
    | undefined
  if (!state) return undefined

  const query = state.queries.find((q) => q.id === id)
  return query?.data as T | undefined
}
