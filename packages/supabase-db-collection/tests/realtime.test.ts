import {
  and,
  createCollection,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  liveQueryCollectionOptions,
  lt,
  lte,
  not,
} from '@tanstack/db'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { realtimeFiltersToSearch } from '../src/postgrest-filters'
import {
  createMockChannel,
  createMockFetch,
  createRealtimeUsersCollection,
  emit,
  filtersFor,
  listenersFor,
  nth,
} from './test.utils'
import type { Collection } from '@tanstack/db'
import type { MockChannel } from './test.utils'

// Collections created during a test, torn down afterwards so their query
// observers are removed (and the realtime channel detached).
let createdCollections: Array<Collection<any, any>> = []

function track<T extends Collection<any, any>>(collection: T): T {
  createdCollections.push(collection)
  return collection
}

beforeEach(() => {
  createdCollections = []
})

afterEach(() => {
  // Tear down in reverse creation order so dependent live queries are cleaned
  // up before the source collections they depend on.
  for (const collection of [...createdCollections].reverse()) {
    collection.cleanup()
  }
})

type QueryFn = Parameters<typeof liveQueryCollectionOptions>[0]['query']
type RealtimeCollection = ReturnType<
  typeof createRealtimeUsersCollection
>['collection']

function startLiveQuery(
  collection: RealtimeCollection,
  buildQuery: (collection: RealtimeCollection) => QueryFn,
) {
  const opts = liveQueryCollectionOptions({ query: buildQuery(collection) })
  return track(
    createCollection(opts as Extract<typeof opts, { singleResult?: never }>),
  )
}

// Runs a live query against a fresh realtime users collection and waits for the
// realtime channel to be attached, then returns the recording mock channel.
async function captureChannel(
  buildQuery: (collection: RealtimeCollection) => QueryFn,
  // These tests exercise server-side filtering, which is opt-in on the
  // collection (realtimeUseFilter defaults to false), so enable it by default
  // here and let individual tests override it.
  { realtimeUseFilter = true }: { realtimeUseFilter?: boolean } = {},
) {
  const mockFetch = createMockFetch()
  const mockChannel = createMockChannel()
  const { collection } = createRealtimeUsersCollection(mockFetch, mockChannel, {
    realtimeUseFilter,
  })
  track(collection)

  const live = startLiveQuery(collection, buildQuery)

  await live.preload()
  await live.toArrayWhenReady()
  await vi.waitFor(() => expect(mockChannel.on).toHaveBeenCalled())

  return { mockChannel, collection }
}

// The filters applied to INSERT listeners — the ones that decide which rows
// belong in the collection.
function insertFilters(mockChannel: MockChannel): Array<string | null> {
  return filtersFor(mockChannel, 'INSERT')
}

describe('realtime filter propagation', () => {
  describe('supported single-comparison filters', () => {
    test('eq on a number column', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => eq(user.id, 1)),
      )
      expect(insertFilters(mockChannel)).toEqual(['id=eq.1'])
    })

    test('eq on a boolean column', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => eq(user.active, true)),
      )
      expect(insertFilters(mockChannel)).toEqual(['active=eq.true'])
    })

    test('gt', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => gt(user.id, 5)),
      )
      expect(insertFilters(mockChannel)).toEqual(['id=gt.5'])
    })

    test('gte', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => gte(user.id, 5)),
      )
      expect(insertFilters(mockChannel)).toEqual(['id=gte.5'])
    })

    test('lt', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => lt(user.id, 10)),
      )
      expect(insertFilters(mockChannel)).toEqual(['id=lt.10'])
    })

    test('lte', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => lte(user.id, 10)),
      )
      expect(insertFilters(mockChannel)).toEqual(['id=lte.10'])
    })

    test('inArray maps to in.(...)', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => inArray(user.id, [1, 2, 3])),
      )
      expect(insertFilters(mockChannel)).toEqual(['id=in.(1,2,3)'])
    })

    test('not(eq) maps to not.eq', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => not(eq(user.active, false))),
      )
      expect(insertFilters(mockChannel)).toEqual(['active=not.eq.false'])
    })

    test('isNull maps to is.null', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => isNull(user.name)),
      )
      expect(insertFilters(mockChannel)).toEqual(['name=is.null'])
    })

    test('not(isNull) maps to not.is.null', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => not(isNull(user.name))),
      )
      expect(insertFilters(mockChannel)).toEqual(['name=not.is.null'])
    })

    test('not(inArray) maps to not.in', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => not(inArray(user.id, [1, 2]))),
      )
      expect(insertFilters(mockChannel)).toEqual(['id=not.in.(1,2)'])
    })

    test('not(gt) maps to not.gt', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => not(gt(user.id, 5))),
      )
      expect(insertFilters(mockChannel)).toEqual(['id=not.gt.5'])
    })

    test('composite AND becomes a comma-separated filter', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => and(eq(user.active, true), gt(user.id, 5))),
      )
      expect(insertFilters(mockChannel)).toEqual(['active=eq.true,id=gt.5'])
    })
  })

  describe('value serialization', () => {
    test('a string containing a comma is PostgREST-quoted', async () => {
      // Unquoted, the comma would read as a second ANDed condition.
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => eq(user.name, 'Doe, Jane')),
      )
      expect(insertFilters(mockChannel)).toEqual(['name=eq."Doe, Jane"'])
    })

    test('a quote inside a value is escaped', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => eq(user.name, 'He said "hi", ok')),
      )
      expect(insertFilters(mockChannel)).toEqual([
        'name=eq."He said \\"hi\\", ok"',
      ])
    })

    test('a plain string is left unquoted', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => eq(user.name, 'Zed')),
      )
      expect(insertFilters(mockChannel)).toEqual(['name=eq.Zed'])
    })

    test('an in list of exactly 100 values is still filtered', async () => {
      const values = Array.from({ length: 100 }, (_, index) => index)
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => inArray(user.id, values)),
      )
      expect(insertFilters(mockChannel)).toEqual([
        `id=in.(${values.join(',')})`,
      ])
    })

    test('an in list longer than 100 values falls back to a catch-all', async () => {
      const values = Array.from({ length: 101 }, (_, index) => index)
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q
            .from({ user: collection })
            .where(({ user }) => inArray(user.id, values)),
      )
      expect(insertFilters(mockChannel)).toEqual([null])
    })
  })

  describe('catch-all subscriptions (no filter)', () => {
    test('no WHERE clause', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) => q.from({ user: collection }),
      )
      expect(insertFilters(mockChannel)).toEqual([null])
    })

    test('no redundant unfiltered UPDATE listener is added', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) => q.from({ user: collection }),
      )
      expect(filtersFor(mockChannel, 'UPDATE')).toEqual([null])
    })

    test('realtimeUseFilter: false subscribes catch-all despite a filterable WHERE', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => eq(user.id, 1)),
        { realtimeUseFilter: false },
      )
      // The WHERE is representable as a Realtime filter, but filtering is off,
      // so every listener subscribes to all changes and no redundant unfiltered
      // UPDATE listener is added.
      expect(insertFilters(mockChannel)).toEqual([null])
      expect(filtersFor(mockChannel, 'UPDATE')).toEqual([null])
      expect(filtersFor(mockChannel, 'DELETE')).toEqual([null])
    })

    test('defaults to catch-all when realtimeUseFilter is omitted', async () => {
      const mockFetch = createMockFetch()
      const mockChannel = createMockChannel()
      // No realtimeUseFilter option → the collection default (false) applies.
      const { collection } = createRealtimeUsersCollection(
        mockFetch,
        mockChannel,
      )
      track(collection)

      const live = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => eq(user.id, 1)),
      )
      await live.preload()
      await live.toArrayWhenReady()
      await vi.waitFor(() => expect(mockChannel.on).toHaveBeenCalled())

      // A filterable WHERE is not pushed; every listener subscribes to all rows.
      expect(insertFilters(mockChannel)).toEqual([null])
      expect(filtersFor(mockChannel, 'UPDATE')).toEqual([null])
    })
  })

  describe('listener layout', () => {
    test('filters apply to INSERT and UPDATE, never to DELETE', async () => {
      const { mockChannel } = await captureChannel(
        (collection) => (q) =>
          q.from({ user: collection }).where(({ user }) => eq(user.id, 1)),
      )

      expect(filtersFor(mockChannel, 'INSERT')).toEqual(['id=eq.1'])
      // The filtered listener catches rows entering the window; the unfiltered
      // one keeps rows already held up to date after they leave it.
      expect(filtersFor(mockChannel, 'UPDATE')).toEqual(['id=eq.1', null])
      // Realtime only delivers filtered deletes with `replica identity full`.
      expect(filtersFor(mockChannel, 'DELETE')).toEqual([null])
    })
  })

  describe('payload routing into the collection', () => {
    const row = {
      id: 99,
      name: 'Zed',
      email: 'zed@test.com',
      active: true,
    }

    test('INSERT writes the new row', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }),
      )

      emit(mockChannel, { eventType: 'INSERT', new: row, old: {} })

      expect(collection.has(collection.getKeyFromItem(row))).toBe(true)
    })

    test('INSERT for a row already held overwrites instead of throwing', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }),
      )

      emit(mockChannel, { eventType: 'INSERT', new: row, old: {} })
      expect(() =>
        emit(mockChannel, {
          eventType: 'INSERT',
          new: { ...row, name: 'Twice' },
          old: {},
        }),
      ).not.toThrow()

      expect(collection.get(collection.getKeyFromItem(row))?.name).toBe('Twice')
    })

    test('UPDATE writes the updated row', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }),
      )

      emit(mockChannel, { eventType: 'INSERT', new: row, old: {} })
      emit(mockChannel, {
        eventType: 'UPDATE',
        new: { ...row, name: 'Updated' },
        old: {},
      })

      expect(collection.get(collection.getKeyFromItem(row))?.name).toBe(
        'Updated',
      )
    })

    test('a matching UPDATE for an unseen row inserts it', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }).where(({ user }) => eq(user.id, 99)),
      )
      const filtered = nth(listenersFor(mockChannel, 'UPDATE'), 0)

      // Realtime only delivers this to the filtered listener when the row
      // matches, which means the row has moved into the query's window.
      expect(() =>
        filtered.handler({ eventType: 'UPDATE', new: row, old: {} }),
      ).not.toThrow()

      expect(collection.has(collection.getKeyFromItem(row))).toBe(true)
    })

    test('an unfiltered UPDATE for an unseen row is ignored', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }).where(({ user }) => eq(user.id, 1)),
      )
      const catchAll = listenersFor(mockChannel, 'UPDATE').find(
        (call) => !call.config.filter,
      )

      // Would otherwise mirror every row in the table into the collection.
      expect(() =>
        catchAll?.handler({ eventType: 'UPDATE', new: row, old: {} }),
      ).not.toThrow()

      expect(collection.has(collection.getKeyFromItem(row))).toBe(false)
    })

    test('INSERT for an already-present key with changed data does not throw', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }),
      )
      const { handler } = nth(mockChannel.onCalls, 0)

      // Realtime replayed/duplicated the same INSERT with changed data: this
      // is the exact shape of an unhandled write-conflict error.
      handler({ eventType: 'INSERT', new: row, old: {} })
      expect(() =>
        handler({
          eventType: 'INSERT',
          new: { ...row, name: 'Zed Prime' },
          old: {},
        }),
      ).not.toThrow()

      const key = collection.getKeyFromItem(row)
      expect(collection.get(key)?.name).toBe('Zed Prime')
    })

    test('UPDATE for a key not present in the collection does not throw', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }),
      )
      const { handler } = nth(mockChannel.onCalls, 0)

      expect(() =>
        handler({ eventType: 'UPDATE', new: row, old: {} }),
      ).not.toThrow()

      const key = collection.getKeyFromItem(row)
      expect(collection.get(key)?.name).toBe('Zed')
    })

    test('DELETE removes the row, and is a no-op for an unknown key', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }),
      )

      emit(mockChannel, { eventType: 'INSERT', new: row, old: {} })
      const key = collection.getKeyFromItem(row)
      expect(collection.has(key)).toBe(true)

      emit(mockChannel, { eventType: 'DELETE', new: {}, old: row })
      expect(collection.has(key)).toBe(false)

      // A delete for a key the collection never had must not throw.
      expect(() =>
        emit(mockChannel, {
          eventType: 'DELETE',
          new: {},
          old: { id: 12_345, name: '', email: '', active: false },
        }),
      ).not.toThrow()
    })
  })

  describe('fetching without waiting for the subscription', () => {
    // Known limitation (see queryFn in src/db.ts): the initial fetch is not
    // gated on the channel subscribing, so a row written in the window between
    // the fetch and the subscription going live can be missed by both.
    test('the first fetch does not wait for the channel to subscribe', async () => {
      const mockFetch = createMockFetch()
      const mockChannel = createMockChannel({ autoSubscribe: false })
      const { collection } = createRealtimeUsersCollection(
        mockFetch,
        mockChannel,
      )
      track(collection)

      const live = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => eq(user.id, 1)),
      )
      await live.preload()
      await live.toArrayWhenReady()

      // The fetch proceeds even though the channel never reported SUBSCRIBED.
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('resubscribing when the filter set changes', () => {
    test('uses a fresh channel topic and drops the previous channel', async () => {
      const mockFetch = createMockFetch()
      const channels: Array<MockChannel> = []
      const { collection, supabase } = createRealtimeUsersCollection(
        mockFetch,
        () => {
          const channel = createMockChannel()
          channels.push(channel)
          return channel
        },
        { realtimeUseFilter: true },
      )
      track(collection)

      const first = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => eq(user.id, 1)),
      )
      await first.preload()
      await first.toArrayWhenReady()
      await vi.waitFor(() => expect(channels.length).toBe(1))

      const second = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => gt(user.id, 5)),
      )
      await second.preload()
      await second.toArrayWhenReady()
      await vi.waitFor(() => expect(channels.length).toBe(2))

      const topics = (
        supabase.channel as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.map(([topic]) => topic)
      // A repeated topic would hand back the channel being torn down.
      expect(new Set(topics).size).toBe(topics.length)

      // The union of both queries' filters is now subscribed.
      expect(insertFilters(nth(channels, 1))).toEqual(['id=eq.1', 'id=gt.5'])

      // The old channel is only dropped once the replacement is subscribed.
      await vi.waitFor(() =>
        expect(supabase.removeChannel).toHaveBeenCalledWith(nth(channels, 0)),
      )
    })
  })

  describe('racing local mutations', () => {
    const row = { id: 77, name: 'Race', email: 'race@test.com', active: true }

    test('a Realtime echo of a pending local insert does not throw', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }),
      )
      const key = collection.getKeyFromItem(row)

      const tx = collection.insert(row)
      // The optimistic row is visible right away, but the synced store only
      // learns about it once PostgREST answers — Realtime is usually faster.
      expect(collection.has(key)).toBe(true)
      expect(() =>
        emit(mockChannel, { eventType: 'INSERT', new: row, old: {} }),
      ).not.toThrow()

      await expect(tx.when('settled')).resolves.toBeDefined()
      expect(collection.get(key)?.name).toBe('Race')
    })

    test('a Realtime echo of a pending local delete does not throw', async () => {
      const { mockChannel, collection } = await captureChannel(
        (c) => (q) => q.from({ user: c }),
      )
      emit(mockChannel, { eventType: 'INSERT', new: row, old: {} })
      const key = collection.getKeyFromItem(row)

      const tx = collection.delete(key)
      expect(collection.has(key)).toBe(false)
      expect(() =>
        emit(mockChannel, { eventType: 'DELETE', new: {}, old: row }),
      ).not.toThrow()

      await expect(tx.when('settled')).resolves.toBeDefined()
      expect(collection.has(key)).toBe(false)
    })
  })

  describe('swapping channels safely', () => {
    // The first channel joins immediately; every replacement waits for the test
    // to report its subscription status.
    async function startSwap() {
      const mockFetch = createMockFetch()
      const channels: Array<MockChannel> = []
      const { collection, supabase } = createRealtimeUsersCollection(
        mockFetch,
        () => {
          const channel = createMockChannel({
            autoSubscribe: channels.length === 0,
          })
          channels.push(channel)
          return channel
        },
        { realtimeUseFilter: true },
      )
      track(collection)

      const first = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => eq(user.id, 1)),
      )
      await first.preload()
      await first.toArrayWhenReady()
      await vi.waitFor(() => expect(channels.length).toBe(1))

      const second = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => gt(user.id, 5)),
      )
      const secondPreloaded = second.preload()
      await vi.waitFor(() => expect(channels.length).toBe(2))
      await vi.waitFor(() =>
        expect(nth(channels, 1).subscribe).toHaveBeenCalled(),
      )

      return { channels, collection, supabase, secondPreloaded }
    }

    test('keeps the previous channel until the replacement reports SUBSCRIBED', async () => {
      const { channels, supabase, secondPreloaded } = await startSwap()

      // Dropping it now would leave a window with no subscription at all.
      expect(supabase.removeChannel).not.toHaveBeenCalled()

      nth(channels, 1).confirmSubscribed()
      await secondPreloaded
      await vi.waitFor(() =>
        expect(supabase.removeChannel).toHaveBeenCalledWith(nth(channels, 0)),
      )
    })

    test('falls back to a catch-all when the server rejects the filtered subscription', async () => {
      const { channels, collection, supabase, secondPreloaded } =
        await startSwap()

      nth(channels, 1).confirmSubscribed('CHANNEL_ERROR')

      await vi.waitFor(() => expect(channels.length).toBe(3))
      expect(insertFilters(nth(channels, 2))).toEqual([null])
      expect(supabase.removeChannel).toHaveBeenCalledWith(nth(channels, 1))
      // The working channel is only replaced once the fallback has joined.
      expect(supabase.removeChannel).not.toHaveBeenCalledWith(nth(channels, 0))

      nth(channels, 2).confirmSubscribed()
      await vi.waitFor(() =>
        expect(supabase.removeChannel).toHaveBeenCalledWith(nth(channels, 0)),
      )
      await secondPreloaded

      // The rejected filter set is remembered: a query that would produce it
      // again reuses the catch-all instead of failing the same way twice.
      const third = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => gt(user.id, 5)),
      )
      await third.preload()
      await third.toArrayWhenReady()
      expect(channels.length).toBe(3)
    })

    test('keeps the previous channel when even the catch-all is rejected', async () => {
      const { channels, supabase, secondPreloaded } = await startSwap()

      nth(channels, 1).confirmSubscribed('CHANNEL_ERROR')
      await vi.waitFor(() => expect(channels.length).toBe(3))
      nth(channels, 2).confirmSubscribed('CHANNEL_ERROR')

      await vi.waitFor(() =>
        expect(supabase.removeChannel).toHaveBeenCalledWith(nth(channels, 2)),
      )
      expect(supabase.removeChannel).toHaveBeenCalledWith(nth(channels, 1))
      expect(supabase.removeChannel).not.toHaveBeenCalledWith(nth(channels, 0))
      expect(channels.length).toBe(3)

      // Data loading is never held hostage by a failed subscription.
      await secondPreloaded
    })

    test('a transient error on the sole catch-all keeps the channel so it can reconnect', async () => {
      const mockFetch = createMockFetch()
      const channels: Array<MockChannel> = []
      const { collection, supabase } = createRealtimeUsersCollection(
        mockFetch,
        () => {
          const channel = createMockChannel({ autoSubscribe: false })
          channels.push(channel)
          return channel
        },
        // realtimeUseFilter defaults to false → a single catch-all subscription.
      )
      track(collection)

      const live = startLiveQuery(collection, (c) => (q) => q.from({ user: c }))
      const preloaded = live.preload()
      await vi.waitFor(() => expect(channels.length).toBe(1))
      await vi.waitFor(() =>
        expect(nth(channels, 0).subscribe).toHaveBeenCalled(),
      )

      // The only channel reports a transient connection error before joining. A
      // catch-all has nothing to reject, so this is not a filter rejection.
      nth(channels, 0).confirmSubscribed('CHANNEL_ERROR')
      await preloaded

      // It is NOT removed — realtime-js keeps retrying the join and its listeners
      // stay attached — and no replacement is opened, so the table is never left
      // without a channel until an observer changes.
      expect(supabase.removeChannel).not.toHaveBeenCalled()
      expect(channels.length).toBe(1)
    })

    test('tearing down all queries removes the joined and the in-flight channel', async () => {
      const mockFetch = createMockFetch()
      const channels: Array<MockChannel> = []
      const { collection, supabase } = createRealtimeUsersCollection(
        mockFetch,
        () => {
          const channel = createMockChannel({
            autoSubscribe: channels.length === 0,
          })
          channels.push(channel)
          return channel
        },
        { realtimeUseFilter: true },
      )
      track(collection)

      const first = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => eq(user.id, 1)),
      )
      await first.preload()
      await first.toArrayWhenReady()
      await vi.waitFor(() => expect(channels.length).toBe(1))

      // A second query opens a replacement channel that never joins, so it stays
      // pending alongside the first, still-joined channel.
      const second = startLiveQuery(
        collection,
        (c) => (q) => q.from({ user: c }).where(({ user }) => gt(user.id, 5)),
      )
      const secondPreloaded = second.preload()
      await vi.waitFor(() => expect(channels.length).toBeGreaterThan(1))
      await secondPreloaded

      // Tearing down every active query must dispose every channel this table
      // opened — a joined channel and any swap still in flight — with none left
      // behind.
      await first.cleanup()
      await second.cleanup()

      await vi.waitFor(() => {
        for (const channel of channels) {
          expect(supabase.removeChannel).toHaveBeenCalledWith(channel)
        }
      })
    })
  })

  // `or(...)` (and other unsupported expressions) cannot be driven through the
  // live-query path because the query's own supabaseQueryFn calls the same
  // strict toPostgrestParams, which throws on an unpushable expression. Cover the
  // defensive fallback directly.
  describe('realtimeFiltersToSearch falls back instead of throwing', () => {
    test('an unsupported expression yields a catch-all', () => {
      const orExpression = { type: 'func', name: 'or', args: [] } as any
      expect(realtimeFiltersToSearch([orExpression])).toEqual(
        new URLSearchParams(),
      )
    })
  })
})
