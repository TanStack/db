import { createClient } from '@supabase/supabase-js'
import { IR, and, inArray, not } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { describe, expect, test, vi } from 'vitest'
import { MAX_URL_LENGTH, supabaseQueryFn } from '../src/functions'
import { loadSubsetOptionsToSearch } from '../src/postgrest-filters'
import {
  getRawUrls,
  getSearches,
  makePaginatingFetch,
} from './pagination.utils'
import { SUPABASE_KEY, SUPABASE_URL } from './test.utils'
import type { LoadSubsetOptions } from '@tanstack/db'

// Same table shape `makePaginatingFetch` was built for: a bare numeric `id`.
const idRef = new IR.PropRef<number>(['id'])

// The base table URL `supabaseQueryFn` measures every subset's rendered URL
// against (see `measureSubset` in src/functions.ts) — computed once here so
// `idsExceedingLength` can size an id list against the same budget the
// production splitter uses.
const BASE_URL_LENGTH = createClient(SUPABASE_URL, SUPABASE_KEY)
  .from('items')
  .url.toString().length

/**
 * A dense `1..n` id list whose rendered `in(...)` filter, combined with the
 * base table URL, is at least `minLength` characters — i.e. the URL a single,
 * unsplit request for this list would produce. Sized against `MAX_URL_LENGTH`
 * (rather than a hard-coded id count) so the tests below keep exercising the
 * splitter even if that constant ever changes.
 *
 * A small sample list's rendered length estimates the average per-id cost
 * (digits plus a percent-encoded comma); the list is then resized to that
 * estimate. One correction pass is always enough — the only thing the sample
 * can get wrong is the id width, which grows by at most a digit or two
 * between the sample and the final count.
 */
function idsExceedingLength(minLength: number): Array<number> {
  let count = 100
  for (let attempt = 0; attempt < 10; attempt++) {
    const ids = Array.from({ length: count }, (_, i) => i + 1)
    const length =
      BASE_URL_LENGTH +
      loadSubsetOptionsToSearch({
        where: inArray(idRef, ids),
      } as unknown as LoadSubsetOptions).toString().length
    if (length >= minLength) {
      return ids
    }
    const perId = (length - BASE_URL_LENGTH) / count
    count = Math.ceil((minLength - BASE_URL_LENGTH) / perId) + 10
  }
  throw new Error(`could not size an id list past ${minLength} characters`)
}

const runWhere = (
  mockFetch: ReturnType<typeof makePaginatingFetch> | typeof fetch,
  where: unknown,
  signal: AbortSignal = new AbortController().signal,
) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: mockFetch },
  })
  return supabaseQueryFn(supabase, 'items', {
    client: new QueryClient(),
    queryKey: ['items'],
    signal,
    meta: { loadSubsetOptions: { where } } as never,
  })
}

const run = (
  mockFetch: ReturnType<typeof makePaginatingFetch> | typeof fetch,
  ids: Array<number>,
  signal: AbortSignal = new AbortController().signal,
) => runWhere(mockFetch, inArray(idRef, ids), signal)

// The length of an `in(id, ids)` subset's first-page URL without its `?`: how
// `measureSubset` (src/functions.ts) used to measure it, before it counted the
// `?` and the `offset`/`limit` params later pages add.
const measuredLength = (ids: Array<number>): number =>
  BASE_URL_LENGTH +
  loadSubsetOptionsToSearch({
    where: inArray(idRef, ids),
  } as unknown as LoadSubsetOptions).toString().length

const FIVE_DIGIT_START = 10_000
const SIX_DIGIT_START = 100_000
const TRAILING_SIX_DIGIT_START = 200_000

/**
 * An id list whose leading ids measure *exactly* `targetLength` (per
 * `measuredLength`), followed by `trailing` more ids that cannot fit beside it
 * and so spill into later chunks. Deterministic: the list is dense 5-digit ids
 * up to the longest prefix within the target, then the last few of those are
 * widened to 6 digits (+1 character each) to close the remaining gap exactly.
 */
function idsPackedTo(targetLength: number, trailing = 5): Array<number> {
  let count = 1
  const fiveDigit = (n: number) =>
    Array.from({ length: n }, (_, i) => FIVE_DIGIT_START + i)
  while (measuredLength(fiveDigit(count + 1)) <= targetLength) {
    count++
  }
  const gap = targetLength - measuredLength(fiveDigit(count))
  const packed = fiveDigit(count).map((value, i) =>
    i >= count - gap ? SIX_DIGIT_START + i : value,
  )
  if (measuredLength(packed) !== targetLength) {
    throw new Error(`could not pack an id list to exactly ${targetLength}`)
  }
  const spill = Array.from(
    { length: trailing },
    (_, i) => TRAILING_SIX_DIGIT_START + i,
  )
  return [...packed, ...spill]
}

describe('supabaseQueryFn: chunked fan-out for an oversized IN list', () => {
  test('many ids produce multiple requests, every URL within budget, and every matching row comes back', async () => {
    const ids = idsExceedingLength(MAX_URL_LENGTH * 1.5)
    const fixture = ids.map((id) => ({ id }))
    const mockFetch = makePaginatingFetch(fixture)

    const rows = await run(mockFetch, ids)

    expect(
      (rows as Array<{ id: number }>).map((r) => r.id).sort((a, b) => a - b),
    ).toEqual(ids)
    const searches = getSearches(mockFetch)
    // The list does not fit in one request at this budget, so it was split.
    expect(searches.length).toBeGreaterThan(1)
    // Every request the mock saw actually carried an `in.(...)` slice of the
    // original list, proving the split happened on the `id` column.
    for (const search of searches) {
      expect(search).toMatch(/id=in\.\(/)
    }
    // Every rendered request line stays within the fixed budget.
    for (const rawUrl of getRawUrls(mockFetch)) {
      expect(rawUrl.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    }
  })

  test('splitting and the db-max-rows cap compose: a chunk larger than the cap still pages', async () => {
    const ids = idsExceedingLength(MAX_URL_LENGTH * 1.5)
    const fixture = ids.map((id) => ({ id }))
    // Small enough that each chunk (hundreds to low thousands of ids) needs
    // several pages, but not so small that the paging loop needs thousands of
    // requests to get through a chunk.
    const cap = 100
    const mockFetch = makePaginatingFetch(fixture, { cap })

    const rows = await run(mockFetch, ids)

    const returned = (rows as Array<{ id: number }>).map((r) => r.id)
    expect(returned.sort((a, b) => a - b)).toEqual(ids)
    expect(new Set(returned).size).toBe(ids.length)
    const searches = getSearches(mockFetch)
    // More requests than there are chunks: each chunk's own paging loop ran.
    expect(searches.length).toBeGreaterThan(2)
  })

  test('one failing chunk rejects the load and aborts its sibling requests', async () => {
    const ids = idsExceedingLength(MAX_URL_LENGTH * 3)
    // Any id lands in exactly one chunk (chunks are disjoint slices of the
    // sorted list), so failing whichever chunk holds this one exercises the
    // abort path without depending on how many chunks came out.
    const failId = ids[0]!
    let abortedCount = 0

    const failingFetch = vi
      .fn<typeof fetch>()
      .mockImplementation((input, init) => {
        const params = new URL(String(input)).searchParams
        const idFilter = params.get('id') ?? ''
        const members = idFilter
          .replace(/^in\.\(/, '')
          .replace(/\)$/, '')
          .split(',')
          .map(Number)
        // The chunk holding `failId` fails fast; every other chunk is slow
        // enough that the abort raised by the failure reaches it first.
        const isFailingChunk = members.includes(failId)
        const signal = init?.signal as AbortSignal | undefined

        return new Promise<Response>((resolve, reject) => {
          const settle = () => {
            if (isFailingChunk) {
              resolve(
                new Response(JSON.stringify({ message: 'boom' }), {
                  status: 500,
                  headers: { 'content-type': 'application/json' },
                }),
              )
              return
            }
            resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: {
                  'content-type': 'application/json',
                  'content-range': '*/0',
                },
              }),
            )
          }
          const timer = setTimeout(settle, isFailingChunk ? 0 : 50)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            abortedCount += 1
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })

    await expect(run(failingFetch, ids)).rejects.toBeDefined()
    // Give the aborted siblings' rejection handlers a turn to run.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(abortedCount).toBeGreaterThan(0)
  })

  test("concurrency never exceeds the fan-out's concurrency cap", async () => {
    // MAX_CONCURRENT_CHUNKS (src/functions.ts) is 6; size the list well past
    // that so the cap actually binds instead of every chunk fitting in one
    // wave.
    const ids = idsExceedingLength(MAX_URL_LENGTH * 10)
    const fixture = ids.map((id) => ({ id }))
    const base = makePaginatingFetch(fixture)

    let active = 0
    let peak = 0
    const trackedFetch = vi.fn<typeof fetch>(async (input, init) => {
      active += 1
      peak = Math.max(peak, active)
      // Yield so overlapping calls actually overlap instead of resolving
      // synchronously one at a time.
      await new Promise((resolve) => setTimeout(resolve, 5))
      try {
        return await base(input, init)
      } finally {
        active -= 1
      }
    })

    const rows = await run(trackedFetch, ids)

    expect((rows as Array<{ id: number }>).length).toBe(ids.length)
    const searches = getSearches(trackedFetch)
    // Sizing above actually produced more chunks than the concurrency cap.
    expect(searches.length).toBeGreaterThan(6)
    // MAX_CONCURRENT_CHUNKS in src/functions.ts.
    expect(peak).toBeLessThanOrEqual(6)
    // The cap should actually bind here — otherwise this test would not have
    // exercised the concurrency limiter at all.
    expect(peak).toBeGreaterThan(1)
  })

  test('an unsplittable not(in) keeps the subset oversized: one request, not one per value', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => i + 1)
    const hugeExcluded = Array.from({ length: 2000 }, (_, i) => `other-${i}`)
    const where = and(
      inArray(idRef, ids),
      not(inArray(new IR.PropRef<string>(['other']), hugeExcluded)),
    )
    // Precondition: the unsplit URL is over budget because of the `not(in)`.
    expect(
      BASE_URL_LENGTH +
        loadSubsetOptionsToSearch({
          where,
        } as unknown as LoadSubsetOptions).toString().length,
    ).toBeGreaterThan(MAX_URL_LENGTH)
    const mockFetch = makePaginatingFetch(ids.map((id) => ({ id })))

    const rows = await runWhere(mockFetch, where)

    expect((rows as Array<{ id: number }>).length).toBe(ids.length)
    // Splitting the small `id` list cannot shrink the URL, so the subset goes
    // out as-is, as a single request.
    expect(getSearches(mockFetch)).toHaveLength(1)
  })

  test('a chunk packed to exactly the URL limit stays within it (the `?` counts)', async () => {
    const ids = idsPackedTo(MAX_URL_LENGTH)
    const mockFetch = makePaginatingFetch(ids.map((id) => ({ id })))

    const rows = await run(mockFetch, ids)

    expect((rows as Array<{ id: number }>).length).toBe(ids.length)
    const rawUrls = getRawUrls(mockFetch)
    // The list was split, and one chunk measures exactly MAX_URL_LENGTH
    // without its `?`.
    expect(rawUrls.length).toBeGreaterThan(1)
    for (const rawUrl of rawUrls) {
      expect(rawUrl.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    }
  })

  test("paging a packed chunk keeps every page's URL, with offset and limit, within the limit", async () => {
    // One below the limit, so the first page's URL (with its `?`) is exactly
    // at it; later pages then add `&offset=...&limit=...` on top.
    const ids = idsPackedTo(MAX_URL_LENGTH - 1)
    const mockFetch = makePaginatingFetch(
      ids.map((id) => ({ id })),
      { cap: 100 },
    )

    const rows = await run(mockFetch, ids)

    expect((rows as Array<{ id: number }>).length).toBe(ids.length)
    const rawUrls = getRawUrls(mockFetch)
    // Pages past the first really were requested.
    expect(rawUrls.some((rawUrl) => rawUrl.includes('offset='))).toBe(true)
    for (const rawUrl of rawUrls) {
      expect(rawUrl.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    }
  })

  test("splitting and the key-order tiebreak compose: every page's URL, with the tiebreak, stays within the limit", async () => {
    // Long key columns make the tiebreak order a large part of every paged
    // URL, far wider than the slack the widest-offset measurement leaves, so a
    // budget that ignored the tiebreak would send over-long page requests.
    const keys = ['organization_identifier_column', 'id']
    const ids = idsExceedingLength(MAX_URL_LENGTH * 1.5)
    const fixture = ids.map((id) => ({
      id,
      organization_identifier_column: 1,
      rank: id % 3,
    }))
    const mockFetch = makePaginatingFetch(fixture, { cap: 100 })

    const rows = await supabaseQueryFn<{ id: number }>(
      createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: mockFetch },
      }),
      'items',
      {
        client: new QueryClient(),
        queryKey: ['items'],
        signal: new AbortController().signal,
        meta: {
          loadSubsetOptions: {
            where: inArray(idRef, ids),
            orderBy: [
              {
                expression: new IR.PropRef<number>(['rank']),
                compareOptions: {
                  direction: 'asc' as const,
                  nulls: 'last' as const,
                },
              },
            ],
          },
        } as never,
      },
      { keys },
    )

    // Every matching row comes back exactly once.
    expect(rows.map((row) => row.id).sort((a, b) => a - b)).toEqual(ids)
    const searches = getSearches(mockFetch)
    // The list was split, and its chunks paged past the cap.
    const pagedSearches = searches.filter((search) =>
      search.includes('offset='),
    )
    expect(pagedSearches.length).toBeGreaterThan(1)
    // Multi-page chunks are read in key order after the query's own order.
    for (const search of pagedSearches) {
      expect(search).toContain(
        'order=rank.asc,organization_identifier_column.asc,id.asc',
      )
    }
    for (const rawUrl of getRawUrls(mockFetch)) {
      expect(rawUrl.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    }
  })
})
