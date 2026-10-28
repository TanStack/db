// Ordinary unit tests for on-demand refetch of ordered prefixes. The law, its
// model, and the generated histories are owned by
// refetch-ordered-prefix-oracle.test.ts (query-db.refetch-ordered-prefix).
import { QueryClient } from '@tanstack/query-core'
import { IR, createCollection } from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { queryCollectionOptions } from '../src/query'
import { sameOrderedIds, settle } from './refetch-ordered-prefix-support'
import type { LoadSubsetOptions } from '@tanstack/db'

let collectionSequence = 0

describe(`query-db on-demand refetch keeps served ordered prefixes whole`, () => {
  it(`the comparison rejects a window with the right size but a stale row`, () => {
    expect(sameOrderedIds([5, 4], [5, 4])).toBe(true)
    expect(sameOrderedIds([4, 1], [5, 4])).toBe(false)
    expect(sameOrderedIds([4, 5], [5, 4])).toBe(false)
    expect(sameOrderedIds([5], [5, 4])).toBe(false)
  })
  // A row that arrives ahead moves a one-page window's end earlier, so the
  // refetch must report. The report gate judges a page's end by order, not
  // by how the provider returned it:
  // - Rows without `rank` sort last, so the first page ends on one. An empty
  //   page and a page whose last row has no order value stay distinct.
  // - A provider may return a page's rows in any order. Its last array row
  //   is then not the page's end.
  // These drive the sync boundary directly: the generated campaigns give
  // every row a rank, and their provider returns rows in order.
  it.each([
    {
      name: `from a row without an order value`,
      initial: [{ id: 0, rank: 3 }, { id: 1 }, { id: 2 }],
      arrival: { id: 3, rank: 2 },
      reversed: false,
    },
    {
      name: `when the provider returns the page in reverse order`,
      initial: [
        { id: 0, rank: 10 },
        { id: 1, rank: 4 },
        { id: 2, rank: 1 },
      ],
      arrival: { id: 3, rank: 6 },
      reversed: true,
    },
  ])(
    `a refetch reports a page whose end moves earlier $name`,
    async ({ initial, arrival, reversed }) => {
      type Row = { id: number; rank?: number }
      const backend: Array<Row> = [...initial]
      const queryClient = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      const items = createCollection(
        queryCollectionOptions<Row>({
          id: `refetch-ordered-prefix-unranked-${collectionSequence++}`,
          queryClient,
          queryKey: [`unranked`],
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          queryFn: (ctx) => {
            const options = ctx.meta?.loadSubsetOptions as LoadSubsetOptions
            const offset = options.offset ?? 0
            const page = [...backend]
              .sort(
                (a, b) =>
                  (b.rank ?? -Infinity) - (a.rank ?? -Infinity) || a.id - b.id,
              )
              .slice(offset, offset + options.limit!)
            return reversed ? page.reverse() : page
          },
        }),
      )
      let reports = 0
      items.on(`loadedSubsets:invalidated`, () => {
        reports++
      })
      const orderBy: Array<IR.OrderByClause> = [
        {
          expression: new IR.PropRef([`rank`]),
          compareOptions: {
            direction: `desc`,
            nulls: `last`,
            stringSort: `lexical`,
          },
        },
      ]
      try {
        items.startSyncImmediate()
        await items._sync.loadSubset({ orderBy, limit: 2 })
        expect(items.toArray.map((row) => row.id).sort()).toEqual([0, 1])
        backend.push(arrival)
        await items.utils.refetch()
        await settle()
        expect(reports).toBe(1)
      } finally {
        await items.cleanup()
        queryClient.clear()
      }
    },
  )
})
