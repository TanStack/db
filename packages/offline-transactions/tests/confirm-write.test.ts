import { describe, expect, it } from 'vitest'
import { createTestOfflineEnvironment } from './harness'
import type { ConfirmWriteContext, OfflineConfig } from '../src/types'

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * A mutationFn that "commits on the server" but never feeds the row back into
 * the collection's synced stream. This reproduces the real-world gap the
 * `confirmWrite` hook targets: the write is durable server-side, but the sync
 * stream hasn't echoed it back yet — so the optimistic overlay is the ONLY
 * thing keeping the row visible. With the hook the row stays until the hook
 * settles; without it the row vanishes the instant the transaction resolves.
 */
const committedButNotSynced = async () => ({ txid: 42 })

async function insertAndCommit(
  env: ReturnType<typeof createTestOfflineEnvironment>,
  id: string,
) {
  const offlineTx = env.executor.createOfflineTransaction({
    mutationFnName: env.mutationFnName,
    autoCommit: false,
  })
  offlineTx.mutate(() => {
    env.collection.insert({
      id,
      value: id,
      completed: false,
      updatedAt: new Date(),
    })
  })
  await offlineTx.commit()
  return offlineTx
}

describe(`OfflineConfig.confirmWrite`, () => {
  it(`holds optimistic state past commit until the hook settles, then releases`, async () => {
    const gate = deferred()
    const calls: Array<ConfirmWriteContext> = []
    const env = createTestOfflineEnvironment({
      mutationFn: committedButNotSynced,
      config: {
        confirmWrite: (context) => {
          calls.push(context)
          return gate.promise
        },
      },
    })
    await env.waitForLeader()

    const offlineTx = await insertAndCommit(env, `item-1`)
    await flushMicrotasks()

    // The server committed but the sync stream never delivered the row, so the
    // ONLY thing keeping it visible is the confirmation hold. It must be there.
    expect(env.executor.getActiveConfirmationHoldCount()).toBe(1)
    expect(env.collection.get(`item-1`)?.value).toBe(`item-1`)

    // The hook received the committed mutations and the mutationFn's result.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.transactionId).toBe(offlineTx.id)
    expect(calls[0]!.mutations).toHaveLength(1)
    expect(calls[0]!.result).toEqual({ txid: 42 })

    // Settle the hook → hold released. With nothing in the synced stream, the
    // optimistic row now drops (in production the sync stream would have it).
    gate.resolve()
    await flushMicrotasks()

    expect(env.executor.getActiveConfirmationHoldCount()).toBe(0)
    expect(env.collection.get(`item-1`)).toBeUndefined()

    env.executor.dispose()
  })

  it(`does not block the serial drain: a hung hook still lets the next write POST`, async () => {
    const never = deferred() // confirmWrite that never settles
    const env = createTestOfflineEnvironment({
      mutationFn: committedButNotSynced,
      config: {
        confirmWrite: () => never.promise,
      },
    })
    await env.waitForLeader()

    await insertAndCommit(env, `item-1`)
    await insertAndCommit(env, `item-2`)
    await flushMicrotasks()

    // Both mutationFns ran even though the first hook never settled — the
    // confirmation runs OFF the serial path. Pre-fix, awaiting confirmation
    // inline would have parked the queue on the first write.
    expect(env.mutationCalls).toHaveLength(2)
    expect(env.executor.getActiveConfirmationHoldCount()).toBe(2)

    env.executor.dispose()
  })

  it(`releases the hold even when the hook rejects (write is already committed)`, async () => {
    const env = createTestOfflineEnvironment({
      mutationFn: committedButNotSynced,
      config: {
        confirmWrite: () => Promise.reject(new Error(`shape never confirmed`)),
      },
    })
    await env.waitForLeader()

    await insertAndCommit(env, `item-1`)
    await flushMicrotasks()

    // A rejection is not a rollback: the hold is released, not retried, and the
    // drain is unaffected.
    expect(env.executor.getActiveConfirmationHoldCount()).toBe(0)
    expect(env.collection.get(`item-1`)).toBeUndefined()

    env.executor.dispose()
  })

  it(`without the hook, optimistic state drops at commit (the gap the hook fills)`, async () => {
    const env = createTestOfflineEnvironment({
      mutationFn: committedButNotSynced,
    })
    await env.waitForLeader()

    await insertAndCommit(env, `item-1`)
    await flushMicrotasks()

    expect(env.executor.getActiveConfirmationHoldCount()).toBe(0)
    expect(env.collection.get(`item-1`)).toBeUndefined()

    env.executor.dispose()
  })

  it(`skips the hold past maxConfirmationHolds (O(n^2) safety valve)`, async () => {
    const gate = deferred()
    const config: Partial<OfflineConfig> = {
      confirmWrite: () => gate.promise,
      maxConfirmationHolds: 0,
    }
    const env = createTestOfflineEnvironment({
      mutationFn: committedButNotSynced,
      config,
    })
    await env.waitForLeader()

    await insertAndCommit(env, `item-1`)
    await flushMicrotasks()

    // Cap is 0, so no hold is created — the write still succeeds, the overlay
    // just drops at commit as it would without the hook.
    expect(env.executor.getActiveConfirmationHoldCount()).toBe(0)
    expect(env.collection.get(`item-1`)).toBeUndefined()

    gate.resolve()
    env.executor.dispose()
  })

  it(`releases all holds on dispose`, async () => {
    const never = deferred()
    const env = createTestOfflineEnvironment({
      mutationFn: committedButNotSynced,
      config: {
        confirmWrite: () => never.promise,
      },
    })
    await env.waitForLeader()

    await insertAndCommit(env, `item-1`)
    await flushMicrotasks()
    expect(env.executor.getActiveConfirmationHoldCount()).toBe(1)

    env.executor.dispose()
    expect(env.executor.getActiveConfirmationHoldCount()).toBe(0)
  })
})
