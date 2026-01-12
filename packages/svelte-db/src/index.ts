// Re-export all public APIs
export * from './useLiveQuery.svelte.js'

// SSR/Hydration exports
export {
  createServerContext,
  prefetchLiveQuery,
  dehydrate,
  type ServerContext,
  type DehydratedState,
  type DehydratedQuery,
  type PrefetchLiveQueryOptions,
} from './server.js'

export { setHydrationContext, getHydrationContext } from './hydration.svelte.js'

export { default as HydrationBoundary } from './HydrationBoundary.svelte'

// Re-export everything from @tanstack/db
export * from '@tanstack/db'

// Re-export some stuff explicitly to ensure the type & value is exported
export type { Collection } from '@tanstack/db'
export { createTransaction } from '@tanstack/db'
