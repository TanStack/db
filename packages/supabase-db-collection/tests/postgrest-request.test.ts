import { PostgrestError } from '@supabase/postgrest-js'
import { createClient } from '@supabase/supabase-js'
import { IR, and, eq, gt } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { describe, expect, test, vi } from 'vitest'
import { subsetOptionsToQueryKey, supabaseQueryFn } from '../src/functions'
import { postgrestRequest } from '../src/postgrest-request'
import { SUPABASE_KEY, SUPABASE_URL, createMockFetch } from './test.utils'

describe('request-state escape hatch', () => {
  // supabase-js changing these fields would silently drop auth; fail loudly.
  test('supabase.from(table) exposes url, headers, and fetch', () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const qb = supabase.from('users')
    expect(qb.url).toBeInstanceOf(URL)
    expect(qb.url.toString()).toBe(`${SUPABASE_URL}/rest/v1/users`)
    expect(qb.headers).toBeInstanceOf(Headers)
    expect(typeof qb.fetch).toBe('function')
  })
})

describe('query key matches request URL', () => {
  test('the cache key encodes the same filters as the sent request', async () => {
    const name = new IR.PropRef<string>(['name'])
    const id = new IR.PropRef<number>(['id'])
    const where = and(eq(name, 'Alice&x=1'), gt(id, 3))

    const [, keyString] = subsetOptionsToQueryKey('users', { where })

    const mockFetch = createMockFetch()
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { fetch: mockFetch },
    })
    await supabaseQueryFn(supabase, 'users', {
      client: new QueryClient(),
      queryKey: ['users'],
      signal: new AbortController().signal,
      meta: { loadSubsetOptions: { where } },
    })
    const sent = new URL(String(mockFetch.mock.calls[0]?.[0])).searchParams
    sent.delete('select')
    // Every filter param in the key is present verbatim in the request.
    for (const [key, value] of new URLSearchParams(keyString)) {
      expect(sent.getAll(key)).toContain(value)
    }
  })
})

describe('cursor pagination fetches boundary ties', () => {
  test('a cursor load issues an unlimited tie request and a limited keyset request', async () => {
    const id = new IR.PropRef<number>(['id'])
    const mockFetch = createMockFetch()
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { fetch: mockFetch },
    })

    await supabaseQueryFn(supabase, 'users', {
      client: new QueryClient(),
      queryKey: ['users'],
      signal: new AbortController().signal,
      meta: {
        loadSubsetOptions: {
          orderBy: [
            {
              expression: id,
              compareOptions: { direction: 'asc', nulls: 'last' },
            },
          ],
          limit: 20,
          cursor: { whereFrom: gt(id, 40), whereCurrent: eq(id, 40) },
        },
      },
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const urls = mockFetch.mock.calls.map(
      (call: Array<unknown>) => new URL(String(call[0])).searchParams,
    )
    const ties = urls.find((s) => s.get('id') === 'eq.40')
    const keyset = urls.find((s) => s.get('id') === 'gt.40')

    expect(ties?.has('limit')).toBe(false)
    expect(keyset?.get('limit')).toBe('20')
    // Cursor pins the window; offset must never ride alongside it.
    expect(keyset?.has('offset')).toBe(false)
  })
})

describe('postgrest errors are thrown as Error instances', () => {
  test('a failed request throws a PostgrestError with the message preserved', async () => {
    const errorBody = {
      message: 'permission denied for table users',
      details: 'insufficient privilege',
      hint: null,
      code: '42501',
    }
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { fetch: mockFetch },
    })

    const promise = postgrestRequest(supabase, 'users', {
      method: 'GET',
      search: new URLSearchParams(),
    })

    await expect(promise).rejects.toBeInstanceOf(PostgrestError)
    await expect(promise).rejects.toMatchObject({
      message: 'permission denied for table users',
      code: '42501',
    })
    // The original bug: throwing a plain object stringified to "[object Object]".
    await expect(promise).rejects.toSatisfy((e: unknown) =>
      String(e).includes('permission denied'),
    )
  })
})
