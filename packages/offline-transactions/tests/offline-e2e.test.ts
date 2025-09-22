import { describe, expect, it } from "vitest"
import { NonRetriableError } from "../src/types"
import { FakeStorageAdapter, createTestOfflineEnvironment } from "./harness"
import type { TestItem } from "./harness"
import type { OfflineMutationFnParams } from "../src/types"
import type { PendingMutation } from "@tanstack/db"

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

const waitUntil = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 20
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

describe(`offline executor end-to-end`, () => {
  it(`resolves waiting promises for successful transactions`, async () => {
    const env = createTestOfflineEnvironment()

    await env.waitForLeader()

    const offlineTx = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })

    const waitPromise = env.executor.waitForTransactionCompletion(offlineTx.id)

    const now = new Date()
    offlineTx.mutate(() => {
      env.collection.insert({
        id: `item-1`,
        value: `hello`,
        completed: false,
        updatedAt: now,
      })
    })

    await offlineTx.commit()

    await expect(waitPromise).resolves.toBeUndefined()

    const outboxEntries = await env.executor.peekOutbox()
    expect(outboxEntries).toEqual([])

    expect(env.mutationCalls.length).toBeGreaterThanOrEqual(1)
    const call = env.mutationCalls[env.mutationCalls.length - 1]!
    expect(call.transaction.mutations).toHaveLength(1)
    expect(call.transaction.mutations[0].key).toBe(`item-1`)
    const stored = env.collection.get(`item-1`)
    expect(stored?.value).toBe(`hello`)
    expect(env.serverState.get(`item-1`)?.value).toBe(`hello`)

    env.executor.dispose()
  })

  it(`retries queued transactions when backend resumes`, async () => {
    let online = false
    const env = createTestOfflineEnvironment({
      mutationFn: (params) => {
        const runtimeOnline = online
        const mutations = params.transaction.mutations as Array<
          PendingMutation<TestItem>
        >
        if (!runtimeOnline) {
          throw new Error(`offline`)
        }
        env.applyMutations(mutations)
        return { ok: true, mutations }
      },
    })

    await env.waitForLeader()

    const offlineTx = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })

    const now = new Date()
    offlineTx.mutate(() => {
      env.collection.insert({
        id: `queued-item`,
        value: `queued`,
        completed: false,
        updatedAt: now,
      })
    })

    // Commit should not throw for retriable errors - it persists to outbox
    const commitPromise = offlineTx.commit()

    // Wait a bit for the transaction to be processed
    await flushMicrotasks()

    // Check that the transaction was attempted once
    expect(env.mutationCalls.length).toBe(1)

    // Check that the transaction is in the outbox (persisted for retry)
    let outboxEntries = await env.executor.peekOutbox()
    expect(outboxEntries.length).toBe(1)
    expect(outboxEntries[0].id).toBe(offlineTx.id)

    // Now bring the system back online
    online = true
    env.executor.notifyOnline()

    // Wait for the retry to succeed
    await waitUntil(() => env.mutationCalls.length >= 2)

    // The original commit promise should now resolve
    await expect(commitPromise).resolves.toBeDefined()

    // Check that the transaction completed successfully
    outboxEntries = await env.executor.peekOutbox()
    expect(outboxEntries).toEqual([])

    outboxEntries = await env.executor.peekOutbox()
    expect(outboxEntries).toEqual([])
    expect(env.mutationCalls.length).toBeGreaterThanOrEqual(2)
    expect(env.serverState.get(`queued-item`)?.value).toBe(`queued`)

    env.executor.dispose()
  })

  it(`rejects waiting promises for permanent failures and rolls back optimistic state`, async () => {
    const error = new NonRetriableError(`permanent`)
    const env = createTestOfflineEnvironment({
      mutationFn: () => {
        throw error
      },
    })

    await env.waitForLeader()

    const offlineTx = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })

    const waitPromise = env.executor.waitForTransactionCompletion(offlineTx.id)

    offlineTx.mutate(() => {
      env.collection.insert({
        id: `perm-item`,
        value: `nope`,
        completed: false,
        updatedAt: new Date(),
      })
    })

    await expect(offlineTx.commit()).rejects.toThrow(`permanent`)
    await expect(waitPromise).rejects.toThrow(`permanent`)

    const outboxEntries = await env.executor.peekOutbox()
    expect(outboxEntries).toEqual([])
    expect(env.collection.get(`perm-item`)).toBeUndefined()
    expect(env.serverState.get(`perm-item`)).toBeUndefined()

    env.executor.dispose()
  })

  it(`replays persisted transactions on startup`, async () => {
    const storage = new FakeStorageAdapter()

    const offlineErrorEnv = createTestOfflineEnvironment({
      storage,
      mutationFn: () => {
        throw new Error(`offline`)
      },
    })

    await offlineErrorEnv.waitForLeader()

    const offlineTx = offlineErrorEnv.executor.createOfflineTransaction({
      mutationFnName: offlineErrorEnv.mutationFnName,
      autoCommit: false,
    })

    offlineTx.mutate(() => {
      offlineErrorEnv.collection.insert({
        id: `persisted`,
        value: `from-outbox`,
        completed: false,
        updatedAt: new Date(),
      })
    })

    // Start the commit - it will persist to outbox and keep retrying
    // We don't await it because it will never complete (mutation always fails)
    offlineTx.commit()

    // Wait for the transaction to be persisted to outbox
    await waitUntil(async () => {
      const pendingEntries = await offlineErrorEnv.executor.peekOutbox()
      return pendingEntries.length === 1
    }, 5000)

    // Verify it's in the outbox
    const outboxEntries = await offlineErrorEnv.executor.peekOutbox()
    expect(outboxEntries.length).toBe(1)
    expect(outboxEntries[0].id).toBe(offlineTx.id)

    offlineErrorEnv.executor.dispose()

    const replayEnv = createTestOfflineEnvironment({
      storage,
      mutationFn: (
        params: OfflineMutationFnParams & { attempt: number }
      ) => {
        const mutations = params.transaction.mutations as Array<
          PendingMutation<TestItem>
        >
        replayEnv.applyMutations(mutations)
        return { ok: true, mutations }
      },
    })

    await replayEnv.waitForLeader()
    await waitUntil(async () => {
      const entries = await replayEnv.executor.peekOutbox()
      return entries.length === 0
    })
    expect(replayEnv.serverState.get(`persisted`)?.value).toBe(`from-outbox`)

    replayEnv.executor.dispose()
  })

  it(`serializes transactions targeting the same key`, async () => {
    const pendingResolvers: Array<() => void> = []
    const env = createTestOfflineEnvironment({
      mutationFn: async (params) => {
        const mutations = params.transaction.mutations as Array<
          PendingMutation<TestItem>
        >

        await new Promise<void>((resolve) => {
          pendingResolvers.push(() => {
            env.applyMutations(mutations)
            resolve()
          })
        })

        return { ok: true, mutations }
      },
    })

    await env.waitForLeader()

    const firstTx = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    const waitFirst = env.executor.waitForTransactionCompletion(firstTx.id)
    firstTx.mutate(() => {
      env.collection.insert({
        id: `shared`,
        value: `v1`,
        completed: false,
        updatedAt: new Date(),
      })
    })
    const commitFirst = firstTx.commit()

    await flushMicrotasks()
    expect(env.mutationCalls.length).toBe(1)
    expect(pendingResolvers.length).toBe(1)

    const secondTx = env.executor.createOfflineTransaction({
      mutationFnName: env.mutationFnName,
      autoCommit: false,
    })
    const waitSecond = env.executor.waitForTransactionCompletion(secondTx.id)
    secondTx.mutate(() => {
      env.collection.update(`shared`, (draft) => {
        draft.value = `v2`
        draft.updatedAt = new Date()
      })
    })
    const commitSecond = secondTx.commit()

    await flushMicrotasks()
    expect(env.mutationCalls.length).toBe(1)
    expect(pendingResolvers.length).toBe(1)

    pendingResolvers.shift()?.()
    await commitFirst
    await waitFirst
    await waitUntil(() => env.mutationCalls.length >= 2)
    expect(pendingResolvers.length).toBe(1)

    pendingResolvers.shift()?.()
    await commitSecond
    await waitSecond
    await waitUntil(() => env.serverState.get(`shared`)?.value === `v2`)

    env.executor.dispose()
  })

  it(`allows concurrent mutations on distinct keys`, async () => {
    const pendingResolvers: Array<() => void> = []
    let env: ReturnType<typeof createTestOfflineEnvironment> | undefined

    const deferredMutation = async (
      params: OfflineMutationFnParams & { attempt: number }
    ) => {
      const runtimeEnv = env
      if (!runtimeEnv) {
        throw new Error(`env not initialized`)
      }

      const mutations = params.transaction.mutations as Array<
        PendingMutation<TestItem>
      >

      await new Promise<void>((resolve) => {
        pendingResolvers.push(() => {
          runtimeEnv.applyMutations(mutations)
          resolve()
        })
      })

      return { ok: true, mutations }
    }

    env = createTestOfflineEnvironment({
      mutationFn: deferredMutation,
    })

    const runtimeEnv = env

    await runtimeEnv.waitForLeader()

    const firstTx = runtimeEnv.executor.createOfflineTransaction({
      mutationFnName: runtimeEnv.mutationFnName,
      autoCommit: false,
    })
    const waitFirst = runtimeEnv.executor.waitForTransactionCompletion(
      firstTx.id
    )
    firstTx.mutate(() => {
      runtimeEnv.collection.insert({
        id: `first`,
        value: `1`,
        completed: false,
        updatedAt: new Date(),
      })
    })
    const commitFirst = firstTx.commit()

    const secondTx = runtimeEnv.executor.createOfflineTransaction({
      mutationFnName: runtimeEnv.mutationFnName,
      autoCommit: false,
    })
    const waitSecond = runtimeEnv.executor.waitForTransactionCompletion(
      secondTx.id
    )
    secondTx.mutate(() => {
      runtimeEnv.collection.insert({
        id: `second`,
        value: `2`,
        completed: false,
        updatedAt: new Date(),
      })
    })
    const commitSecond = secondTx.commit()

    await flushMicrotasks()
    expect(runtimeEnv.mutationCalls.length).toBe(2)
    expect(pendingResolvers.length).toBe(2)

    pendingResolvers.forEach((resolve) => resolve())
    await Promise.all([commitFirst, commitSecond, waitFirst, waitSecond])

    expect(runtimeEnv.serverState.get(`first`)?.value).toBe(`1`)
    expect(runtimeEnv.serverState.get(`second`)?.value).toBe(`2`)

    runtimeEnv.executor.dispose()
  })
})
