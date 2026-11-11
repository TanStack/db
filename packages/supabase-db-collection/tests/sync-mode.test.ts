import { createClient } from '@supabase/supabase-js'
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { supabaseCollectionOptions } from '../src/index'
import { getSearches, makePaginatingFetch } from './pagination.utils'
import {
  SUPABASE_KEY,
  SUPABASE_URL,
  createMockChannel,
  createMockFetch,
  createRealtimeUsersCollection,
  filtersFor,
} from './test.utils'

const itemsSchema = z.object({ id: z.number(), rank: z.number() })

const ROWS = [
  { id: 1, rank: 10 },
  { id: 2, rank: 20 },
  { id: 3, rank: 30 },
  { id: 4, rank: 40 },
  { id: 5, rank: 50 },
]

const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

function makeItemsCollection(
  mockFetch: ReturnType<typeof makePaginatingFetch>,
  syncMode?: 'on-demand' | 'eager',
) {
  const queryClient = new QueryClient()
  const collection = createCollection(
    supabaseCollectionOptions({
      tableName: 'items',
      keys: ['id'],
      schema: itemsSchema,
      supabase: createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: mockFetch },
      }),
      queryClient,
      syncMode,
    }),
  )
  cleanups.push(() => collection.cleanup())
  return { collection, queryClient }
}

describe('syncMode: eager', () => {
  test('fetches the whole table when the collection starts, paging past the server cap', async () => {
    const mockFetch = makePaginatingFetch(ROWS, { cap: 2 })
    const { collection } = makeItemsCollection(mockFetch, 'eager')

    await collection.preload()

    expect(collection.size).toBe(ROWS.length)
    // No subset params at all: no where/limit. The first read only sizes the
    // server cap; because more pages follow, they are read again ordered by the
    // key (the table is unordered, and offset paging needs a total order), with
    // the offset advancing by the rows received on each page.
    expect(getSearches(mockFetch)).toEqual([
      'select=*',
      'select=*&order=id.asc&offset=0&limit=2',
      'select=*&order=id.asc&offset=2&limit=2',
      'select=*&order=id.asc&offset=4&limit=1',
    ])
  })

  test('requests count=exact on the first page only', async () => {
    const mockFetch = makePaginatingFetch(ROWS, { cap: 2 })
    const { collection } = makeItemsCollection(mockFetch, 'eager')

    await collection.preload()

    const prefers = mockFetch.mock.calls.map((call) =>
      new Headers(call[1]?.headers).get('prefer'),
    )
    expect(prefers[0]).toContain('count=exact')
    for (const prefer of prefers.slice(1)) {
      expect(prefer ?? '').not.toContain('count=')
    }
  })

  test('live queries filter locally without issuing further requests', async () => {
    const mockFetch = makePaginatingFetch(ROWS)
    const { collection } = makeItemsCollection(mockFetch, 'eager')

    const live = createLiveQueryCollection((q) =>
      q.from({ item: collection }).where(({ item }) => gt(item.id, 3)),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()

    expect(live.toArray.map((item) => item.id).sort()).toEqual([4, 5])
    // Only the single eager fetch: the where clause is not pushed to PostgREST.
    expect(getSearches(mockFetch)).toEqual(['select=*'])
  })

  test('keys the query by table name alone, whatever the live queries ask for', async () => {
    const mockFetch = makePaginatingFetch(ROWS)
    const { collection, queryClient } = makeItemsCollection(mockFetch, 'eager')

    const live = createLiveQueryCollection((q) =>
      q.from({ item: collection }).where(({ item }) => eq(item.id, 2)),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()

    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([['items']])
  })

  test('mutations write through without refetching the table', async () => {
    const mockFetch = makePaginatingFetch(ROWS)
    const { collection } = makeItemsCollection(mockFetch, 'eager')
    await collection.preload()

    const tx = collection.insert({ id: 6, rank: 60 })
    await tx.when('settled')

    expect(collection.get('6')).toMatchObject({ id: 6, rank: 60 })
    expect(getSearches(mockFetch)).toEqual(['select=*'])
  })

  test('on-demand remains the default: the where clause is pushed to PostgREST', async () => {
    const mockFetch = makePaginatingFetch(ROWS)
    const { collection, queryClient } = makeItemsCollection(mockFetch)

    const live = createLiveQueryCollection((q) =>
      q.from({ item: collection }).where(({ item }) => gt(item.id, 3)),
    )
    cleanups.push(() => live.cleanup())
    await live.preload()

    expect(getSearches(mockFetch)).toEqual(['select=*&id=gt.3'])
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([['items', 'id=gt.3']])
  })

  describe('realtime', () => {
    test('subscribes to every change on the table even when filters are enabled', async () => {
      const mockFetch = createMockFetch()
      const mockChannel = createMockChannel()
      const { collection } = createRealtimeUsersCollection(
        mockFetch,
        mockChannel,
        { realtimeUseFilter: true, syncMode: 'eager' },
      )
      cleanups.push(() => collection.cleanup())

      const live = createLiveQueryCollection((q) =>
        q.from({ user: collection }).where(({ user }) => eq(user.id, 1)),
      )
      cleanups.push(() => live.cleanup())
      await live.preload()
      await vi.waitFor(() => expect(mockChannel.on).toHaveBeenCalled())

      expect(filtersFor(mockChannel, 'INSERT')).toEqual([null])
      expect(filtersFor(mockChannel, 'UPDATE')).toEqual([null])
      expect(filtersFor(mockChannel, 'DELETE')).toEqual([null])
    })
  })
})
