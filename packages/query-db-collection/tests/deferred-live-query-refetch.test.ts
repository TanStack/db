/**
 * A Query Collection resubscribes its TanStack Query observers when its
 * `subscriberCount` rises above zero, and a stale query refetches then. A live
 * query that has no subscriber or preload of its own asks for no data, so it
 * must not raise that count and must not cause a fetch. Its first subscriber
 * does. The history first lets a direct subscriber leave, so the observers
 * are unsubscribed and a resubscription would refetch.
 */
import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { queryCollectionOptions } from '../src/query'

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe(`a live query waiting for a subscriber`, () => {
  it(`causes no Query Collection fetch until it has a subscriber`, async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 0, retry: false } },
    })
    let fetches = 0
    const source = createCollection(
      queryCollectionOptions({
        id: `deferred-live-query-refetch`,
        queryKey: [`deferred-live-query-refetch`],
        queryClient,
        getKey: (row: { id: string }) => row.id,
        queryFn: () => {
          fetches++
          return Promise.resolve([{ id: `a` }])
        },
        startSync: true,
      }),
    )
    const direct = source.subscribeChanges(() => {})
    await settle()
    direct.unsubscribe()
    await settle()
    const fetchesBefore = fetches

    const live = createLiveQueryCollection({
      query: (q) => q.from({ row: source }),
      startSync: true,
    })
    try {
      await settle()
      expect(source.subscriberCount, `while the live query waits`).toBe(0)
      expect(fetches, `no fetch while the live query waits`).toBe(fetchesBefore)

      const subscription = live.subscribeChanges(() => {})
      await settle()
      expect(source.subscriberCount, `after its first subscriber`).toBe(1)
      expect(fetches, `the subscriber resubscribes the stale query`).toBe(
        fetchesBefore + 1,
      )
      subscription.unsubscribe()
    } finally {
      await live.cleanup()
      await source.cleanup()
      queryClient.clear()
    }
  })
})
