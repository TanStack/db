// @vitest-environment jsdom
import { QueryClient, hashKey } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { oraclePropertyOptions } from '../../db/tests/oracle-config.js'
import { createCursorPager, queryCollectionOptions } from '../src/index.js'

/**
 * # Do browser-facing readers release the right cursor work?
 *
 * A nested QueryCollection reader may cancel, be replaced, retry, or lose its
 * last owner while cursor pages are pending. Reader abort releases its queue;
 * it does not cancel a transport still owned by a peer. A replacement sequence
 * may satisfy the nested collection only after its own rows are authoritative.
 *
 * These jsdom histories cross real QueryClient cancellation and retry defaults,
 * QueryCollection preload, shared transports, manual writes, and cleanup. They
 * observe fetch status, errors, rows, calls, abort signals, and later recovery.
 * Native browser page ownership remains in the OPFS oracle.
 */

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
      },
    },
  })
const rowsFor = (size: number) =>
  Array.from({ length: size * 2 }, (_, id) => ({ id }))

describe(`cursor acquisition boundaries`, () => {
  it.each([false, true])(
    `nested row query settles when pages cancel; replacement=%s`,
    async (replace) => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (size) => {
          const client = makeClient()
          const rows = rowsFor(size)
          const key = [`resource`, `pages`]
          const entered = createDeferred<void>()
          const release = createDeferred<void>()
          let hold = true
          let version = 0
          const logged = vi.spyOn(console, `error`).mockImplementation(() => {})
          const options = {
            queryClient: client,
            queryKey: key,
            fetchPage: async (cursor: string | undefined) => {
              const page = {
                rows: rows
                  .slice(cursor ? size : 0, cursor ? rows.length : size)
                  .map((row) => ({ ...row, version })),
                nextCursor: cursor ? null : `next`,
              }
              if (cursor && hold) {
                entered.resolve()
                await release.promise
              }
              return page
            },
          }
          await createCursorPager(options).read({ limit: size })
          const collection = createCollection(
            queryCollectionOptions({
              queryClient: client,
              queryKey: [`resource`, `rows`],
              getKey: (row: { id: number; version: number }) => row.id,
              queryFn: () => createCursorPager(options).read({}),
            }),
          )
          const pending = collection.preload().then(
            () => ({ ok: true }),
            (error: unknown) => ({ ok: false, error }),
          )
          try {
            await entered.promise
            if (replace) {
              hold = false
              version = 1
              await client.refetchQueries({ queryKey: key, exact: true })
            } else await client.cancelQueries({ queryKey: key, exact: true })
            await tick()
            expect(
              client.getQueryState([`resource`, `rows`])?.fetchStatus,
            ).toBe(`idle`)
            const outcome = await pending
            expect(outcome.ok).toBe(replace)
            if (replace)
              expect(
                [...collection.values()].map(({ id, version: rowVersion }) => ({
                  id,
                  version: rowVersion,
                })),
              ).toEqual(rows.map((row) => ({ ...row, version: 1 })))
            else {
              expect(client.getQueryState([`resource`, `rows`])?.status).toBe(
                `error`,
              )
              if (!outcome.ok && `error` in outcome)
                expect((outcome.error as Error).name).toBe(`AbortError`)
            }
            expect(logged).toHaveBeenCalledTimes(replace ? 0 : 1)
          } finally {
            logged.mockRestore()
            release.resolve()
            await collection.cleanup()
            client.clear()
          }
        }),
        oraclePropertyOptions(30, `cursor-pagination.nested-cancellation`),
      )
    },
  )

  it(`reader abort releases its queue without canceling shared transport`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (size) => {
        const client = makeClient(),
          rows = rowsFor(size),
          entered = createDeferred<AbortSignal>(),
          release = createDeferred<void>()
        const pager = createCursorPager({
          queryClient: client,
          queryKey: [`abort`],
          fetchPage: async (cursor, signal) => {
            if (cursor) {
              entered.resolve(signal)
              await release.promise
            }
            return {
              rows: rows.slice(cursor ? size : 0, cursor ? rows.length : size),
              nextCursor: cursor ? null : `next`,
            }
          },
        })
        await pager.read({ limit: size })
        const abort = new AbortController(),
          reason = new Error(`reader left`)
        let state: unknown = `pending`
        const pending = pager.read({}, abort.signal).then(
          () => {
            state = `success`
          },
          (error) => {
            state = error
          },
        )
        try {
          const transport = await entered.promise
          abort.abort(reason)
          await tick()
          expect(state).toBe(reason)
          expect(transport.aborted).toBe(false)
          expect(await pager.read({ limit: size })).toEqual(rows.slice(0, size))
        } finally {
          release.resolve()
          await pending
          client.clear()
        }
      }),
      oraclePropertyOptions(30, `cursor-pagination.reader-abort`),
    )
  })

  it(`a fresh hit does not inherit another acquisition's same-turn cancellation`, async () => {
    const client = makeClient(),
      entered = createDeferred<void>(),
      release = createDeferred<void>()
    const key = [`hit`],
      rows = rowsFor(1)
    const options = {
      queryClient: client,
      queryKey: key,
      fetchPage: async (cursor: string | undefined) => {
        if (cursor) {
          entered.resolve()
          await release.promise
        }
        return {
          rows: [rows[cursor ? 1 : 0]!],
          nextCursor: cursor ? null : `next`,
        }
      },
    }
    await createCursorPager(options).read({ limit: 1 })
    const pending = createCursorPager(options)
      .read({})
      .catch(() => {})
    try {
      await entered.promise
      const hit = createCursorPager(options).read({ limit: 1 })
      void client.cancelQueries(
        { queryKey: key, exact: true },
        { revert: false },
      )
      expect(await hit).toEqual(rows.slice(0, 1))
    } finally {
      release.resolve()
      await pending
      client.clear()
    }
  })

  it.each([undefined, false, 1] as const)(
    `browser retry policy is the same across acquisition phases: %s`,
    async (retry) => {
      for (const phase of [`initial`, `growth`] as const) {
        const client = new QueryClient({
          defaultOptions: {
            queries: { gcTime: Infinity, staleTime: Infinity, retryDelay: 0 },
          },
        })
        if (retry !== undefined) client.setQueryDefaults([`retry`], { retry })
        let calls = 0
        const error = new Error(`page failed`)
        const pager = createCursorPager({
          queryClient: client,
          queryKey: [`retry`],
          fetchPage: (cursor) => {
            if (phase === `initial` || cursor !== undefined) {
              calls++
              return Promise.reject(error)
            }
            return Promise.resolve({ rows: [{ id: 0 }], nextCursor: `next` })
          },
        })
        try {
          await expect(pager.read({})).rejects.toBe(error)
          expect(calls).toBe(retry === 1 ? 2 : 1)
        } finally {
          client.clear()
        }
      }
    },
  )

  it(`supports an AbortSignal without throwIfAborted`, async () => {
    const client = makeClient(),
      abort = new AbortController(),
      rows = rowsFor(1)
    Object.defineProperty(abort.signal, `throwIfAborted`, { value: undefined })
    const pager = createCursorPager({
      queryClient: client,
      queryKey: [`compat`],
      fetchPage: () => Promise.resolve({ rows, nextCursor: null }),
    })
    try {
      expect(await pager.read({}, abort.signal)).toEqual(rows)
      abort.abort()
      await expect(pager.read({}, abort.signal)).rejects.toMatchObject({
        name: `AbortError`,
      })
    } finally {
      client.clear()
    }
  })

  it.each([`response`, `cache`] as const)(
    `invalid continuation rejects without spinning from %s`,
    async (origin) => {
      const client = makeClient(),
        key = [`invalid`]
      const invalid = { rows: rowsFor(1), nextCursor: undefined }
      const pager = createCursorPager({
        queryClient: client,
        queryKey: key,
        fetchPage: () =>
          Promise.resolve(
            invalid as unknown as {
              rows: Array<{ id: number }>
              nextCursor: null
            },
          ),
      })
      if (origin === `cache`)
        client.setQueryData(key, { pages: [invalid], pageParams: [undefined] })
      // A semantic work budget turns a microtask loop into a finite RED witness.
      let attempts = 0
      if (origin === `cache`) {
        const query = client
          .getQueryCache()
          .find({ queryKey: key, exact: true })!
        const run = query.fetch.bind(query)
        vi.spyOn(query, `fetch`).mockImplementation((...input) => {
          if (++attempts > 3) throw new Error(`loop budget exceeded`)
          return run(...input)
        })
      }
      try {
        await expect(pager.read({ limit: 10 })).rejects.toThrow(
          `Invalid cursor page`,
        )
        expect(attempts).toBeLessThanOrEqual(1)
      } finally {
        vi.restoreAllMocks()
        client.clear()
      }
    },
  )

  it(`fresh reads do not hash unrelated cached queries`, async () => {
    const client = makeClient()
    let hashes = 0
    client.setDefaultOptions({
      queries: {
        ...client.getDefaultOptions().queries,
        queryKeyHashFn: (key) => {
          hashes++
          return hashKey(key)
        },
      },
    })
    for (let index = 0; index < 100; index++)
      client.setQueryData([`unrelated`, index], index)
    const pager = createCursorPager({
      queryClient: client,
      queryKey: [`work`],
      fetchPage: () => Promise.resolve({ rows: rowsFor(1), nextCursor: null }),
    })
    try {
      await pager.read({})
      hashes = 0
      await pager.read({ limit: 1 })
      expect(hashes).toBeLessThan(10)
    } finally {
      client.clear()
    }
  })
})
