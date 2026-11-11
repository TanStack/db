import { QueryClient } from '@tanstack/query-core'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { oracleRoute } from '../../db/tests/oracle-config.js'
import {
  differs,
  oracleProperty,
  pass,
} from '../../db/tests/oracle-property.js'
import { createCursorPager } from '../src/index.js'
import { createBackend } from './cursor-pagination/backend.js'
import { expectedRows } from './cursor-pagination/model-oracle.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type { CursorPager } from '../src/index.js'
import type { Row } from './cursor-pagination/model-oracle.js'

/**
 * # When may cached cursor pages answer a later read?
 *
 * Cached pages belong to one query key and one immutable backend sequence.
 * Fresh reads may reuse them. Invalidation, expiry, or garbage collection
 * requires a new sequence for a later read. Cancellation stops the reader
 * without poisoning later work.
 *
 * A fake clock and real QueryClient drive those boundaries. The reference keeps
 * only the permitted source snapshot and freshness deadline; it does not model
 * Query pages, retryers, observers, or garbage collection. Every returned
 * window still compares with the full-relation value model.
 *
 * The cache contract comes from cursor-pagination/README.md and QueryClient's
 * public cache operations. The controlled backend holds each sequence stable;
 * this oracle does not establish snapshot behavior for changing HTTP endpoints.
 * Window values, cache publication, browser Query fetches, and QueryCollection
 * integration have separate owners in oracle-coverage.md.
 */

const scope = { group: undefined, descending: false }
const fixedSeed = 1_779_014
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

// The reference above still owns row truth. These native traces carry the
// same values, identity witnesses and request counts at the old checkpoints.
const cacheLaw = {
  authority: `cursor-pagination/README.md; QueryClient public cache operations`,
  limits: `Controlled immutable page sequences; no changing HTTP endpoint snapshot guarantee.`,
}
function checkCacheTrace(
  trace: ReadonlyArray<Observation>,
  expected: Readonly<Record<string, unknown>>,
): Verdict {
  let checked = 0
  for (const observation of trace) {
    if (observation.checkpoint.startsWith(`environment-fetch-`)) continue
    const verdict = differs(
      observation.checkpoint,
      `cursor cache lifecycle`,
      observation.value,
      expected[observation.checkpoint],
    )
    if (verdict) return verdict
    checked++
  }
  return (
    differs(
      `complete cache history`,
      `cursor cache lifecycle`,
      checked,
      Object.keys(expected).length,
    ) ?? pass
  )
}

describe(`cursor cache lifecycle`, () => {
  describe.each([
    [`global`, `maxPages`],
    [`global`, `select`],
    [`global`, `both`],
    [`key`, `maxPages`],
    [`key`, `select`],
    [`key`, `both`],
  ] as const)(`defaults %s %s`, (level, mode) => {
    oracleProperty({
      id: `cursor-pagination.defaults`,
      law: {
        ...cacheLaw,
        statement: `Inherited maxPages and select defaults cannot truncate a pager's requested window or move its offset origin.`,
      },
      // What this oracle owns: cache reuse, expiry, invalidation and cancellation of
      // the pager's Query pages (createCursorPager). Window values are judged by
      // checkWindow against the full-relation model.
      owns: [`src/cursor-pagination.ts#createCursorPager`],
      histories: {
        arbitrary: fc.tuple(
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 1, max: 3 }),
        ),
        runs: 50,
        fixedSeeds: [fixedSeed],
      },
      model: ([size, maxPages]) => {
        const rows = makeRows(size * (maxPages + 2))
        return {
          initial: expectedRows(rows, scope, { offset: 0, limit: size }),
          full: expectedRows(rows, scope, { offset: 0, limit: rows.length }),
          ...Object.fromEntries(
            [0, size, rows.length - 1].map((offset) => [
              `offset-${offset}`,
              expectedRows(rows, scope, { offset, limit: size }),
            ]),
          ),
          refreshed: expectedRows(makeRows(rows.length, 1), scope, {
            offset: 0,
            limit: rows.length,
          }),
        }
      },
      driver: async ([size, maxPages], observe) => {
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
            if (cursor === undefined) backend = createBackend(rows, scope, size)
            return backend.fetchPage(cursor, signal)
          },
        })
        try {
          observe(`initial`, await pager.read({ limit: size }))
          observe(`full`, await pager.read({ limit: rows.length }))
          // Growing must not move the origin of later offset reads.
          for (const offset of [0, size, rows.length - 1]) {
            const window = { offset, limit: size }
            observe(`offset-${offset}`, await pager.read(window))
          }
          rows = makeRows(rows.length, 1)
          await client.invalidateQueries({ queryKey: key })
          observe(`refreshed`, await pager.read({ limit: rows.length }))
        } finally {
          client.clear()
        }
      },
      check: (_history, trace, expected) => checkCacheTrace(trace, expected),
    })
  })

  describe.each([`initial`, `growth`, `refresh`] as const)(
    `cancel %s`,
    (phase) => {
      oracleProperty({
        id: `cursor-pagination.cancellation`,
        law: {
          ...cacheLaw,
          statement: `Cancellation rejects held readers and fences late delivery while preserving cached rows and later recovery.`,
        },
        owns: [`src/cursor-pagination.ts#createCursorPager`],
        histories: {
          arbitrary: fc.tuple(
            fc.integer({ min: 1, max: 4 }),
            fc.integer({ min: 1, max: 3 }),
          ),
          runs: 50,
          fixedSeeds: [fixedSeed],
        },
        model: ([size, depth]) => {
          const rows = makeRows(size * (depth + 2))
          return {
            ...(phase !== `initial`
              ? {
                  initial: expectedRows(rows, scope, {
                    offset: 0,
                    limit: size * (depth + 1),
                  }),
                }
              : {}),
            ...(phase === `growth`
              ? {
                  'cached-peer': expectedRows(rows, scope, {
                    offset: 0,
                    limit: size,
                  }),
                }
              : {}),
            aborted: true,
            outcomes: [
              { status: `rejected`, errorName: `AbortError` },
              { status: `rejected`, errorName: `AbortError` },
            ],
            'replacement-transport': 0,
            'cache-before-delivery': true,
            'cache-after-delivery': true,
            recovered: expectedRows(
              makeRows(rows.length, phase === `refresh` ? 1 : 0),
              scope,
              { offset: 0, limit: rows.length },
            ),
          }
        },
        driver: async ([size, depth], observe) => {
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
          const delivered = createDeferred<void>()
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
                delivered.resolve()
              }
              return page
            },
          }
          const pager = createCursorPager(options)
          try {
            if (phase !== `initial`) {
              observe(
                `initial`,
                await pager.read({ limit: size * (depth + 1) }),
              )
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
              // peer's deeper Query fetch, even though they share a key.
              observe(
                `cached-peer`,
                await createCursorPager(options).read({ limit: size }),
              )
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
            // microtasks the peer takes to reach the Query fetch boundary.
            await joined.promise
            joinWitness.mockRestore()
            await client.cancelQueries({ queryKey: key, exact: true })
            observe(`aborted`, signal.aborted)
            observe(
              `outcomes`,
              (await Promise.all([pending, peer])).map((result) => ({
                status: result.status,
                ...(result.status === `rejected`
                  ? { errorName: (result.reason as Error | undefined)?.name }
                  : {}),
              })),
            )
            observe(`replacement-transport`, calls - holdAt)
            observe(
              `cache-before-delivery`,
              client.getQueryData(key) === previous,
            )
            hold.resolve()
            await delivered.promise
            await new Promise((resolve) => setTimeout(resolve, 0))
            observe(
              `cache-after-delivery`,
              client.getQueryData(key) === previous,
            )
            observe(`recovered`, await pager.read({ limit: rows.length }))
          } finally {
            hold.resolve()
            client.clear()
          }
        },
        check: (_history, trace, expected) => checkCacheTrace(trace, expected),
      })
    },
  )

  it(`the cache oracle rejects reuse after invalidation and accepts a real refresh`, async () => {
    oracleRoute(`calibration`)
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
          client
            .getQueryCache()
            .find({ queryKey: key, exact: true })!
            .setState({ isInvalidated: false })
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

  it(`reuses a cache one millisecond before expiry and refreshes at expiry`, async () => {
    oracleRoute(`case`)
    // A 99 ms cutoff refetches too soon; a 101 ms cutoff reuses stale rows.
    vi.useFakeTimers({ toFake: [`Date`] })
    vi.setSystemTime(1000)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const key = [`expiry-edge`]
    const initial = makeRows(2)
    let source = initial
    let calls = 0
    const pager = createCursorPager({
      queryClient: client,
      queryKey: key,
      staleTime: 100,
      fetchPage: () => {
        calls++
        return Promise.resolve({ rows: source, nextCursor: null })
      },
    })
    try {
      await checkWindow(pager, initial, 2)
      source = makeRows(2, 1)
      vi.setSystemTime(1099)
      await checkWindow(pager, initial, 2)
      expect(calls).toBe(1)
      vi.setSystemTime(1100)
      await checkWindow(pager, source, 2)
      expect(calls).toBe(2)
    } finally {
      client.clear()
      vi.useRealTimers()
    }
  })

  it(`QueryClient cancellation rejects held work without installing its late page`, async () => {
    oracleRoute(`case`)
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: Infinity, gcTime: Infinity, retry: false },
      },
    })
    const key = [`cancel`]
    const hold = createDeferred<void>()
    const delivered = createDeferred<void>()
    let deliveredSignal: AbortSignal | undefined
    let holdResponse = true
    const rows = makeRows(2)
    const pager = createCursorPager({
      queryClient: client,
      queryKey: key,
      fetchPage: async (_cursor, signal) => {
        deliveredSignal = signal
        if (holdResponse) {
          await hold.promise
          delivered.resolve()
        }
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
      await delivered.promise
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(client.getQueryData(key)).toBeUndefined()
      holdResponse = false
      await checkWindow(pager, rows, 2)
    } finally {
      hold.resolve()
      await pending
      client.clear()
    }
  })

  oracleProperty({
    id: `cursor-pagination.cache`,
    law: {
      ...cacheLaw,
      statement: `Immutable pages are reused until invalidation, removal or freshness expiry; returned windows follow the permitted source snapshot.`,
    },
    owns: [`src/cursor-pagination.ts#createCursorPager`],
    histories: {
      arbitrary: fc.tuple(
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
      ),
      runs: 100,
      fixedSeeds: [fixedSeed],
    },
    model: ([count, size, actions], trace) => {
      let now = 1000
      let deadline = 0
      let width = 1
      let version = 0
      let expectedVersion = 0
      let cached = false
      let readIndex = 0
      const expected: Record<string, unknown> = {}
      for (const action of [`read`, ...actions]) {
        if (action === `change`) {
          version++
          continue
        }
        if (action === `age`) {
          now += 100
          continue
        }
        if (action === `invalidate`) {
          deadline = 0
          continue
        }
        if (action === `remove`) {
          cached = false
          continue
        }
        if (action === `grow`) width += size
        const refresh = !cached || now >= deadline
        if (refresh) expectedVersion = version
        const rows = expectedRows(makeRows(count, expectedVersion), scope, {
          offset: 0,
          limit: width,
        })
        expected[`read-${readIndex}`] = { rows, starts: refresh ? 1 : 0 }
        const fetched = trace.find(
          ({ checkpoint }) => checkpoint === `environment-fetch-${readIndex}`,
        )?.value
        if (fetched) deadline = now + 100
        cached = true
        expected[`repeat-${readIndex}`] = { rows, calls: 0 }
        readIndex++
      }
      return expected
    },
    driver: async ([count, size, actions], observe) => {
      vi.useFakeTimers({ toFake: [`Date`] })
      try {
        let now = 1000
        vi.setSystemTime(now)
        const client = new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        })
        let source = makeRows(count)
        let width = 1
        let version = 0
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
        let readIndex = 0
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
              continue
            }
            if (action === `remove`) {
              client.removeQueries({ queryKey: key })
              continue
            }
            if (action === `grow`) width += size
            const beforeCalls = calls
            const beforeStarts = starts
            const window = { offset: 0, limit: width }
            observe(`read-${readIndex}`, {
              rows: await pager.read({ limit: width }),
              starts: starts - beforeStarts,
            })
            // A successful provider fetch is a controlled environment
            // event. The existing reference's freshness deadline starts
            // there, including a successful growth fetch.
            observe(`environment-fetch-${readIndex}`, calls !== beforeCalls)
            const settledCalls = calls
            observe(`repeat-${readIndex}`, {
              rows: await pager.read(window),
              calls: calls - settledCalls,
            })
            readIndex++
          }
        } finally {
          client.clear()
        }
      } finally {
        vi.useRealTimers()
      }
    },
    check: (_history, trace, expected) => checkCacheTrace(trace, expected),
  })

  it.each([0, 25])(
    `collects inactive pages independently of freshness with gcTime %i`,
    async (gcTime) => {
      oracleRoute(`case`)
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
        // The 25 ms case rejects a cutoff moved one millisecond either way.
        if (gcTime > 0) {
          await vi.advanceTimersByTimeAsync(gcTime - 1)
          expect(client.getQueryData(key)).toBeDefined()
        }
        await vi.advanceTimersByTimeAsync(1)
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
      oracleRoute(`case`)
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

  it(`shares Query fetches across readers without letting one abort cancel its peer`, async () => {
    oracleRoute(`case`)
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
