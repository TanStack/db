import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebLocksLeader } from '../src/coordination/WebLocksLeader'
import { FakeStorageAdapter, createTestOfflineEnvironment } from './harness'

const waitUntil = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for condition`)
}

// The smallest exclusive lock manager an executor needs.
const createLocks = () => {
  let held = false
  const pending: Array<() => void> = []
  const grant = (run: () => unknown, resolve: (value: unknown) => void) => {
    held = true
    void Promise.resolve(run()).then((value) => {
      held = false
      resolve(value)
      pending.shift()?.()
    })
  }
  return {
    request(
      _name: string,
      options: { ifAvailable?: boolean; signal?: AbortSignal },
      callback: (lock: object | null) => unknown,
    ) {
      return new Promise((resolve, reject) => {
        if (options.ifAvailable && held) {
          resolve(callback(null))
          return
        }
        const start = () => grant(() => callback({}), resolve)
        if (!held) {
          start()
          return
        }
        pending.push(start)
        options.signal?.addEventListener(
          `abort`,
          () => {
            pending.splice(pending.indexOf(start), 1)
            reject(new DOMException(`Aborted`, `AbortError`))
          },
          { once: true },
        )
      })
    },
  }
}

// Disposed after each test too, so a failed assertion stops their retries.
const environments: Array<ReturnType<typeof createTestOfflineEnvironment>> = []
const createEnvironment = (
  options: Parameters<typeof createTestOfflineEnvironment>[0],
) => {
  const environment = createTestOfflineEnvironment(options)
  environments.push(environment)
  return environment
}

describe(`Web Locks failover through the executor`, () => {
  afterEach(() => {
    for (const environment of environments.splice(0)) {
      environment.executor.dispose()
    }
    vi.unstubAllGlobals()
  })

  it(`a waiting executor takes over and replays the outbox`, async () => {
    vi.stubGlobal(`navigator`, { locks: createLocks() })
    const storage = new FakeStorageAdapter()
    const leadership: Array<boolean> = []

    const first = createEnvironment({
      storage,
      config: { leaderElection: new WebLocksLeader(`failover`) },
      mutationFn: () => {
        throw new Error(`offline`)
      },
    })
    await first.executor.waitForInit()
    expect(first.executor.isOfflineEnabled).toBe(true)

    const transaction = first.executor.createOfflineTransaction({
      mutationFnName: first.mutationFnName,
      autoCommit: false,
    })
    transaction.mutate(() => {
      first.collection.insert({
        id: `pending`,
        value: `replay me`,
        completed: false,
        updatedAt: new Date(),
      })
    })
    void transaction.commit().catch(() => undefined)
    await waitUntil(
      async () => (await first.executor.peekOutbox()).length === 1,
    )

    const replayed: Array<string> = []
    const second = createEnvironment({
      storage,
      config: {
        leaderElection: new WebLocksLeader(`failover`),
        onLeadershipChange: (isLeader) => leadership.push(isLeader),
      },
      mutationFn: (params) => {
        for (const mutation of params.transaction.mutations) {
          replayed.push(String(mutation.key))
        }
        second.applyMutations(params.transaction.mutations)
        return { ok: true, mutations: params.transaction.mutations }
      },
    })
    await second.executor.waitForInit()
    expect(second.executor.isOfflineEnabled).toBe(false)

    first.executor.dispose()
    await waitUntil(() => second.executor.isOfflineEnabled)
    await waitUntil(
      async () => (await second.executor.peekOutbox()).length === 0,
    )

    expect(leadership).toEqual([false, true])
    expect(replayed).toEqual([`pending`])
    second.executor.dispose()
  })

  it(`a takeover replays even when the leadership callback throws`, async () => {
    vi.stubGlobal(`navigator`, { locks: createLocks() })
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const storage = new FakeStorageAdapter()
    const first = createEnvironment({
      storage,
      config: { leaderElection: new WebLocksLeader(`failover-callback`) },
      mutationFn: () => {
        throw new Error(`offline`)
      },
    })
    await first.executor.waitForInit()
    const transaction = first.executor.createOfflineTransaction({
      mutationFnName: first.mutationFnName,
      autoCommit: false,
    })
    transaction.mutate(() => {
      first.collection.insert({
        id: `pending`,
        value: `replay me`,
        completed: false,
        updatedAt: new Date(),
      })
    })
    void transaction.commit().catch(() => undefined)
    await waitUntil(
      async () => (await first.executor.peekOutbox()).length === 1,
    )

    const replayed: Array<string> = []
    const second = createEnvironment({
      storage,
      config: {
        leaderElection: new WebLocksLeader(`failover-callback`),
        onLeadershipChange: (isLeader) => {
          if (isLeader) throw new Error(`application callback failed`)
        },
      },
      mutationFn: (params) => {
        for (const mutation of params.transaction.mutations) {
          replayed.push(String(mutation.key))
        }
        second.applyMutations(params.transaction.mutations)
        return { ok: true, mutations: params.transaction.mutations }
      },
    })
    try {
      await second.executor.waitForInit()
      first.executor.dispose()
      await waitUntil(
        async () => (await second.executor.peekOutbox()).length === 0,
      )
      expect(replayed).toEqual([`pending`])
    } finally {
      warn.mockRestore()
      second.executor.dispose()
    }
  })

  it(`a disposed waiter leaves the queue`, async () => {
    const locks = createLocks()
    vi.stubGlobal(`navigator`, { locks })
    const first = new WebLocksLeader(`queue`)
    const second = new WebLocksLeader(`queue`)
    const third = new WebLocksLeader(`queue`)
    expect(await first.requestLeadership()).toBe(true)
    expect(await second.requestLeadership()).toBe(false)
    expect(await third.requestLeadership()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))

    second.releaseLeadership()
    first.releaseLeadership()
    await waitUntil(() => third.isLeader())

    expect(second.isLeader()).toBe(false)
    third.releaseLeadership()
  })
})
