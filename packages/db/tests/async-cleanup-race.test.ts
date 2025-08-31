import { describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection.js"

type Row = { id: string; name: string }

// Simulate an external observer keyed by collection id (like a query observer)
// The cleanup() will cancel whatever observer is currently active for that id
const observers = new Map<
  string,
  {
    fetchTimer: ReturnType<typeof setTimeout> | null
    cancelled: { value: boolean }
  }
>()
const startCounts = new Map<string, number>()

describe(`Async sync cleanup race with GC`, () => {
  it(`reproduces: GC cleanup cancels the restarted sync, leaving collection stuck empty`, () => {
    vi.useFakeTimers()

    try {
      const collection = createCollection<Row>({
        id: `race-test`,
        getKey: (row) => row.id,
        gcTime: 50, // fast GC to trigger cleanup quickly
        // Do not start immediately - start occurs on first subscription
        startSync: false,
        sync: {
          sync: ({ begin, write, commit, markReady, collection: col }) => {
            const id = col.id

            // Simulate an async initial fetch that would populate and mark ready
            const count = (startCounts.get(id) ?? 0) + 1
            startCounts.set(id, count)
            const delay = count === 1 ? 200 : 20

            const cancelledRef = { value: false }
            const state = {
              fetchTimer: null as ReturnType<typeof setTimeout> | null,
              cancelled: cancelledRef,
            }
            const fetchTimer = setTimeout(() => {
              // If this observer has been cancelled (e.g. by cleanup racing), do nothing
              const current = observers.get(id)
              if (cancelledRef.value || current !== state) return
              // Simulate successful sync delivering data and signaling readiness
              begin()
              write({ type: `insert`, value: { id: `1`, name: `foo` } })
              commit()
              markReady()
            }, delay)
            state.fetchTimer = fetchTimer
            observers.set(id, state)

            // Cleanup that (1) immediately unsubscribes the current fetch
            // and (2) after a small async delay, cancels the latest fetch that
            // might have been started by a restart (racing)
            return async () => {
              // Immediate unsubscribe of the fetch from this sync instance
              clearTimeout(fetchTimer)

              // Simulate async cleanup (e.g., await cancelQueries)
              await new Promise<void>((resolve) => setTimeout(resolve, 5))

              // After awaiting, cancel whatever fetch is currently registered
              // (this likely belongs to the restarted sync)
              const current = observers.get(id)
              if (current) {
                // Mark current observer as cancelled so its pending fetch (if any) won't write
                current.cancelled.value = true
                if (current.fetchTimer) {
                  clearTimeout(current.fetchTimer)
                  current.fetchTimer = null
                }
                observers.delete(id)
              }
            }
          },
        },
      })

      // 1) Mount: subscribe to start sync
      const unsubscribe1 = collection.subscribeChanges(() => {})
      // Immediately unmount: start GC countdown
      unsubscribe1()

      // 2) Advance to trigger GC cleanup (which calls the async cleanup function)
      vi.advanceTimersByTime(50) // gcTime (cleanup kicks off now)

      // 3) Before the async cleanup completes (it waits 10ms), re-subscribe to restart sync
      const unsubscribe2 = collection.subscribeChanges(() => {})

      // 4) Let the async cleanup finish; it will cancel the NEW observer's fetch timer
      vi.advanceTimersByTime(5)

      // 5) After advancing time beyond the fetch, the restarted sync should have delivered data
      vi.advanceTimersByTime(1000)

      // Correct behavior: data arrives and collection is ready
      expect(collection.size).toBe(1)
      expect(collection.isReady()).toBe(true)
      expect(collection.status).toBe(`ready`)

      // Cleanup
      unsubscribe2()
    } finally {
      observers.clear()
      vi.useRealTimers()
    }
  })
})
