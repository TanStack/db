// Ordinary unit tests for KeyScheduler's selective removal of unissued work. The
// generated lifecycle law is owned by KeyScheduler-oracle.property.test.ts
// (offline.key-scheduler-fifo-ledger).
import { describe, expect, it } from 'vitest'
import { KeyScheduler } from '../src/executor/KeyScheduler'
import { BASE_TIME, createTransaction } from './key-scheduler-support'

describe(`KeyScheduler generated lifecycle`, () => {
  it(`selectively removes only unissued work`, () => {
    const scheduler = new KeyScheduler()
    const active = createTransaction(``, BASE_TIME, BASE_TIME, 1)
    const removed = createTransaction(`removed`, BASE_TIME + 1, BASE_TIME, 2)
    const retained = createTransaction(`retained`, BASE_TIME + 2, BASE_TIME, 3)
    scheduler.schedule(active)
    scheduler.schedule(removed)
    scheduler.schedule(retained)
    scheduler.markStarted(active)

    expect(
      scheduler.removePendingTransactions([active.id, removed.id, `missing`]),
    ).toEqual([removed.id, `missing`])

    expect({
      pending: scheduler.getAllPendingTransactions().map(({ id }) => id),
      running: scheduler.getRunningCount(),
    }).toEqual({ pending: [active.id, retained.id], running: 1 })
    scheduler.markCompleted(active)
    expect(scheduler.getNext()?.id).toBe(retained.id)
  })
})
