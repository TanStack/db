import { expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index'
import { createLiveQueryCollection } from '../src/query/live-query-collection'
import { createLiveQueryObserver } from '../src/live-query-observer'
import { mockSyncCollectionOptions } from './utils'

it.each(
  ([`wholesale`, `granular`] as const).flatMap((mode) =>
    ([`read`, `subscribe`] as const).map((resume) => ({ mode, resume })),
  ),
)(
  `refreshes a detached $mode snapshot after unobserved GC and empty reload on $resume`,
  async ({ mode, resume }) => {
    vi.useFakeTimers()
    const row = { id: 1, name: `Alice` }
    const source = createCollection(
      mockSyncCollectionOptions({
        id: `observer-restart-source`,
        getKey: (value: typeof row) => value.id,
        initialData: [row],
      }),
    )
    const live = createLiveQueryCollection({
      startSync: true,
      gcTime: 1,
      query: (q) => q.from({ row: source }),
    })
    const observer = createLiveQueryObserver(live, { mode })
    try {
      const originalSnapshot = observer.getSnapshot()
      expect(originalSnapshot.status).toBe(`ready`)
      expect(originalSnapshot.data).toMatchObject([row])
      expect(live.subscriberCount).toBe(0)

      await vi.advanceTimersByTimeAsync(51)
      expect(live.status).toBe(`cleaned-up`)
      expect(source.subscriberCount).toBe(0)
      source.utils.begin()
      source.utils.write({ type: `delete`, value: row })
      source.utils.commit()

      // A separate caller reloads the query. The original observer misses
      // every intermediate lifecycle state and receives no row events.
      await live.preload()
      expect(live.status).toBe(`ready`)
      expect(live.size).toBe(0)
      if (resume === `subscribe`) observer.subscribe(() => {})

      const snapshot = observer.getSnapshot()
      expect(snapshot.data).toEqual([])
      expect(snapshot.state).toEqual(new Map())
      expect(snapshot.status).toBe(`ready`)
      expect(snapshot.layoutRevision).toBeGreaterThan(
        originalSnapshot.layoutRevision,
      )
      expect(observer.getSnapshot()).toBe(snapshot)
      expect(originalSnapshot.data).toMatchObject([row])
    } finally {
      observer.dispose()
      await live.cleanup()
      await source.cleanup()
      vi.useRealTimers()
    }
  },
)
