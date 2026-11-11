import { createClient } from '@supabase/supabase-js'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  createLiveQueryWindowController,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { supabaseQueryFn } from '../src/functions'
import { supabaseCollectionOptions } from '../src/index'
import { getSearches, makePaginatingFetch } from './pagination.utils'
import { SUPABASE_KEY, SUPABASE_URL } from './test.utils'

// A live infinite query (`useLiveInfiniteQuery`) is, without React, a
// `createLiveQueryWindowController` over an ordered+limited live query. Growing
// the window makes core hand the adapter keyset `LoadSubsetOptions.cursor`s,
// which is the path these tests exercise end to end against a mocked PostgREST.
//
// NOTE — two kinds of `<col>=eq.<boundary>` reads appear below:
//   1. Boundary probe: core's `OrderedSourceLoader.loadBoundary()` issues
//      `requestSnapshot({ where: eq(col, boundary) })` — where only, no order,
//      no limit — to settle the peek row that decides `hasNextPage`. The adapter
//      renders it `select=*&<col>=eq.<b>`.
//   2. `whereCurrent` tie read: the adapter's `supabaseQueryFn` emits it when
//      `LoadSubsetOptions.cursor` is set, paired with the `gt`/`lt` keyset read.
//      It is ordered and unlimited (`select=*&order=...&<col>=eq.<b>`) so every
//      row tied at the boundary loads even when the tie class exceeds the page.
// In the window path these overlap: the boundary probe already pulls the full
// tie class before the `whereCurrent` read runs, so the tie class is fetched
// twice. The adapter must still emit `whereCurrent` — it honors the cursor
// contract and cannot assume the boundary probe ran (`loadBoundary` skips when
// the boundary value is unchanged, falls back to a full-source load for
// non-keyset orders, and never runs for `loadSubset({ cursor })` calls outside
// the window path). Collapsing the duplication is core's call, not the adapter's.

const itemsSchema = z.object({ id: z.number(), rank: z.number() })

// rank has a tie class (20) spanning ids 2–4 that straddles the first page.
const FIXTURE = [
  { id: 1, rank: 10 },
  { id: 2, rank: 20 },
  { id: 3, rank: 20 },
  { id: 4, rank: 20 },
  { id: 5, rank: 30 },
  { id: 6, rank: 40 },
]

/** A Supabase-backed source collection over the paginating mock. */
function makeCollection(mockFetch: ReturnType<typeof makePaginatingFetch>) {
  return createCollection(
    supabaseCollectionOptions({
      tableName: 'items',
      keys: ['id'],
      schema: itemsSchema,
      supabase: createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: mockFetch },
      }),
    }),
  )
}

/** Wrap a live query in a window controller with an active subscriber. */
function windowController(
  live: ReturnType<typeof createLiveQueryCollection>,
  cleanups: Array<() => void>,
  pageSize: number,
) {
  const controller = createLiveQueryWindowController(live, { pageSize })
  // A subscriber activates the window lease so pages actually load.
  const unsub = controller.subscribe(() => {})
  cleanups.push(() => {
    unsub()
    controller.dispose()
    live.cleanup()
  })
  return controller
}

const ids = (snapshot: { data: ReadonlyArray<unknown> }) =>
  snapshot.data.map((row) => (row as { id: number }).id)

describe('live infinite query (windowed) pagination', () => {
  let collection: ReturnType<typeof makeCollection>
  let mockFetch: ReturnType<typeof makePaginatingFetch>
  const cleanups: Array<() => void> = []

  beforeEach(() => {
    mockFetch = makePaginatingFetch(FIXTURE)
    collection = makeCollection(mockFetch)
    cleanups.push(() => {
      collection.cleanup()
    })
  })

  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      cleanup()
    }
  })

  test('fetches a single page without a keyset cursor', async () => {
    const live = createLiveQueryCollection((q) =>
      q
        .from({ item: collection })
        .orderBy(({ item }) => item.id)
        .limit(2),
    )
    const controller = windowController(live, cleanups, 2)

    await controller.preload()
    const snapshot = controller.getSnapshot()
    // One committed page of `pageSize`, with more rows available.
    expect(snapshot.pages.map((page) => page.map((row) => row.id))).toEqual([
      [1, 2],
    ])
    expect(ids(snapshot)).toEqual([1, 2])
    expect(snapshot.hasNextPage).toBe(true)

    // The first page is a plain ordered window (one peek row past the page)
    // plus core's boundary probe — no keyset cursor (`gt`) and no offset yet.
    expect(getSearches(mockFetch)).toEqual([
      'select=*&order=id.asc.nullsfirst&limit=3', // window + 1 peek row
      'select=*&id=eq.3', // boundary probe (loadBoundary) settles the peek
    ])
  })

  test('grows the window with a keyset cursor and never an offset', async () => {
    const live = createLiveQueryCollection((q) =>
      q
        .from({ item: collection })
        .orderBy(({ item }) => item.id)
        .limit(2),
    )
    const controller = windowController(live, cleanups, 2)

    await controller.preload()
    expect(ids(controller.getSnapshot())).toEqual([1, 2])

    await controller.fetchNextPage()
    // Page 1 rows are preserved and the result is a contiguous ordered prefix.
    expect(ids(controller.getSnapshot())).toEqual([1, 2, 3, 4])

    // The exact PostgREST reads the flow emits. The next page is a keyset
    // request from the boundary (id 3): ordered, limited, and — crucially —
    // with no offset re-skipping rows. No request carries an offset.
    expect(getSearches(mockFetch)).toEqual([
      'select=*&order=id.asc.nullsfirst&limit=3', // page 1: window + 1 peek row
      'select=*&id=eq.3', // boundary probe (loadBoundary) settles the peek
      'select=*&order=id.asc.nullsfirst&id=eq.3', // page 2: whereCurrent tie read
      'select=*&order=id.asc.nullsfirst&limit=2&id=gt.3', // page 2: whereFrom keyset read
      'select=*&id=eq.5', // boundary probe for the next peek
    ])
  })

  test('fetches the full boundary tie class so no tied row is skipped', async () => {
    const live = createLiveQueryCollection((q) =>
      q
        .from({ item: collection })
        .orderBy(({ item }) => item.rank)
        .limit(2),
    )
    const controller = windowController(live, cleanups, 2)

    await controller.preload()
    expect(ids(controller.getSnapshot())).toEqual([1, 2])

    await controller.fetchNextPage()
    const result = ids(controller.getSnapshot())
    // The whole rank-20 tie class (ids 2–4) is loaded even though id 4 sits
    // beyond page 1's peek, so the window stays a contiguous ordered prefix
    // with no gaps and no duplicates.
    expect(result).toContain(4)
    expect(result).toEqual([1, 2, 3, 4])
    expect(new Set(result).size).toBe(result.length)

    // Same boundary values (rank 20) exercise `whereCurrent`. This test locks
    // the shape the adapter must emit: the tie read (3rd) keeps the order,
    // filters to the boundary with `eq`, and has no limit; the keyset read (4th)
    // advances strictly past the boundary with `gt`; neither carries an offset.
    // (Here id 4 is in fact already loaded by the boundary probe — 2nd read,
    // `rank=eq.20`, no order — which makes the `whereCurrent` read redundant in
    // the window path; see the module note. The adapter emits it regardless
    // because it honors the cursor contract.)
    expect(getSearches(mockFetch)).toEqual([
      'select=*&order=rank.asc.nullsfirst&limit=3', // page 1: window + 1 peek row
      'select=*&rank=eq.20', // boundary probe (loadBoundary): full tie class
      'select=*&order=rank.asc.nullsfirst&rank=eq.20', // page 2: whereCurrent tie read
      'select=*&order=rank.asc.nullsfirst&limit=1&rank=gt.20', // page 2: whereFrom keyset read
      'select=*&rank=eq.30', // boundary probe for the next peek
    ])
  })
})

// A collection load with no windowing (a plain subscribe)
// issues a single `supabaseQueryFn` call that must return the FULL matching set,
// looping past PostgREST's `db-max-rows` cap instead of truncating at it.
describe('db-max-rows paging loop (supabaseQueryFn)', () => {
  // Ordered fixture the capped mock pages through.
  const ROWS = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]

  const ORDER_BY = [
    {
      expression: new IR.PropRef<number>(['id']),
      compareOptions: { direction: 'asc' as const, nulls: 'last' as const },
    },
  ]

  const prefer = (call: Array<unknown>): string =>
    new Headers((call[1] as RequestInit | undefined)?.headers).get('prefer') ??
    ''

  const run = (
    mockFetch: ReturnType<typeof makePaginatingFetch>,
    loadSubsetOptions: Record<string, unknown>,
    signal: AbortSignal = new AbortController().signal,
  ) => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { fetch: mockFetch },
    })
    return supabaseQueryFn(supabase, 'items', {
      client: new QueryClient(),
      queryKey: ['items'],
      signal,
      meta: { loadSubsetOptions } as never,
    })
  }

  test('pages through the whole set when it exceeds the server cap', async () => {
    const mockFetch = makePaginatingFetch(ROWS, { cap: 2 })
    const rows = await run(mockFetch, { orderBy: ORDER_BY })

    // Every row returned exactly once, in order.
    expect((rows as Array<{ id: number }>).map((r) => r.id)).toEqual([
      1, 2, 3, 4, 5,
    ])
    // The first request has no artificial page-size limit — the cap sizes it —
    // and each later page advances the offset by the rows received, capped by
    // the rows still owed (the last page asks for just 1).
    expect(getSearches(mockFetch)).toEqual([
      'select=*&order=id.asc.nullslast',
      'select=*&order=id.asc.nullslast&offset=2&limit=2',
      'select=*&order=id.asc.nullslast&offset=4&limit=1',
    ])
  })

  test('requests count=exact on the first page only', async () => {
    const mockFetch = makePaginatingFetch(ROWS, { cap: 2 })
    await run(mockFetch, { orderBy: ORDER_BY })

    const prefers = mockFetch.mock.calls.map(prefer)
    expect(prefers[0]).toContain('count=exact')
    for (const p of prefers.slice(1)) {
      expect(p).not.toContain('count=')
    }
  })

  test('an exact multiple of the cap needs no trailing empty request', async () => {
    const mockFetch = makePaginatingFetch(ROWS.slice(0, 4), { cap: 2 })
    const rows = await run(mockFetch, { orderBy: ORDER_BY })

    expect((rows as Array<{ id: number }>).map((r) => r.id)).toEqual([
      1, 2, 3, 4,
    ])
    // Two requests, not three: the count tells the loop it is done at offset 4.
    expect(getSearches(mockFetch)).toEqual([
      'select=*&order=id.asc.nullslast',
      'select=*&order=id.asc.nullslast&offset=2&limit=2',
    ])
  })

  test('a caller offset counts against the total: no trailing empty request', async () => {
    // Six rows, offset 2, cap 2: rows 3-4 then 5-6 — the count (6) minus the
    // offset (2) tells the loop it is done after two requests, not three.
    const SIX = [...ROWS, { id: 6 }]
    const mockFetch = makePaginatingFetch(SIX, { cap: 2 })
    const rows = await run(mockFetch, { orderBy: ORDER_BY, offset: 2 })

    expect((rows as Array<{ id: number }>).map((r) => r.id)).toEqual([
      3, 4, 5, 6,
    ])
    expect(getSearches(mockFetch)).toEqual([
      'select=*&order=id.asc.nullslast&offset=2',
      'select=*&order=id.asc.nullslast&offset=4&limit=2',
    ])
  })

  test('a set within the cap is a single request', async () => {
    const mockFetch = makePaginatingFetch(ROWS.slice(0, 2), { cap: 2 })
    const rows = await run(mockFetch, { orderBy: ORDER_BY })

    expect((rows as Array<{ id: number }>).map((r) => r.id)).toEqual([1, 2])
    expect(getSearches(mockFetch)).toEqual(['select=*&order=id.asc.nullslast'])
  })

  test('the loop owns limit: a caller limit above the cap still pages', async () => {
    const mockFetch = makePaginatingFetch(ROWS, { cap: 2 })
    const rows = await run(mockFetch, { orderBy: ORDER_BY, limit: 3 })

    // Exactly the caller's 3 rows, fetched across cap-sized pages.
    expect((rows as Array<{ id: number }>).map((r) => r.id)).toEqual([1, 2, 3])
    expect(getSearches(mockFetch)).toEqual([
      'select=*&order=id.asc.nullslast&limit=3',
      'select=*&order=id.asc.nullslast&limit=1&offset=2',
    ])
  })

  describe('rows tied on the requested order', () => {
    type TiedRow = { id: number; rank: number }

    // Every request orders the tied rows differently, like Postgres may when a
    // top-N sort runs with a different limit and offset. Only an order that
    // also sorts by the unique `id` pins one position per row.
    const makeTieShufflingFetch = (fixture: Array<TiedRow>, cap: number) => {
      let requestCount = 0
      return vi.fn<typeof fetch>().mockImplementation((input) => {
        requestCount += 1
        const params = new URL(String(input)).searchParams
        const columns = (params.get('order') ?? '')
          .split(',')
          .filter(Boolean)
          .map((sort) => sort.split('.')[0] as keyof TiedRow)
        const arrival =
          requestCount % 2 === 0 ? [...fixture].reverse() : [...fixture]
        const rows = arrival.sort((a, b) => {
          for (const column of columns) {
            if (a[column] !== b[column]) return a[column] - b[column]
          }
          return 0
        })
        const offset = Number(params.get('offset') ?? 0)
        const page = rows.slice(offset, offset + cap)
        return Promise.resolve(
          new Response(JSON.stringify(page), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'content-range': `${offset}-${offset + page.length - 1}/${rows.length}`,
            },
          }),
        )
      })
    }

    const TIED: Array<TiedRow> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 1 },
      { id: 3, rank: 1 },
      { id: 4, rank: 1 },
      { id: 5, rank: 2 },
      { id: 6, rank: 2 },
    ]
    const RANK_ORDER = [
      {
        expression: new IR.PropRef<number>(['rank']),
        compareOptions: { direction: 'asc' as const, nulls: 'last' as const },
      },
    ]

    const readTied = (
      mockFetch: ReturnType<typeof makeTieShufflingFetch>,
      keys: Array<string>,
      loadSubsetOptions: Record<string, unknown> = { orderBy: RANK_ORDER },
    ) =>
      supabaseQueryFn<TiedRow>(
        createClient(SUPABASE_URL, SUPABASE_KEY, {
          global: { fetch: mockFetch },
        }),
        'items',
        {
          client: new QueryClient(),
          queryKey: ['items'],
          signal: new AbortController().signal,
          meta: { loadSubsetOptions } as never,
        },
        { keys },
      )

    test('without key order the shuffled pages repeat and skip rows', async () => {
      // Control for the model below: with no key to order by, the reads this
      // mock serves are exactly the unstable ones the key order exists to fix.
      const rows = await readTied(makeTieShufflingFetch(TIED, 2), [])

      expect(new Set(rows.map((row) => row.id)).size).toBeLessThan(TIED.length)
    })

    test('pages ordered by the key return each tied row exactly once', async () => {
      const rows = await readTied(makeTieShufflingFetch(TIED, 2), ['id'])

      expect(rows.map((row) => row.id).sort()).toEqual([1, 2, 3, 4, 5, 6])
    })

    test('the first page is read again under the key order when more pages follow', async () => {
      const mockFetch = makeTieShufflingFetch(TIED, 2)
      await readTied(mockFetch, ['id'])

      expect(getSearches(mockFetch)).toEqual([
        'select=*&order=rank.asc.nullslast',
        'select=*&order=rank.asc.nullslast,id.asc&offset=0&limit=2',
        'select=*&order=rank.asc.nullslast,id.asc&offset=2&limit=2',
        'select=*&order=rank.asc.nullslast,id.asc&offset=4&limit=2',
      ])
    })

    test('an unordered read is paged in key order', async () => {
      const mockFetch = makeTieShufflingFetch(TIED, 2)
      const rows = await readTied(mockFetch, ['id'], {})

      expect(rows.map((row) => row.id).sort()).toEqual([1, 2, 3, 4, 5, 6])
      expect(getSearches(mockFetch).slice(1)).toEqual([
        'select=*&order=id.asc&offset=0&limit=2',
        'select=*&order=id.asc&offset=2&limit=2',
        'select=*&order=id.asc&offset=4&limit=2',
      ])
    })

    test('every key column missing from the order is appended', async () => {
      const mockFetch = makeTieShufflingFetch(TIED, 2)
      await readTied(mockFetch, ['rank', 'id'])

      // `rank` is already sorted by, so only `id` is added.
      expect(getSearches(mockFetch)[1]).toBe(
        'select=*&order=rank.asc.nullslast,id.asc&offset=0&limit=2',
      )
    })

    test('a set within one page is read once, as asked', async () => {
      const mockFetch = makeTieShufflingFetch(TIED.slice(0, 2), 2)
      await readTied(mockFetch, ['id'])

      expect(getSearches(mockFetch)).toEqual([
        'select=*&order=rank.asc.nullslast',
      ])
    })
  })

  test('limit: 0 returns an empty set with zero requests', async () => {
    const mockFetch = makePaginatingFetch(ROWS, { cap: 2 })
    const rows = await run(mockFetch, { orderBy: ORDER_BY, limit: 0 })

    expect(rows).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('threads the abort signal to every request', async () => {
    const mockFetch = makePaginatingFetch(ROWS, { cap: 2 })
    const signal = new AbortController().signal
    await run(mockFetch, { orderBy: ORDER_BY }, signal)

    expect(mockFetch.mock.calls.length).toBeGreaterThan(1)
    for (const call of mockFetch.mock.calls) {
      expect((call[1] as RequestInit).signal).toBe(signal)
    }
  })

  test('one failed page fails the whole load (no partial data)', async () => {
    let calls = 0
    const failingFetch = vi.fn<typeof fetch>().mockImplementation(() => {
      calls += 1
      if (calls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'content-range': '0-1/5',
            },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ message: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { fetch: failingFetch },
    })

    await expect(
      supabaseQueryFn(supabase, 'items', {
        client: new QueryClient(),
        queryKey: ['items'],
        signal: new AbortController().signal,
        meta: { loadSubsetOptions: { orderBy: ORDER_BY } } as never,
      }),
    ).rejects.toBeDefined()
  })
})
