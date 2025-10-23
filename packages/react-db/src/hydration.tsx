"use client"

import { createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"
import type { DehydratedState } from "./server"

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
export function useHydratedQuery<T = any>(hydrateId: string): T | undefined {
  const hydrationState = useContext(HydrationContext)

  return useMemo(() => {
    if (!hydrationState) return undefined

    const query = hydrationState.queries.find((q) => q.hydrateId === hydrateId)
    return query?.data as T | undefined
  }, [hydrationState, hydrateId])
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
 *     hydrateId: 'todos',
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
 *   const { data } = useLiveQuery({
 *     hydrateId: 'todos', // Must match the hydrateId used in prefetchLiveQuery
 *     query: (q) => q.from({ todos: todosCollection })
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
