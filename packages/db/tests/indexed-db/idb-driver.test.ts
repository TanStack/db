// These tests check the native waiter's timing and cleanup mechanics, not
// product results. Retirement laws stay in retirement-oracle.test.ts.
import { expect, it, vi } from 'vitest'
import { completed, withHarness } from './harness'
import { observeTransactions } from './idb-driver'

it('resolves an already established native cut without scheduling a timer', async () => {
  await withHarness(async (h) => {
    const native = observeTransactions(h.db.db)
    h.disposers.push(() => native.restore())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await native.until(() => true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

it.each(['admission', 'complete', 'abort'] as const)(
  'resumes at native %s and clears the timeout',
  async (cut) => {
    await withHarness(async (h) => {
      const native = observeTransactions(h.db.db)
      h.disposers.push(() => native.restore())
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const waiting = native.until(() =>
          cut === 'admission'
            ? native.entries.length === 1
            : native.entries[0]?.status === cut,
        )
        const transaction = h.db.db.transaction('items')
        const finished = completed(transaction).catch(() => undefined)
        if (cut === 'abort') transaction.abort()
        await waiting
        expect(native.entries[0]?.status).toBe(
          cut === 'admission' ? 'pending' : cut,
        )
        expect(vi.getTimerCount()).toBe(0)
        await finished
      } finally {
        vi.useRealTimers()
      }
    })
  },
)

it('rejects an unreachable cut, removes its waiter and lets the harness clean up', async () => {
  const originalChannel = globalThis.BroadcastChannel
  let disposed = false
  let waiterRemoved = false
  let timersRemaining: number | undefined
  const failure = await withHarness(async (h) => {
    const native = observeTransactions(h.db.db)
    h.disposers.push(() => {
      native.restore()
      disposed = true
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const ready = vi.fn(() => false)
      const waiting = native.until(ready).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(1000)
      // Record a broken, unbounded waiter without hanging the test itself.
      const error = await Promise.race([waiting, Promise.resolve('pending')])
      if (error === 'pending') return
      const calls = ready.mock.calls.length
      await completed(h.db.db.transaction('items'))
      waiterRemoved = ready.mock.calls.length === calls
      timersRemaining = vi.getTimerCount()
      throw error
    } finally {
      vi.useRealTimers()
    }
  }).catch((error: unknown) => error)
  expect(failure, 'native cut rejects at its own deadline').toBeInstanceOf(
    Error,
  )
  expect(failure).toMatchObject({
    message: 'Timed out waiting for native transaction state',
  })
  expect(waiterRemoved).toBe(true)
  expect(timersRemaining).toBe(0)
  expect(disposed).toBe(true)
  expect(globalThis.BroadcastChannel).toBe(originalChannel)
})
