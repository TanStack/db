import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index'

describe(`preload retention`, () => {
  const collections: Array<{ cleanup: () => Promise<void> }> = []

  beforeEach(() => vi.useFakeTimers())
  afterEach(async () => {
    for (const collection of collections.splice(0)) await collection.cleanup()
    vi.useRealTimers()
  })

  function makeCollection(startSync = false) {
    let ready!: () => void
    let fail!: (error: Error) => void
    const cleanup = vi.fn()
    const collection = createCollection<{ id: number }>({
      getKey: (row) => row.id,
      gcTime: 10,
      startSync,
      sync: {
        sync: ({ begin, write, commit, markReady, markError }) => {
          ready = () => {
            begin()
            write({ type: `insert`, value: { id: 1 } })
            commit()
            markReady()
          }
          fail = markError
          return cleanup
        },
      },
    })
    collections.push(collection)
    return {
      collection,
      ready: () => ready(),
      fail: (error: Error) => fail(error),
      cleanup,
    }
  }

  it.each([false, true])(
    `retains pending data and grants a fresh grace period after readiness (already syncing: %s)`,
    async (startSync) => {
      const { collection, ready, cleanup } = makeCollection(startSync)
      const pending = collection.preload()
      const outcome = pending.then(
        () => `ready`,
        () => `aborted`,
      )
      expect(collection.preload()).toBe(pending)

      await vi.advanceTimersByTimeAsync(1000)
      expect(collection.status).toBe(`loading`)
      expect(cleanup).not.toHaveBeenCalled()

      ready()
      await expect(outcome).resolves.toBe(`ready`)
      expect(collection.size).toBe(1)
      await vi.advanceTimersByTimeAsync(49)
      expect(collection.status).toBe(`ready`)
      await vi.advanceTimersByTimeAsync(2)
      expect(collection.status).toBe(`cleaned-up`)
      expect(cleanup).toHaveBeenCalledOnce()
    },
  )

  it(`retains a pending preload when the last subscriber leaves`, async () => {
    const { collection, ready } = makeCollection()
    const subscription = collection.subscribeChanges(() => {})
    const pending = collection.preload()
    const outcome = pending.then(
      () => `ready`,
      () => `aborted`,
    )
    subscription.unsubscribe()
    await vi.advanceTimersByTimeAsync(1000)
    expect(collection.status).toBe(`loading`)
    ready()
    await expect(outcome).resolves.toBe(`ready`)
  })

  it(`cancels idle cleanup when preload starts after the GC deadline`, async () => {
    const { collection, ready } = makeCollection(true)
    await Promise.resolve()
    // Run the GC timer, leaving its destructive idle callback queued.
    vi.advanceTimersByTime(50)
    const outcome = collection.preload().then(
      () => `ready`,
      () => `aborted`,
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(collection.status).toBe(`loading`)
    ready()
    await expect(outcome).resolves.toBe(`ready`)
  })

  it(`reclaims an unused collection after preload fails`, async () => {
    const { collection, fail, cleanup } = makeCollection()
    const failure = new Error(`source failed`)
    const outcome = collection.preload().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1000)
    expect(collection.status).toBe(`loading`)
    fail(failure)
    await expect(outcome).resolves.toBe(failure)
    await vi.advanceTimersByTimeAsync(51)
    expect(collection.status).toBe(`cleaned-up`)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it(`allows explicit cleanup to abort preload without scheduling another GC`, async () => {
    const { collection, cleanup } = makeCollection()
    const outcome = collection.preload().catch((error: unknown) => error)
    await collection.cleanup()
    await expect(outcome).resolves.toMatchObject({ name: `AbortError` })
    await vi.advanceTimersByTimeAsync(1000)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
