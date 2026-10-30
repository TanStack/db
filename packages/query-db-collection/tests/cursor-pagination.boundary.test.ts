// @vitest-environment jsdom
// Ordinary tests for cursor Query fetch boundaries: a fresh hit beside a same-turn
// cancellation, retry policy, AbortSignal compatibility, invalid continuations,
// and hash work. The cursor boundary law (nested cancellation and reader abort)
// is owned by cursor-pagination.boundary-oracle.test.ts.
import { QueryClient, hashKey } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { createCursorPager } from '../src/index.js'
import { makeClient, rowsFor } from './cursor-pagination-boundary-support.js'

describe(`cursor Query fetch boundaries`, () => {
  it(`a fresh hit does not inherit another Query fetch's same-turn cancellation`, async () => {
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
    `browser retry policy is the same across Query fetch phases: %s`,
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
