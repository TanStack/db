import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { mockSyncCollectionOptions, resetCleanupQueue } from './utils.js'

type Person = { id: string; name: string }

const collections: Array<{ cleanup: () => Promise<void> }> = []

const makeLiveQuery = (gcTime = 1, startSync = true) => {
  const source = createCollection(
    mockSyncCollectionOptions<Person>({
      id: `unsubscribed-gc-source`,
      getKey: (person) => person.id,
      initialData: [{ id: `1`, name: `Alice` }],
    }),
  )
  const live = createLiveQueryCollection({
    startSync,
    gcTime,
    query: (q) => q.from({ person: source }),
  })
  collections.push(source, live)
  return { source, live }
}

describe(`collections that start syncing without a subscriber`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCleanupQueue()
  })

  afterEach(async () => {
    for (const collection of collections.reverse()) await collection.cleanup()
    collections.length = 0
    await Promise.resolve()
    resetCleanupQueue()
    vi.useRealTimers()
  })

  it(`keeps the initial grace period but uses gcTime after the last subscriber leaves`, async () => {
    const { source, live } = makeLiveQuery()

    await vi.advanceTimersByTimeAsync(49)
    expect(live.status).toBe(`ready`)
    expect(source.subscriberCount).toBe(1)

    const subscription = live.subscribeChanges(() => {})
    await vi.advanceTimersByTimeAsync(100)
    expect(live.status).toBe(`ready`)
    expect(live.size).toBe(1)

    subscription.unsubscribe()
    await vi.advanceTimersByTimeAsync(2)
    expect(live.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)
  })

  it(`honors a gcTime longer than the initial grace period`, async () => {
    const { source, live } = makeLiveQuery(100)

    await vi.advanceTimersByTimeAsync(99)
    expect(live.status).toBe(`ready`)
    await vi.advanceTimersByTimeAsync(2)
    expect(live.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)
  })

  it(`restarts sync when a subscriber attaches after reclamation`, async () => {
    const { source, live } = makeLiveQuery()

    await vi.advanceTimersByTimeAsync(51)
    expect(live.status).toBe(`cleaned-up`)
    expect(source.subscriberCount).toBe(0)

    const subscription = live.subscribeChanges(() => {})
    expect(live.status).toBe(`ready`)
    expect(live.size).toBe(1)
    expect(source.subscriberCount).toBe(1)
    subscription.unsubscribe()
  })

  it.each([0, -1, Infinity, -Infinity, NaN])(
    `disables automatic GC for gcTime %s`,
    async (gcTime) => {
      const { source, live } = makeLiveQuery(gcTime)

      await vi.advanceTimersByTimeAsync(300001)
      expect(live.status).toBe(`ready`)
      expect(source.subscriberCount).toBe(1)
    },
  )

  it.each([`preload`, `startSyncImmediate`] as const)(
    `reclaims unused collections started by %s`,
    async (method) => {
      const { source, live } = makeLiveQuery(1, false)
      expect(source.subscriberCount).toBe(0)

      await live[method]()
      expect(source.subscriberCount).toBe(1)
      await vi.advanceTimersByTimeAsync(51)
      expect(live.status).toBe(`cleaned-up`)
      expect(source.subscriberCount).toBe(0)
    },
  )
})
