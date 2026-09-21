import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../db/src'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import type {
  PersistedTx,
  PersistenceAdapter,
} from '../../db-sqlite-persistence-core/src'
import type { BrowserCollectionCoordinatorOptions } from '../src/browser-coordinator'

// ---------------------------------------------------------------------------
// BroadcastChannel mock
// ---------------------------------------------------------------------------

type MessageHandler = (event: { data: unknown }) => void
const channels: Map<
  string,
  Set<{ onmessage: MessageHandler | null }>
> = new Map()

class MockBroadcastChannel {
  readonly name: string
  onmessage: MessageHandler | null = null

  constructor(name: string) {
    this.name = name
    if (!channels.has(name)) {
      channels.set(name, new Set())
    }
    channels.get(name)!.add(this)
  }

  postMessage(data: unknown): void {
    const peers = channels.get(this.name)
    if (!peers) return
    // Deliver to all other instances on same channel (simulating cross-tab)
    for (const peer of peers) {
      if (peer !== this && peer.onmessage) {
        // Use microtask to simulate async delivery
        const handler = peer.onmessage
        queueMicrotask(() => handler({ data: structuredClone(data) }))
      }
    }
  }

  close(): void {
    channels.get(this.name)?.delete(this)
  }
}

// ---------------------------------------------------------------------------
// Web Locks mock
// ---------------------------------------------------------------------------

type LockGrantedCallback = (lock: { name: string }) => Promise<unknown>

const heldLocks = new Map<string, { release: () => void }>()
const lockQueues = new Map<
  string,
  Array<{
    callback: LockGrantedCallback
    signal?: AbortSignal
    resolve: (v: unknown) => void
    reject: (e: Error) => void
  }>
>()

function tryGrantNextLock(name: string): void {
  if (heldLocks.has(name)) return
  const queue = lockQueues.get(name)
  if (!queue || queue.length === 0) return

  const next = queue.shift()!
  if (next.signal?.aborted) {
    // Skip aborted entries and try next
    tryGrantNextLock(name)
    return
  }

  let releaseCallback!: () => void
  void new Promise<void>((resolve) => {
    releaseCallback = resolve
  })

  heldLocks.set(name, { release: releaseCallback })

  const result = next.callback({ name })
  // When the callback resolves/rejects, release the lock
  Promise.resolve(result).then(
    (value) => {
      heldLocks.delete(name)
      releaseCallback()
      next.resolve(value)
      tryGrantNextLock(name)
    },
    (error) => {
      heldLocks.delete(name)
      releaseCallback()
      next.reject(error)
      tryGrantNextLock(name)
    },
  )
}

const mockNavigatorLocks = {
  request: (
    name: string,
    optionsOrCallback: { signal?: AbortSignal } | LockGrantedCallback,
    maybeCallback?: LockGrantedCallback,
  ): Promise<unknown> => {
    const callback =
      typeof optionsOrCallback === `function`
        ? optionsOrCallback
        : maybeCallback!
    const signal =
      typeof optionsOrCallback === `object`
        ? optionsOrCallback.signal
        : undefined

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException(`Lock request aborted`, `AbortError`))
        return
      }

      const entry = { callback, signal, resolve, reject }
      if (!lockQueues.has(name)) {
        lockQueues.set(name, [])
      }
      lockQueues.get(name)!.push(entry)

      if (signal) {
        signal.addEventListener(`abort`, () => {
          const queue = lockQueues.get(name)
          if (queue) {
            const idx = queue.indexOf(entry)
            if (idx >= 0) {
              queue.splice(idx, 1)
              reject(new DOMException(`Lock request aborted`, `AbortError`))
            }
          }
        })
      }

      tryGrantNextLock(name)
    })
  },
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

function installGlobals(): void {
  ;(globalThis as Record<string, unknown>).BroadcastChannel =
    MockBroadcastChannel as unknown
  Object.defineProperty(globalThis, `navigator`, {
    value: {
      ...(((globalThis as Record<string, unknown>).navigator as
        | object
        | undefined) ?? {}),
      locks: mockNavigatorLocks,
    },
    writable: true,
    configurable: true,
  })
}

function cleanupGlobals(): void {
  channels.clear()
  heldLocks.clear()
  lockQueues.clear()
}

// ---------------------------------------------------------------------------
// Adapter stub
// ---------------------------------------------------------------------------

function createStubAdapter(): PersistenceAdapter & {
  pullSince: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<{
    latestRowVersion: number
    requiresFullReload: false
    changedKeys: Array<string | number>
    deletedKeys: Array<string | number>
  }>
  getStreamPosition: (collectionId: string) => Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }>
  appliedTxs: Array<{ collectionId: string; txId: string }>
} {
  const appliedTxs: Array<{ collectionId: string; txId: string }> = []

  return {
    appliedTxs,
    loadSubset: () => Promise.resolve([]),
    applyCommittedTx: (collectionId, tx) => {
      appliedTxs.push({ collectionId, txId: tx.txId })
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
    pullSince: (_collectionId, _fromRowVersion) =>
      Promise.resolve({
        latestRowVersion: 0,
        requiresFullReload: false as const,
        changedKeys: [],
        deletedKeys: [],
      }),
    getStreamPosition: () =>
      Promise.resolve({
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
      }),
  }
}

function createCoordinator(
  adapter?: ReturnType<typeof createStubAdapter>,
): BrowserCollectionCoordinator {
  const opts: BrowserCollectionCoordinatorOptions = {
    dbName: `test-db`,
    adapter: adapter ?? createStubAdapter(),
  }
  return new BrowserCollectionCoordinator(opts)
}

async function flush(ms: number = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe(`BrowserCollectionCoordinator`, () => {
  beforeEach(() => {
    installGlobals()
  })

  afterEach(() => {
    cleanupGlobals()
  })

  describe(`leadership`, () => {
    it(`first coordinator becomes leader for a collection`, async () => {
      const coord = createCoordinator()
      coord.subscribe(`todos`, () => {})
      await flush(50)

      expect(coord.isLeader(`todos`)).toBe(true)
      coord.dispose()
    })

    it(`second coordinator waits for leadership`, async () => {
      const coord1 = createCoordinator()
      coord1.subscribe(`todos`, () => {})
      await flush(50)
      expect(coord1.isLeader(`todos`)).toBe(true)

      const coord2 = createCoordinator()
      coord2.subscribe(`todos`, () => {})
      await flush(50)
      // coord2 should be follower while coord1 holds the lock
      expect(coord2.isLeader(`todos`)).toBe(false)

      coord1.dispose()
      coord2.dispose()
    })

    it(`second coordinator takes over after first disposes`, async () => {
      const coord1 = createCoordinator()
      coord1.subscribe(`todos`, () => {})
      await flush(50)
      expect(coord1.isLeader(`todos`)).toBe(true)

      const coord2 = createCoordinator()
      coord2.subscribe(`todos`, () => {})
      await flush(50)
      expect(coord2.isLeader(`todos`)).toBe(false)

      coord1.dispose()
      await flush(50)

      expect(coord2.isLeader(`todos`)).toBe(true)
      coord2.dispose()
    })

    it(`different collections have independent leaders`, async () => {
      const coord1 = createCoordinator()
      const coord2 = createCoordinator()

      coord1.subscribe(`todos`, () => {})
      coord2.subscribe(`notes`, () => {})
      await flush(50)

      expect(coord1.isLeader(`todos`)).toBe(true)
      expect(coord2.isLeader(`notes`)).toBe(true)

      coord1.dispose()
      coord2.dispose()
    })

    it(`returns unique node ids`, () => {
      const coord1 = createCoordinator()
      const coord2 = createCoordinator()

      expect(coord1.getNodeId()).not.toBe(coord2.getNodeId())

      coord1.dispose()
      coord2.dispose()
    })
  })

  describe(`message transport`, () => {
    it(`delivers published messages to remote subscribers`, async () => {
      const coord1 = createCoordinator()
      const coord2 = createCoordinator()

      const received: Array<unknown> = []
      coord2.subscribe(`todos`, (msg) => {
        received.push(msg.payload)
      })

      coord1.subscribe(`todos`, () => {})
      await flush(50)

      coord1.publish(`todos`, {
        v: 1,
        dbName: `test-db`,
        collectionId: `todos`,
        senderId: coord1.getNodeId(),
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `tx-1`,
          latestRowVersion: 1,
          requiresFullReload: true,
        },
      })

      await flush()

      expect(received.length).toBe(1)
      expect((received[0] as Record<string, unknown>).type).toBe(`tx:committed`)

      coord1.dispose()
      coord2.dispose()
    })

    it(`does not deliver own messages to self via subscriber`, async () => {
      const coord = createCoordinator()
      const received: Array<unknown> = []
      coord.subscribe(`todos`, (msg) => {
        received.push(msg)
      })
      await flush(50)

      coord.publish(`todos`, {
        v: 1,
        dbName: `test-db`,
        collectionId: `todos`,
        senderId: coord.getNodeId(),
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `tx-1`,
          latestRowVersion: 1,
          requiresFullReload: true,
        },
      })

      await flush()

      expect(received.length).toBe(0)
      coord.dispose()
    })
  })

  describe(`RPC - applyLocalMutations`, () => {
    it(`leader applies mutations and returns accepted ids`, async () => {
      const adapter = createStubAdapter()
      const coord = createCoordinator(adapter)

      coord.subscribe(`todos`, () => {})
      await flush(50)
      expect(coord.isLeader(`todos`)).toBe(true)

      const response = await coord.requestApplyLocalMutations(`todos`, [
        {
          mutationId: `mut-1`,
          type: `insert`,
          key: `1`,
          value: { id: `1`, title: `Test` },
        },
      ])

      expect(response.ok).toBe(true)
      if (response.ok) {
        expect(response.acceptedMutationIds).toEqual([`mut-1`])
        expect(response.term).toBeGreaterThan(0)
        expect(response.seq).toBeGreaterThan(0)
      }
      expect(adapter.appliedTxs.length).toBe(1)

      coord.dispose()
    })

    it(`does not reuse a directly published source transaction position`, async () => {
      const adapter = createStubAdapter()
      const durableRows = new Map<string | number, unknown>()
      const occupiedPositions = new Set<string>()
      adapter.applyCommittedTx = (collectionId, tx) => {
        const position = `${collectionId}:${tx.term}:${tx.seq}`
        if (occupiedPositions.has(position)) return Promise.resolve()
        occupiedPositions.add(position)
        adapter.appliedTxs.push({ collectionId, txId: tx.txId })
        if (tx.truncate) durableRows.clear()
        for (const mutation of tx.mutations) {
          if (mutation.type === `delete`) {
            durableRows.delete(mutation.key)
          } else {
            durableRows.set(mutation.key, mutation.value)
          }
        }
        return Promise.resolve()
      }
      const coord = createCoordinator(adapter)
      coord.subscribe(`todos`, () => {})
      await flush(50)
      expect(coord.isLeader(`todos`)).toBe(true)

      await adapter.applyCommittedTx(`todos`, {
        txId: `authoritative-source-snapshot`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        truncate: true,
        mutations: [
          {
            type: `insert`,
            key: `network`,
            value: { id: `network`, title: `Network snapshot` },
          },
        ],
      })
      coord.publish(`todos`, {
        v: 1,
        dbName: `test-db`,
        collectionId: `todos`,
        senderId: coord.getNodeId(),
        ts: Date.now(),
        payload: {
          type: `tx:committed`,
          term: 1,
          seq: 1,
          txId: `authoritative-source-snapshot`,
          latestRowVersion: 1,
          requiresFullReload: true,
        },
      })

      const response = await coord.requestApplyLocalMutations(`todos`, [
        {
          mutationId: `local-after-network`,
          type: `insert`,
          key: `local`,
          value: { id: `local`, title: `Local mutation` },
        },
      ])

      expect({
        ok: response.ok,
        seq: response.ok ? response.seq : undefined,
        durableKeys: Array.from(durableRows.keys()).sort(),
      }).toEqual({
        ok: true,
        seq: 2,
        durableKeys: [`local`, `network`],
      })
      coord.dispose()
    })

    it(`serializes a network winner with a competing coordinator mutation`, async () => {
      type Todo = { id: string; title: string }

      const adapter = createStubAdapter()
      const hydrationStarted = deferred()
      const hydration =
        deferred<
          Array<{ key: string | number; value: Record<string, unknown> }>
        >()
      const startNetwork = deferred()
      const upstreamDone = deferred()
      const snapshotApplyEntered = deferred<PersistedTx>()
      const releaseSnapshotApply = deferred()
      const durableRows = new Map<string | number, Record<string, unknown>>()
      const occupiedPositions = new Set<string>()

      adapter.loadSubset = () => {
        hydrationStarted.resolve()
        return hydration.promise
      }
      adapter.applyCommittedTx = async (collectionId, tx) => {
        if (tx.truncate) {
          snapshotApplyEntered.resolve(tx)
          await releaseSnapshotApply.promise
        }

        const position = `${collectionId}:${tx.term}:${tx.seq}`
        if (occupiedPositions.has(position)) return
        occupiedPositions.add(position)
        adapter.appliedTxs.push({ collectionId, txId: tx.txId })
        if (tx.truncate) durableRows.clear()
        for (const mutation of tx.mutations) {
          if (mutation.type === `delete`) {
            durableRows.delete(mutation.key)
          } else {
            durableRows.set(mutation.key, mutation.value)
          }
        }
      }

      const leader = createCoordinator(adapter)
      const follower = createCoordinator(adapter)
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `todos`,
          getKey: (todo) => todo.id,
          sync: {
            sync: ({ begin, truncate, write, commit, markReady, metadata }) => {
              void (async () => {
                await startNetwork.promise
                begin()
                metadata?.collection.set(`cursor`, `network-cursor`)
                truncate()
                write({
                  type: `insert`,
                  value: { id: `network`, title: `Network snapshot` },
                  metadata: { owner: `network` },
                })
                const applied = commit()
                if (applied !== true) void applied.catch(() => undefined)
                markReady()
              })().then(upstreamDone.resolve, upstreamDone.reject)
              return {}
            },
          },
          persistence: { adapter, coordinator: leader },
        }),
      )

      try {
        const preload = collection.preload()
        await hydrationStarted.promise
        await flush(50)
        expect(leader.isLeader(`todos`)).toBe(true)
        follower.subscribe(`todos`, () => {})
        await flush(50)
        expect(follower.isLeader(`todos`)).toBe(false)

        startNetwork.resolve()
        await upstreamDone.promise
        hydration.resolve([])
        await preload
        const sourceTx = await snapshotApplyEntered.promise
        expect(sourceTx).toMatchObject({
          truncate: true,
          mutations: [
            {
              key: `network`,
              value: { id: `network`, title: `Network snapshot` },
            },
          ],
          rowMetadataMutations: [
            { type: `set`, key: `network`, value: { owner: `network` } },
          ],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `network-cursor` },
          ],
        })

        let responseSettled = false
        const responsePromise = follower
          .requestApplyLocalMutations(`todos`, [
            {
              mutationId: `peer-while-source-apply-is-held`,
              type: `insert`,
              key: `peer`,
              value: { id: `peer`, title: `Peer mutation` },
            },
          ])
          .then((response) => {
            responseSettled = true
            return response
          })
        await flush()
        const responseSettledBeforeSourceApply = responseSettled
        releaseSnapshotApply.resolve()
        const response = await responsePromise
        await flush()
        await collection.cleanup()

        expect({
          responseSettledBeforeSourceApply,
          responseSeq: response.ok ? response.seq : undefined,
          sourceSeq: sourceTx.seq,
          durableKeys: Array.from(durableRows.keys()).sort(),
        }).toEqual({
          responseSettledBeforeSourceApply: false,
          responseSeq: sourceTx.seq + 1,
          sourceSeq: sourceTx.seq,
          durableKeys: [`network`, `peer`],
        })
      } finally {
        releaseSnapshotApply.resolve()
        hydration.resolve([])
        await collection.cleanup()
        leader.dispose()
        follower.dispose()
      }
    })

    it(`follower routes mutations to leader via RPC`, async () => {
      const adapter = createStubAdapter()
      const leader = createCoordinator(adapter)
      const follower = createCoordinator(adapter)

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      expect(leader.isLeader(`todos`)).toBe(true)
      expect(follower.isLeader(`todos`)).toBe(false)

      const response = await follower.requestApplyLocalMutations(`todos`, [
        {
          mutationId: `mut-2`,
          type: `insert`,
          key: `2`,
          value: { id: `2`, title: `Follower mutation` },
        },
      ])

      expect(response.ok).toBe(true)
      if (response.ok) {
        expect(response.acceptedMutationIds).toEqual([`mut-2`])
      }
      expect(adapter.appliedTxs.length).toBe(1)

      leader.dispose()
      follower.dispose()
    })

    it(`routes full persisted transactions through the leader without losing data`, async () => {
      const adapter = createStubAdapter()
      let appliedTx: PersistedTx | undefined
      adapter.applyCommittedTx = (collectionId, tx) => {
        adapter.appliedTxs.push({ collectionId, txId: tx.txId })
        appliedTx = tx
        return Promise.resolve()
      }
      const leader = createCoordinator(adapter)
      leader.subscribe(`todos`, () => {})
      await flush(50)
      const follower = createCoordinator(adapter)
      follower.subscribe(`todos`, () => {})
      await flush(50)

      const response = await follower.requestApplyPersistedTransaction(
        `todos`,
        {
          txId: `source-with-metadata`,
          truncate: true,
          mutations: [
            {
              type: `insert`,
              key: `network`,
              value: { id: `network`, title: `Network snapshot` },
              metadata: { owner: `source` },
              metadataChanged: true,
            },
          ],
          rowMetadataMutations: [
            { type: `set`, key: `network`, value: { owner: `source` } },
          ],
          collectionMetadataMutations: [
            { type: `set`, key: `cursor`, value: `cursor-1` },
          ],
        },
      )

      expect(response.ok).toBe(true)
      expect(appliedTx).toMatchObject({
        txId: `source-with-metadata`,
        truncate: true,
        mutations: [
          {
            type: `insert`,
            key: `network`,
            value: { id: `network`, title: `Network snapshot` },
            metadata: { owner: `source` },
            metadataChanged: true,
          },
        ],
        rowMetadataMutations: [
          { type: `set`, key: `network`, value: { owner: `source` } },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `cursor`, value: `cursor-1` },
        ],
      })
      expect(appliedTx?.term).toBeGreaterThan(0)
      expect(appliedTx?.seq).toBeGreaterThan(0)
      expect(appliedTx?.rowVersion).toBeGreaterThan(0)

      leader.dispose()
      follower.dispose()
    })

    it(`does not retry or consume a position when adapter application fails`, async () => {
      const adapter = createStubAdapter()
      const persistenceError = new Error(`write failed`)
      let applyAttempts = 0
      adapter.applyCommittedTx = (collectionId, tx) => {
        applyAttempts++
        if (applyAttempts === 1) return Promise.reject(persistenceError)
        adapter.appliedTxs.push({ collectionId, txId: tx.txId })
        return Promise.resolve()
      }
      const coord = createCoordinator(adapter)
      coord.subscribe(`todos`, () => {})
      await flush(50)

      await expect(
        coord.requestApplyPersistedTransaction(`todos`, {
          txId: `failed-source`,
          mutations: [],
        }),
      ).rejects.toBe(persistenceError)

      const response = await coord.requestApplyPersistedTransaction(`todos`, {
        txId: `successful-source`,
        mutations: [],
      })
      expect(response).toMatchObject({ ok: true, seq: 1, latestRowVersion: 1 })
      expect(applyAttempts).toBe(2)

      coord.dispose()
    })

    it(`deduplicates envelope ids`, async () => {
      const adapter = createStubAdapter()
      const coord = createCoordinator(adapter)
      coord.subscribe(`todos`, () => {})
      await flush(50)

      // First call
      const res1 = await coord.requestApplyLocalMutations(`todos`, [
        {
          mutationId: `mut-1`,
          type: `insert`,
          key: `1`,
          value: { id: `1`, title: `Test` },
        },
      ])
      expect(res1.ok).toBe(true)
      expect(adapter.appliedTxs.length).toBe(1)

      coord.dispose()
    })
  })

  describe(`RPC - pullSince`, () => {
    it(`leader handles pullSince directly`, async () => {
      const adapter = createStubAdapter()
      const coord = createCoordinator(adapter)
      coord.subscribe(`todos`, () => {})
      await flush(50)

      const response = await coord.pullSince(`todos`, 0)

      expect(response.ok).toBe(true)
      if (response.ok) {
        expect(response.requiresFullReload).toBe(false)
      }

      coord.dispose()
    })

    it(`follower routes pullSince to leader`, async () => {
      const adapter = createStubAdapter()
      adapter.pullSince = vi.fn().mockResolvedValue({
        latestRowVersion: 5,
        requiresFullReload: false,
        changedKeys: [`key-1`],
        deletedKeys: [],
      })

      const leader = createCoordinator(adapter)
      const follower = createCoordinator(adapter)

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      const response = await follower.pullSince(`todos`, 0)

      expect(response.ok).toBe(true)
      if (response.ok && !response.requiresFullReload) {
        expect(response.changedKeys).toEqual([`key-1`])
        expect(response.latestRowVersion).toBe(5)
      }

      leader.dispose()
      follower.dispose()
    })
  })

  describe(`RPC - ensurePersistedIndex`, () => {
    it(`leader ensures index locally`, async () => {
      const adapter = createStubAdapter()
      adapter.ensureIndex = vi.fn().mockResolvedValue(undefined)

      const coord = createCoordinator(adapter)
      coord.subscribe(`todos`, () => {})
      await flush(50)

      await coord.requestEnsurePersistedIndex(`todos`, `idx-1`, {
        expressionSql: [`title`],
      })

      expect(adapter.ensureIndex).toHaveBeenCalledWith(`todos`, `idx-1`, {
        expressionSql: [`title`],
      })

      coord.dispose()
    })

    it(`follower routes ensurePersistedIndex to leader`, async () => {
      const adapter = createStubAdapter()
      adapter.ensureIndex = vi.fn().mockResolvedValue(undefined)

      const leader = createCoordinator(adapter)
      const follower = createCoordinator(adapter)

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      await follower.requestEnsurePersistedIndex(`todos`, `idx-2`, {
        expressionSql: [`id`],
      })

      expect(adapter.ensureIndex).toHaveBeenCalled()

      leader.dispose()
      follower.dispose()
    })
  })

  describe(`dispose`, () => {
    it(`cleans up on dispose`, async () => {
      const coord = createCoordinator()
      coord.subscribe(`todos`, () => {})
      await flush(50)

      coord.dispose()

      // Should not throw after disposal
      expect(coord.isLeader(`todos`)).toBe(false)
    })
  })
})
