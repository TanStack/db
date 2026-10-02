import { expect, it, vi } from 'vitest'
import { createCollection, createLiveQueryCollection } from '../src'
import { resetCleanupQueue } from './utils'

/**
 * Automatic GC retires an unused live-query Collection after its configured
 * elapsed delay. A wall-clock correction does not extend that ownership.
 * The cleanup-queue oracle owns the broader appointment history. This test
 * checks its public effect: release of the source Collection subscription.
 */
it(`releases a live query's source subscription after elapsed GC time`, async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  resetCleanupQueue()

  const source = createCollection<{ id: string }>({
    id: `source-gc-clock`,
    getKey: (row) => row.id,
    startSync: true,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const live = createLiveQueryCollection({
    query: (q) => q.from({ s: source }),
    gcTime: 1,
    startSync: true,
  })

  try {
    await live.preload()
    const subscriber = live.subscribeChanges(() => {})
    expect(source.subscriberCount).toBe(1)

    subscriber.unsubscribe()
    await Promise.resolve()
    vi.setSystemTime(-1000)
    await vi.advanceTimersByTimeAsync(10)

    expect(source.subscriberCount).toBe(0)
  } finally {
    await live.cleanup()
    await source.cleanup()
    resetCleanupQueue()
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})
