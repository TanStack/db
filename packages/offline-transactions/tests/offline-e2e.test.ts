import { describe, expect, it } from "vitest"
import { createTestOfflineEnvironment } from "./harness"

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
})
