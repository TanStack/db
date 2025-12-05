import { describe, expect, it } from 'vitest'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'
import type { TestItem } from './harness'
import type { PendingMutation } from '@tanstack/db'

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

const waitUntil = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 20,
) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out waiting for condition`)
}

describe(`leader failover`, () => {
  it(`transfers pending transactions from old leader to new leader`, async () => {
    const sharedStorage = new FakeStorageAdapter()

    // Create executor A as leader
    const envA = createTestOfflineEnvironment({
      storage: sharedStorage,
      mutationFn: () => {
        throw new Error(`offline`)
      },
    })

    await envA.waitForLeader()
    expect(envA.executor.isOfflineEnabled).toBe(true)

    // Create a transaction that will fail and persist to outbox
    const txA = envA.executor.createOfflineTransaction({
      mutationFnName: envA.mutationFnName,
      autoCommit: false,
    })

    txA.mutate(() => {
      envA.collection.insert({
        id: `failover-item`,
        value: `transfer-me`,
        completed: false,
        updatedAt: new Date(),
      })
    })

    // Start commit - it will fail and persist to outbox
    txA.commit()

    // Wait for transaction to be in outbox
    await waitUntil(async () => {
      const outbox = await envA.executor.peekOutbox()
      return outbox.length === 1
    })

    // Verify A has the transaction in outbox
    const outboxA = await envA.executor.peekOutbox()
    expect(outboxA).toHaveLength(1)
    expect(outboxA[0].id).toBe(txA.id)

    // Now create executor B with same storage, starts as non-leader
    const envB = createTestOfflineEnvironment({
      storage: sharedStorage,
      mutationFn: (params) => {
        const mutations = params.transaction.mutations as Array<
          PendingMutation<TestItem>
        >
        envB.applyMutations(mutations)
        return { ok: true, mutations }
      },
      config: {
        leaderElection: undefined, // Will use its own leader
      },
    })

    // Initially B is non-leader
    envB.leader.setLeader(false)
    await flushMicrotasks()
    expect(envB.executor.isOfflineEnabled).toBe(false)

    // Switch leadership: A loses, B gains
    envA.leader.setLeader(false)
    envB.leader.setLeader(true)

    await flushMicrotasks()

    // Verify leadership states
    expect(envA.executor.isOfflineEnabled).toBe(false)
    expect(envB.executor.isOfflineEnabled).toBe(true)

    // Wait for B to execute the transaction
    await waitUntil(() => envB.mutationCalls.length >= 1)

    // Verify B executed the transaction
    expect(envB.mutationCalls).toHaveLength(1)
    expect(envB.serverState.get(`failover-item`)?.value).toBe(`transfer-me`)

    // Verify outbox is now empty (transaction completed)
    await waitUntil(async () => {
      const outbox = await envB.executor.peekOutbox()
      return outbox.length === 0
    })

    envA.executor.dispose()
    envB.executor.dispose()
  })

  it(`non-leader remains passive until it becomes leader`, async () => {
    const sharedStorage = new FakeStorageAdapter()

    // Create executor A as leader with a failing mutation
    const envA = createTestOfflineEnvironment({
      storage: sharedStorage,
      mutationFn: () => {
        throw new Error(`offline`)
      },
    })

    await envA.waitForLeader()

    // Create executor B as non-leader with working mutation
    const envB = createTestOfflineEnvironment({
      storage: sharedStorage,
      mutationFn: (params) => {
        const mutations = params.transaction.mutations as Array<
          PendingMutation<TestItem>
        >
        envB.applyMutations(mutations)
        return { ok: true, mutations }
      },
    })

    envB.leader.setLeader(false)
    await flushMicrotasks()

    // A creates a transaction that goes to outbox
    const txA = envA.executor.createOfflineTransaction({
      mutationFnName: envA.mutationFnName,
      autoCommit: false,
    })

    txA.mutate(() => {
      envA.collection.insert({
        id: `passive-test`,
        value: `waiting`,
        completed: false,
        updatedAt: new Date(),
      })
    })

    txA.commit()

    await waitUntil(async () => {
      const outbox = await envA.executor.peekOutbox()
      return outbox.length === 1
    })

    // B should not execute while non-leader
    await flushMicrotasks()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(envB.mutationCalls).toHaveLength(0)

    // Now make B the leader
    envA.leader.setLeader(false)
    envB.leader.setLeader(true)
    await flushMicrotasks()

    // B should now execute the transaction
    await waitUntil(() => envB.mutationCalls.length >= 1)
    expect(envB.mutationCalls).toHaveLength(1)
    expect(envB.serverState.get(`passive-test`)?.value).toBe(`waiting`)

    envA.executor.dispose()
    envB.executor.dispose()
  })

  it(`transaction survives multiple leadership transitions`, async () => {
    const sharedStorage = new FakeStorageAdapter()

    // Create executor A (will fail)
    const envA = createTestOfflineEnvironment({
      storage: sharedStorage,
      mutationFn: () => {
        throw new Error(`A fails`)
      },
    })

    await envA.waitForLeader()

    // Create transaction from A
    const txA = envA.executor.createOfflineTransaction({
      mutationFnName: envA.mutationFnName,
      autoCommit: false,
    })

    txA.mutate(() => {
      envA.collection.insert({
        id: `survivor`,
        value: `resilient`,
        completed: false,
        updatedAt: new Date(),
      })
    })

    txA.commit()

    await waitUntil(async () => {
      const outbox = await envA.executor.peekOutbox()
      return outbox.length === 1
    })

    // Create executor B (will also fail)
    const envB = createTestOfflineEnvironment({
      storage: sharedStorage,
      mutationFn: () => {
        throw new Error(`B fails`)
      },
    })

    envB.leader.setLeader(false)

    // Create executor C (will succeed)
    const envC = createTestOfflineEnvironment({
      storage: sharedStorage,
      mutationFn: (params) => {
        const mutations = params.transaction.mutations as Array<
          PendingMutation<TestItem>
        >
        envC.applyMutations(mutations)
        return { ok: true, mutations }
      },
    })

    envC.leader.setLeader(false)

    // Transfer to B
    envA.leader.setLeader(false)
    envB.leader.setLeader(true)
    await flushMicrotasks()

    // Wait for B to attempt and fail
    await waitUntil(() => envB.mutationCalls.length >= 1)
    expect(envB.mutationCalls).toHaveLength(1)

    // Transaction should still be in outbox
    const outboxB = await envB.executor.peekOutbox()
    expect(outboxB).toHaveLength(1)

    // Transfer to C
    envB.leader.setLeader(false)
    envC.leader.setLeader(true)
    await flushMicrotasks()

    // Wait for C to execute successfully
    await waitUntil(() => envC.mutationCalls.length >= 1)
    expect(envC.mutationCalls).toHaveLength(1)
    expect(envC.serverState.get(`survivor`)?.value).toBe(`resilient`)

    // Outbox should now be empty
    await waitUntil(async () => {
      const outbox = await envC.executor.peekOutbox()
      return outbox.length === 0
    })

    envA.executor.dispose()
    envB.executor.dispose()
    envC.executor.dispose()
  })

  it(`new transactions from non-leader go online-only`, async () => {
    const sharedStorage = new FakeStorageAdapter()

    const envA = createTestOfflineEnvironment({
      storage: sharedStorage,
    })

    await envA.waitForLeader()

    const envB = createTestOfflineEnvironment({
      storage: sharedStorage,
    })

    envB.leader.setLeader(false)
    await flushMicrotasks()

    // Create transaction from non-leader B
    const txB = envB.executor.createOfflineTransaction({
      mutationFnName: envB.mutationFnName,
      autoCommit: false,
    })

    txB.mutate(() => {
      envB.collection.insert({
        id: `online-only`,
        value: `no-outbox`,
        completed: false,
        updatedAt: new Date(),
      })
    })

    await txB.commit()

    // Should have executed immediately without outbox
    expect(envB.mutationCalls).toHaveLength(1)

    // Should NOT be in outbox
    const outbox = await envB.executor.peekOutbox()
    expect(outbox).toHaveLength(0)

    // Now create transaction from leader A
    const txA = envA.executor.createOfflineTransaction({
      mutationFnName: envA.mutationFnName,
      autoCommit: false,
    })

    txA.mutate(() => {
      envA.collection.insert({
        id: `outbox-item`,
        value: `in-outbox`,
        completed: false,
        updatedAt: new Date(),
      })
    })

    await txA.commit()

    // A's transaction should have gone through outbox
    expect(envA.mutationCalls.length).toBeGreaterThanOrEqual(1)

    envA.executor.dispose()
    envB.executor.dispose()
  })

  it(`calls onLeadershipChange callback on both gain and loss`, async () => {
    const sharedStorage = new FakeStorageAdapter()
    const callbackCalls: Array<{ executor: string; isLeader: boolean }> = []

    const envA = createTestOfflineEnvironment({
      storage: sharedStorage,
      config: {
        onLeadershipChange: (isLeader) => {
          callbackCalls.push({ executor: `A`, isLeader })
        },
      },
    })

    await envA.waitForLeader()

    // A should have been called with true
    expect(callbackCalls).toContainEqual({ executor: `A`, isLeader: true })

    const envB = createTestOfflineEnvironment({
      storage: sharedStorage,
      config: {
        onLeadershipChange: (isLeader) => {
          callbackCalls.push({ executor: `B`, isLeader })
        },
      },
    })

    envB.leader.setLeader(false)
    await flushMicrotasks()

    // B should have been called with false
    expect(callbackCalls).toContainEqual({ executor: `B`, isLeader: false })

    const beforeLength = callbackCalls.length

    // Transfer leadership
    envA.leader.setLeader(false)
    await flushMicrotasks()
    envB.leader.setLeader(true)
    await flushMicrotasks()

    // Both should have been called
    const newCalls = callbackCalls.slice(beforeLength)
    expect(newCalls).toContainEqual({ executor: `A`, isLeader: false })
    expect(newCalls).toContainEqual({ executor: `B`, isLeader: true })

    envA.executor.dispose()
    envB.executor.dispose()
  })
})
