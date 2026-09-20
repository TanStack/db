import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import type {
  PersistedCollectionCoordinator,
  PersistenceAdapter,
  ProtocolEnvelope,
  PullSinceResponse,
  TxCommitted,
} from '../src'
import type { LoadSubsetOptions } from '@tanstack/db'

type Todo = { id: string; title: string }

function createLimitAdapter(initial: Array<Todo>) {
  const rows = new Map(initial.map((r) => [r.id, r]))
  const calls: Array<LoadSubsetOptions> = []
  const adapter: PersistenceAdapter & {
    rows: Map<string, Todo>
    calls: Array<LoadSubsetOptions>
  } = {
    rows,
    calls,
    loadSubset: (_id, options) => {
      calls.push(options)
      const all = Array.from(rows.values()).map((value) => ({
        key: value.id,
        value,
      }))
      const limited =
        options.limit === undefined ? all : all.slice(0, options.limit)
      return Promise.resolve(limited)
    },
    loadCollectionMetadata: () => Promise.resolve([]),
    scanRows: () =>
      Promise.resolve(
        Array.from(rows.values()).map((value) => ({ key: value.id, value })),
      ),
    applyCommittedTx: (_id, tx) => {
      if (tx.truncate) rows.clear()
      for (const m of tx.mutations) {
        if (m.type === `delete`) rows.delete(m.key as string)
        else rows.set(m.key as string, m.value as Todo)
      }
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  return adapter
}

type CoordinatorHarness = PersistedCollectionCoordinator & {
  emit: (payload: TxCommitted, senderId?: string) => void
}

function createCoordinatorHarness(collectionId: string): CoordinatorHarness {
  let subscriber: ((message: ProtocolEnvelope<unknown>) => void) | undefined
  const pullSinceResponse: PullSinceResponse = {
    type: `rpc:pullSince:res`,
    rpcId: `pull-0`,
    ok: true,
    latestTerm: 1,
    latestSeq: 0,
    latestRowVersion: 0,
    requiresFullReload: false,
    changedKeys: [],
    deletedKeys: [],
  }
  const harness: CoordinatorHarness = {
    getNodeId: () => `coordinator-node`,
    subscribe: (_collectionId, onMessage) => {
      subscriber = onMessage
      return () => {
        subscriber = undefined
      }
    },
    publish: () => {},
    isLeader: () => true,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    requestEnsureRemoteSubset: async () => {},
    pullSince: () => Promise.resolve(pullSinceResponse),
    emit: (payload, senderId = `remote-node`) => {
      subscriber?.({
        v: 1,
        dbName: `test-db`,
        collectionId,
        senderId,
        ts: Date.now(),
        payload,
      })
    },
  }
  return harness
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * The ways a repeat acquisition could be answered from rows that are not in
 * the collection, and the bookkeeping the fast path still owes upstream.
 *
 * Four of these are about `hydratedDemands` outliving what it describes, each
 * producing a `true` where a promise is owed. The fifth is the opposite
 * direction: an acquisition that was cancelled must stop being ensured
 * remotely, which the slow path has always done and the fast path has to be
 * told to do.
 */
describe(`subset fast path`, () => {
  it(`does not leak coverage when one options object is acquired twice`, async () => {
    const adapter = createLimitAdapter([
      { id: `1`, title: `one` },
      { id: `2`, title: `two` },
      { id: `3`, title: `three` },
    ])
    const coordinator = createCoordinatorHarness(`sync-present`)
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (r) => r.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true, unloadSubset: () => {} }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    collection.startSyncImmediate()

    const wide: LoadSubsetOptions = { limit: 3 }
    await collection._sync.loadSubset(wide)
    expect(collection.size).toBe(3)

    // Same options object, loaded again (no unload in between).
    expect(collection._sync.loadSubset(wide)).toBe(true)
    // One release for what the runtime recorded as two retains.
    collection._sync.unloadSubset(wide)

    // A narrow demand is now the only live acquisition.
    await collection._sync.loadSubset({ limit: 1 })

    // Full reload: rebuilt from active subsets only -> rows 2 and 3 drop out.
    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-full-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    await flush()
    expect(collection.size).toBe(1)
    expect(adapter.rows.size).toBe(3) // the store still has all three

    // A fresh acquisition of the wide demand. Its rows are NOT in the
    // collection, so this must not be answered synchronously.
    const reacquired = collection._sync.loadSubset({ limit: 3 })
    expect(reacquired).not.toBe(true)
    await reacquired
    expect(collection.size).toBe(3)

    await collection.cleanup()
  })

  it(`does not re-mark a demand hydrated when a truncate lands during a reload`, async () => {
    const adapter = createLimitAdapter([
      { id: `1`, title: `one` },
      { id: `2`, title: `two` },
      { id: `3`, title: `three` },
    ])
    // A store whose truncate write fails: the collection is emptied, the store
    // is not.
    const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
    adapter.applyCommittedTx = (id, tx) => {
      if (tx.truncate) return Promise.reject(new Error(`store write failed`))
      return applyCommittedTx(id, tx)
    }
    const coordinator = createCoordinatorHarness(`sync-present`)
    const loadSubset = adapter.loadSubset.bind(adapter)
    let calls = 0
    let releaseReload!: () => void
    let reloadEntered!: () => void
    const reloadGate = new Promise<void>((r) => {
      releaseReload = r
    })
    const entered = new Promise<void>((r) => {
      reloadEntered = r
    })
    adapter.loadSubset = async (...args) => {
      calls++
      if (calls === 2) {
        reloadEntered()
        await reloadGate
      }
      return loadSubset(...args)
    }

    let truncateSource!: () => void
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (r) => r.id,
        sync: {
          sync: ({ begin, commit, truncate, markReady }) => {
            markReady()
            truncateSource = () => {
              begin()
              truncate()
              commit()
            }
            return { loadSubset: () => true, unloadSubset: () => {} }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    collection.startSyncImmediate()

    await collection._sync.loadSubset({ limit: 3 })
    expect(collection.size).toBe(3)

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-full-reload`,
      latestRowVersion: 1,
      requiresFullReload: true,
    })
    await entered
    // The source truncates while the reload is in flight.
    truncateSource()
    releaseReload()
    await flush()

    expect(collection.size).toBe(0)
    expect(adapter.rows.size).toBe(3)

    const reacquired = collection._sync.loadSubset({ limit: 3 })
    expect(reacquired).not.toBe(true)
    await reacquired
    expect(collection.size).toBe(3)

    await collection.cleanup()
  })

  it(`does not keep ensuring a fast-path acquisition whose upstream load aborted`, async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const abortError = Object.assign(new Error(`abort`), { name: `AbortError` })
    const ensured: Array<LoadSubsetOptions> = []
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `fast-path-abort`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestEnsureRemoteSubset: (_id, options) => {
        ensured.push(options)
        return Promise.reject(new Error(`offline`))
      },
    }
    const first: LoadSubsetOptions = { limit: 1 }
    const second: LoadSubsetOptions = { limit: 1 }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `fast-path-abort`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options: LoadSubsetOptions) =>
                options === second ? Promise.reject(abortError) : true,
              unloadSubset: () => {},
            }
          },
        },
        persistence: { adapter: createLimitAdapter([{ id: `1`, title: `a` }]), coordinator },
      }),
    )
    try {
      collection.startSyncImmediate()
      await collection._sync.loadSubset(first)

      const result = await Promise.resolve(
        collection._sync.loadSubset(second),
      ).then(
        () => `ready`,
        (error: unknown) => error,
      )
      expect(result).toBe(abortError)

      const secondEnsuresBefore = ensured.filter((o) => o === second).length
      await vi.advanceTimersByTimeAsync(500)
      const secondEnsuresAfter = ensured.filter((o) => o === second).length
      // The aborted acquisition must not keep being ensured remotely.
      expect(secondEnsuresAfter).toBe(secondEnsuresBefore)
    } finally {
      await collection.cleanup()
      warning.mockRestore()
      vi.useRealTimers()
    }
  })

  it(`stops ensuring an aborted demand on the slow path too`, async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const abortError = Object.assign(new Error(`abort`), { name: `AbortError` })
    const ensured: Array<LoadSubsetOptions> = []
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `fast-path-abort`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestEnsureRemoteSubset: (_id, options) => {
        ensured.push(options)
        return Promise.reject(new Error(`offline`))
      },
    }
    const first: LoadSubsetOptions = { limit: 1 }
    const second: LoadSubsetOptions = { limit: 2 }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `fast-path-abort-control`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options: LoadSubsetOptions) =>
                options === second ? Promise.reject(abortError) : true,
              unloadSubset: () => {},
            }
          },
        },
        persistence: { adapter: createLimitAdapter([{ id: `1`, title: `a` }]), coordinator },
      }),
    )
    try {
      collection.startSyncImmediate()
      await collection._sync.loadSubset(first)

      const result = await Promise.resolve(
        collection._sync.loadSubset(second),
      ).then(
        () => `ready`,
        (error: unknown) => error,
      )
      expect(result).toBe(abortError)

      const secondEnsuresBefore = ensured.filter((o) => o === second).length
      await vi.advanceTimersByTimeAsync(500)
      const secondEnsuresAfter = ensured.filter((o) => o === second).length
      // The aborted acquisition must not keep being ensured remotely.
      expect(secondEnsuresAfter).toBe(secondEnsuresBefore)
    } finally {
      await collection.cleanup()
      warning.mockRestore()
      vi.useRealTimers()
    }
  })

  it(`does not mark a demand hydrated when its last holder left mid-read`, async () => {
    const adapter = createLimitAdapter([
      { id: `1`, title: `one` },
      { id: `2`, title: `two` },
      { id: `3`, title: `three` },
    ])
    const read = adapter.loadSubset.bind(adapter)
    let openGate!: () => void
    let readEntered!: () => void
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    const entered = new Promise<void>((resolve) => {
      readEntered = resolve
    })
    let gated = true
    adapter.loadSubset = async (...args) => {
      if (gated) {
        gated = false
        readEntered()
        await gate
      }
      return read(...args)
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `released-mid-read`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => true, unloadSubset: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.startSyncImmediate()

    try {
      const only: LoadSubsetOptions = { limit: 3 }
      const pending = collection._sync.loadSubset(only)

      // Released while its own read is still in flight, so by the time that
      // read finishes nothing wants the rows any more.
      await entered
      collection._sync.unloadSubset(only)
      openGate()
      await pending

      // Recording the demand as hydrated here would leave an entry with no
      // holder, which no release can ever remove. This asserts the invariant
      // directly rather than the wrong answer it can lead to: reaching that
      // needs the apply mutex held by non-hydrating work, which no public API
      // on a persisted collection exposes.
      const reacquired = collection._sync.loadSubset({ limit: 3 })
      expect(reacquired).not.toBe(true)
      await reacquired
      expect(collection.get(`3`)).toBeDefined()
    } finally {
      await collection.cleanup()
    }
  })
})
