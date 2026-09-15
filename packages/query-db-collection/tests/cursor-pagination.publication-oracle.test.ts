import {
  QueryClient,
  QueryObserver,
  isCancelledError,
} from '@tanstack/query-core'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { oraclePropertyOptions } from '../../db/tests/oracle-config.js'
import { createCursorPager } from '../src/index.js'
import { createBackend } from './cursor-pagination/backend.js'
import { expectedRows } from './cursor-pagination/model.js'
import type { Row } from './cursor-pagination/model.js'

const scope = { group: undefined, descending: false }
const rowsFor = (count: number, version = 0): Array<Row> =>
  Array.from({ length: count }, (_, id) => ({ id, rank: id, group: version }))
const createClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })

// The reference remains a whole relation. These laws add publication and
// next-use observations, not a model of Query's retryer or page cache.
describe(`cursor cache publication`, () => {
  it.each([true, false])(
    `force refresh requires cancellation of held growth: %s`,
    async (cancel) => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 1, max: 3 }),
          async (size, depth) => {
            const client = createClient()
            const key = [`posts`, `cursor-pages`]
            const entered = createDeferred<void>()
            const release = createDeferred<void>()
            let source = rowsFor(size * (depth + 1))
            // Each token retains its original immutable backend, even when a new
            // sequence starts. The fixture must not rescue stale cursors.
            const routes = new Map<string, ReturnType<typeof createBackend>>()
            let serial = 0
            let starts = 0
            let calls = 0
            let holdAt = Infinity
            const options = {
              queryClient: client,
              queryKey: key,
              fetchPage: async (
                cursor: string | undefined,
                signal: AbortSignal,
              ) => {
                const backend =
                  cursor === undefined
                    ? createBackend(source, scope, size)
                    : routes.get(cursor)!
                if (cursor === undefined) starts++
                const backendCursor = cursor?.slice(cursor.indexOf(`:`) + 1)
                const page = await backend.fetchPage(backendCursor, signal)
                const nextCursor =
                  page.nextCursor === null
                    ? null
                    : `${++serial}:${page.nextCursor}`
                if (nextCursor !== null) routes.set(nextCursor, backend)
                if (++calls === holdAt) {
                  entered.resolve()
                  await release.promise // Deliberately deliver even after abort.
                }
                return { rows: page.rows, nextCursor }
              },
            }
            const outer = new QueryObserver(client, {
              queryKey: [`posts`, `rows`],
              queryFn: () =>
                createCursorPager(options).read({ limit: size * depth }),
            })
            const unsubscribe = outer.subscribe(() => {})
            try {
              await outer.refetch({ cancelRefetch: false, throwOnError: true })
              holdAt = calls + 1
              const growth = createCursorPager(options)
                .read({})
                .catch((error: unknown) => error)
              await entered.promise
              source = rowsFor(source.length, 1)
              const query = client
                .getQueryCache()
                .find({ queryKey: key, exact: true })!
              const joined = createDeferred<void>()
              const fetch = query.fetch.bind(query)
              const witness = vi
                .spyOn(query, `fetch`)
                .mockImplementation((...args) => {
                  const result = fetch(...args)
                  joined.resolve()
                  return result
                })
              // Follow the guide's force-refresh recipe through a real active
              // outer query. Observe its acquisition before releasing old data.
              if (cancel) await client.cancelQueries({ queryKey: [`posts`] })
              const refresh = client.invalidateQueries({ queryKey: [`posts`] })
              await joined.promise
              witness.mockRestore()
              release.resolve()
              await refresh
              const oldResult = await growth
              const expected = expectedRows(source, scope, {
                offset: 0,
                limit: size * depth,
              })
              const check = () =>
                expect(
                  outer.getCurrentResult().data,
                  `refresh publishes the new snapshot`,
                ).toEqual(expected)
              if (cancel) {
                check()
                expect(isCancelledError(oldResult)).toBe(true)
                expect(starts).toBe(2)
                expect(
                  await createCursorPager(options).read({
                    limit: size * depth,
                  }),
                ).toEqual(expected)
              } else {
                // Fault control: omitting the documented cancellation reaches
                // the same checker with a valid but obsolete backend sequence.
                expect(check).toThrow(`refresh publishes`)
                expect(outer.getCurrentResult().data).toEqual(
                  expectedRows(rowsFor(source.length), scope, {
                    offset: 0,
                    limit: size * depth,
                  }),
                )
                expect(starts).toBe(1)
              }
            } finally {
              release.resolve()
              unsubscribe()
              client.clear()
            }
          },
        ),
        oraclePropertyOptions(50, `cursor-pagination.refresh-publication`),
      )
    },
  )

  it.each([`growth`, `refresh`] as const)(
    `%s rejects malformed final continuations without poisoning the cache`,
    async (phase) => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 1, max: 4 }),
          fc.nat({ max: 3 }),
          fc.boolean(),
          async (size, depth, repeat, retry) => {
            const client = createClient()
            client.setDefaultOptions({
              queries: {
                ...client.getDefaultOptions().queries,
                retry: retry ? 1 : false,
                retryDelay: 0,
              },
            })
            const key = [`protocol`]
            let source = rowsFor(size * (depth + 1))
            let backend = createBackend(source, scope, size)
            let params: Array<string> = []
            let malformed = false
            let calls = 0
            const entered = createDeferred<void>()
            const release = createDeferred<void>()
            const options = {
              queryClient: client,
              queryKey: key,
              fetchPage: async (
                cursor: string | undefined,
                signal: AbortSignal,
              ) => {
                calls++
                if (cursor === undefined) {
                  backend = createBackend(source, scope, size)
                  params = []
                } else params.push(cursor)
                const page = await backend.fetchPage(cursor, signal)
                if (malformed && page.nextCursor === null) {
                  entered.resolve()
                  await release.promise
                }
                return malformed && page.nextCursor === null
                  ? { ...page, nextCursor: params[repeat % params.length]! }
                  : page
              },
            }
            const pager = createCursorPager(options)
            try {
              await pager.read({
                limit: phase === `growth` ? size * depth : source.length,
              })
              if (phase === `refresh`) {
                source = rowsFor(source.length, 1)
                await client.invalidateQueries({ queryKey: key })
              }
              const previous = client.getQueryData(key)
              const published: Array<unknown> = []
              const unsubscribe = client.getQueryCache().subscribe((event) => {
                if (event.type === `updated` && event.action.type === `success`)
                  published.push(event.query.state.data)
              })
              malformed = true
              try {
                const pending = pager.read({}).catch((error: unknown) => error)
                await entered.promise
                const query = client
                  .getQueryCache()
                  .find({ queryKey: key, exact: true })!
                const joined = createDeferred<void>()
                const fetch = query.fetch.bind(query)
                const witness = vi
                  .spyOn(query, `fetch`)
                  .mockImplementation((...args) => {
                    const result = fetch(...args)
                    joined.resolve()
                    return result
                  })
                const peer = createCursorPager(options)
                  .read({})
                  .catch((error: unknown) => error)
                await joined.promise
                witness.mockRestore()
                release.resolve()
                for (const result of await Promise.all([pending, peer])) {
                  expect(result).toBeInstanceOf(Error)
                  expect(String(result)).toContain(`repeated`)
                }
                expect(
                  published,
                  `invalid acquisition must not publish success`,
                ).toEqual([])
                expect(client.getQueryData(key)).toBe(previous)
              } finally {
                unsubscribe()
              }
              malformed = false
              const before = calls
              expect(await pager.read({})).toEqual(
                expectedRows(source, scope, { offset: 0, limit: undefined }),
              )
              expect(calls).toBeGreaterThan(before)
              const settled = calls
              expect(await pager.read({})).toEqual(
                expectedRows(source, scope, { offset: 0, limit: undefined }),
              )
              expect(calls).toBe(settled)
            } finally {
              release.resolve()
              client.clear()
            }
          },
        ),
        oraclePropertyOptions(50, `cursor-pagination.protocol-publication`),
      )
    },
  )

  it(`cached slices visit only requested rows`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.nat({ max: 120 }),
        fc.option(fc.nat({ max: 120 }), { nil: undefined }),
        async (count, offset, limit) => {
          const client = createClient()
          const rows = rowsFor(count)
          let visits = 0
          const observed = rows.map((row) => row)
          for (let index = 0; index < count; index++) {
            Object.defineProperty(observed, index, {
              enumerable: true,
              get: () => {
                visits++
                return rows[index]
              },
            })
          }
          const pager = createCursorPager({
            queryClient: client,
            queryKey: [`slice`],
            fetchPage: () =>
              Promise.resolve({ rows: observed, nextCursor: null }),
          })
          try {
            await pager.read({})
            visits = 0
            const expected = expectedRows(rows, scope, { offset, limit })
            expect(await pager.read({ offset, limit })).toEqual(expected)
            expect(visits).toBe(expected.length)
          } finally {
            client.clear()
          }
        },
      ),
      oraclePropertyOptions(100, `cursor-pagination.slice-work`),
    )
  })
})
