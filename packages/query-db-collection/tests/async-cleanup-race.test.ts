import { describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/query-core"
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "../src/query"

type Row = { id: string; name: string }

const startCounts = new Map<string, number>()
const activeFetches = new Map<
  string,
  { timer: ReturnType<typeof setTimeout> | null; canceled: { value: boolean } }
>()

describe(`QueryCollection async cleanup race with GC`, () => {
  it(`reproduces: GC cleanup cancels restarted fetch -> collection stays empty (should not)`, async () => {
    vi.useFakeTimers()

    try {
      const queryKey = [`race-query`] as const

      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 0,
          },
        },
      })

      // Stub cancelQueries to asynchronously cancel the latest scheduled fetch
      vi.spyOn(queryClient, `cancelQueries`).mockImplementation(
        (params?: any): Promise<void> => {
          const keyStr = JSON.stringify(params?.queryKey ?? [])
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              const state = activeFetches.get(keyStr)
              if (state) {
                if (state.timer) {
                  clearTimeout(state.timer)
                  state.timer = null
                }
                state.canceled.value = true
                activeFetches.delete(keyStr)
              }
              resolve()
            }, 5)
          })
        }
      )

      const baseOptions = queryCollectionOptions<Row>({
        id: `race-qc`,
        queryKey,
        queryClient,
        getKey: (r) => r.id,
        // Do not start immediately; we'll control via subscription
        startSync: false,
        queryFn: async (ctx) => {
          const keyStr = JSON.stringify(
            ctx.queryKey as unknown as Array<unknown>
          )
          const count = (startCounts.get(keyStr) ?? 0) + 1
          startCounts.set(keyStr, count)
          const delay = count === 1 ? 200 : 20

          const canceledRef = { value: false }
          return await new Promise<Array<Row>>((resolve) => {
            const timer = setTimeout(() => {
              if (canceledRef.value) {
                // Simulate canceled fetch: do nothing
                resolve([])
                return
              }
              resolve([{ id: `1`, name: `foo` }])
            }, delay)
            activeFetches.set(keyStr, { timer, canceled: canceledRef })
          })
        },
      })
      // gcTime is supported by the underlying Collection; attach it when creating the collection
      const collection = createCollection({
        ...baseOptions,
        gcTime: 50,
      })

      // 1) Subscribe to start the initial fetch
      const unsubscribe1 = collection.subscribeChanges(() => {})
      // Immediately unsubscribe to trigger GC countdown
      unsubscribe1()

      // 2) Advance timers to fire GC and call async cleanup (which schedules cancel)
      await vi.advanceTimersByTimeAsync(50) // gcTime

      // 3) Before async cancel completes (5ms), resubscribe to restart fetch
      const unsubscribe2 = collection.subscribeChanges(() => {})

      // 4) Allow async cancel to run and cancel the restarted fetch
      await vi.advanceTimersByTimeAsync(5)

      // 5) Advance beyond fetch delays; the restarted fetch was canceled, so no data delivered
      await vi.advanceTimersByTimeAsync(1000)

      // Correct behavior would be to have data and be ready; assert that (to make this fail)
      expect(collection.size).toBe(1)
      expect(collection.isReady()).toBe(true)
      expect(collection.status).toBe(`ready`)

      unsubscribe2()
    } finally {
      startCounts.clear()
      activeFetches.clear()
      vi.useRealTimers()
    }
  })
})
