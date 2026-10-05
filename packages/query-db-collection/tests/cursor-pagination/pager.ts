import { QueryClient } from '@tanstack/query-core'
import { createCursorPager as createProductionPager } from '../../src/index.js'
import type { FetchPage } from './backend.js'

/** Stable-snapshot tests use isolated caches without timers or expiry. */
export function createCursorPager<T>(fetchPage: FetchPage<T>) {
  return createProductionPager({
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
    queryKey: [`cursor-pages`],
    staleTime: Infinity,
    gcTime: Infinity,
    fetchPage,
  })
}
