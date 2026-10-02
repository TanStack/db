import { expect, it } from 'vitest'

/**
 * # Can a returning subscriber cancel idle cleanup that rescheduled itself?
 *
 * After automatic GC fires, a Collection runs cleanup in browser idle time.
 * If the idle period has no time left, cleanup reschedules itself for the next
 * one. A subscriber that returns before cleanup runs must cancel that
 * rescheduled callback. Otherwise, after the subscriber leaves again, the old
 * callback cleans the Collection up before its new GC delay elapses.
 * Authority: `gcTime` in the Collection options and the lifecycle comments in
 * `src/collection/lifecycle.ts`.
 *
 * This history needs its own file. The idle scheduler is chosen when
 * `src/utils/browser-polyfills.ts` loads, and the Node polyfill always reports
 * a timed-out deadline, so no history in the suite can reach a reschedule.
 * The file installs a controllable `window.requestIdleCallback` before it
 * imports the Collection. The cleanup-queue oracle owns GC appointments; this
 * file owns only the idle stage after an appointment fires.
 */

type Deadline = { didTimeout: boolean; timeRemaining: () => number }
const pending = new Map<number, (deadline: Deadline) => void>()
let nextId = 1
let firstPeriodHasNoTime = true
;(window as any).requestIdleCallback = (callback: (d: Deadline) => void) => {
  const id = nextId++
  pending.set(id, callback)
  return id
}
;(window as any).cancelIdleCallback = (id: number) => {
  pending.delete(id)
}
function runIdlePeriods() {
  for (const [id, callback] of [...pending]) {
    pending.delete(id)
    const noTime = firstPeriodHasNoTime
    firstPeriodHasNoTime = false
    callback({ didTimeout: false, timeRemaining: () => (noTime ? 0 : 50) })
  }
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

it(`cancels a rescheduled idle cleanup when a subscriber returns`, async () => {
  const { createCollection } = await import('../src/collection/index.js')
  const collection = createCollection<{ id: string }>({
    id: `idle-cleanup`,
    getKey: (row) => row.id,
    gcTime: 40,
    startSync: true,
    sync: { sync: ({ markReady }) => markReady() },
  })
  try {
    await collection.preload()

    // The last subscriber leaves. GC fires and schedules idle cleanup, and
    // the first idle period has no time, so cleanup reschedules.
    collection.subscribeChanges(() => {}).unsubscribe()
    await wait(80)
    expect(pending.size).toBe(1)
    runIdlePeriods()
    expect(collection.status).toBe(`ready`)

    // A subscriber returns and leaves. The fresh GC delay has not elapsed, so
    // no idle period may clean the Collection up.
    collection.subscribeChanges(() => {}).unsubscribe()
    runIdlePeriods()
    expect(collection.status).toBe(`ready`)
  } finally {
    await collection.cleanup()
  }
})
