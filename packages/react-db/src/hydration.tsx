"use client"

import { createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"
import type { DehydratedState } from "./server"

/**
 * Symbol for storing hydrated state globally, avoiding collisions across bundles
 * @internal
 */
const HYDRATED_SYMBOL =
  typeof Symbol !== `undefined`
    ? Symbol.for(`tanstack.db.hydrated`)
    : `__TANSTACK_DB_HYDRATED_STATE__`

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
 *   const { data } = useLiveQuery({
 *     id: 'todos', // Must match the id used in prefetchLiveQuery
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

/**
 * Hydrate dehydrated state on the client
 *
 * This is useful for manual hydration in non-React contexts or for
 * integrating with other frameworks.
 *
 * @param dehydratedState - The dehydrated state to hydrate
 * @param options - Hydration options
 * @param options.oneShot - If true, the hydrated state will be cleared after the first read
 *
 * @example
 * ```tsx
 * // Store in global state for access by useLiveQuery
 * hydrate(dehydratedState)
 *
 * // One-shot hydration (cleared after first read)
 * hydrate(dehydratedState, { oneShot: true })
 * ```
 */
export function hydrate(
  dehydratedState: DehydratedState,
  { oneShot = false }: { oneShot?: boolean } = {}
): void {
  // Store in a global that useLiveQuery can access
  if (typeof window !== `undefined`) {
    ;(window as any)[HYDRATED_SYMBOL] = { state: dehydratedState, oneShot }
  }
}

/**
 * Internal helper to read hydrated data and handle one-shot consumption
 * @internal
 */
function readHydrated(id: string) {
  if (typeof window === `undefined`) return undefined

  const w = (window as any)[HYDRATED_SYMBOL]
  if (!w?.state) return undefined

  const q = w.state.queries.find((query: any) => query.id === id)?.data

  // If one-shot is enabled, clear the global state after reading
  if (q && w.oneShot) {
    ;(window as any)[HYDRATED_SYMBOL] = undefined
  }

  return q
}

/**
 * Get hydrated data from global state (for non-React contexts)
 * @internal
 */
export function getHydratedQuery<T = any>(id: string): T | undefined {
  return readHydrated(id) as T | undefined
}
