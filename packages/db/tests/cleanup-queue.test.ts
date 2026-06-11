import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CleanupQueue } from '../src/collection/cleanup-queue'

describe('CleanupQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    CleanupQueue.resetInstance()
  })

  afterEach(() => {
    vi.useRealTimers()
    CleanupQueue.resetInstance()
  })

  it('batches setTimeout creations across multiple synchronous schedules', async () => {
    const queue = CleanupQueue.getInstance()
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    const spySetTimeout = vi.spyOn(global, 'setTimeout')

    queue.schedule('key1', 1000, cb1)
    queue.schedule('key2', 1000, cb2)

    expect(spySetTimeout).not.toHaveBeenCalled()

    // Process microtasks
    await Promise.resolve()

    // Should only create a single timeout for the earliest scheduled task
    expect(spySetTimeout).toHaveBeenCalledTimes(1)
  })

  it('executes callbacks after delay', async () => {
    const queue = CleanupQueue.getInstance()
    const cb1 = vi.fn()

    queue.schedule('key1', 1000, cb1)

    await Promise.resolve()

    expect(cb1).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(cb1).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(cb1).toHaveBeenCalledTimes(1)
  })

  it('can cancel tasks before they run', async () => {
    const queue = CleanupQueue.getInstance()
    const cb1 = vi.fn()

    queue.schedule('key1', 1000, cb1)

    await Promise.resolve()

    queue.cancel('key1')

    vi.advanceTimersByTime(1000)
    expect(cb1).not.toHaveBeenCalled()
  })

  it('schedules subsequent tasks properly if earlier tasks are cancelled', async () => {
    const queue = CleanupQueue.getInstance()
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    queue.schedule('key1', 1000, cb1)
    queue.schedule('key2', 2000, cb2)

    await Promise.resolve()

    queue.cancel('key1')

    // At 1000ms, process will be called because of the original timeout, but no callbacks will trigger
    vi.advanceTimersByTime(1000)
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).not.toHaveBeenCalled()

    // It should automatically schedule the next timeout for key2
    vi.advanceTimersByTime(1000)
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it('processes multiple tasks that have expired at the same time', async () => {
    const queue = CleanupQueue.getInstance()
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const cb3 = vi.fn()

    queue.schedule('key1', 1000, cb1)
    queue.schedule('key2', 1500, cb2)
    queue.schedule('key3', 1500, cb3)

    await Promise.resolve()

    vi.advanceTimersByTime(1000)
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(cb2).toHaveBeenCalledTimes(1)
    expect(cb3).toHaveBeenCalledTimes(1)
  })

  it('continues processing tasks if one throws an error', async () => {
    const queue = CleanupQueue.getInstance()
    const cb1 = vi.fn().mockImplementation(() => {
      throw new Error('Test error')
    })
    const cb2 = vi.fn()

    const spyConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    queue.schedule('key1', 1000, cb1)
    queue.schedule('key2', 1000, cb2)

    await Promise.resolve()

    vi.advanceTimersByTime(1000)

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(spyConsoleError).toHaveBeenCalledWith(
      'Error in CleanupQueue task:',
      expect.any(Error),
    )
    // cb2 should still be called even though cb1 threw an error
    expect(cb2).toHaveBeenCalledTimes(1)

    spyConsoleError.mockRestore()
  })
})
