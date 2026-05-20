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

    const firstTx = scheduler.getNext()
    expect(firstTx?.id).toBe(`first`)

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

    const secondTx = scheduler.getNext()
    expect(secondTx).toBeUndefined()
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

    expect(scheduler.getNext()).toBeUndefined()

    vi.advanceTimersByTime(5000)

    const result = scheduler.getNext()
    expect(result?.id).toBe(`first`)
  })

  it(`processes the second transaction after the first completes`, () => {
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

    const tx1 = scheduler.getNext()
    expect(tx1?.id).toBe(`first`)

    scheduler.markStarted(first)
    scheduler.markCompleted(first)

    const tx2 = scheduler.getNext()
    expect(tx2?.id).toBe(`second`)
  })

  it(`returns nothing while a transaction is running`, () => {
    vi.useFakeTimers()

    const now = new Date(`2026-01-01T00:00:00.000Z`)
    vi.setSystemTime(now)

    const scheduler = new KeyScheduler()
    const tx = createTransaction({
      id: `tx1`,
      createdAt: new Date(now.getTime()),
      nextAttemptAt: now.getTime(),
    })

    scheduler.schedule(tx)
    scheduler.markStarted(tx)

    expect(scheduler.getNext()).toBeUndefined()
  })

  it(`processes second transaction after first retries and succeeds`, () => {
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

    scheduler.markStarted(first)
    scheduler.markFailed(first)
    scheduler.updateTransaction({
      ...first,
      retryCount: 1,
      nextAttemptAt: now.getTime() + 5000,
    })

    expect(scheduler.getNext()).toBeUndefined()

    vi.advanceTimersByTime(5000)

    const retryTx = scheduler.getNext()
    expect(retryTx?.id).toBe(`first`)

    scheduler.markStarted(retryTx!)
    scheduler.markCompleted(retryTx!)

    const finalTx = scheduler.getNext()
    expect(finalTx?.id).toBe(`second`)
  })

  it(`maintains FIFO order regardless of scheduling order`, () => {
    vi.useFakeTimers()

    const now = new Date(`2026-01-01T00:00:00.000Z`)
    vi.setSystemTime(now)

    const scheduler = new KeyScheduler()
    const older = createTransaction({
      id: `older`,
      createdAt: new Date(now.getTime()),
      nextAttemptAt: now.getTime(),
    })
    const newer = createTransaction({
      id: `newer`,
      createdAt: new Date(now.getTime() + 1),
      nextAttemptAt: now.getTime(),
    })

    scheduler.schedule(newer)
    scheduler.schedule(older)

    const next = scheduler.getNext()
    expect(next?.id).toBe(`older`)
  })

  it(`preserves FIFO order after updateTransaction`, () => {
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

    scheduler.updateTransaction({
      ...first,
      retryCount: 1,
      nextAttemptAt: now.getTime() + 5000,
    })

    vi.advanceTimersByTime(5000)

    const next = scheduler.getNext()
    expect(next?.id).toBe(`first`)
  })

  it(`returns undefined when no transactions are scheduled`, () => {
    const scheduler = new KeyScheduler()
    expect(scheduler.getNext()).toBeUndefined()
  })

  it(`updates many pending transactions in one call`, () => {
    const now = Date.now()
    const scheduler = new KeyScheduler()
    const first = createTransaction({
      id: `first`,
      createdAt: new Date(now),
      nextAttemptAt: now,
    })
    const second = createTransaction({
      id: `second`,
      createdAt: new Date(now + 1),
      nextAttemptAt: now,
    })

    scheduler.schedule(first)
    scheduler.schedule(second)

    scheduler.updateTransactions([
      { ...first, retryCount: 1, nextAttemptAt: now + 1000 },
      { ...second, retryCount: 2, nextAttemptAt: now + 2000 },
    ])

    const pending = scheduler.getAllPendingTransactions()
    expect(pending.find((tx) => tx.id === `first`)).toMatchObject({
      retryCount: 1,
      nextAttemptAt: now + 1000,
    })
    expect(pending.find((tx) => tx.id === `second`)).toMatchObject({
      retryCount: 2,
      nextAttemptAt: now + 2000,
    })
  })

  it(`ignores unknown transaction ids when updating many transactions`, () => {
    const now = Date.now()
    const scheduler = new KeyScheduler()
    const existing = createTransaction({
      id: `existing`,
      createdAt: new Date(now),
      nextAttemptAt: now,
    })
    const unknown = createTransaction({
      id: `unknown`,
      createdAt: new Date(now + 1),
      nextAttemptAt: now + 1000,
    })

    scheduler.schedule(existing)
    scheduler.updateTransactions([unknown])

    expect(scheduler.getAllPendingTransactions()).toEqual([existing])
  })

  it(`preserves pending transactions not included in bulk updates`, () => {
    const now = Date.now()
    const scheduler = new KeyScheduler()
    const updated = createTransaction({
      id: `updated`,
      createdAt: new Date(now),
      nextAttemptAt: now,
    })
    const untouched = createTransaction({
      id: `untouched`,
      createdAt: new Date(now + 1),
      nextAttemptAt: now,
    })

    scheduler.schedule(updated)
    scheduler.schedule(untouched)
    scheduler.updateTransactions([{ ...updated, retryCount: 3 }])

    const pending = scheduler.getAllPendingTransactions()
    expect(pending.find((tx) => tx.id === `updated`)?.retryCount).toBe(3)
    expect(pending.find((tx) => tx.id === `untouched`)).toBe(untouched)
  })

  it(`uses the last duplicate id when bulk updating transactions`, () => {
    const now = Date.now()
    const scheduler = new KeyScheduler()
    const transaction = createTransaction({
      id: `duplicate`,
      createdAt: new Date(now),
      nextAttemptAt: now,
    })

    scheduler.schedule(transaction)
    scheduler.updateTransactions([
      { ...transaction, retryCount: 1 },
      { ...transaction, retryCount: 2 },
    ])

    expect(scheduler.getAllPendingTransactions()[0]?.retryCount).toBe(2)
  })

  it(`keeps FIFO order after bulk updates`, () => {
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
    scheduler.updateTransactions([
      { ...second, retryCount: 1 },
      { ...first, retryCount: 1 },
    ])

    expect(scheduler.getNext()?.id).toBe(`first`)
  })

  it(`returns null for earliest retry time when empty`, () => {
    const scheduler = new KeyScheduler()
    expect(scheduler.getEarliestRetryTime()).toBeNull()
  })

  it(`returns the minimum nextAttemptAt as the earliest retry time`, () => {
    const now = Date.now()
    const scheduler = new KeyScheduler()

    scheduler.schedule(
      createTransaction({
        id: `later`,
        createdAt: new Date(now),
        nextAttemptAt: now + 5000,
      }),
    )
    scheduler.schedule(
      createTransaction({
        id: `earlier`,
        createdAt: new Date(now + 1),
        nextAttemptAt: now - 1000,
      }),
    )

    expect(scheduler.getEarliestRetryTime()).toBe(now - 1000)
  })

  it(`processes transactions with identical createdAt in scheduling order`, () => {
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
      createdAt: new Date(now.getTime()),
      nextAttemptAt: now.getTime(),
    })

    scheduler.schedule(first)
    scheduler.schedule(second)

    const tx1 = scheduler.getNext()
    expect(tx1?.id).toBe(`first`)

    scheduler.markStarted(first)
    scheduler.markCompleted(first)

    const tx2 = scheduler.getNext()
    expect(tx2?.id).toBe(`second`)
  })
})
