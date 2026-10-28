import { QueryClient } from '@tanstack/query-core'

// Shared fixtures for the cursor fetch boundary tests. The boundary oracle
// (cursor-pagination.boundary-oracle.test.ts) and the ordinary boundary tests
// (cursor-pagination.boundary.test.ts) both build clients and page rows with
// these helpers.
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
export const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
      },
    },
  })
export const rowsFor = (size: number) =>
  Array.from({ length: size * 2 }, (_, id) => ({ id }))
