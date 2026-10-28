import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { expect } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { createCursorPager, queryCollectionOptions } from '../src/index.js'
import { createBackend } from './cursor-pagination/backend.js'
import type { Row, Scope } from './cursor-pagination/model-oracle.js'

// Shared fixture for the cursor adapter integration tests. The law is owned by
// cursor-pagination-oracle.integration.test.ts, and the ordinary response delivery
// test is in cursor-pagination.integration.test.ts.
export function createFixture(
  rows: Array<Row>,
  scope: Scope,
  backendSize: number,
  holdFirst = false,
) {
  const backend = { calls: [] as Array<string | undefined> }
  const gate = createDeferred<void>()
  let received = 0
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  const makePager = (rank?: number) => {
    const makeBackend = () =>
      createBackend(
        rank === undefined ? rows : rows.filter((row) => row.rank === rank),
        scope,
        backendSize,
      )
    let transport = makeBackend()
    return createCursorPager({
      queryClient: client,
      queryKey: [`cursor-experiment`, scope, `opaque-pages`, rank ?? null],
      fetchPage: async (cursor, signal) => {
        if (cursor === undefined) transport = makeBackend()
        if (rank === undefined) backend.calls.push(cursor)
        const page = await transport.fetchPage(cursor, signal)
        if (++received === 1 && holdFirst) await gate.promise
        return page
      },
    })
  }
  const pager = makePager()
  const ties = new Map<number, ReturnType<typeof makePager>>()
  const requests: Array<{ offset: number; limit: number | undefined }> = []
  let cursorRequestCount = 0
  const direction = scope.descending ? `desc` : `asc`
  const source = createCollection(
    queryCollectionOptions<Row>({
      queryClient: client,
      queryKey: [`cursor-experiment`, scope, `rows`],
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      getKey: (row) => row.id,
      queryFn: async (ctx) => {
        const options = ctx.meta?.loadSubsetOptions
        let reader = pager
        const where = options?.where
        if (where !== undefined) {
          if (
            where.type !== `func` ||
            where.name !== `eq` ||
            where.args.length !== 2 ||
            where.args[0]?.type !== `ref` ||
            where.args[0].path.length !== 1 ||
            where.args[0].path[0] !== `rank` ||
            where.args[1]?.type !== `val` ||
            typeof where.args[1].value !== `number`
          ) {
            throw new Error(`Unsupported fixture predicate`)
          }
          const rank = where.args[1].value
          let tie = ties.get(rank)
          if (!tie) {
            tie = makePager(rank)
            ties.set(rank, tie)
          }
          reader = tie
        }
        if (options?.cursor) {
          cursorRequestCount++
          expect(options.cursor.whereCurrent).toMatchObject({
            type: `func`,
            name: `eq`,
            args: [
              { type: `ref`, path: [`rank`] },
              { type: `val`, value: expect.any(Number) },
            ],
          })
          expect(options.cursor.whereFrom).toMatchObject({
            type: `func`,
            name: scope.descending ? `lt` : `gt`,
            args: [
              { type: `ref`, path: [`rank`] },
              { type: `val`, value: expect.any(Number) },
            ],
          })
        }
        if (options?.orderBy) {
          expect(options.orderBy).toMatchObject([
            { expression: { path: [`rank`] }, compareOptions: { direction } },
            { expression: { path: [`id`] }, compareOptions: { direction } },
          ])
        }
        const window = { offset: options?.offset ?? 0, limit: options?.limit }
        requests.push(window)
        return reader.read(window, ctx.signal)
      },
    }),
  )
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.rank, direction)
      .orderBy(({ row }) => row.id, direction)
      .limit(1),
  )
  return {
    backend,
    gate,
    requests,
    cursorRequestCount: () => cursorRequestCount,
    live,
    source,
    refresh: () =>
      client.invalidateQueries(
        { queryKey: [`cursor-experiment`, scope] },
        { throwOnError: true },
      ),
    received: () => received,
    async cleanup() {
      gate.resolve()
      await live.cleanup()
      await source.cleanup()
      client.clear()
    },
  }
}

export // This oracle checks all user row fields and their order. Virtual Collection
// fields ($key/$origin/etc.) are outside the cursor adapter's responsibility.
const observeRows = (rows: ReadonlyArray<Row>) =>
  rows.map(({ id, rank, group }) => ({ id, rank, group }))
