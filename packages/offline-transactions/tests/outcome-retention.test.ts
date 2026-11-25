import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OUTCOME_RETENTION_MS } from '../src/outbox/OutboxManager'
import { NonRetriableError } from '../src/types'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import type { OnlineDetector } from '../src/types'

// Rejection records for writers in other tabs live for a bounded time. These
// checks move the clock, which the durable follower oracle does not.

const offline = (): OnlineDetector => ({
  subscribe: () => () => {},
  notifyOnline: () => {},
  isOnline: () => false,
  dispose: () => {},
})

const record = (message: string, at: number) =>
  JSON.stringify({ error: { name: `NonRetriableError`, message }, at })

// A tab alone: its channel carries nothing.
class SilentChannel {
  onmessage: unknown = null
  postMessage(): void {}
  close(): void {}
}

beforeEach(() => {
  vi.stubGlobal(`BroadcastChannel`, SilentChannel)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it(`prunes outcome records older than the retention window when a tab leads`, async () => {
  const storage = new FakeStorageAdapter()
  const now = Date.now()
  await storage.set(
    `outcome:old`,
    record(`old`, now - OUTCOME_RETENTION_MS - 1),
  )
  await storage.set(
    `outcome:recent`,
    record(`recent`, now - OUTCOME_RETENTION_MS + 60_000),
  )
  const env = createTestOfflineEnvironment({
    storage,
    config: { followerWrites: `durable`, onlineDetector: offline() },
  })
  try {
    await env.waitForLeader()
    await vi.waitFor(async () => {
      expect(await storage.get(`outcome:old`)).toBe(null)
    })
    expect(await storage.get(`outcome:recent`)).toBe(
      record(`recent`, now - OUTCOME_RETENTION_MS + 60_000),
    )
  } finally {
    env.executor.dispose()
  }
})

it.each([false, true])(
  `a saved write whose row left with no record completes only within the retention window, aged=%s`,
  async (aged) => {
    vi.useFakeTimers({ toFake: [`Date`] })
    const storage = new FakeStorageAdapter()
    const env = createTestOfflineEnvironment({
      storage,
      config: { followerWrites: `durable`, onlineDetector: offline() },
    })
    let status: unknown = `pending`
    let observed: Promise<void> | undefined
    let id = ``
    try {
      await env.waitForLeader()
      const transaction = env.executor.createOfflineTransaction({
        mutationFnName: env.mutationFnName,
        autoCommit: false,
      })
      id = transaction.id
      observed = env.executor.waitForTransactionCompletion(id).then(
        () => {
          status = `completed`
        },
        (error: unknown) => {
          status = error
        },
      )
      transaction.mutate(() => {
        env.collection.insert({
          id: `saved`,
          value: `saved`,
          completed: false,
          updatedAt: new Date(),
        })
      })
      void transaction.commit().catch(() => undefined)
      await vi.waitFor(async () => {
        expect(await storage.get(`tx:${id}`)).not.toBe(null)
      })

      env.leader.setLeader(false)
      // Another leader sent and removed the row; a success records nothing.
      await storage.delete(`tx:${id}`)
      if (aged) vi.setSystemTime(Date.now() + OUTCOME_RETENTION_MS + 1)
      env.leader.setLeader(true)
      for (let turn = 0; turn < 10; turn++)
        await new Promise((resolve) => setTimeout(resolve, 0))

      // A pruned record would look the same, so an aged write keeps waiting.
      expect(status).toBe(aged ? `pending` : `completed`)
    } finally {
      if (status === `pending` && id)
        env.executor.rejectTransaction(id, new NonRetriableError(`cleanup`))
      await observed
      env.executor.dispose()
    }
  },
)
