import { getContext, setContext } from 'svelte'
import type { DehydratedState } from './server'

/**
 * Context key for hydration state
 * @internal
 */
const HYDRATION_KEY = Symbol(`tanstack-db-hydration`)

/**
 * Set the hydration context with dehydrated state from the server
 * This should be called in a parent component to make hydrated data available to child components.
 *
 * @param state - The dehydrated state from the server, or undefined if no SSR data
 * @internal
 */
export function setHydrationContext(state: DehydratedState | undefined): void {
  setContext(HYDRATION_KEY, state)
}

/**
 * Get the hydration context containing dehydrated state
 * Returns undefined if no hydration context has been set or if called outside a component.
 *
 * @returns The dehydrated state, or undefined if not in a hydration context
 * @internal
 */
export function getHydrationContext(): DehydratedState | undefined {
  try {
    return getContext<DehydratedState | undefined>(HYDRATION_KEY)
  } catch {
    // getContext throws when called outside of component initialization
    // In that case, we simply return undefined (no hydration data available)
    return undefined
  }
}

/**
 * Hook to access hydrated data for a specific query by ID
 *
 * @param id - The query ID to look up
 * @returns The hydrated data for the query, or undefined if not found
 * @internal
 */
export function useHydratedQuery<T = any>(id: string): T | undefined {
  const state = getHydrationContext()

  if (!state) return undefined

  const query = state.queries.find((q) => q.id === id)
  return query?.data as T | undefined
}
