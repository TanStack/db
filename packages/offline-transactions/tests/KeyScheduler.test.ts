import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import type { OfflineTransaction } from '../src/types'

function createTransaction({
  id,
  createdAt,
  nextAttemptAt,
  retryCount = 0,
}: {
  id: string
  createdAt: Date
  nextAttemptAt: number
  retryCount?: number
}): OfflineTransaction {
  return {
    id,
    mutationFnName: `syncData`,
    mutations: [],
    keys: [],
    idempotencyKey: `idempotency-${id}`,
    createdAt,
    retryCount,
    nextAttemptAt,
    metadata: {},
    version: 1,
  }
}

describe(`KeyScheduler`, () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it(`does not execute a later ready transaction while an earlier retry is pending`, () => {
    vi.useFakeTimers()

    const now = new Date(`2026-01-01T00:00:00.000Z`)
    vi.setSystemTime(now)

    const scheduler = new KeyScheduler()
    const first = createTransaction({
      id: `first`,
      createdAt: new Date(now.getTime()),
      nextAttemptAt: now.getTime(),
    })
    const second = createTransaction({
      id: `second`,
      createdAt: new Date(now.getTime() + 1),
      nextAttemptAt: now.getTime(),
    })

    scheduler.schedule(first)
    scheduler.schedule(second)

    const firstBatch = scheduler.getNextBatch(1)
    expect(firstBatch.map((tx) => tx.id)).toEqual([`first`])

    scheduler.markStarted(first)
    scheduler.markFailed(first)
    scheduler.updateTransaction({
      ...first,
      retryCount: 1,
      nextAttemptAt: now.getTime() + 5000,
      lastError: {
        name: `Error`,
        message: `network timeout`,
      },
    })

    const secondBatch = scheduler.getNextBatch(1)
    expect(secondBatch).toEqual([])
  })

  it(`executes the first transaction once its retry delay has elapsed`, () => {
    vi.useFakeTimers()

    const now = new Date(`2026-01-01T00:00:00.000Z`)
    vi.setSystemTime(now)

    const scheduler = new KeyScheduler()
    const first = createTransaction({
      id: `first`,
      createdAt: new Date(now.getTime()),
      nextAttemptAt: now.getTime() + 5000,
      retryCount: 1,
    })
    const second = createTransaction({
      id: `second`,
      createdAt: new Date(now.getTime() + 1),
      nextAttemptAt: now.getTime(),
    })

    scheduler.schedule(first)
    scheduler.schedule(second)

    expect(scheduler.getNextBatch(1)).toEqual([])

    vi.advanceTimersByTime(5000)

    const batch = scheduler.getNextBatch(1)
    expect(batch.map((tx) => tx.id)).toEqual([`first`])
  })
})
