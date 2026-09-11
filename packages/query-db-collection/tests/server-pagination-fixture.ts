import { QueryClient } from '@tanstack/query-core'
import { BTreeIndex, createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '../src/index'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression'
import type { LoadSubsetOptions } from '@tanstack/db'

export type ServerRow = { id: number; rank: number }

// An ordinary QueryObserver, not InfiniteQueryObserver. This fixture models
// numeric rows supplied in ascending id/rank order; it is not a general sorter.
// The endpoint either fulfills the request or returns one nonconforming cap.
export function createServerPaginationFixture(options: {
  syncMode: `eager` | `on-demand`
  rows: Array<ServerRow>
  cap?: number
  serverPageSize?: number
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const requests: Array<{
    pageParam: unknown
    subset: LoadSubsetOptions | undefined
  }> = []
  const serverPages: Array<number> = []
  const collection = createCollection(
    queryCollectionOptions({
      queryClient: client,
      queryKey: [`server-pagination-probe`],
      syncMode: options.syncMode,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      getKey: (row: ServerRow) => row.id,
      queryFn: async (context): Promise<Array<ServerRow>> => {
        requests.push({
          pageParam: `pageParam` in context ? context.pageParam : undefined,
          subset: context.meta?.loadSubsetOptions,
        })
        const subset = context.meta?.loadSubsetOptions
        const start = subset?.offset ?? 0
        const limit = options.cap ?? subset?.limit ?? options.rows.length
        const matching = options.rows.filter((row) =>
          subset?.where
            ? evaluateReferenceExpression(subset.where, row) === true
            : true,
        )
        if (options.serverPageSize !== undefined) {
          const pageSize = options.serverPageSize
          const firstPage = Math.floor(start / pageSize)
          const prefixSkip = start % pageSize
          const gathered: Array<ServerRow> = []
          let page: number | undefined = firstPage
          while (page !== undefined && gathered.length < prefixSkip + limit) {
            serverPages.push(page)
            // Server authority stays inside the adapter. Query DB receives only
            // the completed row array, not this endpoint-specific continuation.
            const response: {
              rows: Array<ServerRow>
              nextPage: number | undefined
            } = await Promise.resolve({
              rows: matching.slice(page * pageSize, (page + 1) * pageSize),
              nextPage:
                (page + 1) * pageSize < matching.length ? page + 1 : undefined,
            })
            gathered.push(...response.rows)
            page = response.nextPage
          }
          return gathered.slice(prefixSkip, prefixSkip + limit)
        }
        return matching.slice(start, start + limit)
      },
    }),
  )
  return { collection, requests, serverPages, client }
}
