import { createClient } from '@supabase/supabase-js'
import { createCollection, liveQueryCollectionOptions } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { expect, vi } from 'vitest'
import { z } from 'zod'
import { supabaseCollectionOptions } from '../src/index'

// --- Schemas ---

export const usersSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
})

export const usersTodosSchema = z.object({
  user_id: z.number(),
  todo_id: z.number(),
})

export const todosSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  completed: z.boolean(),
})

// --- Mock infrastructure ---

export const SUPABASE_URL = 'http://localhost:54321'
export const SUPABASE_KEY = 'test-key'

export const mockResponses: Record<string, Array<any>> = {
  users: [
    { id: 'user_1', name: 'Alice', email: 'alice@test.com', active: true },
  ],
  users_todos: [{ user_id: 'user_1', todo_id: 'todo_1' }],
  todos: [
    {
      id: 'todo_1',
      title: 'Buy milk',
      description: 'From the store',
      completed: false,
    },
  ],
}

export function createMockFetch() {
  // Rows inserted or updated through this mock, by table and `id`, so an
  // update can return the whole stored row as PostgREST does.
  const written = new Map<string, Record<string, unknown>>()
  return vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const table = url.pathname.replace('/rest/v1/', '')
    const method = init?.method ?? 'GET'

    // Insert and update requests return the stored row as the
    // "representation", so `.select().single()` has something schema-shaped to
    // parse. An insert stores its body; an update writes its body's columns
    // over the stored row it matches by `id`.
    if (method === 'POST' || method === 'PATCH') {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      const id =
        method === 'POST' ? body.id : url.searchParams.get('id')?.slice(3)
      const storedKey = `${table}:${id}`
      const stored =
        method === 'PATCH'
          ? (written.get(storedKey) ??
            mockResponses[table]?.find((row) => `${row.id}` === `${id}`))
          : undefined
      const row = { ...stored, ...body }
      written.set(storedKey, row)
      return Promise.resolve(
        new Response(JSON.stringify(row), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }

    const all = mockResponses[table] ?? []
    // Honour offset/limit so the pagination loop's follow-up pages terminate
    // (a page past the data returns empty) instead of re-serving the same rows.
    const params = url.searchParams
    const offset = params.get('offset') ? Number(params.get('offset')) : 0
    const limit = params.get('limit')
    const rows = all.slice(
      offset,
      limit === null ? undefined : offset + Number(limit),
    )
    const end = offset + rows.length - 1
    return Promise.resolve(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          // The loop reads the total off Content-Range to size its paging; the
          // format mirrors PostgREST's `<start>-<end>/<total>`.
          'content-range': rows.length
            ? `${offset}-${end}/${all.length}`
            : `*/${all.length}`,
        },
      }),
    )
  })
}

/** Extract the headers of a captured `fetch` call as a `Headers` instance. */
export function getRequestHeaders(
  mockFetch: ReturnType<typeof createMockFetch>,
  callIndex = 0,
): Headers {
  const init = mockFetch.mock.calls[callIndex]?.[1]
  return new Headers(init?.headers)
}

export function createMockedUsersCollection(mockFetch: typeof fetch) {
  return createCollection(
    supabaseCollectionOptions({
      tableName: 'users',
      keys: ['id'],
      schema: usersSchema,
      supabase: createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: mockFetch },
      }),
    }),
  )
}

export function createMockedUsersTodosCollection(mockFetch: typeof fetch) {
  return createCollection(
    supabaseCollectionOptions({
      tableName: 'users_todos',
      keys: ['user_id', 'todo_id'],
      schema: usersTodosSchema,
      supabase: createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: mockFetch },
      }),
    }),
  )
}

export function createMockedTodosCollection(mockFetch: typeof fetch) {
  return createCollection(
    supabaseCollectionOptions({
      tableName: 'todos',
      keys: ['id'],
      schema: todosSchema,
      supabase: createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: mockFetch },
      }),
    }),
  )
}

// --- Realtime mock infrastructure ---

type MockChannelOnCall = {
  type: string
  config: { event: string; schema: string; table: string; filter?: string }
  handler: (payload: any) => void
}

export type MockChannel = {
  onCalls: Array<MockChannelOnCall>
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  /**
   * Reports a subscription status (SUBSCRIBED by default) when the channel was
   * created with `autoSubscribe: false`.
   */
  confirmSubscribed: (status?: string) => void
}

export function createMockChannel({
  autoSubscribe = true,
}: {
  autoSubscribe?: boolean
} = {}): MockChannel {
  const onCalls: Array<MockChannelOnCall> = []
  let pending: ((status: string) => void) | undefined

  const channel: MockChannel = {
    onCalls,
    on: vi.fn((type: string, config: any, handler: (payload: any) => void) => {
      onCalls.push({ type, config, handler })
      return channel
    }),
    // The adapter drives channel swaps and the rejection fallback off the
    // subscription status, so the mock reports one like the real channel does.
    subscribe: vi.fn((callback?: (status: string) => void) => {
      if (autoSubscribe) {
        callback?.('SUBSCRIBED')
      } else {
        pending = callback
      }
      return channel
    }),
    confirmSubscribed: (status = 'SUBSCRIBED') => {
      pending?.(status)
      pending = undefined
    },
  }
  return channel
}

/** Returns the postgres_changes listeners registered for a given event. */
export function listenersFor(mockChannel: MockChannel, event: string) {
  return mockChannel.onCalls.filter((call) => call.config.event === event)
}

/** The filter strings of a given event's listeners (null when unfiltered). */
export function filtersFor(
  mockChannel: MockChannel,
  event: string,
): Array<string | null> {
  return listenersFor(mockChannel, event).map(
    (call) => call.config.filter ?? null,
  )
}

/** Dispatches a payload to every listener registered for its event type. */
export function emit(mockChannel: MockChannel, payload: any) {
  for (const call of listenersFor(mockChannel, payload.eventType)) {
    call.handler(payload)
  }
}

export function createRealtimeUsersCollection(
  mockFetch: typeof fetch,
  mockChannel: MockChannel | (() => MockChannel),
  options: {
    realtimeUseFilter?: boolean
    syncMode?: 'on-demand' | 'eager'
  } = {},
) {
  // A fresh QueryClient keeps the module-level realtime registry in db.ts
  // isolated per test.
  const queryClient = new QueryClient()
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: mockFetch },
  })
  // The real client would open a live WebSocket, so stub the realtime surface.
  supabase.channel = vi.fn(() =>
    typeof mockChannel === 'function' ? mockChannel() : mockChannel,
  ) as unknown as typeof supabase.channel
  supabase.removeChannel = vi.fn() as unknown as typeof supabase.removeChannel

  const collection = createCollection(
    supabaseCollectionOptions({
      tableName: 'users',
      keys: ['id'],
      schema: usersSchema,
      supabase,
      realtime: true,
      realtimeUseFilter: options.realtimeUseFilter,
      syncMode: options.syncMode,
      queryClient,
    }),
  )

  return { collection, supabase, queryClient }
}

// --- Query helpers ---

export async function queryResult(
  queryFn: Parameters<typeof liveQueryCollectionOptions>[0]['query'],
) {
  const opts = liveQueryCollectionOptions({ query: queryFn })
  const collection = createCollection(
    opts as Extract<typeof opts, { singleResult?: never }>,
  )
  await collection.preload()
  const data = await collection.toArrayWhenReady()
  collection.cleanup()
  return data
}

// --- Assertion helpers ---

export function normalizeFetchUrl(raw: string | URL | Request): string {
  const url = new URL(typeof raw === 'string' ? raw : raw.toString())
  url.searchParams.sort()
  return `${url.pathname}${decodeURIComponent(url.search)}`
}

export function expectFetchUrls(
  mockFetch: ReturnType<typeof createMockFetch>,
  expectedPaths: Array<string>,
) {
  const actual = mockFetch.mock.calls.map(([url]) => normalizeFetchUrl(url))
  const expected = expectedPaths.map((p) =>
    normalizeFetchUrl(new URL(p, SUPABASE_URL)),
  )
  expect([...actual]).toEqual([...expected])
}

/**
 * Index into an array, failing loudly when the element is missing. Keeps test
 * assertions concise under `noUncheckedIndexedAccess`.
 */
export function nth<T>(items: ReadonlyArray<T>, index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error(`Expected an element at index ${index}`)
  }
  return item
}
