/**
 * # Which cross-window coordinator facts survive retries and disposal?
 *
 * Contract: leader work uses the adapter registered for that Collection. A
 * retry after response loss observes the first durable mutation result without
 * applying it again. Disposal is terminal for current and future RPC attempts.
 *
 * Model and history grammar: an independent collection-to-adapter map selects
 * one call recorder; a completed envelope retains one result; a disposed flag
 * permits no request posts. Generated histories vary Collection registration
 * order, RPC kind, mutation count, response delivery, and disposal phase.
 *
 * Production path and observations: paired real coordinators communicate
 * through controlled BroadcastChannel and Web Locks fixtures. The laws record
 * exact adapter calls, durable transaction count, returned result, promise
 * settlement, and request posts.
 *
 * Known omissions: these laws do not establish native browser scheduling or
 * concurrent delivery of one in-flight envelope. Electron keeps focused
 * parity witnesses for the same protocol boundaries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { BasicIndex, createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '@tanstack/db-sqlite-persistence-core'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import type { PersistenceAdapter } from '@tanstack/db-sqlite-persistence-core'
import type { BrowserCollectionCoordinatorOptions } from '../src/browser-coordinator'

// ---------------------------------------------------------------------------
// BroadcastChannel mock
// ---------------------------------------------------------------------------

type MessageHandler = (event: { data: unknown }) => void
const channels: Map<
  string,
  Set<{ onmessage: MessageHandler | null }>
> = new Map()
let dropNextMessageWhen: ((data: unknown) => boolean) | undefined
let observePostedMessage: ((data: unknown) => void) | undefined

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
    observePostedMessage?.(data)
    if (dropNextMessageWhen?.(data)) {
      dropNextMessageWhen = undefined
      return
    }
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
  dropNextMessageWhen = undefined
  observePostedMessage = undefined
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

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

type CoordinatorInspection = {
  collectionAdapters: Map<string, unknown>
  collections: Map<string, unknown>
  appliedEnvelopeIds: Map<string, unknown>
}

function inspectCoordinator(
  coordinator: BrowserCollectionCoordinator,
): CoordinatorInspection {
  return coordinator as unknown as CoordinatorInspection
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

    it(`replays the successful mutation result when its first response is lost`, async () => {
      vi.useFakeTimers()
      const adapter = createStubAdapter()
      let leadershipRead!: () => void
      const leadershipReadPromise = new Promise<void>((resolve) => {
        leadershipRead = resolve
      })
      let firstSuccessDropped!: () => void
      const firstSuccessDroppedPromise = new Promise<void>((resolve) => {
        firstSuccessDropped = resolve
      })
      adapter.getStreamPosition = async () => {
        leadershipRead()
        return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
      }

      const leader = createCoordinator(adapter)
      const follower = createCoordinator(adapter)

      try {
        leader.subscribe(`todos`, () => {})
        await leadershipReadPromise
        await Promise.resolve()
        follower.subscribe(`todos`, () => {})

        dropNextMessageWhen = (data) => {
          const payload = (
            data as { payload?: { type?: string; ok?: boolean } }
          ).payload
          if (
            payload?.type === `rpc:applyLocalMutations:res` &&
            payload.ok === true
          ) {
            firstSuccessDropped()
            return true
          }
          return false
        }

        const responsePromise = follower.requestApplyLocalMutations(`todos`, [
          {
            mutationId: `mut-lost-response`,
            type: `insert`,
            key: `lost-response`,
            value: { id: `lost-response`, title: `Persisted once` },
          },
        ])

        await firstSuccessDroppedPromise
        expect(adapter.appliedTxs).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(10_200)
        const response = await responsePromise
        expect(response).toMatchObject({
          ok: true,
          acceptedMutationIds: [`mut-lost-response`],
        })
        expect(adapter.appliedTxs).toHaveLength(1)
      } finally {
        follower.dispose()
        leader.dispose()
        vi.useRealTimers()
      }
    })

    it(`preserves one durable mutation result across generated response-delivery histories`, async () => {
      vi.useFakeTimers()
      let run = 0
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.record({
              mutationCount: fc.integer({ min: 1, max: 4 }),
              dropFirstSuccess: fc.boolean(),
            }),
            async ({ mutationCount, dropFirstSuccess }) => {
              run++
              const collectionId = `delivery-history-${run}`
              const adapter = createStubAdapter()
              let leadershipRead!: () => void
              const leadershipReadPromise = new Promise<void>((resolve) => {
                leadershipRead = resolve
              })
              let firstSuccessDropped!: () => void
              const firstSuccessDroppedPromise = new Promise<void>(
                (resolve) => {
                  firstSuccessDropped = resolve
                },
              )
              adapter.getStreamPosition = async () => {
                leadershipRead()
                return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
              }

              const leader = createCoordinator(adapter)
              const follower = createCoordinator(adapter)
              try {
                leader.subscribe(collectionId, () => {})
                await leadershipReadPromise
                await Promise.resolve()
                follower.subscribe(collectionId, () => {})

                if (dropFirstSuccess) {
                  dropNextMessageWhen = (data) => {
                    const payload = (
                      data as { payload?: { type?: string; ok?: boolean } }
                    ).payload
                    if (
                      payload?.type === `rpc:applyLocalMutations:res` &&
                      payload.ok === true
                    ) {
                      firstSuccessDropped()
                      return true
                    }
                    return false
                  }
                }

                const mutations = Array.from(
                  { length: mutationCount },
                  (_, index) => ({
                    mutationId: `mut-${run}-${index}`,
                    type: `insert` as const,
                    key: `${index}`,
                    value: { id: `${index}`, title: `row ${index}` },
                  }),
                )
                const responsePromise = follower.requestApplyLocalMutations(
                  collectionId,
                  mutations,
                )
                if (dropFirstSuccess) {
                  await firstSuccessDroppedPromise
                  await vi.advanceTimersByTimeAsync(10_200)
                }

                const response = await responsePromise
                expect(response).toMatchObject({
                  ok: true,
                  acceptedMutationIds: mutations.map(
                    (mutation) => mutation.mutationId,
                  ),
                })
                expect(adapter.appliedTxs).toHaveLength(1)
              } finally {
                dropNextMessageWhen = undefined
                follower.dispose()
                leader.dispose()
                for (let microtask = 0; microtask < 4; microtask++) {
                  await Promise.resolve()
                }
              }
            },
          ),
          { seed: 1868, numRuns: 12, endOnFailure: true },
        )
      } finally {
        vi.useRealTimers()
      }
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

    it(`does not repeat successful leader-local index creation`, async () => {
      const adapter = createStubAdapter()
      let leadershipRead!: () => void
      const leadershipReadPromise = new Promise<void>((resolve) => {
        leadershipRead = resolve
      })
      adapter.getStreamPosition = async () => {
        leadershipRead()
        return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
      }
      adapter.ensureIndex = vi.fn().mockResolvedValue(undefined)

      const coord = createCoordinator(adapter)
      try {
        coord.subscribe(`todos`, () => {})
        await leadershipReadPromise
        await Promise.resolve()

        const spec = { expressionSql: [`title`] }
        await adapter.ensureIndex(`todos`, `idx-once`, spec)
        await coord.requestEnsurePersistedIndex(
          `todos`,
          `idx-once`,
          spec,
          adapter,
          true,
        )

        expect(adapter.ensureIndex).toHaveBeenCalledOnce()
      } finally {
        coord.dispose()
      }
    })

    it(`keeps production collection bootstrap index work exact-once on the leader`, async () => {
      const adapter = createStubAdapter()
      adapter.ensureIndex = vi.fn().mockResolvedValue(undefined)
      const coordinator = createCoordinator(adapter)
      const leaderReady = createDeferred()
      observePostedMessage = (data) => {
        const envelope = data as {
          collectionId?: string
          payload?: { type?: string }
        }
        if (
          envelope.collectionId === `leader-bootstrap-index` &&
          envelope.payload?.type === `leader:heartbeat`
        ) {
          leaderReady.resolve()
        }
      }
      const releaseLeader = coordinator.subscribe(
        `leader-bootstrap-index`,
        () => {},
      )
      await leaderReady.promise
      observePostedMessage = undefined

      const collection = createCollection(
        persistedCollectionOptions<{ id: string; title: string }, string>({
          id: `leader-bootstrap-index`,
          getKey: (row) => row.id,
          defaultIndexType: BasicIndex,
          sync: {
            sync: ({ markReady }) => {
              markReady()
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      collection.createIndex((row) => row.title, { name: `title` })

      try {
        await collection.preload()
        expect(adapter.ensureIndex).toHaveBeenCalledOnce()
      } finally {
        await collection.cleanup()
        releaseLeader()
        coordinator.dispose()
      }
    })

    it(`reaches crossed production RPC leadership only after both hydration scopes exit`, async () => {
      const bothLocalIndexesEntered = createDeferred()
      const bothLeaderRPCsEntered = createDeferred()
      const releaseSchedulerCycle = createDeferred()
      let localIndexEntries = 0
      let leaderRPCEntries = 0

      const createTab = () => {
        const adapter = createStubAdapter()
        const baseEnsureIndex = adapter.ensureIndex.bind(adapter)
        let hydrationScopeActive = false
        const leaderRPCScopeObservations: Array<boolean> = []
        const scopedAdapter: PersistenceAdapter = {
          ...adapter,
          ensureIndex: async (...args) => {
            localIndexEntries++
            if (localIndexEntries === 2) bothLocalIndexesEntered.resolve()
            await bothLocalIndexesEntered.promise
            await baseEnsureIndex(...args)
          },
        }
        adapter.runInHydrationScope = async (task) => {
          hydrationScopeActive = true
          try {
            return await task(scopedAdapter)
          } finally {
            hydrationScopeActive = false
          }
        }
        adapter.ensureIndex = async (...args) => {
          leaderRPCScopeObservations.push(hydrationScopeActive)
          leaderRPCEntries++
          if (leaderRPCEntries === 2) bothLeaderRPCsEntered.resolve()
          if (hydrationScopeActive) await releaseSchedulerCycle.promise
          await baseEnsureIndex(...args)
        }
        return { adapter, leaderRPCScopeObservations }
      }

      const tab1 = createTab()
      const tab2 = createTab()
      const coordinator1 = createCoordinator(tab1.adapter)
      const coordinator2 = createCoordinator(tab2.adapter)
      const leaderCollections = new Set<string>()
      const bothLeadersReady = createDeferred()
      observePostedMessage = (data) => {
        const envelope = data as {
          collectionId?: string
          payload?: { type?: string }
        }
        if (
          envelope.payload?.type === `leader:heartbeat` &&
          (envelope.collectionId === `crossed-a` ||
            envelope.collectionId === `crossed-b`)
        ) {
          leaderCollections.add(envelope.collectionId)
          if (leaderCollections.size === 2) bothLeadersReady.resolve()
        }
      }
      coordinator1.setAdapterForCollection(`crossed-b`, tab1.adapter)
      coordinator2.setAdapterForCollection(`crossed-a`, tab2.adapter)
      const releaseLeaderB = coordinator1.subscribe(`crossed-b`, () => {})
      const releaseLeaderA = coordinator2.subscribe(`crossed-a`, () => {})
      await bothLeadersReady.promise
      observePostedMessage = undefined

      const createFollowerCollection = (
        id: string,
        adapter: PersistenceAdapter,
        coordinator: BrowserCollectionCoordinator,
      ) => {
        const collection = createCollection(
          persistedCollectionOptions<{ id: string; title: string }, string>({
            id,
            getKey: (row) => row.id,
            defaultIndexType: BasicIndex,
            sync: {
              sync: ({ markReady }) => {
                markReady()
              },
            },
            persistence: { adapter, coordinator },
          }),
        )
        collection.createIndex((row) => row.title, { name: `${id}-title` })
        return collection
      }
      const followerA = createFollowerCollection(
        `crossed-a`,
        tab1.adapter,
        coordinator1,
      )
      const followerB = createFollowerCollection(
        `crossed-b`,
        tab2.adapter,
        coordinator2,
      )
      const preloadA = Promise.resolve(followerA.preload())
      const preloadB = Promise.resolve(followerB.preload())
      void preloadA.catch(() => undefined)
      void preloadB.catch(() => undefined)

      try {
        await bothLeaderRPCsEntered.promise
        expect({
          tab1: tab1.leaderRPCScopeObservations,
          tab2: tab2.leaderRPCScopeObservations,
        }).toEqual({ tab1: [false], tab2: [false] })
        await Promise.all([preloadA, preloadB])
      } finally {
        releaseSchedulerCycle.resolve()
        await Promise.all([preloadA, preloadB]).catch(() => undefined)
        await Promise.all([followerA.cleanup(), followerB.cleanup()])
        releaseLeaderA()
        releaseLeaderB()
        coordinator2.dispose()
        coordinator1.dispose()
      }
    })

    it(`uses a supplied leader-local adapter when local work is not complete`, async () => {
      const registeredAdapter = createStubAdapter()
      const scopedAdapter = createStubAdapter()
      let leadershipRead!: () => void
      const leadershipReadPromise = new Promise<void>((resolve) => {
        leadershipRead = resolve
      })
      registeredAdapter.getStreamPosition = async () => {
        leadershipRead()
        return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
      }
      registeredAdapter.ensureIndex = vi.fn().mockResolvedValue(undefined)
      scopedAdapter.ensureIndex = vi.fn().mockResolvedValue(undefined)

      const coord = createCoordinator(registeredAdapter)
      try {
        coord.subscribe(`todos`, () => {})
        await leadershipReadPromise
        await Promise.resolve()

        await coord.requestEnsurePersistedIndex(
          `todos`,
          `idx-scoped`,
          { expressionSql: [`title`] },
          scopedAdapter,
        )

        expect(scopedAdapter.ensureIndex).toHaveBeenCalledOnce()
        expect(registeredAdapter.ensureIndex).not.toHaveBeenCalled()
      } finally {
        coord.dispose()
      }
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

    it(`keeps leader RPC work on the adapter registered for its collection`, async () => {
      const todosAdapter = createStubAdapter()
      const notesAdapter = createStubAdapter()
      let leadershipRead!: () => void
      const leadershipReadPromise = new Promise<void>((resolve) => {
        leadershipRead = resolve
      })
      todosAdapter.ensureIndex = vi.fn().mockResolvedValue(undefined)
      notesAdapter.ensureIndex = vi.fn().mockResolvedValue(undefined)
      todosAdapter.getStreamPosition = async () => {
        leadershipRead()
        return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
      }

      const leader = createCoordinator(todosAdapter)
      const follower = createCoordinator(notesAdapter)

      try {
        leader.subscribe(`todos`, () => {})
        await leadershipReadPromise
        await Promise.resolve()
        expect(leader.isLeader(`todos`)).toBe(true)
        follower.subscribe(`todos`, () => {})

        // Resolving a later collection variant must not replace the adapter
        // already owning leader-side work for `todos`.
        leader.setAdapter(notesAdapter)
        await follower.requestEnsurePersistedIndex(`todos`, `idx-todos`, {
          expressionSql: [`title`],
        })

        expect(todosAdapter.ensureIndex).toHaveBeenCalledOnce()
        expect(notesAdapter.ensureIndex).not.toHaveBeenCalled()
      } finally {
        follower.dispose()
        leader.dispose()
      }
    })

    it(`routes generated collection and RPC histories through their owning adapter`, async () => {
      let run = 0
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 4 }).chain((collectionCount) =>
            fc.record({
              collectionCount: fc.constant(collectionCount),
              registrationOrder: fc.shuffledSubarray(
                Array.from({ length: collectionCount }, (_, index) => index),
                { minLength: collectionCount, maxLength: collectionCount },
              ),
              targetIndex: fc.integer({ min: 0, max: collectionCount - 1 }),
              rpcKind: fc.constantFrom(`index`, `pull`, `mutation`),
            }),
          ),
          async ({
            collectionCount,
            registrationOrder,
            targetIndex,
            rpcKind,
          }) => {
            run++
            const collectionIds = Array.from(
              { length: collectionCount },
              (_, index) => `routing-${run}-${index}`,
            )
            const adapters = collectionIds.map(() => createStubAdapter())
            const ensureCalls = adapters.map(() => vi.fn())
            const pullCalls = adapters.map(() => vi.fn())
            adapters.forEach((adapter, index) => {
              adapter.ensureIndex =
                ensureCalls[index]!.mockResolvedValue(undefined)
              adapter.pullSince = pullCalls[index]!.mockResolvedValue({
                latestRowVersion: index,
                requiresFullReload: false,
                changedKeys: [],
                deletedKeys: [],
              })
            })

            let leadershipRead!: () => void
            const leadershipReadPromise = new Promise<void>((resolve) => {
              leadershipRead = resolve
            })
            adapters[targetIndex]!.getStreamPosition = async () => {
              leadershipRead()
              return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
            }

            const leader = createCoordinator(adapters[0])
            const follower = createCoordinator(adapters.at(-1))
            const targetCollectionId = collectionIds[targetIndex]!
            try {
              for (const index of registrationOrder) {
                leader.setAdapterForCollection(
                  collectionIds[index]!,
                  adapters[index]!,
                )
              }
              leader.subscribe(targetCollectionId, () => {})
              await leadershipReadPromise
              await Promise.resolve()
              follower.subscribe(targetCollectionId, () => {})

              if (rpcKind === `index`) {
                await follower.requestEnsurePersistedIndex(
                  targetCollectionId,
                  `idx-${run}`,
                  { expressionSql: [`title`] },
                )
              } else if (rpcKind === `pull`) {
                await follower.pullSince(targetCollectionId, 0)
              } else {
                const response = await follower.requestApplyLocalMutations(
                  targetCollectionId,
                  [
                    {
                      mutationId: `mut-${run}`,
                      type: `insert`,
                      key: `${run}`,
                      value: { id: `${run}`, title: `row ${run}` },
                    },
                  ],
                )
                expect(response.ok).toBe(true)
              }

              adapters.forEach((adapter, index) => {
                const callCount =
                  rpcKind === `index`
                    ? ensureCalls[index]!.mock.calls.length
                    : rpcKind === `pull`
                      ? pullCalls[index]!.mock.calls.length
                      : adapter.appliedTxs.length
                expect(callCount).toBe(index === targetIndex ? 1 : 0)
              })
            } finally {
              follower.dispose()
              leader.dispose()
              for (let microtask = 0; microtask < 4; microtask++) {
                await Promise.resolve()
              }
            }
          },
        ),
        { seed: 1868, numRuns: 18, endOnFailure: true },
      )
    })
  })

  describe(`collection and retry-result retention`, () => {
    it(`releases generated collection-owned state after the last subscriber`, async () => {
      let run = 0
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }).chain((collectionCount) =>
            fc.record({
              collectionCount: fc.constant(collectionCount),
              releaseOrder: fc.shuffledSubarray(
                Array.from({ length: collectionCount }, (_, index) => index),
                { minLength: collectionCount, maxLength: collectionCount },
              ),
            }),
          ),
          async ({ collectionCount, releaseOrder }) => {
            run++
            const coordinator = createCoordinator()
            const collectionIds = Array.from(
              { length: collectionCount },
              (_, index) => `lifecycle-${run}-${index}`,
            )
            const readyCollections = new Set<string>()
            const allReady = createDeferred()
            observePostedMessage = (data) => {
              const envelope = data as {
                collectionId?: string
                payload?: { type?: string }
              }
              if (
                envelope.payload?.type === `leader:heartbeat` &&
                envelope.collectionId &&
                collectionIds.includes(envelope.collectionId)
              ) {
                readyCollections.add(envelope.collectionId)
                if (readyCollections.size === collectionCount) {
                  allReady.resolve()
                }
              }
            }
            for (const collectionId of collectionIds) {
              coordinator.setAdapterForCollection(
                collectionId,
                createStubAdapter(),
              )
            }
            const releases = collectionIds.map((collectionId) =>
              coordinator.subscribe(collectionId, () => {}),
            )

            try {
              await allReady.promise
              observePostedMessage = undefined
              expect(
                inspectCoordinator(coordinator).collectionAdapters.size,
              ).toBe(collectionCount)

              let remaining = collectionCount
              for (const releasedIndex of releaseOrder) {
                releases[releasedIndex]!()
                remaining--
                expect({
                  adapters:
                    inspectCoordinator(coordinator).collectionAdapters.size,
                  collections: inspectCoordinator(coordinator).collections.size,
                }).toEqual({
                  adapters: remaining,
                  collections: remaining,
                })
              }
            } finally {
              observePostedMessage = undefined
              for (const release of releases) release()
              coordinator.dispose()
            }
          },
        ),
        { seed: 1868, numRuns: 12, endOnFailure: true },
      )
    })

    it(`bounds generated retry-result histories by retention and collection lifecycle`, async () => {
      vi.useFakeTimers()
      let run = 0
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.record({
              mutationCount: fc.integer({ min: 1, max: 4 }),
              terminal: fc.constantFrom(`retention`, `unsubscribe`, `dispose`),
            }),
            async ({ mutationCount, terminal }) => {
              run++
              vi.setSystemTime(0)
              const adapter = createStubAdapter()
              const coordinator = createCoordinator(adapter)
              const collectionId = `envelope-retention-${run}`
              const ready = createDeferred()
              observePostedMessage = (data) => {
                const envelope = data as {
                  collectionId?: string
                  payload?: { type?: string }
                }
                if (
                  envelope.collectionId === collectionId &&
                  envelope.payload?.type === `leader:heartbeat`
                ) {
                  ready.resolve()
                }
              }
              const release = coordinator.subscribe(collectionId, () => {})

              try {
                await ready.promise
                observePostedMessage = undefined
                for (let index = 0; index < mutationCount; index++) {
                  await coordinator.requestApplyLocalMutations(collectionId, [
                    {
                      mutationId: `mutation-${run}-${index}`,
                      type: `insert`,
                      key: `${index}`,
                      value: { id: `${index}`, title: `row ${index}` },
                    },
                  ])
                }
                expect(
                  inspectCoordinator(coordinator).appliedEnvelopeIds.size,
                ).toBe(mutationCount)

                if (terminal === `retention`) {
                  await vi.advanceTimersByTimeAsync(60_000)
                } else if (terminal === `unsubscribe`) {
                  release()
                } else {
                  coordinator.dispose()
                }

                expect(
                  inspectCoordinator(coordinator).appliedEnvelopeIds.size,
                ).toBe(0)
              } finally {
                observePostedMessage = undefined
                release()
                coordinator.dispose()
                vi.clearAllTimers()
              }
            },
          ),
          { seed: 1868, numRuns: 12, endOnFailure: true },
        )
      } finally {
        vi.useRealTimers()
      }
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

    it(`settles an in-flight RPC at dispose without posting retries`, async () => {
      vi.useFakeTimers()
      const adapter = createStubAdapter()
      let leadershipRead!: () => void
      const leadershipReadPromise = new Promise<void>((resolve) => {
        leadershipRead = resolve
      })
      let firstRequestPosted!: () => void
      const firstRequestPostedPromise = new Promise<void>((resolve) => {
        firstRequestPosted = resolve
      })
      adapter.getStreamPosition = async () => {
        leadershipRead()
        return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
      }

      const leader = createCoordinator(adapter)
      const follower = createCoordinator(adapter)
      let requestPosts = 0
      let settled = false

      try {
        leader.subscribe(`todos`, () => {})
        await leadershipReadPromise
        await Promise.resolve()
        follower.subscribe(`todos`, () => {})

        observePostedMessage = (data) => {
          const type = (data as { payload?: { type?: string } }).payload?.type
          if (type === `rpc:ensurePersistedIndex:req`) {
            requestPosts++
            if (requestPosts === 1) firstRequestPosted()
          }
        }
        dropNextMessageWhen = (data) =>
          (data as { payload?: { type?: string } }).payload?.type ===
          `rpc:ensurePersistedIndex:req`

        const request = follower
          .requestEnsurePersistedIndex(`todos`, `idx-dispose`, {
            expressionSql: [`title`],
          })
          .then(
            () => {
              settled = true
            },
            () => {
              settled = true
            },
          )

        await firstRequestPostedPromise
        follower.dispose()
        for (let microtask = 0; microtask < 8; microtask++) {
          await Promise.resolve()
        }
        const settledAtDispose = settled

        await vi.advanceTimersByTimeAsync(21_000)
        await request

        expect({ settledAtDispose, requestPosts }).toEqual({
          settledAtDispose: true,
          requestPosts: 1,
        })
      } finally {
        follower.dispose()
        leader.dispose()
        vi.useRealTimers()
      }
    })

    it(`makes disposal terminal across generated RPC kinds and lifecycle phases`, async () => {
      vi.useFakeTimers()
      let run = 0
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.record({
              rpcKind: fc.constantFrom(`index`, `pull`, `mutation`),
              disposePhase: fc.constantFrom(
                `before-request`,
                `pending`,
                `retry-delay`,
              ),
            }),
            async ({ rpcKind, disposePhase }) => {
              run++
              const collectionId = `dispose-history-${run}`
              const adapter = createStubAdapter()
              let leadershipRead!: () => void
              const leadershipReadPromise = new Promise<void>((resolve) => {
                leadershipRead = resolve
              })
              let firstRequestPosted!: () => void
              const firstRequestPostedPromise = new Promise<void>((resolve) => {
                firstRequestPosted = resolve
              })
              adapter.getStreamPosition = async () => {
                leadershipRead()
                return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
              }

              const leader = createCoordinator(adapter)
              const follower = createCoordinator(adapter)
              let requestPosts = 0
              const requestType =
                rpcKind === `index`
                  ? `rpc:ensurePersistedIndex:req`
                  : rpcKind === `pull`
                    ? `rpc:pullSince:req`
                    : `rpc:applyLocalMutations:req`

              try {
                leader.subscribe(collectionId, () => {})
                await leadershipReadPromise
                await Promise.resolve()
                follower.subscribe(collectionId, () => {})

                observePostedMessage = (data) => {
                  if (
                    (data as { payload?: { type?: string } }).payload?.type ===
                    requestType
                  ) {
                    requestPosts++
                    if (requestPosts === 1) firstRequestPosted()
                  }
                }
                dropNextMessageWhen = (data) =>
                  (data as { payload?: { type?: string } }).payload?.type ===
                  requestType

                if (disposePhase === `before-request`) {
                  follower.dispose()
                }
                const request =
                  rpcKind === `index`
                    ? follower.requestEnsurePersistedIndex(
                        collectionId,
                        `idx-${run}`,
                        { expressionSql: [`title`] },
                      )
                    : rpcKind === `pull`
                      ? follower.pullSince(collectionId, 0)
                      : follower.requestApplyLocalMutations(collectionId, [
                          {
                            mutationId: `mut-${run}`,
                            type: `insert`,
                            key: `${run}`,
                            value: { id: `${run}`, title: `row ${run}` },
                          },
                        ])
                const settled = request.then(
                  () => `resolved` as const,
                  () => `rejected` as const,
                )

                if (disposePhase !== `before-request`) {
                  await firstRequestPostedPromise
                  if (disposePhase === `retry-delay`) {
                    await vi.advanceTimersByTimeAsync(10_000)
                  }
                  follower.dispose()
                }

                await expect(settled).resolves.toBe(`rejected`)
                expect(requestPosts).toBe(
                  disposePhase === `before-request` ? 0 : 1,
                )
              } finally {
                observePostedMessage = undefined
                dropNextMessageWhen = undefined
                follower.dispose()
                leader.dispose()
                for (let microtask = 0; microtask < 4; microtask++) {
                  await Promise.resolve()
                }
              }
            },
          ),
          { seed: 1868, numRuns: 18, endOnFailure: true },
        )
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
