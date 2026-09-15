import { QueryClient, isCancelledError } from '@tanstack/query-core'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { oraclePropertyOptions } from '../../db/tests/oracle-config.js'
import { createCursorPager } from '../src/index.js'
import { createBackend } from './cursor-pagination/backend.js'
import { expectedRows } from './cursor-pagination/model.js'
import type { CursorPager } from '../src/index.js'
import type { Row } from './cursor-pagination/model.js'

const scope = { group: undefined, descending: false }
const makeRows = (count: number, version = 0): Array<Row> =>
  Array.from({ length: count }, (_, id) => ({
    id,
    rank: Math.floor(id / 3),
    group: version,
  }))

async function checkWindow(
  pager: CursorPager<Row>,
  source: Array<Row>,
  width: number,
) {
  expect(
    await pager.read({ limit: width }),
    `window matches the permitted source snapshot`,
  ).toEqual(expectedRows(source, scope, { offset: 0, limit: width }))
}

/** Row truth is still a full relation. A fake clock and real QueryClient drive
 * freshness; the model keeps only the permitted source snapshot and a deadline,
 * not Query's page cache, retryer, observer or garbage-collection state. */
describe(`cursor cache lifecycle`, () => {
  it.each([
    [`global`, `maxPages`],
    [`global`, `select`],
    [`global`, `both`],
    [`key`, `maxPages`],
    [`key`, `select`],
    [`key`, `both`],
  ] as const)(
    `preserves full windows with %s %s defaults`,
    async (level, mode) => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 1, max: 3 }),
          async (size, maxPages) => {
            const client = new QueryClient({
              defaultOptions: {
                queries: {
                  retry: false,
                  gcTime: Infinity,
                  staleTime: Infinity,
                },
              },
            })
            const defaults = {
              ...(mode !== `select` ? { maxPages } : {}),
              ...(mode !== `maxPages`
                ? { select: (data: unknown) => ({ selected: data }) }
                : {}),
            }
            const key = [`defaults`, level, mode]
            if (level === `global`) {
              client.setDefaultOptions({
                queries: { ...client.getDefaultOptions().queries, ...defaults },
              })
            } else client.setQueryDefaults([`defaults`], defaults)
            let rows = makeRows(size * (maxPages + 2))
            let backend = createBackend(rows, scope, size)
            const pager = createCursorPager({
              queryClient: client,
              queryKey: key,
              fetchPage: (cursor, signal) => {
                if (cursor === undefined)
                  backend = createBackend(rows, scope, size)
                return backend.fetchPage(cursor, signal)
              },
            })
            try {
              await checkWindow(pager, rows, size)
              await checkWindow(pager, rows, rows.length)
              // Growing must not move the origin of later offset reads.
              for (const offset of [0, size, rows.length - 1]) {
                const window = { offset, limit: size }
                expect(await pager.read(window)).toEqual(
                  expectedRows(rows, scope, window),
                )
              }
              rows = makeRows(rows.length, 1)
              await client.invalidateQueries({ queryKey: key })
              await checkWindow(pager, rows, rows.length)
            } finally {
              client.clear()
            }
          },
        ),
        oraclePropertyOptions(50, `cursor-pagination.defaults`),
      )
    },
  )

  it.each([`initial`, `growth`, `refresh`] as const)(
    `cancellation stops a held %s acquisition and permits later recovery`,
    async (phase) => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 1, max: 3 }),
          async (size, depth) => {
            const client = new QueryClient({
              defaultOptions: {
                queries: {
                  staleTime: Infinity,
                  gcTime: Infinity,
                  retry: false,
                },
              },
            })
            const key = [`cancel-history`]
            const hold = createDeferred<void>()
            const started = createDeferred<AbortSignal>()
            let holdAt = Infinity
            let calls = 0
            let rows = makeRows(size * (depth + 2))
            let backend = createBackend(rows, scope, size)
            const options = {
              queryClient: client,
              queryKey: key,
              fetchPage: async (
                cursor: string | undefined,
                signal: AbortSignal,
              ) => {
                if (cursor === undefined)
                  backend = createBackend(rows, scope, size)
                const page = await backend.fetchPage(cursor, signal)
                if (++calls === holdAt) {
                  started.resolve(signal)
                  // Hold real response delivery; deliberately ignore abort to
                  // prove Query also fences a transport's late completion.
                  await hold.promise
                }
                return page
              },
            }
            const pager = createCursorPager(options)
            try {
              if (phase !== `initial`) {
                await checkWindow(pager, rows, size * (depth + 1))
              }
              const previous = client.getQueryData(key)
              if (phase === `refresh`) {
                rows = makeRows(rows.length, 1)
                await client.invalidateQueries({ queryKey: key })
              }
              holdAt = calls + (phase === `refresh` ? depth : 1)
              const window = { limit: rows.length }
              const pending = pager.read(window).then(
                (value) => ({ status: `fulfilled` as const, value }),
                (reason: unknown) => ({ status: `rejected` as const, reason }),
              )
              const signal = await started.promise
              if (phase === `growth`) {
                // A reader whose whole window is cached need not wait for a
                // peer's deeper acquisition, even though they share a key.
                await checkWindow(createCursorPager(options), rows, size)
              }
              const query = client
                .getQueryCache()
                .find({ queryKey: key, exact: true })!
              const joined = createDeferred<void>()
              const fetch = query.fetch.bind(query)
              const joinWitness = vi
                .spyOn(query, `fetch`)
                .mockImplementation((...args) => {
                  const result = fetch(...args)
                  joined.resolve()
                  return result
                })
              const peer = createCursorPager(options)
                .read(window)
                .then(
                  (value) => ({ status: `fulfilled` as const, value }),
                  (reason: unknown) => ({
                    status: `rejected` as const,
                    reason,
                  }),
                )
              // Observe the real fetch join instead of guessing how many
              // microtasks the peer takes to reach the acquisition boundary.
              await joined.promise
              joinWitness.mockRestore()
              await client.cancelQueries({ queryKey: key, exact: true })
              expect(signal.aborted).toBe(true)
              for (const result of await Promise.all([pending, peer])) {
                expect(result.status).toBe(`rejected`)
                if (result.status === `rejected`)
                  expect(
                    isCancelledError(result.reason),
                    String(result.reason),
                  ).toBe(true)
              }
              expect(
                calls,
                `cancellation must not start replacement transport`,
              ).toBe(holdAt)
              expect(client.getQueryData(key)).toBe(previous)
              hold.resolve()
              await Promise.resolve()
              await Promise.resolve()
              expect(client.getQueryData(key)).toBe(previous)
              await checkWindow(pager, rows, rows.length)
            } finally {
              hold.resolve()
              client.clear()
            }
          },
        ),
        oraclePropertyOptions(50, `cursor-pagination.cancellation`),
      )
    },
  )

  it(`the cache oracle rejects reuse after invalidation and accepts a real refresh`, async () => {
    for (const ignoreInvalidation of [false, true]) {
      const client = new QueryClient({
        defaultOptions: {
          queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
        },
      })
      let rows = makeRows(2)
      const key = [`sensitivity`]
      const pager = createCursorPager({
        queryClient: client,
        queryKey: key,
        fetchPage: () => Promise.resolve({ rows, nextCursor: null }),
      })
      try {
        await checkWindow(pager, rows, 2)
        rows = makeRows(2, 1)
        await client.invalidateQueries({ queryKey: key })
        if (ignoreInvalidation) {
          // Deliberately bypass Query's stale check, but still execute the
          // production pager and the same value checker as the history law.
          vi.spyOn(client, `fetchInfiniteQuery`).mockImplementation((options) =>
            client.ensureInfiniteQueryData(options),
          )
          await expect(checkWindow(pager, rows, 2)).rejects.toThrow(
            `window matches`,
          )
        } else await checkWindow(pager, rows, 2)
      } finally {
        vi.restoreAllMocks()
        client.clear()
      }
    }
  })

  it(`QueryClient cancellation rejects held work without installing its late page`, async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      },
    })
    const key = [`cancel`]
    const hold = createDeferred<void>()
    let deliveredSignal: AbortSignal | undefined
    let holdResponse = true
    const rows = makeRows(2)
    const pager = createCursorPager({
      queryClient: client,
      queryKey: key,
      fetchPage: async (_cursor, signal) => {
        deliveredSignal = signal
        if (holdResponse) await hold.promise
        return { rows, nextCursor: null }
      },
    })
    const pending = pager.read({}).then(
      () => `success`,
      () => `rejected`,
    )
    try {
      await vi.waitFor(() => expect(deliveredSignal).toBeDefined())
      await client.cancelQueries({ queryKey: key, exact: true })
      expect(await pending).toBe(`rejected`)
      expect(deliveredSignal?.aborted).toBe(true)
      hold.resolve()
      await Promise.resolve()
      expect(client.getQueryData(key)).toBeUndefined()
      holdResponse = false
      await checkWindow(pager, rows, 2)
    } finally {
      hold.resolve()
      await pending
      client.clear()
    }
  })

  it(`reuses pages until expiry or invalidation across generated histories`, async () => {
    vi.useFakeTimers({ toFake: [`Date`] })
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 5 }),
          fc.array(
            fc.constantFrom(
              `read`,
              `grow`,
              `age`,
              `invalidate`,
              `change`,
              `remove`,
            ),
            { minLength: 1, maxLength: 25 },
          ),
          async (count, size, actions) => {
            let now = 1000
            vi.setSystemTime(now)
            const client = new QueryClient({
              defaultOptions: { queries: { retry: false, gcTime: Infinity } },
            })
            let source = makeRows(count)
            let expectedSource = source
            let deadline = 0
            let width = 1
            let version = 0
            let cached = false
            let calls = 0
            let starts = 0
            let backend = createBackend(source, scope, size)
            const key = [`cache-law`]
            const pager = createCursorPager({
              queryClient: client,
              queryKey: key,
              staleTime: 100,
              fetchPage: (cursor, signal) => {
                calls++
                if (cursor === undefined) {
                  starts++
                  backend = createBackend(source, scope, size)
                }
                return backend.fetchPage(cursor, signal)
              },
            })
            try {
              for (const action of [`read`, ...actions] as const) {
                if (action === `change`) {
                  source = makeRows(count, ++version)
                  continue
                }
                if (action === `age`) {
                  now += 100
                  vi.setSystemTime(now)
                  continue
                }
                if (action === `invalidate`) {
                  await client.invalidateQueries({ queryKey: key })
                  deadline = 0
                  continue
                }
                if (action === `remove`) {
                  client.removeQueries({ queryKey: key })
                  cached = false
                  continue
                }
                if (action === `grow`) width += size
                const refresh = !cached || now >= deadline
                if (refresh) expectedSource = source
                const beforeCalls = calls
                const beforeStarts = starts
                const window = { offset: 0, limit: width }
                await checkWindow(pager, expectedSource, width)
                expect(starts - beforeStarts).toBe(refresh ? 1 : 0)
                // Query dates the cache from its latest successful acquisition,
                // including fetchNextPage, rather than aging each page separately.
                if (calls !== beforeCalls) deadline = now + 100
                cached = true
                const settledCalls = calls
                expect(await pager.read(window)).toEqual(
                  expectedRows(expectedSource, scope, window),
                )
                expect(calls).toBe(settledCalls)
              }
            } finally {
              client.clear()
            }
          },
        ),
        oraclePropertyOptions(100, `cursor-pagination.cache`),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([0, 25])(
    `collects inactive pages independently of freshness with gcTime %i`,
    async (gcTime) => {
      vi.useFakeTimers()
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const backend = createBackend(makeRows(6), scope, 2)
      const key = [`collect`]
      const pager = createCursorPager({
        queryClient: client,
        queryKey: key,
        staleTime: Infinity,
        gcTime,
        fetchPage: backend.fetchPage,
      })
      try {
        await pager.read({ limit: 3 })
        expect(backend.calls).toHaveLength(2)
        expect(client.getQueryData(key)).toBeDefined()
        await vi.advanceTimersByTimeAsync(gcTime + 1)
        expect(client.getQueryData(key)).toBeUndefined()
        expect(await pager.read({ limit: 3 })).toEqual(
          expectedRows(makeRows(6), scope, { offset: 0, limit: 3 }),
        )
        expect(backend.calls).toHaveLength(4)
      } finally {
        client.clear()
        vi.useRealTimers()
      }
    },
  )

  it.each([`expiry`, `invalidate`] as const)(
    `keeps cached data while a %s refresh is held or fails`,
    async (cause) => {
      vi.useFakeTimers({ toFake: [`Date`] })
      vi.setSystemTime(1000)
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      })
      const key = [`refresh`]
      let source = makeRows(6)
      let backend = createBackend(source, scope, 2)
      let hold: ReturnType<typeof createDeferred<void>> | undefined
      const pager = createCursorPager({
        queryClient: client,
        queryKey: key,
        staleTime: 100,
        fetchPage: async (cursor, signal) => {
          if (cursor === undefined) backend = createBackend(source, scope, 2)
          const page = await backend.fetchPage(cursor, signal)
          if (hold) await hold.promise
          return page
        },
      })
      try {
        await pager.read({ limit: 4 })
        const old = client.getQueryData(key)
        source = makeRows(6, 1)
        if (cause === `expiry`) vi.setSystemTime(1100)
        else await client.invalidateQueries({ queryKey: key })
        hold = createDeferred<void>()
        const error = new Error(`refresh failed`)
        const pending = pager
          .read({ limit: 4 })
          .catch((reason: unknown) => reason)
        await vi.waitFor(() => expect(client.isFetching()).toBe(1))
        expect(client.getQueryData(key)).toBe(old)
        hold.reject(error)
        expect(await pending).toBe(error)
        expect(client.getQueryData(key)).toBe(old)
        hold = undefined
        expect(await pager.read({ limit: 4 })).toEqual(
          expectedRows(source, scope, { offset: 0, limit: 4 }),
        )
      } finally {
        hold?.resolve()
        client.clear()
        vi.useRealTimers()
      }
    },
  )

  it(`shares acquisitions across readers without letting one abort cancel its peer`, async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      },
    })
    const backend = createBackend(makeRows(6), scope, 2)
    const hold = createDeferred<void>()
    const options = {
      queryClient: client,
      queryKey: [`shared`],
      fetchPage: async (cursor: string | undefined, signal: AbortSignal) => {
        const page = await backend.fetchPage(cursor, signal)
        await hold.promise
        return page
      },
    }
    const a = createCursorPager(options)
    const b = createCursorPager(options)
    const abort = new AbortController()
    const error = new Error(`reader left`)
    const pending = Promise.allSettled([
      a.read({ limit: 2 }, abort.signal),
      b.read({ limit: 4 }),
    ])
    try {
      await vi.waitFor(() => expect(backend.calls).toHaveLength(1))
      abort.abort(error)
      hold.resolve()
      expect(await pending).toEqual([
        { status: `rejected`, reason: error },
        {
          status: `fulfilled`,
          value: expectedRows(makeRows(6), scope, { offset: 0, limit: 4 }),
        },
      ])
      expect(backend.calls).toHaveLength(2)
    } finally {
      hold.resolve()
      await pending
      client.clear()
    }
  })
})
