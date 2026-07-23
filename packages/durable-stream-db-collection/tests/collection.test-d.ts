import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { durableStreamCollectionOptions } from '../src/collection'
import type { RowWithOffset } from '../src/types'
import { z } from 'zod'

describe(`durableStreamCollectionOptions types`, () => {
  it(`should infer row type from getKey function`, () => {
    interface Event {
      id: string
      type: string
      payload: unknown
    }

    const options = durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
    })

    // The collection should have RowWithOffset<Event> as the item type
    const collection = createCollection(options)

    // Get should return RowWithOffset<Event> | undefined
    const item = collection.get(`test`)
    expectTypeOf(item).toEqualTypeOf<RowWithOffset<Event> | undefined>()

    if (item) {
      expectTypeOf(item.id).toEqualTypeOf<string>()
      expectTypeOf(item.type).toEqualTypeOf<string>()
      expectTypeOf(item.payload).toEqualTypeOf<unknown>()
      expectTypeOf(item.offset).toEqualTypeOf<string>()
    }
  })

  it(`should infer row type from schema`, () => {
    const eventSchema = z.object({
      id: z.string(),
      type: z.string(),
      timestamp: z.number(),
    })

    type Event = z.infer<typeof eventSchema>

    const options = durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      schema: eventSchema,
    })

    const collection = createCollection(options)
    const item = collection.get(`test`)

    if (item) {
      expectTypeOf(item.id).toEqualTypeOf<string>()
      expectTypeOf(item.type).toEqualTypeOf<string>()
      expectTypeOf(item.timestamp).toEqualTypeOf<number>()
      expectTypeOf(item.offset).toEqualTypeOf<string>()
    }
  })

  it(`should allow string or number keys`, () => {
    interface Event {
      id: number
      name: string
    }

    const options = durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id, // number key
      getDeduplicationKey: (row) => String(row.id),
    })

    const collection = createCollection(options)

    // Should accept number keys
    const item = collection.get(123)
    expectTypeOf(item).toEqualTypeOf<RowWithOffset<Event> | undefined>()
  })

  it(`should require getKey and getDeduplicationKey`, () => {
    interface Event {
      id: string
    }

    // @ts-expect-error - missing required getKey
    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getDeduplicationKey: (row) => row.id,
    })

    // @ts-expect-error - missing required getDeduplicationKey
    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
    })

    // @ts-expect-error - missing required url
    durableStreamCollectionOptions<Event>({
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
    })
  })

  it(`should type headers correctly`, () => {
    interface Event {
      id: string
    }

    // Should allow Record<string, string>
    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      headers: {
        Authorization: `Bearer token`,
        'Content-Type': `application/json`,
      },
    })
  })

  it(`should type storage interface correctly`, () => {
    interface Event {
      id: string
    }

    // Sync storage
    const syncStorage = {
      getItem: (key: string): string | null => null,
      setItem: (key: string, value: string): void => {},
    }

    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      storage: syncStorage,
    })

    // Async storage
    const asyncStorage = {
      getItem: async (key: string): Promise<string | null> => null,
      setItem: async (key: string, value: string): Promise<void> => {},
    }

    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      storage: asyncStorage,
    })
  })

  it(`should allow storageKey to be false or string`, () => {
    interface Event {
      id: string
    }

    // String prefix
    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      storageKey: `my-app`,
    })

    // Disabled
    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      storageKey: false,
    })
  })

  it(`should type liveMode correctly`, () => {
    interface Event {
      id: string
    }

    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      liveMode: `long-poll`,
    })

    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      liveMode: `sse`,
    })

    // @ts-expect-error - invalid live mode
    durableStreamCollectionOptions<Event>({
      url: `http://example.com/stream`,
      getKey: (row) => row.id,
      getDeduplicationKey: (row) => row.id,
      liveMode: `invalid`,
    })
  })
})
