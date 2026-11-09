import { createClient } from '@supabase/supabase-js'
import { createCollection } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { supabaseCollectionOptions } from '../src/index'
import {
  SUPABASE_KEY,
  SUPABASE_URL,
  createMockChannel,
  emit,
} from './test.utils'
import type { MockChannel } from './test.utils'

const eventsSchema = z.object({
  id: z.bigint(),
  title: z.string(),
  startsAt: z.date(),
  endsAt: z.date().nullable(),
  tags: z.set(z.string()),
})

// What PostgREST and Realtime send for the schema above: a bigint is a JSON
// number, a timestamptz an ISO string and a text[] a JSON array.
type EventRecord = {
  id: number
  title: string
  startsAt: string
  endsAt: string | null
  tags: Array<string>
}

const START = '2024-05-06T07:08:09.123+00:00'
const END = '2024-05-07T07:08:09.123+00:00'

const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

const json = (body: unknown, contentRange?: string) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(contentRange ? { 'content-range': contentRange } : {}),
    },
  })

/** A PostgREST stand-in holding `rows`, recording the write requests it gets. */
function makeServer(rows: Array<EventRecord>) {
  const writes: Array<{ method: string; search: string; body: unknown }> = []
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      return Promise.resolve(json(rows, `0-${rows.length - 1}/${rows.length}`))
    }
    const body = JSON.parse(String(init?.body ?? '{}'))
    writes.push({ method, search: new URL(String(input)).search, body })
    // PATCH and POST return the stored row, as `Prefer: return=representation`
    // asks: bigints as JSON numbers, with a column the server filled in.
    return Promise.resolve(
      json({ ...body, id: Number(body.id ?? 1), endsAt: body.endsAt ?? null }),
    )
  })
  return { fetchMock, writes }
}

function makeEvents(
  rows: Array<EventRecord>,
  { realtime = false }: { realtime?: boolean } = {},
) {
  const server = makeServer(rows)
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: server.fetchMock },
  })
  const channel: MockChannel = createMockChannel()
  if (realtime) {
    supabase.channel = vi.fn(
      () => channel,
    ) as unknown as typeof supabase.channel
    supabase.removeChannel = vi.fn() as unknown as typeof supabase.removeChannel
  }
  const collection = createCollection(
    supabaseCollectionOptions({
      tableName: 'events',
      keys: ['id'],
      schema: eventsSchema,
      supabase,
      queryClient: new QueryClient(),
      syncMode: 'eager',
      realtime,
      parse: {
        id: (value) => BigInt(value as number),
        startsAt: (value) => new Date(value as string),
        endsAt: (value) => new Date(value as string),
        tags: (value) => new Set(value as Array<string>),
      },
      serialize: {
        id: (value) => value.toString(),
        startsAt: (value) => value.toISOString(),
        endsAt: (value) => value.toISOString(),
        // A Set would serialize to `{}`.
        tags: (value) => [...value],
      },
    }),
  )
  cleanups.push(() => collection.cleanup())
  return { collection, channel, ...server }
}

describe('parse and serialize', () => {
  test('rows read from PostgREST are parsed into the schema types', async () => {
    const { collection } = makeEvents([
      {
        id: 7,
        title: 'Launch',
        startsAt: START,
        endsAt: END,
        tags: ['a', 'b'],
      },
    ])
    await collection.preload()

    expect(collection.get('7')).toMatchObject({
      id: 7n,
      title: 'Launch',
      startsAt: new Date(START),
      endsAt: new Date(END),
      tags: new Set(['a', 'b']),
    })
  })

  test('null columns are not passed to parse', async () => {
    const { collection } = makeEvents([
      { id: 7, title: 'Open ended', startsAt: START, endsAt: null, tags: [] },
    ])
    await collection.preload()

    expect(collection.get('7')?.endsAt).toBeNull()
  })

  test('columns without a conversion are left as received', async () => {
    const { collection } = makeEvents([
      { id: 7, title: 'Launch', startsAt: START, endsAt: null, tags: [] },
    ])
    await collection.preload()

    expect(collection.get('7')?.title).toBe('Launch')
  })

  test('an insert sends serialized columns and stores the parsed server row', async () => {
    const { collection, writes } = makeEvents([])
    await collection.preload()

    const tx = collection.insert({
      id: 42n,
      title: 'Insert',
      startsAt: new Date(START),
      endsAt: null,
      tags: new Set(['x', 'y']),
    })
    await tx.when('settled')

    expect(writes).toEqual([
      {
        method: 'POST',
        search: '?select=*',
        body: {
          id: '42',
          title: 'Insert',
          startsAt: '2024-05-06T07:08:09.123Z',
          endsAt: null,
          tags: ['x', 'y'],
        },
      },
    ])
    expect(collection.get('42')).toMatchObject({
      title: 'Insert',
      startsAt: new Date(START),
      tags: new Set(['x', 'y']),
    })
  })

  test('an update matches the row by its serialized key and sends serialized columns', async () => {
    const { collection, writes } = makeEvents([
      {
        id: 7,
        title: 'Launch',
        startsAt: START,
        endsAt: END,
        tags: ['a', 'b'],
      },
    ])
    await collection.preload()

    const tx = collection.update('7', (draft) => {
      draft.title = 'Relaunch'
    })
    await tx.when('settled')

    expect(writes).toEqual([
      {
        method: 'PATCH',
        search: '?id=eq.7&select=*',
        body: {
          id: '7',
          title: 'Relaunch',
          startsAt: '2024-05-06T07:08:09.123Z',
          endsAt: '2024-05-07T07:08:09.123Z',
          tags: ['a', 'b'],
        },
      },
    ])
    expect(collection.get('7')?.title).toBe('Relaunch')
  })

  test('a delete matches the row by its serialized key', async () => {
    const { collection, writes } = makeEvents([
      { id: 7, title: 'Launch', startsAt: START, endsAt: null, tags: [] },
    ])
    await collection.preload()

    const tx = collection.delete('7')
    await tx.when('settled')

    expect(writes).toMatchObject([{ method: 'DELETE', search: '?id=eq.7' }])
    expect(collection.has('7')).toBe(false)
  })

  describe('realtime', () => {
    const attached = async (rows: Array<EventRecord> = []) => {
      const events = makeEvents(rows, { realtime: true })
      await events.collection.preload()
      await vi.waitFor(() => expect(events.channel.on).toHaveBeenCalled())
      return events
    }

    test('inserted rows are parsed', async () => {
      const { collection, channel } = await attached()

      emit(channel, {
        eventType: 'INSERT',
        new: {
          id: 8,
          title: 'Live',
          startsAt: START,
          endsAt: null,
          tags: ['live'],
        },
      })

      expect(collection.get('8')).toMatchObject({
        id: 8n,
        startsAt: new Date(START),
        endsAt: null,
        tags: new Set(['live']),
      })
    })

    test('updated rows are parsed', async () => {
      const { collection, channel } = await attached([
        { id: 8, title: 'Live', startsAt: START, endsAt: null, tags: [] },
      ])

      emit(channel, {
        eventType: 'UPDATE',
        new: {
          id: 8,
          title: 'Live',
          startsAt: START,
          endsAt: END,
          tags: ['a', 'b'],
        },
      })

      expect(collection.get('8')?.endsAt).toEqual(new Date(END))
    })

    test('a deleted row is found by its parsed key', async () => {
      const { collection, channel } = await attached([
        { id: 8, title: 'Live', startsAt: START, endsAt: null, tags: [] },
      ])

      // A delete payload carries only the key columns of the old row.
      emit(channel, { eventType: 'DELETE', old: { id: 8 } })

      expect(collection.has('8')).toBe(false)
    })
  })
})
