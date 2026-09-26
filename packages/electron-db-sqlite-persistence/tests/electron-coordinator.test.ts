/**
 * Browser and Electron coordinators implement the same cross-window protocol.
 * The generated Browser law owns the history dimensions; these shrink
 * witnesses keep the Electron implementation on the same adapter-routing,
 * retry-result, and disposal boundaries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectronCollectionCoordinator } from '../src/electron-coordinator'
import type { ElectronCollectionCoordinatorOptions } from '../src/electron-coordinator'
import type { PersistenceAdapter } from '@tanstack/db-sqlite-persistence-core'

type MessageHandler = (event: { data: unknown }) => void
const channels = new Map<string, Set<{ onmessage: MessageHandler | null }>>()
let dropNextMessageWhen: ((data: unknown) => boolean) | undefined
let observePostedMessage: ((data: unknown) => void) | undefined

class MockBroadcastChannel {
  onmessage: MessageHandler | null = null

  constructor(readonly name: string) {
    const peers = channels.get(name) ?? new Set()
    peers.add(this)
    channels.set(name, peers)
  }

  postMessage(data: unknown): void {
    observePostedMessage?.(data)
    if (dropNextMessageWhen?.(data)) {
      dropNextMessageWhen = undefined
      return
    }
    for (const peer of channels.get(this.name) ?? []) {
      if (peer !== this && peer.onmessage) {
        const handler = peer.onmessage
        queueMicrotask(() => handler({ data: structuredClone(data) }))
      }
    }
  }

  close(): void {
    channels.get(this.name)?.delete(this)
  }
}

type LockCallback = (lock: { name: string }) => Promise<unknown>
type QueuedLock = {
  callback: LockCallback
  signal?: AbortSignal
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}
const heldLocks = new Set<string>()
const lockQueues = new Map<string, Array<QueuedLock>>()

function grantNextLock(name: string): void {
  if (heldLocks.has(name)) return
  const next = lockQueues.get(name)?.shift()
  if (!next) return
  if (next.signal?.aborted) {
    grantNextLock(name)
    return
  }
  heldLocks.add(name)
  void Promise.resolve(next.callback({ name })).then(
    (value) => {
      heldLocks.delete(name)
      next.resolve(value)
      grantNextLock(name)
    },
    (error: unknown) => {
      heldLocks.delete(name)
      next.reject(error instanceof Error ? error : new Error(String(error)))
      grantNextLock(name)
    },
  )
}

const mockLocks = {
  request: (
    name: string,
    optionsOrCallback: { signal?: AbortSignal } | LockCallback,
    maybeCallback?: LockCallback,
  ): Promise<unknown> => {
    const callback =
      typeof optionsOrCallback === `function`
        ? optionsOrCallback
        : maybeCallback!
    const signal =
      typeof optionsOrCallback === `function`
        ? undefined
        : optionsOrCallback.signal
    return new Promise((resolve, reject) => {
      const entry = { callback, signal, resolve, reject }
      const queue = lockQueues.get(name) ?? []
      queue.push(entry)
      lockQueues.set(name, queue)
      signal?.addEventListener(`abort`, () => {
        const index = queue.indexOf(entry)
        if (index >= 0) {
          queue.splice(index, 1)
          reject(new DOMException(`Lock request aborted`, `AbortError`))
        }
      })
      grantNextLock(name)
    })
  },
}

type StubAdapter = PersistenceAdapter & {
  appliedTxs: Array<string>
  pullSince: () => Promise<{
    latestRowVersion: number
    requiresFullReload: false
    changedKeys: Array<string>
    deletedKeys: Array<string>
  }>
  getStreamPosition: () => Promise<{
    latestTerm: number
    latestSeq: number
    latestRowVersion: number
  }>
}

function createStubAdapter(): StubAdapter {
  const appliedTxs: Array<string> = []
  return {
    appliedTxs,
    loadSubset: async () => [],
    loadResumeSnapshot: async () => ({
      rows: [],
      collectionMetadata: [],
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
      resetEpoch: 0,
    }),
    applyCommittedTx: async (_collectionId, tx) => {
      appliedTxs.push(tx.txId)
    },
    ensureIndex: async () => {},
    pullSince: async () => ({
      latestRowVersion: 0,
      requiresFullReload: false,
      changedKeys: [],
      deletedKeys: [],
    }),
    getStreamPosition: async () => ({
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
    }),
  }
}

function createCoordinator(
  adapter: StubAdapter,
): ElectronCollectionCoordinator {
  const options: ElectronCollectionCoordinatorOptions = {
    dbName: `electron-coordinator-law`,
    adapter,
  }
  return new ElectronCollectionCoordinator(options)
}

async function waitForLeadership(
  coordinator: ElectronCollectionCoordinator,
  collectionId: string,
): Promise<void> {
  for (let microtask = 0; microtask < 12; microtask++) {
    if (coordinator.isLeader(collectionId)) return
    await Promise.resolve()
  }
  expect(coordinator.isLeader(collectionId)).toBe(true)
}

type CoordinatorInspection = {
  collectionAdapters: Map<string, unknown>
  collections: Map<string, unknown>
  appliedEnvelopes: Map<string, unknown>
}

function inspectCoordinator(
  coordinator: ElectronCollectionCoordinator,
): CoordinatorInspection {
  return coordinator as unknown as CoordinatorInspection
}

describe(`ElectronCollectionCoordinator parity`, () => {
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).BroadcastChannel =
      MockBroadcastChannel as unknown
    Object.defineProperty(globalThis, `navigator`, {
      value: { locks: mockLocks },
      configurable: true,
    })
  })

  afterEach(() => {
    dropNextMessageWhen = undefined
    observePostedMessage = undefined
    channels.clear()
    heldLocks.clear()
    lockQueues.clear()
    vi.useRealTimers()
  })

  it(`keeps follower RPC work on the collection adapter`, async () => {
    const todosAdapter = createStubAdapter()
    const notesAdapter = createStubAdapter()
    let leadershipRead!: () => void
    const leadershipReadPromise = new Promise<void>((resolve) => {
      leadershipRead = resolve
    })
    todosAdapter.getStreamPosition = async () => {
      leadershipRead()
      return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
    }
    todosAdapter.ensureIndex = vi.fn().mockResolvedValue(undefined)
    notesAdapter.ensureIndex = vi.fn().mockResolvedValue(undefined)

    const leader = createCoordinator(todosAdapter)
    const follower = createCoordinator(notesAdapter)
    try {
      leader.setAdapterForCollection(`todos`, todosAdapter)
      leader.subscribe(`todos`, () => {})
      await leadershipReadPromise
      await waitForLeadership(leader, `todos`)
      follower.subscribe(`todos`, () => {})
      leader.setAdapter(notesAdapter)

      const postedTypes: Array<string | undefined> = []
      observePostedMessage = (data) => {
        postedTypes.push(
          (data as { payload?: { type?: string } }).payload?.type,
        )
      }
      const request = follower.requestEnsurePersistedIndex(`todos`, `idx`, {
        expressionSql: [`title`],
      })
      for (let microtask = 0; microtask < 12; microtask++) {
        await Promise.resolve()
      }
      expect(postedTypes).toContain(`rpc:ensurePersistedIndex:res`)
      await request

      expect(todosAdapter.ensureIndex).toHaveBeenCalledOnce()
      expect(notesAdapter.ensureIndex).not.toHaveBeenCalled()
    } finally {
      follower.dispose()
      leader.dispose()
    }
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

    const coordinator = createCoordinator(adapter)
    try {
      coordinator.subscribe(`todos`, () => {})
      await leadershipReadPromise
      await waitForLeadership(coordinator, `todos`)
      const spec = { expressionSql: [`title`] }

      await adapter.ensureIndex(`todos`, `idx-once`, spec)
      await coordinator.requestEnsurePersistedIndex(
        `todos`,
        `idx-once`,
        spec,
        adapter,
        true,
      )

      expect(adapter.ensureIndex).toHaveBeenCalledOnce()
    } finally {
      coordinator.dispose()
    }
  })

  it(`replays a successful mutation result after response loss`, async () => {
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
      await waitForLeadership(leader, `todos`)
      follower.subscribe(`todos`, () => {})
      dropNextMessageWhen = (data) => {
        const payload = (data as { payload?: { type?: string; ok?: boolean } })
          .payload
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
          mutationId: `mut-electron`,
          type: `insert`,
          key: `1`,
          value: { id: `1` },
        },
      ])
      await firstSuccessDroppedPromise
      await vi.advanceTimersByTimeAsync(10_200)

      await expect(responsePromise).resolves.toMatchObject({
        ok: true,
        acceptedMutationIds: [`mut-electron`],
      })
      expect(adapter.appliedTxs).toHaveLength(1)
    } finally {
      follower.dispose()
      leader.dispose()
    }
  })

  it(`scopes envelope deduplication by collection`, async () => {
    const alphaAdapter = createStubAdapter()
    const betaAdapter = createStubAdapter()
    const coordinator = createCoordinator(alphaAdapter)
    coordinator.setAdapterForCollection(`alpha`, alphaAdapter)
    coordinator.setAdapterForCollection(`beta`, betaAdapter)
    coordinator.subscribe(`alpha`, () => {})
    coordinator.subscribe(`beta`, () => {})

    const internals = coordinator as unknown as {
      handleApplyLocalMutations: (
        collectionId: string,
        request: {
          type: `rpc:applyLocalMutations:req`
          rpcId: string
          envelopeId: string
          mutations: Array<{
            mutationId: string
            type: `insert`
            key: string
            value: { id: string }
          }>
        },
      ) => Promise<{ ok: boolean; rpcId: string }>
    }

    try {
      await Promise.all([
        waitForLeadership(coordinator, `alpha`),
        waitForLeadership(coordinator, `beta`),
      ])
      const alpha = await internals.handleApplyLocalMutations(`alpha`, {
        type: `rpc:applyLocalMutations:req`,
        rpcId: `alpha-rpc`,
        envelopeId: `shared-envelope`,
        mutations: [
          {
            mutationId: `alpha-mutation`,
            type: `insert`,
            key: `alpha`,
            value: { id: `alpha` },
          },
        ],
      })
      const beta = await internals.handleApplyLocalMutations(`beta`, {
        type: `rpc:applyLocalMutations:req`,
        rpcId: `beta-rpc`,
        envelopeId: `shared-envelope`,
        mutations: [
          {
            mutationId: `beta-mutation`,
            type: `insert`,
            key: `beta`,
            value: { id: `beta` },
          },
        ],
      })

      expect({
        alpha,
        alphaApplies: alphaAdapter.appliedTxs.length,
        beta,
        betaApplies: betaAdapter.appliedTxs.length,
      }).toMatchObject({
        alpha: { ok: true, rpcId: `alpha-rpc` },
        alphaApplies: 1,
        beta: { ok: true, rpcId: `beta-rpc` },
        betaApplies: 1,
      })
    } finally {
      coordinator.dispose()
    }
  })

  it(`coalesces an envelope retry while its first write is in flight`, async () => {
    const adapter = createStubAdapter()
    let enterFirstApply!: () => void
    const firstApplyEntered = new Promise<void>((resolve) => {
      enterFirstApply = resolve
    })
    let releaseFirstApply!: () => void
    const firstApplyRelease = new Promise<void>((resolve) => {
      releaseFirstApply = resolve
    })
    let applyCalls = 0
    adapter.applyCommittedTx = async (_collectionId, tx) => {
      applyCalls++
      if (applyCalls === 1) {
        enterFirstApply()
        await firstApplyRelease
      }
      adapter.appliedTxs.push(tx.txId)
    }
    const coordinator = createCoordinator(adapter)
    coordinator.subscribe(`todos`, () => {})

    const internals = coordinator as unknown as {
      handleApplyLocalMutations: (
        collectionId: string,
        request: {
          type: `rpc:applyLocalMutations:req`
          rpcId: string
          envelopeId: string
          mutations: Array<{
            mutationId: string
            type: `insert`
            key: string
            value: { id: string }
          }>
        },
      ) => Promise<{
        ok: boolean
        rpcId: string
        term?: number
        seq?: number
        latestRowVersion?: number
      }>
    }
    const request = {
      type: `rpc:applyLocalMutations:req` as const,
      envelopeId: `in-flight-envelope`,
      mutations: [
        {
          mutationId: `mutation`,
          type: `insert` as const,
          key: `row`,
          value: { id: `row` },
        },
      ],
    }

    try {
      await waitForLeadership(coordinator, `todos`)
      const first = internals.handleApplyLocalMutations(`todos`, {
        ...request,
        rpcId: `first-rpc`,
      })
      await firstApplyEntered
      const retry = internals.handleApplyLocalMutations(`todos`, {
        ...request,
        rpcId: `retry-rpc`,
      })
      await Promise.resolve()
      releaseFirstApply()

      const [firstResponse, retryResponse] = await Promise.all([first, retry])
      expect({
        applyCalls,
        first: { ...firstResponse, rpcId: undefined },
        retry: { ...retryResponse, rpcId: undefined },
      }).toEqual({
        applyCalls: 1,
        first: { ...retryResponse, rpcId: undefined },
        retry: { ...firstResponse, rpcId: undefined },
      })
    } finally {
      releaseFirstApply()
      coordinator.dispose()
    }
  })

  it(`releases collection-owned state and retry results with the last subscriber`, async () => {
    const adapter = createStubAdapter()
    const coordinator = createCoordinator(adapter)
    const release = coordinator.subscribe(`todos`, () => {})
    try {
      await waitForLeadership(coordinator, `todos`)
      await coordinator.requestApplyLocalMutations(`todos`, [
        {
          mutationId: `mut-release`,
          type: `insert`,
          key: `1`,
          value: { id: `1` },
        },
      ])
      expect({
        adapters: inspectCoordinator(coordinator).collectionAdapters.size,
        collections: inspectCoordinator(coordinator).collections.size,
        envelopes: inspectCoordinator(coordinator).appliedEnvelopes.size,
      }).toEqual({ adapters: 1, collections: 1, envelopes: 1 })

      release()
      expect({
        adapters: inspectCoordinator(coordinator).collectionAdapters.size,
        collections: inspectCoordinator(coordinator).collections.size,
        envelopes: inspectCoordinator(coordinator).appliedEnvelopes.size,
      }).toEqual({ adapters: 0, collections: 0, envelopes: 0 })
    } finally {
      release()
      coordinator.dispose()
    }
  })

  it(`expires retry results without later mutation traffic`, async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const adapter = createStubAdapter()
    const coordinator = createCoordinator(adapter)
    const release = coordinator.subscribe(`todos`, () => {})
    try {
      await waitForLeadership(coordinator, `todos`)
      await coordinator.requestApplyLocalMutations(`todos`, [
        {
          mutationId: `mut-expire`,
          type: `insert`,
          key: `1`,
          value: { id: `1` },
        },
      ])
      expect(inspectCoordinator(coordinator).appliedEnvelopes.size).toBe(1)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(inspectCoordinator(coordinator).appliedEnvelopes.size).toBe(0)
    } finally {
      release()
      coordinator.dispose()
      vi.useRealTimers()
    }
  })

  it(`settles pending work at dispose without retrying`, async () => {
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
    try {
      leader.subscribe(`todos`, () => {})
      await leadershipReadPromise
      await waitForLeadership(leader, `todos`)
      follower.subscribe(`todos`, () => {})
      observePostedMessage = (data) => {
        if (
          (data as { payload?: { type?: string } }).payload?.type ===
          `rpc:pullSince:req`
        ) {
          requestPosts++
          firstRequestPosted()
        }
      }
      dropNextMessageWhen = (data) =>
        (data as { payload?: { type?: string } }).payload?.type ===
        `rpc:pullSince:req`

      const settled = follower.pullSince(`todos`, 0).then(
        () => `resolved`,
        () => `rejected`,
      )
      await firstRequestPostedPromise
      follower.dispose()

      await expect(settled).resolves.toBe(`rejected`)
      await vi.advanceTimersByTimeAsync(21_000)
      expect(requestPosts).toBe(1)
    } finally {
      follower.dispose()
      leader.dispose()
    }
  })
})
