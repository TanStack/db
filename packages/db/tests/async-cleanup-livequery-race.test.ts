import { describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection.js"
import { createLiveQueryCollection } from "../src/query/live-query-collection.js"

type Row = { id: string; name: string }

const startCounts = new Map<string, number>()
const scheduled = new Map<
  string,
  { timer: ReturnType<typeof setTimeout> | null; canceled: { value: boolean } }
>()

describe(`LiveQueryCollection async cleanup race with GC`, () => {
  it(`reproduces: GC cleanup cancels restarted live pipeline -> live query stays empty (should not)`, async () => {
    vi.useFakeTimers()

    try {
      // Base collection feeding the live query
      const base = createCollection<Row>({
        id: `base-source`,
        getKey: (r) => r.id,
        startSync: false,
        gcTime: 0,
        sync: {
          sync: ({ begin, write, commit, markReady, collection }) => {
            const id = collection.id
            const count = (startCounts.get(id) ?? 0) + 1
            startCounts.set(id, count)
            const delay = count === 1 ? 200 : 20

            const canceledRef = { value: false }
            const state = {
              timer: null as ReturnType<typeof setTimeout> | null,
              canceled: canceledRef,
            }
            const timer = setTimeout(() => {
              const cur = scheduled.get(id)
              if (canceledRef.value || cur !== state) return
              begin()
              write({ type: `insert`, value: { id: `1`, name: `foo` } })
              commit()
              markReady()
            }, delay)
            state.timer = timer
            scheduled.set(id, state)

            return async () => {
              // immediate cancel of this instance's timer
              clearTimeout(timer)
              // async cleanup that cancels the latest scheduled fetch (race)
              await new Promise<void>((r) => setTimeout(r, 5))
              const cur = scheduled.get(id)
              if (cur) {
                cur.canceled.value = true
                if (cur.timer) clearTimeout(cur.timer)
                cur.timer = null
                scheduled.delete(id)
              }
            }
          },
        },
      })

      // Create the live query collection but do not startSync immediately; we'll rely on subscribe
      const live = createLiveQueryCollection({
        id: `live-race`,
        startSync: false,
        gcTime: 50,
        query: (q: any) =>
          q
            .from({ base })
            .select(({ base: b }: any) => ({ id: b.id, name: b.name })),
      })

      // Subscribe then unsubscribe to trigger GC
      const off1 = live.subscribeChanges(() => {})
      off1()

      await vi.advanceTimersByTimeAsync(50)

      // Resubscribe before async cleanup completes
      const off2 = live.subscribeChanges(() => {})
      await vi.advanceTimersByTimeAsync(5)

      // Wait beyond fetch delay
      await vi.advanceTimersByTimeAsync(1000)

      // Correct behavior: live query should have data and be ready
      expect(live.size).toBe(1)
      expect(live.isReady()).toBe(true)
      expect(live.status).toBe(`ready`)

      off2()
    } finally {
      startCounts.clear()
      scheduled.clear()
      vi.useRealTimers()
    }
  })
})
