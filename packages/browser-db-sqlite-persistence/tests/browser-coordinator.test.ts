import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IR } from '@tanstack/db'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import type { LoadSubsetOptions, Subscription } from '@tanstack/db'
import type {
  ApplyCommittedTxRequest,
  ApplyLocalMutationsRequest,
  IndeterminateCommitError,
  PersistedCollectionDurabilityError,
  PersistedTx,
  PersistenceAdapter,
  RemoteSubsetOwner,
  TransportedLoadSubsetOptions,
} from '@tanstack/db-sqlite-persistence-core'
import type { BrowserCollectionCoordinatorOptions } from '../src/browser-coordinator'

/**
 * # Which Browser coordinator outcomes are safe to acknowledge?
 *
 * RFC #1659 requires every adapter operation to use the elected owner for its
 * collection. Complete committed transactions must cross that boundary
 * without losing metadata. A mutating RPC may replay only through the same
 * known leader and term. Remote subset request data must be clone-safe, and
 * each accepted physical acquisition creates one exact acquisition lease.
 *
 * The adapter call logs, transport controls, owner callbacks, and internal-map
 * snapshots are focused reference ledgers. Histories vary local and follower
 * routes, response loss, leadership change, owner replacement, duplicate
 * delivery, release, failure, and disposal. The production driver is the real
 * `BrowserCollectionCoordinator`; only BroadcastChannel and Web Locks are
 * replaced with deterministic seams.
 *
 * Checkpoints sit at adapter entry, RPC response delivery, acquisition
 * acceptance, acquisition release, lifecycle failure, and disposal. Fault
 * controls drop or duplicate messages, reject owner work, change leaders, and
 * advance the released-tombstone clock. Exact call counts and error identities
 * prevent a final-state-only false green.
 *
 * The composed public-Collection and generated route models live in
 * `per-collection-coordinator-oracle.test.ts`. These seams do not prove real
 * browser scheduling, Web Locks, BroadcastChannel, OPFS ownership, or worker
 * behavior. They also do not yet prove bounded retry after follower transport
 * or remote-owner admission failure; that review finding remains open.
 */

// ---------------------------------------------------------------------------
// BroadcastChannel mock
// ---------------------------------------------------------------------------

type MessageHandler = (event: { data: unknown }) => void
const channels: Map<
  string,
  Set<{ onmessage: MessageHandler | null }>
> = new Map()
let dropNextBroadcastMessage: ((data: unknown) => boolean) | undefined
let duplicateNextBroadcastMessage:
  | ((data: unknown) => unknown | undefined)
  | undefined
let observeBroadcastMessage: ((data: unknown) => void) | undefined

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
    observeBroadcastMessage?.(data)
    if (dropNextBroadcastMessage?.(data)) {
      dropNextBroadcastMessage = undefined
      return
    }

    const duplicate = duplicateNextBroadcastMessage?.(data)
    if (duplicate !== undefined) {
      duplicateNextBroadcastMessage = undefined
    }
    // BroadcastChannel performs serialization during postMessage, so clone
    // failures are synchronous rather than deferred to delivery.
    const deliveries = (
      duplicate === undefined ? [data] : [data, duplicate]
    ).map((delivery) => structuredClone(delivery))
    const peers = channels.get(this.name)
    if (!peers) return
    // Deliver to all other instances on same channel (simulating cross-tab)
    for (const peer of peers) {
      if (peer !== this && peer.onmessage) {
        // Use microtask to simulate async delivery
        const handler = peer.onmessage
        for (const delivery of deliveries) {
          queueMicrotask(() => handler({ data: structuredClone(delivery) }))
        }
      }
    }
  }

  close(): void {
    channels.get(this.name)?.delete(this)
  }
}

function injectBroadcastMessage(channelName: string, data: unknown): void {
  for (const endpoint of channels.get(channelName) ?? []) {
    const handler = endpoint.onmessage
    if (handler) {
      queueMicrotask(() => handler({ data: structuredClone(data) }))
    }
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
  dropNextBroadcastMessage = undefined
  duplicateNextBroadcastMessage = undefined
  observeBroadcastMessage = undefined
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
  appliedTxs: Array<{ collectionId: string; tx: PersistedTx }>
} {
  const appliedTxs: Array<{ collectionId: string; tx: PersistedTx }> = []

  return {
    appliedTxs,
    loadSubset: () => Promise.resolve([]),
    applyCommittedTx: (collectionId, tx) => {
      appliedTxs.push({ collectionId, tx })
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
  const coordinator = new BrowserCollectionCoordinator(opts)
  liveCoordinators.add(coordinator)
  return coordinator
}

const liveCoordinators = new Set<BrowserCollectionCoordinator>()

function subsetWithNestedValue(value: unknown): LoadSubsetOptions {
  return {
    where: new IR.Func(`in`, [
      new IR.PropRef([`todos`, `status`]),
      new IR.Value([`kept`, value]),
    ]),
  }
}

function withUnusedUnloadSubset<
  T extends (options: TransportedLoadSubsetOptions) => Promise<void> | void,
>(owner: T): T & RemoteSubsetOwner {
  // These fixtures exercise admission and delivery only. The required no-op
  // release hook keeps that unrelated scope explicit without weakening the
  // production coordinator contract.
  return Object.assign(owner, {
    unloadSubset: vi.fn(),
    onError: vi.fn(),
  })
}

class UnsupportedSubsetValue {
  constructor(readonly label: string) {}
}

function withEnumerableExpando<T extends object>(value: T): T {
  Object.defineProperty(value, `extra`, {
    value: `would be lost`,
    enumerable: true,
  })
  return value
}

function detachBufferWithView(
  kind: `buffer` | `data-view` | `typed-array`,
): ArrayBuffer | DataView | Uint8Array {
  const buffer = new ArrayBuffer(4)
  const value =
    kind === `buffer`
      ? buffer
      : kind === `data-view`
        ? new DataView(buffer)
        : new Uint8Array(buffer)
  structuredClone(buffer, { transfer: [buffer] })
  return value
}

type ResizableArrayBufferConstructor = {
  new (byteLength: number, options: { maxByteLength: number }): ArrayBuffer
}

type Float16ArrayConstructor = {
  new (values: ArrayLike<number>): ArrayBufferView
}

function createResizableArrayBuffer(): ArrayBuffer | undefined {
  try {
    const buffer = new (ArrayBuffer as ResizableArrayBufferConstructor)(4, {
      maxByteLength: 8,
    })
    return (buffer as ArrayBuffer & { readonly resizable?: boolean }).resizable
      ? buffer
      : undefined
  } catch {
    return undefined
  }
}

const unsupportedValuePath = `options.where.args[1].value[1]`
const resizableArrayBufferValueCases = createResizableArrayBuffer()
  ? ([
      [
        `resizable ArrayBuffer`,
        () => createResizableArrayBuffer()!,
        unsupportedValuePath,
      ],
      [
        `length-tracking DataView`,
        () => new DataView(createResizableArrayBuffer()!),
        unsupportedValuePath,
      ],
      [
        `length-tracking typed array`,
        () => new Uint8Array(createResizableArrayBuffer()!),
        unsupportedValuePath,
      ],
    ] as const)
  : ([] as const)
const Float16ArrayValue = Reflect.get(globalThis, `Float16Array`) as
  | Float16ArrayConstructor
  | undefined
const float16ArrayValueCases = Float16ArrayValue
  ? ([
      [
        `Float16Array outside the exported typed-array union`,
        () => new Float16ArrayValue([1, 2]),
        unsupportedValuePath,
      ],
    ] as const)
  : ([] as const)

const unsupportedSubsetValueCases = [
  [`function`, () => () => {}, unsupportedValuePath],
  [`symbol`, () => Symbol(`unsupported`), unsupportedValuePath],
  [`WeakMap`, () => new WeakMap(), unsupportedValuePath],
  [`WeakSet`, () => new WeakSet(), unsupportedValuePath],
  [`Promise`, () => Promise.resolve(`unsupported`), unsupportedValuePath],
  [
    `custom prototype`,
    () => new UnsupportedSubsetValue(`unsupported`),
    unsupportedValuePath,
  ],
  [
    `custom prototype with a throwing constructor getter`,
    () => {
      const prototype = Object.create(null) as object
      Object.defineProperty(prototype, `constructor`, {
        get: () => {
          throw new Error(`constructor getter must not be invoked`)
        },
      })
      return Object.create(prototype) as object
    },
    unsupportedValuePath,
  ],
  [
    `nonzero RegExp lastIndex`,
    () => {
      const regexp = /wire/g
      regexp.lastIndex = 2
      return regexp
    },
    `${unsupportedValuePath}.lastIndex`,
  ],
  [`SharedArrayBuffer`, () => new SharedArrayBuffer(4), unsupportedValuePath],
  [
    `function-valued Map key`,
    () => new Map([[() => {}, `value`]]),
    `${unsupportedValuePath}.entries[0].key`,
  ],
  [
    `symbol-valued Map value`,
    () => new Map([[`key`, Symbol(`unsupported`)]]),
    `${unsupportedValuePath}.entries[0].value`,
  ],
  [
    `function-valued Set entry`,
    () => new Set([() => {}]),
    `${unsupportedValuePath}.values[0]`,
  ],
  [
    `detached view nested in a Map`,
    () => new Map([[`key`, detachBufferWithView(`typed-array`)]]),
    `${unsupportedValuePath}.entries[0].value`,
  ],
  [
    `detached ArrayBuffer`,
    () => detachBufferWithView(`buffer`),
    unsupportedValuePath,
  ],
  [
    `detached DataView`,
    () => detachBufferWithView(`data-view`),
    unsupportedValuePath,
  ],
  [
    `detached typed array`,
    () => detachBufferWithView(`typed-array`),
    unsupportedValuePath,
  ],
  [
    `symbol-keyed record`,
    () => ({ [Symbol(`unsupported`)]: true }),
    `${unsupportedValuePath}[Symbol(unsupported)]`,
  ],
  [
    `accessor property`,
    () =>
      Object.defineProperty({}, `computed`, {
        enumerable: true,
        get: () => {
          throw new Error(`accessor must not be invoked`)
        },
      }),
    `${unsupportedValuePath}.computed`,
  ],
  [
    `non-enumerable property`,
    () => Object.defineProperty({}, `hidden`, { value: true }),
    `${unsupportedValuePath}.hidden`,
  ],
  [
    `Date expando`,
    () => withEnumerableExpando(new Date(0)),
    `${unsupportedValuePath}.extra`,
  ],
  [
    `RegExp expando`,
    () => withEnumerableExpando(/wire/),
    `${unsupportedValuePath}.extra`,
  ],
  [
    `Map expando`,
    () => withEnumerableExpando(new Map()),
    `${unsupportedValuePath}.extra`,
  ],
  [
    `Set expando`,
    () => withEnumerableExpando(new Set()),
    `${unsupportedValuePath}.extra`,
  ],
  [
    `ArrayBuffer expando`,
    () => withEnumerableExpando(new ArrayBuffer(4)),
    `${unsupportedValuePath}.extra`,
  ],
  [
    `DataView expando`,
    () => withEnumerableExpando(new DataView(new ArrayBuffer(4))),
    `${unsupportedValuePath}.extra`,
  ],
  [
    `typed array expando`,
    () => withEnumerableExpando(new Uint8Array(4)),
    `${unsupportedValuePath}.extra`,
  ],
  [
    `array expando`,
    () => withEnumerableExpando([]),
    `${unsupportedValuePath}.extra`,
  ],
  ...resizableArrayBufferValueCases,
  ...float16ArrayValueCases,
] as const

async function flush(ms: number = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe(`BrowserCollectionCoordinator`, () => {
  beforeEach(() => {
    installGlobals()
  })

  afterEach(async () => {
    for (const coordinator of liveCoordinators) coordinator.dispose()
    liveCoordinators.clear()
    await flush(0)
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

    it(`coalesces a local-mutation envelope while application is in flight`, async () => {
      const leaderAdapter = createStubAdapter()
      const originalApply = leaderAdapter.applyCommittedTx
      let releaseApplication = (): void => {}
      const applicationGate = new Promise<void>((resolve) => {
        releaseApplication = resolve
      })
      leaderAdapter.applyCommittedTx = vi.fn(async (collectionId, tx) => {
        await applicationGate
        return originalApply(collectionId, tx)
      })
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator()
      const observedResponses: Array<{
        rpcId: string
        term: number
        seq: number
        latestRowVersion: number
        acceptedMutationIds: Array<string>
      }> = []

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      try {
        duplicateNextBroadcastMessage = (data) => {
          const envelope = data as { payload?: { type?: string } }
          if (envelope.payload?.type !== `rpc:applyLocalMutations:req`) {
            return undefined
          }
          const duplicate = structuredClone(data) as {
            payload: { rpcId: string }
          }
          duplicate.payload.rpcId = `coalesced-local-rpc`
          return duplicate
        }
        observeBroadcastMessage = (data) => {
          const payload = (
            data as {
              payload?: {
                type?: string
                rpcId?: string
                ok?: boolean
                term?: number
                seq?: number
                latestRowVersion?: number
                acceptedMutationIds?: Array<string>
              }
            }
          ).payload
          if (
            payload?.type === `rpc:applyLocalMutations:res` &&
            payload.ok === true
          ) {
            observedResponses.push({
              rpcId: payload.rpcId!,
              term: payload.term!,
              seq: payload.seq!,
              latestRowVersion: payload.latestRowVersion!,
              acceptedMutationIds: payload.acceptedMutationIds!,
            })
          }
        }

        const responsePromise = follower.requestApplyLocalMutations(`todos`, [
          {
            mutationId: `mut-in-flight`,
            type: `insert`,
            key: `todo-in-flight-local`,
            value: { id: `todo-in-flight-local` },
          },
        ])
        await flush()
        releaseApplication()
        const response = await responsePromise
        await flush()

        const responsesByRpcId = Object.fromEntries(
          observedResponses.map(({ rpcId, ...result }) => [rpcId, result]),
        )
        const expectedResult = {
          term: 1,
          seq: 1,
          latestRowVersion: 1,
          acceptedMutationIds: [`mut-in-flight`],
        }
        expect(leaderAdapter.applyCommittedTx).toHaveBeenCalledTimes(1)
        expect(leaderAdapter.appliedTxs).toHaveLength(1)
        expect(responsesByRpcId).toEqual({
          [response.rpcId]: expectedResult,
          'coalesced-local-rpc': expectedResult,
        })
      } finally {
        releaseApplication()
        observeBroadcastMessage = undefined
        duplicateNextBroadcastMessage = undefined
        leader.dispose()
        follower.dispose()
      }
    })

    it(`replays the exact local-mutation success after same-leader response loss`, async () => {
      const leaderAdapter = createStubAdapter()
      const followerAdapter = createStubAdapter()
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator(followerAdapter)

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      vi.useFakeTimers()
      try {
        let droppedResponse: unknown
        dropNextBroadcastMessage = (data) => {
          const payload = (data as { payload?: { type?: string } }).payload
          if (payload?.type !== `rpc:applyLocalMutations:res`) return false
          droppedResponse = structuredClone(payload)
          return true
        }

        const responsePromise = follower.requestApplyLocalMutations(`todos`, [
          {
            mutationId: `local-response-loss`,
            type: `insert`,
            key: `todo-local-response-loss`,
            value: { id: `todo-local-response-loss` },
          },
        ])

        await vi.advanceTimersByTimeAsync(0)
        expect(droppedResponse).toMatchObject({
          type: `rpc:applyLocalMutations:res`,
          ok: true,
        })
        expect(leaderAdapter.appliedTxs).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(10_200)
        const response = await responsePromise

        expect(response).toEqual(droppedResponse)
        expect(leaderAdapter.appliedTxs).toHaveLength(1)
        expect(followerAdapter.appliedTxs).toEqual([])
      } finally {
        leader.dispose()
        follower.dispose()
        vi.useRealTimers()
      }
    })

    it(`fails indeterminate when a local-mutation success is lost across leader change`, async () => {
      const retiredLeaderAdapter = createStubAdapter()
      const requesterAdapter = createStubAdapter()
      const retiredLeader = createCoordinator(retiredLeaderAdapter)
      const requester = createCoordinator(requesterAdapter)

      retiredLeader.subscribe(`todos`, () => {})
      requester.subscribe(`todos`, () => {})
      await flush(50)

      vi.useFakeTimers()
      try {
        let publications = 0
        observeBroadcastMessage = (data) => {
          if (
            (data as { payload?: { type?: string } }).payload?.type ===
            `tx:committed`
          ) {
            publications++
          }
        }
        dropNextBroadcastMessage = (data) =>
          (data as { payload?: { type?: string } }).payload?.type ===
          `rpc:applyLocalMutations:res`
        const outcomePromise = requester
          .requestApplyLocalMutations(`todos`, [
            {
              mutationId: `local-requester-takeover`,
              type: `insert`,
              key: `local-requester-takeover`,
              value: { id: `local-requester-takeover` },
            },
          ])
          .then(
            (response) => ({ response }),
            (error: unknown) => ({ error }),
          )

        await vi.advanceTimersByTimeAsync(0)
        expect(retiredLeaderAdapter.appliedTxs).toHaveLength(1)
        retiredLeader.dispose()
        await vi.advanceTimersByTimeAsync(0)
        expect(requester.isLeader(`todos`)).toBe(true)

        await vi.advanceTimersByTimeAsync(31_000)
        const outcome = await outcomePromise

        expect(outcome).toEqual({
          error: expect.objectContaining({
            name: `IndeterminateCommitError`,
            code: `INDETERMINATE_COMMIT`,
            collectionId: `todos`,
            requestType: `rpc:applyLocalMutations:req`,
            previousLeaderId: (retiredLeader as unknown as { nodeId: string })
              .nodeId,
            previousTerm: 1,
            currentLeaderId: (requester as unknown as { nodeId: string })
              .nodeId,
            currentTerm: 1,
            cause: expect.objectContaining({
              message: expect.stringContaining(`timed out`),
            }),
          } satisfies Partial<IndeterminateCommitError>),
        })
        expect(retiredLeaderAdapter.appliedTxs).toHaveLength(1)
        expect(requesterAdapter.appliedTxs).toEqual([])
        expect(publications).toBe(1)
      } finally {
        observeBroadcastMessage = undefined
        retiredLeader.dispose()
        requester.dispose()
        vi.useRealTimers()
      }
    })

    it(`fails indeterminate instead of retrying local mutations without an initial leader route`, async () => {
      const coordinator = createCoordinator()
      const transportError = new Error(`unknown leader response was lost`)
      const attemptedMutations: Array<ApplyLocalMutationsRequest[`mutations`]> =
        []
      const failedTransport = vi.fn(
        (_collectionId: string, request: ApplyLocalMutationsRequest) => {
          attemptedMutations.push(structuredClone(request.mutations))
          if (attemptedMutations.length === 1) {
            return Promise.reject(transportError)
          }
          return Promise.resolve({
            type: `rpc:applyLocalMutations:res` as const,
            rpcId: request.rpcId,
            ok: true as const,
            term: 1,
            seq: 1,
            latestRowVersion: 1,
            acceptedMutationIds: request.mutations.map(
              (mutation) => mutation.mutationId,
            ),
          })
        },
      )
      Object.defineProperty(coordinator, `sendRPCOnce`, {
        value: failedTransport,
        configurable: true,
      })

      try {
        const outcome = await coordinator
          .requestApplyLocalMutations(`todos`, [
            {
              mutationId: `browser-unknown-leader-local`,
              type: `insert`,
              key: `browser-unknown-leader-local`,
              value: { id: `browser-unknown-leader-local` },
            },
          ])
          .then(
            (response) => ({ response }),
            (error: unknown) => ({ error }),
          )

        expect(outcome).toEqual({
          error: expect.objectContaining({
            name: `IndeterminateCommitError`,
            code: `INDETERMINATE_COMMIT`,
            collectionId: `todos`,
            requestType: `rpc:applyLocalMutations:req`,
            previousLeaderId: null,
            previousTerm: null,
            currentLeaderId: null,
            currentTerm: null,
            cause: transportError,
          } satisfies Partial<IndeterminateCommitError>),
        })
        expect(failedTransport).toHaveBeenCalledTimes(1)
        expect(attemptedMutations).toEqual([
          [
            {
              mutationId: `browser-unknown-leader-local`,
              type: `insert`,
              key: `browser-unknown-leader-local`,
              value: { id: `browser-unknown-leader-local` },
            },
          ],
        ])
      } finally {
        coordinator.dispose()
      }
    })

    it(`classifies local-mutation durability failures on local and follower routes`, async () => {
      const failure = Object.assign(
        new Error(`local mutation persistence failed`),
        {
          code: `SQLITE_IOERR`,
          path: [`todos`, `rows`],
        },
      )
      const adapter = createStubAdapter()
      adapter.applyCommittedTx = vi.fn().mockRejectedValue(failure)
      const leader = createCoordinator(adapter)
      const follower = createCoordinator(createStubAdapter())

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      try {
        const followerResponse = await follower.requestApplyLocalMutations(
          `todos`,
          [
            {
              mutationId: `remote-durability-failure`,
              type: `insert`,
              key: `remote-durability-failure`,
              value: { id: `remote-durability-failure` },
            },
          ],
        )

        expect(followerResponse).toEqual({
          type: `rpc:applyLocalMutations:res`,
          rpcId: expect.any(String),
          ok: false,
          code: `PERSISTENCE_ERROR`,
          error: expect.stringContaining(failure.message),
          sourceCode: `SQLITE_IOERR`,
          path: [`todos`, `rows`],
        })
        expect(adapter.applyCommittedTx).toHaveBeenCalledTimes(1)

        await expect(
          leader.requestApplyLocalMutations(`todos`, [
            {
              mutationId: `local-durability-failure`,
              type: `insert`,
              key: `local-durability-failure`,
              value: { id: `local-durability-failure` },
            },
          ]),
        ).rejects.toMatchObject({
          name: `PersistedCollectionDurabilityError`,
          code: `SQLITE_IOERR`,
          path: [`todos`, `rows`],
          cause: failure,
        } satisfies Partial<PersistedCollectionDurabilityError>)
        expect(adapter.applyCommittedTx).toHaveBeenCalledTimes(2)
      } finally {
        leader.dispose()
        follower.dispose()
      }
    })
  })

  describe(`RPC - applyCommittedTx`, () => {
    it(`routes a complete source transaction to the leader-owned adapter`, async () => {
      const leaderAdapter = createStubAdapter()
      const followerAdapter = createStubAdapter()
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator(followerAdapter)
      const followerMessages: Array<unknown> = []

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, (message) => {
        if ((message.payload as { type?: string }).type === `tx:committed`) {
          followerMessages.push(message.payload)
        }
      })
      await flush(50)

      const response = await follower.requestApplyCommittedTx(`todos`, {
        txId: `source-tx`,
        term: 91,
        seq: 92,
        rowVersion: 93,
        truncate: true,
        mutations: [
          {
            type: `insert`,
            key: `todo-1`,
            value: { id: `todo-1`, title: `Owned source row` },
          },
        ],
        rowMetadataMutations: [
          { type: `set`, key: `todo-1`, value: { source: `remote` } },
        ],
        collectionMetadataMutations: [
          { type: `set`, key: `resume`, value: { offset: `next` } },
        ],
      })

      expect(response.ok).toBe(true)
      expect(followerAdapter.appliedTxs).toEqual([])
      expect(leaderAdapter.appliedTxs).toHaveLength(1)
      expect(leaderAdapter.appliedTxs[0]).toMatchObject({
        collectionId: `todos`,
        tx: {
          txId: `source-tx`,
          truncate: true,
          mutations: [
            {
              type: `insert`,
              key: `todo-1`,
              value: { id: `todo-1`, title: `Owned source row` },
            },
          ],
          rowMetadataMutations: [
            { type: `set`, key: `todo-1`, value: { source: `remote` } },
          ],
          collectionMetadataMutations: [
            { type: `set`, key: `resume`, value: { offset: `next` } },
          ],
        },
      })
      expect(leaderAdapter.appliedTxs[0]!.tx.term).not.toBe(91)
      expect(leaderAdapter.appliedTxs[0]!.tx.seq).not.toBe(92)
      expect(leaderAdapter.appliedTxs[0]!.tx.rowVersion).not.toBe(93)

      await flush()
      expect(followerMessages).toHaveLength(1)
      expect(followerMessages[0]).toEqual({
        type: `tx:committed`,
        term: expect.any(Number),
        seq: expect.any(Number),
        txId: `source-tx`,
        latestRowVersion: expect.any(Number),
        requiresFullReload: true,
      })

      leader.dispose()
      follower.dispose()
    })

    it(`classifies committed durability failures on local and follower routes`, async () => {
      const leaderAdapter = createStubAdapter()
      const failure = Object.assign(new Error(`persistence failed`), {
        code: `SQLITE_FULL`,
        path: `/tmp/browser.sqlite`,
      })
      leaderAdapter.applyCommittedTx = vi.fn().mockRejectedValue(failure)
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator(createStubAdapter())

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      const response = await follower.requestApplyCommittedTx(`todos`, {
        txId: `source-tx-failure`,
        term: 0,
        seq: 0,
        rowVersion: 0,
        mutations: [],
      })

      expect(response).toEqual({
        type: `rpc:applyCommittedTx:res`,
        rpcId: expect.any(String),
        ok: false,
        code: `PERSISTENCE_ERROR`,
        error: expect.stringContaining(`persistence failed`),
        sourceCode: `SQLITE_FULL`,
        path: `/tmp/browser.sqlite`,
      })
      expect(leaderAdapter.applyCommittedTx).toHaveBeenCalledTimes(1)

      await expect(
        leader.requestApplyCommittedTx(`todos`, {
          txId: `source-tx-local-failure`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        }),
      ).rejects.toMatchObject({
        name: `PersistedCollectionDurabilityError`,
        code: `SQLITE_FULL`,
        path: `/tmp/browser.sqlite`,
        cause: failure,
      } satisfies Partial<PersistedCollectionDurabilityError>)
      expect(leaderAdapter.applyCommittedTx).toHaveBeenCalledTimes(2)

      leader.dispose()
      follower.dispose()
    })

    it(`does not retry application failures after entering the writer lock`, async () => {
      const applicationError = new Error(`persistence failed once`)
      const adapter = createStubAdapter()
      adapter.applyCommittedTx = vi.fn().mockRejectedValue(applicationError)
      const coordinator = createCoordinator(adapter)

      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)

      vi.useFakeTimers()
      try {
        let settled = false
        const outcomePromise = coordinator
          .requestApplyCommittedTx(`todos`, {
            txId: `source-tx-application-failure`,
            term: 0,
            seq: 0,
            rowVersion: 0,
            mutations: [],
          })
          .then(
            (response) => {
              settled = true
              return { response }
            },
            (error: unknown) => {
              settled = true
              return { error }
            },
          )

        await vi.advanceTimersByTimeAsync(0)
        const firstTurn = {
          applicationCalls: vi.mocked(adapter.applyCommittedTx).mock.calls
            .length,
          settled,
        }

        coordinator.dispose()
        await vi.advanceTimersByTimeAsync(5_000)
        const outcome = await outcomePromise

        expect(firstTurn).toEqual({ applicationCalls: 1, settled: true })
        expect(adapter.applyCommittedTx).toHaveBeenCalledTimes(1)
        expect(outcome).toEqual({
          error: expect.objectContaining({
            name: `PersistedCollectionDurabilityError`,
            cause: applicationError,
          }),
        })
      } finally {
        coordinator.dispose()
        vi.useRealTimers()
      }
    })

    it(`replays the successful response when only that response is lost`, async () => {
      const leaderAdapter = createStubAdapter()
      const followerAdapter = createStubAdapter()
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator(followerAdapter)

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      vi.useFakeTimers()
      try {
        let droppedResponse: unknown
        dropNextBroadcastMessage = (data) => {
          const payload = (data as { payload?: { type?: string } }).payload
          if (payload?.type !== `rpc:applyCommittedTx:res`) return false
          droppedResponse = structuredClone(payload)
          return true
        }

        const responsePromise = follower.requestApplyCommittedTx(`todos`, {
          txId: `source-tx-response-loss`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [
            {
              type: `insert`,
              key: `todo-response-loss`,
              value: { id: `todo-response-loss` },
            },
          ],
        })

        await vi.advanceTimersByTimeAsync(0)
        expect(droppedResponse).toMatchObject({
          type: `rpc:applyCommittedTx:res`,
          ok: true,
        })
        expect(leaderAdapter.appliedTxs).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(10_200)
        const response = await responsePromise

        expect(response).toEqual(droppedResponse)
        expect(leaderAdapter.appliedTxs).toHaveLength(1)
        expect(followerAdapter.appliedTxs).toEqual([])
      } finally {
        leader.dispose()
        follower.dispose()
        vi.useRealTimers()
      }
    })

    it(`coalesces the same envelope while its first application is in flight`, async () => {
      const leaderAdapter = createStubAdapter()
      const followerAdapter = createStubAdapter()
      const originalApply = leaderAdapter.applyCommittedTx
      let releaseApplication = (): void => {}
      const applicationGate = new Promise<void>((resolve) => {
        releaseApplication = resolve
      })
      leaderAdapter.applyCommittedTx = vi.fn(async (collectionId, tx) => {
        await applicationGate
        return originalApply(collectionId, tx)
      })
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator(followerAdapter)
      const observedResponses: Array<{
        rpcId: string
        term: number
        seq: number
        latestRowVersion: number
      }> = []

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      try {
        duplicateNextBroadcastMessage = (data) => {
          const envelope = data as {
            payload?: { type?: string; rpcId?: string }
          }
          if (envelope.payload?.type !== `rpc:applyCommittedTx:req`) {
            return undefined
          }
          const duplicate = structuredClone(data) as {
            payload: { rpcId: string }
          }
          duplicate.payload.rpcId = `coalesced-rpc`
          return duplicate
        }
        observeBroadcastMessage = (data) => {
          const payload = (
            data as {
              payload?: {
                type?: string
                rpcId?: string
                ok?: boolean
                term?: number
                seq?: number
                latestRowVersion?: number
              }
            }
          ).payload
          if (
            payload?.type === `rpc:applyCommittedTx:res` &&
            payload.ok === true
          ) {
            observedResponses.push({
              rpcId: payload.rpcId!,
              term: payload.term!,
              seq: payload.seq!,
              latestRowVersion: payload.latestRowVersion!,
            })
          }
        }

        const responsePromise = follower.requestApplyCommittedTx(`todos`, {
          txId: `source-tx-in-flight-envelope`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [
            {
              type: `insert`,
              key: `todo-in-flight-envelope`,
              value: { id: `todo-in-flight-envelope` },
            },
          ],
        })
        await flush()
        const callsBeforeRelease = vi.mocked(leaderAdapter.applyCommittedTx)
          .mock.calls.length

        releaseApplication()
        const response = await responsePromise
        await flush()

        const responsesByRpcId = Object.fromEntries(
          observedResponses.map(({ rpcId, ...position }) => [rpcId, position]),
        )
        const expectedPosition = {
          term: 1,
          seq: 1,
          latestRowVersion: 1,
        }
        expect({
          callsBeforeRelease,
          appliedTxs: leaderAdapter.appliedTxs.length,
          responsesByRpcId,
        }).toEqual({
          callsBeforeRelease: 1,
          appliedTxs: 1,
          responsesByRpcId: {
            [response.rpcId]: expectedPosition,
            'coalesced-rpc': expectedPosition,
          },
        })
        expect(followerAdapter.appliedTxs).toEqual([])
      } finally {
        releaseApplication()
        observeBroadcastMessage = undefined
        duplicateNextBroadcastMessage = undefined
        leader.dispose()
        follower.dispose()
      }
    })

    it(`allows the same envelope to retry after its application fails`, async () => {
      const applicationError = new Error(`first application failed`)
      const leaderAdapter = createStubAdapter()
      const originalApply = leaderAdapter.applyCommittedTx
      leaderAdapter.applyCommittedTx = vi
        .fn()
        .mockRejectedValueOnce(applicationError)
        .mockImplementation((collectionId, tx) =>
          originalApply(collectionId, tx),
        )
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator()
      let requestEnvelope: unknown
      const observedResponses: Array<{ ok?: boolean; error?: string }> = []

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      try {
        observeBroadcastMessage = (data) => {
          const payload = (
            data as {
              payload?: { type?: string; ok?: boolean; error?: string }
            }
          ).payload
          if (
            payload?.type === `rpc:applyCommittedTx:req` &&
            requestEnvelope === undefined
          ) {
            requestEnvelope = structuredClone(data)
          }
          if (payload?.type === `rpc:applyCommittedTx:res`) {
            observedResponses.push({
              ok: payload.ok,
              ...(payload.error === undefined ? {} : { error: payload.error }),
            })
          }
        }

        const firstResponse = await follower.requestApplyCommittedTx(`todos`, {
          txId: `source-tx-retry-after-failure`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        })
        expect(firstResponse).toMatchObject({
          ok: false,
          code: `PERSISTENCE_ERROR`,
          error: expect.stringContaining(applicationError.message),
        })
        expect(leaderAdapter.applyCommittedTx).toHaveBeenCalledTimes(1)
        expect(requestEnvelope).toBeDefined()

        injectBroadcastMessage(`tsdb:coord:test-db`, requestEnvelope)
        await flush()

        expect(leaderAdapter.applyCommittedTx).toHaveBeenCalledTimes(2)
        expect(leaderAdapter.appliedTxs).toHaveLength(1)
        expect(observedResponses).toEqual([
          {
            ok: false,
            error: expect.stringContaining(applicationError.message),
          },
          { ok: true },
        ])
      } finally {
        observeBroadcastMessage = undefined
        leader.dispose()
        follower.dispose()
      }
    })

    it(`rejects a different mutation operation that reuses an in-flight envelope`, async () => {
      const leaderAdapter = createStubAdapter()
      const originalApply = leaderAdapter.applyCommittedTx
      let releaseApplication = (): void => {}
      const applicationGate = new Promise<void>((resolve) => {
        releaseApplication = resolve
      })
      leaderAdapter.applyCommittedTx = vi.fn(async (collectionId, tx) => {
        await applicationGate
        return originalApply(collectionId, tx)
      })
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator()
      let crossOperationResponse: unknown

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      try {
        duplicateNextBroadcastMessage = (data) => {
          const envelope = data as {
            payload?: { type?: string; envelopeId?: string }
          }
          if (envelope.payload?.type !== `rpc:applyCommittedTx:req`) {
            return undefined
          }
          const duplicate = structuredClone(data) as {
            payload: Record<string, unknown>
          }
          duplicate.payload = {
            type: `rpc:applyLocalMutations:req`,
            rpcId: `cross-operation-rpc`,
            envelopeId: envelope.payload.envelopeId,
            mutations: [],
          }
          return duplicate
        }
        observeBroadcastMessage = (data) => {
          const payload = (data as { payload?: { rpcId?: string } }).payload
          if (payload?.rpcId === `cross-operation-rpc`) {
            crossOperationResponse = structuredClone(payload)
          }
        }

        const responsePromise = follower.requestApplyCommittedTx(`todos`, {
          txId: `source-tx-cross-operation-envelope`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        })
        await flush()

        expect(crossOperationResponse).toMatchObject({
          type: `rpc:applyLocalMutations:res`,
          rpcId: `cross-operation-rpc`,
          ok: false,
          code: `CONFLICT`,
          error: expect.stringContaining(`is already in flight`),
        })
        expect(leaderAdapter.applyCommittedTx).toHaveBeenCalledTimes(1)

        releaseApplication()
        const response = await responsePromise
        expect(response).toMatchObject({ ok: true, seq: 1 })
        expect(leaderAdapter.appliedTxs).toHaveLength(1)
      } finally {
        releaseApplication()
        observeBroadcastMessage = undefined
        duplicateNextBroadcastMessage = undefined
        leader.dispose()
        follower.dispose()
      }
    })

    it(`fails indeterminate when a committed success is lost across leader change`, async () => {
      const retiredLeaderAdapter = createStubAdapter()
      const requesterAdapter = createStubAdapter()
      const retiredLeader = createCoordinator(retiredLeaderAdapter)
      const requester = createCoordinator(requesterAdapter)

      retiredLeader.subscribe(`todos`, () => {})
      requester.subscribe(`todos`, () => {})
      await flush(50)
      expect(retiredLeader.isLeader(`todos`)).toBe(true)
      expect(requester.isLeader(`todos`)).toBe(false)

      vi.useFakeTimers()
      try {
        let publications = 0
        observeBroadcastMessage = (data) => {
          if (
            (data as { payload?: { type?: string } }).payload?.type ===
            `tx:committed`
          ) {
            publications++
          }
        }
        let droppedResponse: unknown
        dropNextBroadcastMessage = (data) => {
          const payload = (data as { payload?: { type?: string } }).payload
          if (payload?.type !== `rpc:applyCommittedTx:res`) return false
          droppedResponse = structuredClone(payload)
          return true
        }

        const outcomePromise = requester
          .requestApplyCommittedTx(`todos`, {
            txId: `source-tx-requester-takeover`,
            term: 0,
            seq: 0,
            rowVersion: 0,
            mutations: [
              {
                type: `insert`,
                key: `todo-requester-takeover`,
                value: { id: `todo-requester-takeover` },
              },
            ],
          })
          .then(
            (response) => ({ response }),
            (error: unknown) => ({ error }),
          )

        await vi.advanceTimersByTimeAsync(0)
        expect(droppedResponse).toMatchObject({ ok: true })
        expect(retiredLeaderAdapter.appliedTxs).toHaveLength(1)

        retiredLeader.dispose()
        await vi.advanceTimersByTimeAsync(0)
        expect(requester.isLeader(`todos`)).toBe(true)

        await vi.advanceTimersByTimeAsync(31_000)
        const outcome = await outcomePromise

        expect(outcome).toEqual({
          error: expect.objectContaining({
            name: `IndeterminateCommitError`,
            code: `INDETERMINATE_COMMIT`,
            collectionId: `todos`,
            requestType: `rpc:applyCommittedTx:req`,
            previousLeaderId: (retiredLeader as unknown as { nodeId: string })
              .nodeId,
            previousTerm: 1,
            currentLeaderId: (requester as unknown as { nodeId: string })
              .nodeId,
            currentTerm: 1,
            cause: expect.objectContaining({
              message: expect.stringContaining(`timed out`),
            }),
          } satisfies Partial<IndeterminateCommitError>),
        })
        expect(retiredLeaderAdapter.appliedTxs).toHaveLength(1)
        expect(requesterAdapter.appliedTxs).toEqual([])
        expect(publications).toBe(1)
      } finally {
        observeBroadcastMessage = undefined
        retiredLeader.dispose()
        requester.dispose()
        vi.useRealTimers()
      }
    })

    it(`fails indeterminate instead of retrying a committed transaction without an initial leader route`, async () => {
      const coordinator = createCoordinator()
      const transportError = new Error(`unknown leader response was lost`)
      const attemptedTransactions: Array<PersistedTx> = []
      const failedTransport = vi.fn(
        (_collectionId: string, request: ApplyCommittedTxRequest) => {
          attemptedTransactions.push(structuredClone(request.tx))
          if (attemptedTransactions.length === 1) {
            return Promise.reject(transportError)
          }
          return Promise.resolve({
            type: `rpc:applyCommittedTx:res` as const,
            rpcId: request.rpcId,
            ok: true as const,
            term: 1,
            seq: 1,
            latestRowVersion: 1,
          })
        },
      )
      Object.defineProperty(coordinator, `sendRPCOnce`, {
        value: failedTransport,
        configurable: true,
      })

      try {
        const outcome = await coordinator
          .requestApplyCommittedTx(`todos`, {
            txId: `browser-unknown-leader-committed`,
            term: 0,
            seq: 0,
            rowVersion: 0,
            mutations: [
              {
                type: `insert`,
                key: `browser-unknown-leader-committed`,
                value: { id: `browser-unknown-leader-committed` },
              },
            ],
          })
          .then(
            (response) => ({ response }),
            (error: unknown) => ({ error }),
          )

        expect(outcome).toEqual({
          error: expect.objectContaining({
            name: `IndeterminateCommitError`,
            code: `INDETERMINATE_COMMIT`,
            collectionId: `todos`,
            requestType: `rpc:applyCommittedTx:req`,
            previousLeaderId: null,
            previousTerm: null,
            currentLeaderId: null,
            currentTerm: null,
            cause: transportError,
          } satisfies Partial<IndeterminateCommitError>),
        })
        expect(failedTransport).toHaveBeenCalledTimes(1)
        expect(attemptedTransactions).toEqual([
          {
            txId: `browser-unknown-leader-committed`,
            term: 0,
            seq: 0,
            rowVersion: 0,
            mutations: [
              {
                type: `insert`,
                key: `browser-unknown-leader-committed`,
                value: { id: `browser-unknown-leader-committed` },
              },
            ],
          },
        ])
      } finally {
        coordinator.dispose()
      }
    })

    it(`does not retain completed or in-flight committed transactions after disposal`, async () => {
      const adapter = createStubAdapter()
      const originalApply = adapter.applyCommittedTx
      let heldApplyEntered = false
      let releaseHeldApply = (): void => {}
      const heldApplyGate = new Promise<void>((resolve) => {
        releaseHeldApply = resolve
      })
      adapter.applyCommittedTx = vi.fn(async (collectionId, tx) => {
        if (tx.txId === `held-during-disposal`) {
          heldApplyEntered = true
          await heldApplyGate
        }
        await originalApply(collectionId, tx)
      })
      const coordinator = createCoordinator(adapter)
      const internals = coordinator as unknown as {
        handleApplyCommittedTx: (
          collectionId: string,
          request: ApplyCommittedTxRequest,
        ) => Promise<{
          ok: boolean
          code?: string
        }>
        appliedEnvelopes: Map<string, unknown>
        inFlightEnvelopes: Map<string, unknown>
      }
      const completedRequest: ApplyCommittedTxRequest = {
        type: `rpc:applyCommittedTx:req`,
        rpcId: `completed-rpc`,
        envelopeId: `completed-envelope`,
        tx: {
          txId: `completed-before-disposal`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        },
      }
      const heldRequest: ApplyCommittedTxRequest = {
        type: `rpc:applyCommittedTx:req`,
        rpcId: `held-rpc`,
        envelopeId: `held-envelope`,
        tx: {
          txId: `held-during-disposal`,
          term: 0,
          seq: 0,
          rowVersion: 0,
          mutations: [],
        },
      }

      coordinator.subscribe(`todos`, () => {})
      await flush(50)

      try {
        expect(
          await internals.handleApplyCommittedTx(`todos`, completedRequest),
        ).toMatchObject({ ok: true })
        const heldResponse = internals.handleApplyCommittedTx(
          `todos`,
          heldRequest,
        )
        await vi.waitFor(() => expect(heldApplyEntered).toBe(true))
        expect({
          completed: internals.appliedEnvelopes.size,
          inFlight: internals.inFlightEnvelopes.size,
        }).toEqual({ completed: 1, inFlight: 1 })

        coordinator.dispose()
        expect({
          completed: internals.appliedEnvelopes.size,
          inFlight: internals.inFlightEnvelopes.size,
        }).toEqual({ completed: 0, inFlight: 0 })

        releaseHeldApply()
        await expect(heldResponse).resolves.toMatchObject({ ok: true })
        expect({
          completed: internals.appliedEnvelopes.size,
          inFlight: internals.inFlightEnvelopes.size,
        }).toEqual({ completed: 0, inFlight: 0 })
        await expect(
          internals.handleApplyCommittedTx(`todos`, completedRequest),
        ).resolves.toMatchObject({ ok: false, code: `NOT_LEADER` })
      } finally {
        releaseHeldApply()
        coordinator.dispose()
      }
    })

    it(`does not answer a held follower request after its leader is disposed`, async () => {
      const leaderAdapter = createStubAdapter()
      const originalApply = leaderAdapter.applyCommittedTx
      let applyEntered = false
      let releaseApply = (): void => {}
      const applyGate = new Promise<void>((resolve) => {
        releaseApply = resolve
      })
      leaderAdapter.applyCommittedTx = vi.fn(async (collectionId, tx) => {
        applyEntered = true
        await applyGate
        await originalApply(collectionId, tx)
      })
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator(createStubAdapter())
      const leaderInternals = leader as unknown as {
        appliedEnvelopes: Map<string, unknown>
        inFlightEnvelopes: Map<string, unknown>
      }
      const followerInternals = follower as unknown as {
        sendRPCOnce: (
          collectionId: string,
          request: ApplyCommittedTxRequest,
        ) => Promise<unknown>
      }
      let responsePosts = 0

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      try {
        observeBroadcastMessage = (data) => {
          const payload = (data as { payload?: { type?: string } }).payload
          if (payload?.type === `rpc:applyCommittedTx:res`) {
            responsePosts++
          }
        }
        const outcomePromise = followerInternals
          .sendRPCOnce(`todos`, {
            type: `rpc:applyCommittedTx:req`,
            rpcId: `held-follower-rpc`,
            envelopeId: `held-follower-envelope`,
            tx: {
              txId: `held-follower-tx`,
              term: 0,
              seq: 0,
              rowVersion: 0,
              mutations: [],
            },
          })
          .then(
            (response) => ({ response }),
            (error: unknown) => ({ error }),
          )

        await vi.waitFor(() => expect(applyEntered).toBe(true))
        leader.dispose()
        releaseApply()
        await vi.waitFor(() => expect(leaderAdapter.appliedTxs).toHaveLength(1))
        await flush()

        expect({
          responsePosts,
          completed: leaderInternals.appliedEnvelopes.size,
          inFlight: leaderInternals.inFlightEnvelopes.size,
        }).toEqual({ responsePosts: 0, completed: 0, inFlight: 0 })

        follower.dispose()
        const outcome = await outcomePromise
        expect(outcome).toEqual({ error: new Error(`coordinator disposed`) })
      } finally {
        observeBroadcastMessage = undefined
        releaseApply()
        leader.dispose()
        follower.dispose()
      }
    })
  })

  describe(`RPC - ensureRemoteSubset`, () => {
    it(`rejects a second live remote subset owner instead of replacing the first`, () => {
      const coordinator = createCoordinator()
      const first = Object.assign(
        vi.fn((_options: TransportedLoadSubsetOptions) => Promise.resolve()),
        {
          loadSubset: vi.fn((_options: TransportedLoadSubsetOptions) =>
            Promise.resolve(),
          ),
          unloadSubset: vi.fn((_options: TransportedLoadSubsetOptions) => {}),
          onError: vi.fn(),
        },
      )
      const second = Object.assign(
        vi.fn((_options: TransportedLoadSubsetOptions) => Promise.resolve()),
        {
          loadSubset: vi.fn((_options: TransportedLoadSubsetOptions) =>
            Promise.resolve(),
          ),
          unloadSubset: vi.fn((_options: TransportedLoadSubsetOptions) => {}),
          onError: vi.fn(),
        },
      )
      const unregisterFirst = coordinator.registerRemoteSubsetOwner(
        `todos`,
        first,
      )

      try {
        expect(() =>
          coordinator.registerRemoteSubsetOwner(`todos`, second),
        ).toThrowError(
          expect.objectContaining({
            name: `DuplicateRemoteSubsetOwnerError`,
            collectionId: `todos`,
          }),
        )
      } finally {
        unregisterFirst()
        coordinator.dispose()
      }
    })

    it(`rejects an unsupported nested membership value before local owner work`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)

      const owner = withUnusedUnloadSubset(vi.fn(() => Promise.resolve()))
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )

      try {
        await expect(
          coordinator.requestEnsureRemoteSubset(
            `todos`,
            subsetWithNestedValue(() => {}),
          ),
        ).rejects.toMatchObject({
          name: `RemoteSubsetWireValueError`,
          path: `options.where.args[1].value[1]`,
          message: `Unsupported remote subset wire value at options.where.args[1].value[1]: function`,
        })
        expect(owner).not.toHaveBeenCalled()
      } finally {
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`rejects a sparse function argument at its exact Browser wire path`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      const owner = withUnusedUnloadSubset(vi.fn())
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      const args = [new IR.PropRef([`todos`, `status`])]
      args.length = 2

      try {
        await expect(
          coordinator.requestEnsureRemoteSubset(`todos`, {
            where: new IR.Func(`eq`, args),
          }),
        ).rejects.toMatchObject({
          name: `RemoteSubsetWireValueError`,
          path: `options.where.args[1]`,
        })
        expect(owner).not.toHaveBeenCalled()
      } finally {
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`holds same-stack Browser subset reentry behind the original owner load`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      const options: LoadSubsetOptions = { limit: 1 }
      let releaseLoad = (): void => {}
      const loadGate = new Promise<void>((resolve) => {
        releaseLoad = resolve
      })
      let duplicate: Promise<void> | undefined
      let didReenter = false
      const owner = Object.assign(
        vi.fn(() => {
          if (!didReenter) {
            didReenter = true
            duplicate = coordinator.requestEnsureRemoteSubset(`todos`, options)
          }
          return loadGate
        }),
        { unloadSubset: vi.fn(), onError: vi.fn() },
      )
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )

      try {
        let firstSettled = false
        let duplicateSettled = false
        const first = coordinator
          .requestEnsureRemoteSubset(`todos`, options)
          .then(() => {
            firstSettled = true
          })
        await vi.waitFor(() => expect(duplicate).toBeDefined())
        const duplicateResult = duplicate!.then(() => {
          duplicateSettled = true
        })
        await flush(0)

        expect({
          ownerCalls: owner.mock.calls.length,
          firstSettled,
          duplicateSettled,
        }).toEqual({
          ownerCalls: 1,
          firstSettled: false,
          duplicateSettled: false,
        })

        releaseLoad()
        await Promise.all([first, duplicateResult])
      } finally {
        releaseLoad()
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`compacts a terminal same-stack Browser release after the real owner load finishes`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      const options: LoadSubsetOptions = { limit: 1 }
      let releaseLoad = (): void => {}
      const loadGate = new Promise<void>((resolve) => {
        releaseLoad = resolve
      })
      let release: Promise<void> | undefined
      const events: Array<string> = []
      const owner = Object.assign(
        vi.fn(() => {
          events.push(`load`)
          release = coordinator.requestReleaseRemoteSubset(`todos`, options)
          return loadGate
        }),
        {
          unloadSubset: vi.fn(() => {
            events.push(`unload`)
          }),
          onError: vi.fn(),
        },
      )
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      const internals = coordinator as unknown as {
        outboundRemoteSubsetAcquisitions: Map<string, unknown>
        inboundRemoteSubsetAcquisitions: Map<string, Record<string, unknown>>
      }

      try {
        let releaseSettled = false
        const load = coordinator.requestEnsureRemoteSubset(`todos`, options)
        await vi.waitFor(() => expect(release).toBeDefined())
        const terminalRelease = release!.then(() => {
          releaseSettled = true
        })
        await flush(0)
        expect({ events: [...events], releaseSettled }).toEqual({
          events: [`load`],
          releaseSettled: false,
        })

        releaseLoad()
        await Promise.all([load, terminalRelease])
        const [terminal] = internals.inboundRemoteSubsetAcquisitions.values()
        expect({
          events,
          outbound: internals.outboundRemoteSubsetAcquisitions.size,
          inbound: internals.inboundRemoteSubsetAcquisitions.size,
          terminalKeys: Object.keys(terminal ?? {}).sort(),
        }).toEqual({
          events: [`load`, `unload`],
          outbound: 0,
          inbound: 1,
          terminalKeys: [
            `acquisitionId`,
            `collectionId`,
            `released`,
            `requesterId`,
          ],
        })
      } finally {
        releaseLoad()
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`releases a transferred Browser lease whose initial load rejected`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)
      const loadError = new Error(`browser transferred load failed`)
      const ownerErrors: Array<unknown> = []
      const owner = Object.assign(
        vi.fn((_options: TransportedLoadSubsetOptions) =>
          Promise.reject(loadError),
        ),
        {
          unloadSubset: vi.fn(
            (_options: TransportedLoadSubsetOptions) => undefined,
          ),
          onError: (error: unknown) => ownerErrors.push(error),
        },
      )
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      const options: LoadSubsetOptions = { offset: 20 }
      const unhandled: Array<unknown> = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, onUnhandled)
      const internals = coordinator as unknown as {
        inboundRemoteSubsetAcquisitions: Map<string, Record<string, unknown>>
      }

      try {
        const ensureError = await coordinator
          .requestEnsureRemoteSubset(`todos`, options)
          .then(
            () => undefined,
            (error: unknown) => error,
          )
        await coordinator.requestReleaseRemoteSubset(`todos`, options)
        await flush(0)
        const [terminal] = internals.inboundRemoteSubsetAcquisitions.values()

        expect(ensureError).toBe(loadError)
        expect(owner).toHaveBeenCalledTimes(1)
        expect(owner.unloadSubset).toHaveBeenCalledTimes(1)
        expect(owner.unloadSubset.mock.calls[0]?.[0]).toBe(
          owner.mock.calls[0]?.[0],
        )
        expect(ownerErrors).toEqual([loadError])
        expect(unhandled).toEqual([])
        expect({
          inbound: internals.inboundRemoteSubsetAcquisitions.size,
          terminalKeys: Object.keys(terminal ?? {}).sort(),
        }).toEqual({
          inbound: 1,
          terminalKeys: [
            `acquisitionId`,
            `collectionId`,
            `released`,
            `requesterId`,
          ],
        })
      } finally {
        process.off(`unhandledRejection`, onUnhandled)
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`keeps a Browser release tombstone when a transferred load rejects concurrently`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)
      const loadError = new Error(`browser concurrent transferred load failed`)
      let rejectLoad = (_error: unknown): void => {}
      const loadGate = new Promise<void>((_resolve, reject) => {
        rejectLoad = reject
      })
      const ownerErrors: Array<unknown> = []
      const owner = Object.assign(
        vi.fn((_options: TransportedLoadSubsetOptions) => loadGate),
        {
          unloadSubset: vi.fn(
            (_options: TransportedLoadSubsetOptions) => undefined,
          ),
          onError: (error: unknown) => ownerErrors.push(error),
        },
      )
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      const options: LoadSubsetOptions = { offset: 21 }
      const unhandled: Array<unknown> = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, onUnhandled)
      const internals = coordinator as unknown as {
        nodeId: string
        outboundRemoteSubsetAcquisitions: Map<string, { acquisitionId: string }>
        inboundRemoteSubsetAcquisitions: Map<string, Record<string, unknown>>
        handleEnsureRemoteSubset: (
          collectionId: string,
          request: {
            type: `rpc:ensureRemoteSubset:req`
            rpcId: string
            acquisitionId: string
            options: TransportedLoadSubsetOptions
          },
          requesterId: string,
        ) => Promise<{ ok: boolean }>
      }

      try {
        const ensure = coordinator
          .requestEnsureRemoteSubset(`todos`, options)
          .then(
            () => ({ status: `fulfilled` as const }),
            (error: unknown) => ({ status: `rejected` as const, error }),
          )
        await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(1))
        const [outbound] = internals.outboundRemoteSubsetAcquisitions.values()
        const release = coordinator
          .requestReleaseRemoteSubset(`todos`, options)
          .then(
            () => ({ status: `fulfilled` as const }),
            (error: unknown) => ({ status: `rejected` as const, error }),
          )
        rejectLoad(loadError)
        const outcomes = await Promise.all([ensure, release])
        const duplicate = await internals
          .handleEnsureRemoteSubset(
            `todos`,
            {
              type: `rpc:ensureRemoteSubset:req`,
              rpcId: `delayed-browser-duplicate`,
              acquisitionId: outbound!.acquisitionId,
              options: owner.mock.calls[0]![0],
            },
            internals.nodeId,
          )
          .then(
            (response) => ({ status: `fulfilled` as const, response }),
            (error: unknown) => ({ status: `rejected` as const, error }),
          )
        await flush(0)
        const [terminal] = internals.inboundRemoteSubsetAcquisitions.values()

        expect(outcomes).toEqual([
          { status: `rejected`, error: loadError },
          { status: `fulfilled` },
        ])
        expect(duplicate).toEqual({
          status: `fulfilled`,
          response: expect.objectContaining({ ok: true }),
        })
        expect(owner).toHaveBeenCalledTimes(1)
        expect(owner.unloadSubset).toHaveBeenCalledTimes(1)
        expect(ownerErrors).toEqual([loadError])
        expect(unhandled).toEqual([])
        expect({
          inbound: internals.inboundRemoteSubsetAcquisitions.size,
          terminalKeys: Object.keys(terminal ?? {}).sort(),
        }).toEqual({
          inbound: 1,
          terminalKeys: [
            `acquisitionId`,
            `collectionId`,
            `released`,
            `requesterId`,
          ],
        })
      } finally {
        rejectLoad(loadError)
        process.off(`unhandledRejection`, onUnhandled)
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`rejects unsupported nested values before follower transport or owner work`, async () => {
      const leader = createCoordinator()
      const follower = createCoordinator()
      const owner = withUnusedUnloadSubset(vi.fn(() => Promise.resolve()))
      const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
      let subsetPosts = 0

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)
      expect(leader.isLeader(`todos`)).toBe(true)
      expect(follower.isLeader(`todos`)).toBe(false)
      observeBroadcastMessage = (data) => {
        const payload = (data as { payload?: { type?: string } }).payload
        if (payload?.type === `rpc:ensureRemoteSubset:req`) subsetPosts++
      }

      try {
        await expect(
          follower.requestEnsureRemoteSubset(
            `todos`,
            subsetWithNestedValue(() => {}),
          ),
        ).rejects.toMatchObject({
          name: `RemoteSubsetWireValueError`,
          path: `options.where.args[1].value[1]`,
          message: `Unsupported remote subset wire value at options.where.args[1].value[1]: function`,
        })
        expect({ subsetPosts, ownerCalls: owner.mock.calls.length }).toEqual({
          subsetPosts: 0,
          ownerCalls: 0,
        })
      } finally {
        observeBroadcastMessage = undefined
        unregisterOwner()
        leader.dispose()
        follower.dispose()
      }
    })

    it.each(unsupportedSubsetValueCases)(
      `rejects a nested %s through both local and follower admission`,
      async (_label, createUnsupported, path) => {
        const leader = createCoordinator()
        const follower = createCoordinator()
        const owner = withUnusedUnloadSubset(vi.fn(() => Promise.resolve()))
        const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
        let subsetPosts = 0

        leader.subscribe(`todos`, () => {})
        follower.subscribe(`todos`, () => {})
        await flush(50)
        observeBroadcastMessage = (data) => {
          const payload = (data as { payload?: { type?: string } }).payload
          if (payload?.type === `rpc:ensureRemoteSubset:req`) subsetPosts++
        }

        try {
          const outcomes = await Promise.all(
            [leader, follower].map((coordinator) =>
              coordinator
                .requestEnsureRemoteSubset(
                  `todos`,
                  subsetWithNestedValue(createUnsupported()),
                )
                .then(
                  () => ({ ok: true as const }),
                  (error: unknown) => ({ ok: false as const, error }),
                ),
            ),
          )
          for (const outcome of outcomes) {
            expect(outcome).toMatchObject({
              ok: false,
              error: { name: `RemoteSubsetWireValueError`, path },
            })
          }
          expect({
            subsetPosts,
            ownerCalls: owner.mock.calls.length,
          }).toEqual({ subsetPosts: 0, ownerCalls: 0 })
        } finally {
          observeBroadcastMessage = undefined
          unregisterOwner()
          leader.dispose()
          follower.dispose()
        }
      },
    )

    it.each([
      [
        `where expression`,
        {
          where: new IR.Value({ nested: () => {} }),
        },
        `options.where.value.nested`,
      ],
      [
        `non-identifier object key`,
        {
          where: new IR.Value({ [`dotted.key`]: () => {} }),
        },
        `options.where.value["dotted.key"]`,
      ],
      [
        `property-reference path`,
        {
          where: new IR.PropRef([`todos`, (() => {}) as unknown as string]),
        },
        `options.where.path[1]`,
      ],
      [
        `order expression`,
        {
          orderBy: [
            {
              expression: new IR.Value({ nested: () => {} }),
              compareOptions: { direction: `asc`, nulls: `last` },
            },
          ],
        },
        `options.orderBy[0].expression.value.nested`,
      ],
      [
        `comparison options`,
        {
          orderBy: [
            {
              expression: new IR.PropRef([`todos`, `title`]),
              compareOptions: {
                direction: `asc`,
                nulls: `last`,
                stringSort: `locale`,
                localeOptions: { matcher: () => {} },
              },
            },
          ],
        },
        `options.orderBy[0].compareOptions.localeOptions.matcher`,
      ],
      [
        `cursor from expression`,
        {
          cursor: {
            whereFrom: new IR.Value({ nested: () => {} }),
            whereCurrent: new IR.Value(`current`),
          },
        },
        `options.cursor.whereFrom.value.nested`,
      ],
      [
        `cursor current expression`,
        {
          cursor: {
            whereFrom: new IR.Value(`from`),
            whereCurrent: new IR.Value({ nested: () => {} }),
          },
        },
        `options.cursor.whereCurrent.value.nested`,
      ],
      [
        `cursor key`,
        {
          cursor: {
            whereFrom: new IR.Value(`from`),
            whereCurrent: new IR.Value(`current`),
            lastKey: () => {},
          },
        },
        `options.cursor.lastKey`,
      ],
      [`limit`, { limit: () => {} }, `options.limit`],
      [`offset`, { offset: () => {} }, `options.offset`],
    ] as const)(
      `reports the exact path for an unsupported %s value`,
      async (_label, options, path) => {
        const leader = createCoordinator()
        const follower = createCoordinator()
        leader.subscribe(`todos`, () => {})
        follower.subscribe(`todos`, () => {})
        await flush(50)
        const owner = withUnusedUnloadSubset(vi.fn(() => Promise.resolve()))
        const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
        let subsetPosts = 0
        observeBroadcastMessage = (data) => {
          const payload = (data as { payload?: { type?: string } }).payload
          if (payload?.type === `rpc:ensureRemoteSubset:req`) subsetPosts++
        }

        try {
          const outcomes = await Promise.all(
            [leader, follower].map((coordinator) =>
              coordinator
                .requestEnsureRemoteSubset(
                  `todos`,
                  options as unknown as LoadSubsetOptions,
                )
                .then(
                  () => ({ ok: true as const }),
                  (error: unknown) => ({ ok: false as const, error }),
                ),
            ),
          )
          for (const outcome of outcomes) {
            expect(outcome).toMatchObject({
              ok: false,
              error: { name: `RemoteSubsetWireValueError`, path },
            })
          }
          expect({
            subsetPosts,
            ownerCalls: owner.mock.calls.length,
          }).toEqual({ subsetPosts: 0, ownerCalls: 0 })
        } finally {
          observeBroadcastMessage = undefined
          unregisterOwner()
          leader.dispose()
          follower.dispose()
        }
      },
    )

    it.each([
      [
        `wire record reused as an expression`,
        () => {
          const shared = { bad: 1 }
          return {
            where: new IR.Func(`and`, [
              new IR.Value(shared),
              shared as unknown as IR.BasicExpression,
            ]),
          }
        },
        `options.where.args[1].type`,
      ],
      [
        `wire array reused as a property-reference path`,
        () => {
          const shared = [`todos`, 1]
          return {
            where: new IR.Func(`and`, [
              new IR.Value(shared),
              new IR.PropRef(shared as unknown as Array<string>),
            ]),
          }
        },
        `options.where.args[1].path[1]`,
      ],
      [
        `wire array reused as an expression array`,
        () => {
          const shared = [1]
          return {
            where: new IR.Func(`and`, [
              new IR.Value(shared),
              new IR.Func(
                `nested`,
                shared as unknown as Array<IR.BasicExpression>,
              ),
            ]),
          }
        },
        `options.where.args[1].args[0]`,
      ],
      [
        `wire record reused as comparison options`,
        () => {
          const shared = { bad: 1 }
          return {
            where: new IR.Value(shared),
            orderBy: [
              {
                expression: new IR.PropRef([`todos`, `title`]),
                compareOptions: shared,
              },
            ],
          }
        },
        `options.orderBy[0].compareOptions.bad`,
      ],
    ] as const)(
      `does not reuse a projected %s across incompatible schema roles`,
      async (_label, createOptions, path) => {
        const leader = createCoordinator()
        const follower = createCoordinator()
        const owner = withUnusedUnloadSubset(vi.fn(() => Promise.resolve()))
        const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
        let subsetPosts = 0

        leader.subscribe(`todos`, () => {})
        follower.subscribe(`todos`, () => {})
        await flush(50)
        observeBroadcastMessage = (data) => {
          const payload = (data as { payload?: { type?: string } }).payload
          if (payload?.type === `rpc:ensureRemoteSubset:req`) subsetPosts++
        }

        try {
          const outcomes = await Promise.all(
            [leader, follower].map((coordinator) =>
              coordinator
                .requestEnsureRemoteSubset(
                  `todos`,
                  createOptions() as unknown as LoadSubsetOptions,
                )
                .then(
                  () => ({ ok: true as const }),
                  (error: unknown) => ({ ok: false as const, error }),
                ),
            ),
          )
          for (const outcome of outcomes) {
            expect(outcome).toMatchObject({
              ok: false,
              error: { name: `RemoteSubsetWireValueError`, path },
            })
          }
          expect({
            subsetPosts,
            ownerCalls: owner.mock.calls.length,
          }).toEqual({ subsetPosts: 0, ownerCalls: 0 })
        } finally {
          observeBroadcastMessage = undefined
          unregisterOwner()
          leader.dispose()
          follower.dispose()
        }
      },
    )

    it(`preserves supported native values, aliases, and cycles for both routes`, async () => {
      const leader = createCoordinator()
      const follower = createCoordinator()
      const received: Array<TransportedLoadSubsetOptions> = []
      const owner = withUnusedUnloadSubset(
        vi.fn((options: TransportedLoadSubsetOptions) => {
          received.push(options)
          return Promise.resolve()
        }),
      )
      const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      const shared = { label: `shared` }
      const cycle: Record<string, unknown> = { label: `cycle` }
      cycle.self = cycle
      const buffer = new ArrayBuffer(8)
      const view = new DataView(buffer, 2, 4)
      const typed = new Uint16Array(buffer, 0, 2)
      typed.set([17, 42])
      const typedArrays = [
        new Int8Array([-1, 2]),
        new Uint8Array([0, 255]),
        new Uint8ClampedArray([0, 255]),
        new Int16Array([-2, 3]),
        new Uint16Array([2, 65_535]),
        new Int32Array([-3, 4]),
        new Uint32Array([3, 4_000_000_000]),
        new Float32Array([-0, Number.NaN, Number.POSITIVE_INFINITY]),
        new Float64Array([Number.NEGATIVE_INFINITY, Math.PI]),
        new BigInt64Array([-4n, 5n]),
        new BigUint64Array([4n, 5n]),
      ]
      const sparse = new Array<unknown>(3)
      sparse[1] = undefined
      const reservedKeys = { constructor: `own constructor value` }
      Object.defineProperty(reservedKeys, `__proto__`, {
        value: { label: `own __proto__ value` },
        enumerable: true,
        writable: true,
        configurable: true,
      })
      const richValue = {
        undefinedValue: undefined,
        nullValue: null,
        booleanValue: true,
        stringValue: `wire`,
        bigintValue: 9_007_199_254_740_993n,
        nanValue: Number.NaN,
        positiveInfinity: Number.POSITIVE_INFINITY,
        negativeInfinity: Number.NEGATIVE_INFINITY,
        negativeZero: -0,
        date: new Date(`2026-09-16T12:34:56.000Z`),
        invalidDate: new Date(Number.NaN),
        regexp: /wire/giu,
        buffer,
        view,
        typed,
        typedArrays,
        map: new Map<unknown, unknown>([[shared, cycle]]),
        set: new Set<unknown>([shared, cycle]),
        sparse,
        reservedKeys,
        first: shared,
        second: shared,
        cycle,
      }
      const options = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`todos`, `payload`]),
          new IR.Value(richValue),
        ]),
        signal: new AbortController().signal,
        subscription: {
          on: () => () => {},
        } as unknown as Subscription,
      }

      try {
        await leader.requestEnsureRemoteSubset(`todos`, options)
        await follower.requestEnsureRemoteSubset(`todos`, options)
        expect(received).toHaveLength(2)

        for (const decoded of received) {
          const value = (
            decoded.where as unknown as {
              args: Array<{ value?: typeof richValue }>
            }
          ).args[1]!.value!
          expect(value.undefinedValue).toBeUndefined()
          expect(value.nullValue).toBeNull()
          expect(value.booleanValue).toBe(true)
          expect(value.stringValue).toBe(`wire`)
          expect(value.bigintValue).toBe(9_007_199_254_740_993n)
          expect(Object.is(value.nanValue, Number.NaN)).toBe(true)
          expect(
            Object.is(value.positiveInfinity, Number.POSITIVE_INFINITY),
          ).toBe(true)
          expect(
            Object.is(value.negativeInfinity, Number.NEGATIVE_INFINITY),
          ).toBe(true)
          expect(Object.is(value.negativeZero, -0)).toBe(true)
          expect(value.date.getTime()).toBe(richValue.date.getTime())
          expect(Number.isNaN(value.invalidDate.getTime())).toBe(true)
          expect({
            source: value.regexp.source,
            flags: value.regexp.flags,
            lastIndex: value.regexp.lastIndex,
          }).toEqual({ source: `wire`, flags: `giu`, lastIndex: 0 })
          expect(value.buffer).toBeInstanceOf(ArrayBuffer)
          expect(value.view).toBeInstanceOf(DataView)
          expect(value.typed).toBeInstanceOf(Uint16Array)
          expect(Array.from(new Uint8Array(value.buffer))).toEqual(
            Array.from(new Uint8Array(richValue.buffer)),
          )
          expect({
            byteOffset: value.view.byteOffset,
            byteLength: value.view.byteLength,
          }).toEqual({ byteOffset: 2, byteLength: 4 })
          expect(Array.from(value.typed)).toEqual([17, 42])
          expect(value.view.buffer).toBe(value.buffer)
          expect(value.typed.buffer).toBe(value.buffer)
          expect(value.typedArrays).toHaveLength(typedArrays.length)
          for (let index = 0; index < typedArrays.length; index++) {
            const actual = value.typedArrays[index]!
            const expected = typedArrays[index]!
            expect(actual.constructor).toBe(expected.constructor)
            expect(actual.byteOffset).toBe(expected.byteOffset)
            expect(actual.byteLength).toBe(expected.byteLength)
            expect(
              Array.from(
                new Uint8Array(
                  actual.buffer,
                  actual.byteOffset,
                  actual.byteLength,
                ),
              ),
            ).toEqual(
              Array.from(
                new Uint8Array(
                  expected.buffer,
                  expected.byteOffset,
                  expected.byteLength,
                ),
              ),
            )
          }
          expect(value.map).toBeInstanceOf(Map)
          expect(value.set).toBeInstanceOf(Set)
          expect(value.first).toBe(value.second)
          expect([...value.map.keys()]).toEqual([value.first])
          expect(value.map.get(value.first)).toBe(value.cycle)
          expect(value.set.has(value.first)).toBe(true)
          expect(value.set.has(value.cycle)).toBe(true)
          expect(value.cycle.self).toBe(value.cycle)
          expect(0 in value.sparse).toBe(false)
          expect(1 in value.sparse).toBe(true)
          expect(2 in value.sparse).toBe(false)
          expect(Object.getPrototypeOf(value.reservedKeys)).toBe(
            Object.prototype,
          )
          expect(
            Object.getOwnPropertyDescriptor(value.reservedKeys, `__proto__`),
          ).toMatchObject({
            value: { label: `own __proto__ value` },
            enumerable: true,
            writable: true,
            configurable: true,
          })
          expect(value.reservedKeys.constructor).toBe(`own constructor value`)
          expect(decoded).not.toHaveProperty(`signal`)
          expect(decoded).not.toHaveProperty(`subscription`)
        }
        // Local delivery need not clone identity, but it must receive the same
        // validated, live-field-free wire domain as follower delivery.
        expect(received[1]).not.toBe(options)
      } finally {
        unregisterOwner()
        leader.dispose()
        follower.dispose()
      }
    })

    it(`direct leader requests await the registered collection owner`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)

      let releaseOwner = (): void => {}
      const owner = withUnusedUnloadSubset(
        vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseOwner = resolve
            }),
        ),
      )
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )

      try {
        let settled = false
        const request = coordinator
          .requestEnsureRemoteSubset(`todos`, { limit: 2, offset: 1 })
          .then(() => {
            settled = true
          })
        await Promise.resolve()
        const beforeRelease = { ownerCalls: owner.mock.calls.length, settled }

        releaseOwner()
        await request

        expect(beforeRelease).toEqual({ ownerCalls: 1, settled: false })
        expect(owner).toHaveBeenCalledWith({ limit: 2, offset: 1 })
      } finally {
        releaseOwner()
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`preserves the receiver of an explicitly registered adapter owner`, async () => {
      const receivers: Array<unknown> = []
      const leaderAdapter = createStubAdapter() as ReturnType<
        typeof createStubAdapter
      > & {
        ensureRemoteSubset: (
          collectionId: string,
          options: { limit?: number },
        ) => Promise<void>
      }
      leaderAdapter.ensureRemoteSubset = function (
        this: typeof leaderAdapter,
        _collectionId,
        _options,
      ) {
        receivers.push(this)
        return Promise.resolve()
      }
      const leader = createCoordinator(leaderAdapter)
      const follower = createCoordinator()
      const owner = withUnusedUnloadSubset(
        vi.fn((options: TransportedLoadSubsetOptions) =>
          leaderAdapter.ensureRemoteSubset(`todos`, options),
        ),
      )
      const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)

      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)

      try {
        await follower.requestEnsureRemoteSubset(`todos`, { limit: 1 })
        expect(receivers).toEqual([leaderAdapter])
      } finally {
        unregisterOwner()
        leader.dispose()
        follower.dispose()
      }
    })

    it(`scopes a reused subset options object to each Browser collection`, async () => {
      const coordinator = createCoordinator()
      const alpha = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      })
      const beta = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      })
      const unregisterAlpha = coordinator.registerRemoteSubsetOwner(
        `alpha`,
        alpha,
      )
      const unregisterBeta = coordinator.registerRemoteSubsetOwner(`beta`, beta)
      coordinator.subscribe(`alpha`, () => {})
      coordinator.subscribe(`beta`, () => {})
      await flush(50)
      expect({
        alpha: coordinator.isLeader(`alpha`),
        beta: coordinator.isLeader(`beta`),
      }).toEqual({ alpha: true, beta: true })

      const shared: LoadSubsetOptions = { limit: 2, offset: 1 }
      try {
        await coordinator.requestEnsureRemoteSubset(`alpha`, shared)
        await coordinator.requestEnsureRemoteSubset(`beta`, shared)
        await coordinator.requestEnsureRemoteSubset(`alpha`, shared)

        const afterAcquire = {
          alphaLoads: alpha.mock.calls.length,
          betaLoads: beta.mock.calls.length,
        }
        await coordinator.requestReleaseRemoteSubset(`alpha`, shared)
        await coordinator.requestReleaseRemoteSubset(`beta`, shared)

        expect({
          afterAcquire,
          alphaUnloads: alpha.unloadSubset.mock.calls.length,
          betaUnloads: beta.unloadSubset.mock.calls.length,
        }).toEqual({
          afterAcquire: { alphaLoads: 1, betaLoads: 1 },
          alphaUnloads: 1,
          betaUnloads: 1,
        })
      } finally {
        unregisterAlpha()
        unregisterBeta()
        coordinator.dispose()
      }
    })

    it(`replays after an earlier Browser leader responds behind a new heartbeat`, async () => {
      const leader = createCoordinator()
      const follower = createCoordinator()
      let releaseOwner = (): void => {}
      const owner = withUnusedUnloadSubset(
        vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseOwner = resolve
            }),
        ),
      )
      const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)
      expect({
        leader: leader.isLeader(`todos`),
        follower: follower.isLeader(`todos`),
      }).toEqual({ leader: true, follower: false })

      const leaderInternals = leader as unknown as {
        nodeId: string
        channel: { postMessage: (message: unknown) => void }
      }
      const followerInternals = follower as unknown as {
        onChannelMessage: (message: unknown) => void
        outboundRemoteSubsetAcquisitions: Map<
          string,
          { acquiredLeaderId: string | null }
        >
      }
      const originalLeaderPost = leaderInternals.channel.postMessage.bind(
        leaderInternals.channel,
      )
      let heldResponse: unknown
      leaderInternals.channel.postMessage = (message) => {
        const type = (message as { payload?: { type?: string } }).payload?.type
        if (type === `rpc:ensureRemoteSubset:res`) {
          heldResponse = structuredClone(message)
          return
        }
        originalLeaderPost(message)
      }
      let requestPosts = 0
      observeBroadcastMessage = (message) => {
        if (
          (message as { payload?: { type?: string } }).payload?.type ===
          `rpc:ensureRemoteSubset:req`
        ) {
          requestPosts++
        }
      }

      try {
        const request = follower.requestEnsureRemoteSubset(`todos`, {
          limit: 1,
        })
        await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(1))

        followerInternals.onChannelMessage({
          v: 1,
          dbName: `test-db`,
          collectionId: `todos`,
          senderId: `replacement-browser-leader`,
          ts: Date.now(),
          payload: {
            type: `leader:heartbeat`,
            term: 2,
            leaderId: `replacement-browser-leader`,
            latestSeq: 0,
            latestRowVersion: 0,
          },
        })
        releaseOwner()
        await vi.waitFor(() => expect(heldResponse).toBeDefined())
        leader.isLeader = () => false
        followerInternals.onChannelMessage(heldResponse)
        await request
        await flush()

        const [acquisition] =
          followerInternals.outboundRemoteSubsetAcquisitions.values()
        expect({
          requestPosts,
          acquiredLeaderId: acquisition?.acquiredLeaderId,
        }).toEqual({
          requestPosts: 2,
          acquiredLeaderId: leaderInternals.nodeId,
        })
      } finally {
        observeBroadcastMessage = undefined
        releaseOwner()
        unregisterOwner()
        leader.dispose()
        follower.dispose()
      }
    })

    it(`replays a held Browser lease after an A to B to A leader cycle`, async () => {
      const leader = createCoordinator()
      const follower = createCoordinator()
      let releaseFirstLoad = (): void => {}
      const firstLoadGate = new Promise<void>((resolve) => {
        releaseFirstLoad = resolve
      })
      const owner = Object.assign(
        vi.fn().mockImplementationOnce(() => firstLoadGate),
        { unloadSubset: vi.fn(), onError: vi.fn() },
      )
      const unregisterOwner = leader.registerRemoteSubsetOwner(`todos`, owner)
      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)
      const leaderInternals = leader as unknown as {
        nodeId: string
        channel: { postMessage: (message: unknown) => void }
        inboundRemoteSubsetAcquisitions: Map<string, unknown>
        releaseInboundRemoteSubsetAcquisitions: (collectionId: string) => void
      }
      const followerInternals = follower as unknown as {
        onChannelMessage: (message: unknown) => void
        outboundRemoteSubsetAcquisitions: Map<
          string,
          { acquiredLeaderId: string | null }
        >
      }
      const originalLeaderPost = leaderInternals.channel.postMessage.bind(
        leaderInternals.channel,
      )
      let heldResponse: unknown
      leaderInternals.channel.postMessage = (message) => {
        const type = (message as { payload?: { type?: string } }).payload?.type
        if (
          type === `rpc:ensureRemoteSubset:res` &&
          heldResponse === undefined
        ) {
          heldResponse = structuredClone(message)
          return
        }
        originalLeaderPost(message)
      }
      let requestPosts = 0
      const wireRequests: Array<{
        acquisitionId: string
        rpcId: string
      }> = []
      observeBroadcastMessage = (message) => {
        const payload = (
          message as {
            payload?: {
              type?: string
              acquisitionId?: string
              rpcId?: string
            }
          }
        ).payload
        if (payload?.type === `rpc:ensureRemoteSubset:req`) {
          requestPosts++
          wireRequests.push({
            acquisitionId: payload.acquisitionId!,
            rpcId: payload.rpcId!,
          })
        }
      }
      const heartbeat = (leaderId: string, term: number) => ({
        v: 1,
        dbName: `test-db`,
        collectionId: `todos`,
        senderId: leaderId,
        ts: Date.now(),
        payload: {
          type: `leader:heartbeat`,
          term,
          leaderId,
          latestSeq: 0,
          latestRowVersion: 0,
        },
      })
      const options: LoadSubsetOptions = { limit: 1 }

      try {
        const request = follower.requestEnsureRemoteSubset(`todos`, options)
        await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(1))
        followerInternals.onChannelMessage(
          heartbeat(`replacement-browser-leader`, 2),
        )
        leaderInternals.releaseInboundRemoteSubsetAcquisitions(`todos`)
        followerInternals.onChannelMessage(heartbeat(leaderInternals.nodeId, 3))
        releaseFirstLoad()
        await vi.waitFor(() => expect(heldResponse).toBeDefined())
        followerInternals.onChannelMessage(heldResponse)
        await request
        await vi.waitFor(() => expect(owner).toHaveBeenCalledTimes(2))

        const [acquisition] =
          followerInternals.outboundRemoteSubsetAcquisitions.values()
        expect({
          requestPosts,
          loads: owner.mock.calls.length,
          unloads: owner.unloadSubset.mock.calls.length,
          inbound: leaderInternals.inboundRemoteSubsetAcquisitions.size,
          acquiredLeaderId: acquisition?.acquiredLeaderId,
        }).toEqual({
          requestPosts: 2,
          loads: 2,
          unloads: 1,
          inbound: 1,
          acquiredLeaderId: leaderInternals.nodeId,
        })
        expect(wireRequests).toHaveLength(2)
        expect(wireRequests[0]!.acquisitionId).not.toBe(``)
        expect(wireRequests[1]!.acquisitionId).toBe(
          wireRequests[0]!.acquisitionId,
        )
        expect(wireRequests[1]!.rpcId).not.toBe(wireRequests[0]!.rpcId)

        await follower.requestReleaseRemoteSubset(`todos`, options)
        expect(owner.unloadSubset).toHaveBeenCalledTimes(2)
      } finally {
        observeBroadcastMessage = undefined
        releaseFirstLoad()
        unregisterOwner()
        leader.dispose()
        follower.dispose()
      }
    })

    it(`reports a failed Browser replay once without self-retrying`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      const replayError = new Error(`replacement owner is not ready`)
      const ownerErrors: Array<unknown> = []
      const owner = Object.assign(
        vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(replayError),
        {
          unloadSubset: vi.fn(),
          onError: (error: unknown) => ownerErrors.push(error),
        },
      )
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      const options: LoadSubsetOptions = { limit: 1 }
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      type Acquisition = {
        acquiredLeaderId: string | null
        inFlight: Promise<void> | null
      }
      const internals = coordinator as unknown as {
        outboundRemoteSubsetAcquisitions: Map<string, Acquisition>
        releaseInboundRemoteSubsetAcquisitions: (collectionId: string) => void
        replayRemoteSubsetAcquisitions: (collectionId: string) => Promise<void>
      }
      const [acquisition] = internals.outboundRemoteSubsetAcquisitions.values()
      internals.releaseInboundRemoteSubsetAcquisitions(`todos`)
      await vi.waitFor(() =>
        expect(owner.unloadSubset).toHaveBeenCalledTimes(1),
      )
      acquisition!.acquiredLeaderId = `retired-browser-leader`
      const unhandled: Array<unknown> = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, onUnhandled)

      try {
        await internals.replayRemoteSubsetAcquisitions(`todos`)
        await flush()
        expect({
          attempts: owner.mock.calls.length - 1,
          ownerErrors,
          acquiredLeaderId: acquisition!.acquiredLeaderId,
          inFlight: acquisition!.inFlight,
          unhandled,
        }).toEqual({
          attempts: 1,
          ownerErrors: [replayError],
          acquiredLeaderId: `retired-browser-leader`,
          inFlight: null,
          unhandled: [],
        })
      } finally {
        process.off(`unhandledRejection`, onUnhandled)
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`keeps a failed remote Browser follower replay out of its local owner lifecycle`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      const internals = coordinator as unknown as {
        onChannelMessage: (message: unknown) => void
        sendRPC: (collectionId: string, request: unknown) => Promise<unknown>
        outboundRemoteSubsetAcquisitions: Map<
          string,
          { acquiredLeaderId: string | null; inFlight: Promise<void> | null }
        >
      }
      coordinator.isLeader = () => false
      const heartbeat = (leaderId: string, term: number) =>
        internals.onChannelMessage({
          v: 1,
          dbName: `test-db`,
          collectionId: `todos`,
          senderId: leaderId,
          ts: Date.now(),
          payload: {
            type: `leader:heartbeat`,
            term,
            leaderId,
            latestSeq: 0,
            latestRowVersion: 0,
          },
        })
      heartbeat(`remote-browser-a`, 1)
      const ownerErrors: Array<unknown> = []
      const owner = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: (error: unknown) => ownerErrors.push(error),
      })
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      internals.sendRPC = vi.fn().mockResolvedValue({
        type: `rpc:ensureRemoteSubset:res`,
        rpcId: `initial-browser`,
        ok: true,
        leaderId: `remote-browser-a`,
      })
      const options: LoadSubsetOptions = { limit: 1 }

      try {
        await coordinator.requestEnsureRemoteSubset(`todos`, options)
        const replayError = new Error(`remote Browser replay transport failed`)
        const replayRPC = vi.fn().mockRejectedValue(replayError)
        internals.sendRPC = replayRPC
        heartbeat(`remote-browser-b`, 2)
        await vi.waitFor(() => expect(replayRPC).toHaveBeenCalledTimes(1))
        await vi.waitFor(() => {
          const [acquisition] =
            internals.outboundRemoteSubsetAcquisitions.values()
          expect(acquisition?.inFlight).toBeNull()
        })

        const [acquisition] =
          internals.outboundRemoteSubsetAcquisitions.values()
        expect({
          ownerErrors,
          attempts: replayRPC.mock.calls.length,
          acquiredLeaderId: acquisition?.acquiredLeaderId,
          retained: internals.outboundRemoteSubsetAcquisitions.size,
        }).toEqual({
          ownerErrors: [],
          attempts: 1,
          acquiredLeaderId: `remote-browser-a`,
          retained: 1,
        })
      } finally {
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`expires Browser release tombstones after the existing RPC dedupe horizon`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)
      const owner = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      })
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      const now = vi.spyOn(Date, `now`)
      const internals = coordinator as unknown as {
        inboundRemoteSubsetAcquisitions: Map<string, unknown>
      }

      try {
        for (let index = 0; index < 8; index++) {
          now.mockReturnValue(index * 60_001)
          const options = { offset: index }
          await coordinator.requestEnsureRemoteSubset(`todos`, options)
          await coordinator.requestReleaseRemoteSubset(`todos`, options)
        }

        expect({
          loads: owner.mock.calls.length,
          unloads: owner.unloadSubset.mock.calls.length,
          retained: internals.inboundRemoteSubsetAcquisitions.size,
        }).toEqual({ loads: 8, unloads: 8, retained: 1 })
      } finally {
        now.mockRestore()
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`ignores a lower-term Browser heartbeat without replaying to its stale leader`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      coordinator.isLeader = () => false
      const internals = coordinator as unknown as {
        onChannelMessage: (message: unknown) => void
        collections: Map<
          string,
          { leaderId: string | null; latestTerm: number }
        >
        replayRemoteSubsetAcquisitions: (collectionId: string) => Promise<void>
      }
      const replay = vi.fn(() => Promise.resolve())
      internals.replayRemoteSubsetAcquisitions = replay
      const heartbeat = (leaderId: string, term: number) =>
        internals.onChannelMessage({
          v: 1,
          dbName: `test-db`,
          collectionId: `todos`,
          senderId: leaderId,
          ts: Date.now(),
          payload: {
            type: `leader:heartbeat`,
            term,
            leaderId,
            latestSeq: 0,
            latestRowVersion: 0,
          },
        })

      try {
        heartbeat(`remote-browser-b`, 2)
        replay.mockClear()
        heartbeat(`retired-browser-a`, 1)
        const state = internals.collections.get(`todos`)

        expect({
          leaderId: state?.leaderId,
          latestTerm: state?.latestTerm,
          replayCalls: replay.mock.calls.length,
        }).toEqual({
          leaderId: `remote-browser-b`,
          latestTerm: 2,
          replayCalls: 0,
        })
      } finally {
        coordinator.dispose()
      }
    })

    it(`rebinds a live Browser acquisition when its owner is replaced`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)
      let releaseFirstLoad = (): void => {}
      const firstLoadGate = new Promise<void>((resolve) => {
        releaseFirstLoad = resolve
      })
      const firstOwner = Object.assign(
        vi.fn(() => firstLoadGate),
        {
          unloadSubset: vi.fn(),
          onError: vi.fn(),
        },
      )
      const secondOwner = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(
          (_options: TransportedLoadSubsetOptions) => undefined,
        ),
        onError: vi.fn(),
      })
      const unregisterFirst = coordinator.registerRemoteSubsetOwner(
        `todos`,
        firstOwner,
      )
      let unregisterSecond: (() => void) | undefined
      const options: LoadSubsetOptions = { limit: 1 }

      try {
        const initialAcquire = coordinator.requestEnsureRemoteSubset(
          `todos`,
          options,
        )
        await vi.waitFor(() => expect(firstOwner).toHaveBeenCalledTimes(1))
        unregisterFirst()
        unregisterSecond = coordinator.registerRemoteSubsetOwner(
          `todos`,
          secondOwner,
        )
        releaseFirstLoad()
        await initialAcquire
        await vi.waitFor(() => expect(secondOwner).toHaveBeenCalledTimes(1))

        expect(firstOwner.unloadSubset).toHaveBeenCalledTimes(1)
        await coordinator.requestReleaseRemoteSubset(`todos`, options)
        expect(secondOwner.unloadSubset).toHaveBeenCalledTimes(1)
      } finally {
        releaseFirstLoad()
        unregisterFirst()
        unregisterSecond?.()
        coordinator.dispose()
      }
    })

    it(`rebinds a live remote Browser follower lease when the same leader replaces its owner`, async () => {
      const leader = createCoordinator()
      const follower = createCoordinator()
      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)
      expect({
        leader: leader.isLeader(`todos`),
        follower: follower.isLeader(`todos`),
      }).toEqual({ leader: true, follower: false })
      let releaseFirstLoad = (): void => {}
      const firstLoadGate = new Promise<void>((resolve) => {
        releaseFirstLoad = resolve
      })
      const firstOwner = Object.assign(
        vi.fn(() => firstLoadGate),
        {
          unloadSubset: vi.fn(),
          onError: vi.fn(),
        },
      )
      const secondOwner = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      })
      const unregisterFirst = leader.registerRemoteSubsetOwner(
        `todos`,
        firstOwner,
      )
      let unregisterSecond: (() => void) | undefined
      const options: LoadSubsetOptions = { limit: 1 }
      let requestPosts = 0
      observeBroadcastMessage = (message) => {
        if (
          (message as { payload?: { type?: string } }).payload?.type ===
          `rpc:ensureRemoteSubset:req`
        ) {
          requestPosts++
        }
      }

      try {
        const initialAcquire = follower.requestEnsureRemoteSubset(
          `todos`,
          options,
        )
        await vi.waitFor(() => expect(firstOwner).toHaveBeenCalledTimes(1))
        unregisterFirst()
        unregisterSecond = leader.registerRemoteSubsetOwner(
          `todos`,
          secondOwner,
        )
        releaseFirstLoad()
        await initialAcquire
        await vi.waitFor(() => expect(secondOwner).toHaveBeenCalledTimes(1))

        expect({
          requestPosts,
          firstUnloads: firstOwner.unloadSubset.mock.calls.length,
        }).toEqual({ requestPosts: 1, firstUnloads: 1 })
        await follower.requestReleaseRemoteSubset(`todos`, options)
        expect(secondOwner.unloadSubset).toHaveBeenCalledTimes(1)
      } finally {
        observeBroadcastMessage = undefined
        releaseFirstLoad()
        unregisterFirst()
        unregisterSecond?.()
        leader.dispose()
        follower.dispose()
      }
    })

    it(`rebinds remote Browser demand when its replacement owner registers after release settlement`, async () => {
      const leader = createCoordinator()
      const follower = createCoordinator()
      leader.subscribe(`todos`, () => {})
      follower.subscribe(`todos`, () => {})
      await flush(50)
      expect({
        leader: leader.isLeader(`todos`),
        follower: follower.isLeader(`todos`),
      }).toEqual({ leader: true, follower: false })
      const firstOwner = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      })
      const secondOwner = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      })
      const unregisterFirst = leader.registerRemoteSubsetOwner(
        `todos`,
        firstOwner,
      )
      let unregisterSecond: (() => void) | undefined
      const options: LoadSubsetOptions = { offset: 22 }
      const leaderInternals = leader as unknown as {
        inboundRemoteSubsetAcquisitions: Map<string, Record<string, unknown>>
      }

      try {
        await follower.requestEnsureRemoteSubset(`todos`, options)
        unregisterFirst()
        await vi.waitFor(() =>
          expect(firstOwner.unloadSubset).toHaveBeenCalledTimes(1),
        )
        await flush(0)

        unregisterSecond = leader.registerRemoteSubsetOwner(
          `todos`,
          secondOwner,
        )
        await flush(0)

        expect({
          firstLoads: firstOwner.mock.calls.length,
          firstUnloads: firstOwner.unloadSubset.mock.calls.length,
          secondLoads: secondOwner.mock.calls.length,
          inbound: leaderInternals.inboundRemoteSubsetAcquisitions.size,
        }).toEqual({
          firstLoads: 1,
          firstUnloads: 1,
          secondLoads: 1,
          inbound: 1,
        })

        await follower.requestReleaseRemoteSubset(`todos`, options)
        const [terminal] =
          leaderInternals.inboundRemoteSubsetAcquisitions.values()
        expect(secondOwner.unloadSubset).toHaveBeenCalledTimes(1)
        expect(secondOwner.unloadSubset.mock.calls[0]?.[0]).toBe(
          secondOwner.mock.calls[0]?.[0],
        )
        expect({
          inbound: leaderInternals.inboundRemoteSubsetAcquisitions.size,
          terminalKeys: Object.keys(terminal ?? {}).sort(),
        }).toEqual({
          inbound: 1,
          terminalKeys: [
            `acquisitionId`,
            `collectionId`,
            `released`,
            `requesterId`,
          ],
        })
      } finally {
        unregisterFirst()
        unregisterSecond?.()
        leader.dispose()
        follower.dispose()
      }
    })

    it(`reacquires the same Browser lease after leadership retirement`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)
      const owner = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      })
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      const internals = coordinator as unknown as {
        releaseInboundRemoteSubsetAcquisitions: (collectionId: string) => void
      }
      const options: LoadSubsetOptions = { limit: 1 }

      try {
        await coordinator.requestEnsureRemoteSubset(`todos`, options)
        internals.releaseInboundRemoteSubsetAcquisitions(`todos`)
        await vi.waitFor(() =>
          expect(owner.unloadSubset).toHaveBeenCalledTimes(1),
        )

        await coordinator.requestEnsureRemoteSubset(`todos`, options)
        expect(owner).toHaveBeenCalledTimes(2)
        await coordinator.requestReleaseRemoteSubset(`todos`, options)
        expect(owner.unloadSubset).toHaveBeenCalledTimes(2)
      } finally {
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`starts independent Browser lease replays without sibling head-of-line blocking`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      const owner = Object.assign(vi.fn(), {
        unloadSubset: vi.fn(),
        onError: vi.fn(),
      })
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 1 })
      await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 2 })

      type Acquisition = {
        collectionId: string
        options: TransportedLoadSubsetOptions
        acquiredLeaderId: string | null
      }
      const internals = coordinator as unknown as {
        outboundRemoteSubsetAcquisitions: Map<string, Acquisition>
        acquireRemoteSubset: (acquisition: Acquisition) => Promise<void>
        replayRemoteSubsetAcquisitions: (collectionId: string) => Promise<void>
      }
      const acquisitions = [
        ...internals.outboundRemoteSubsetAcquisitions.values(),
      ]
      for (const acquisition of acquisitions) {
        acquisition.acquiredLeaderId = `retired-browser-leader`
      }
      let releaseFirstReplay = (): void => {}
      const firstReplayGate = new Promise<void>((resolve) => {
        releaseFirstReplay = resolve
      })
      const starts: Array<number | undefined> = []
      internals.acquireRemoteSubset = async (acquisition) => {
        starts.push(acquisition.options.offset)
        if (acquisition.options.offset === 1) await firstReplayGate
      }

      try {
        const replay = internals.replayRemoteSubsetAcquisitions(`todos`)
        await Promise.resolve()
        const startsBeforeFirstFinished = [...starts]
        expect(startsBeforeFirstFinished).toEqual([1, 2])
        releaseFirstReplay()
        await replay
      } finally {
        releaseFirstReplay()
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`reports owner unload rejection while completing sibling Browser cleanup`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      const unloadError = new Error(`browser owner unload failed`)
      const ownerErrors: Array<unknown> = []
      const unloadSubset = vi.fn((options: TransportedLoadSubsetOptions) =>
        options.offset === 1 ? Promise.reject(unloadError) : undefined,
      )
      const owner = Object.assign(vi.fn(), {
        unloadSubset,
        onError: (error: unknown) => ownerErrors.push(error),
      })
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 1 })
      await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 2 })
      const unhandled: Array<unknown> = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, onUnhandled)
      const internals = coordinator as unknown as {
        inboundRemoteSubsetAcquisitions: Map<
          string,
          { release: Promise<void> | null }
        >
        releaseInboundRemoteSubsetAcquisitions: (collectionId: string) => void
      }

      try {
        internals.releaseInboundRemoteSubsetAcquisitions(`todos`)
        const releases = [
          ...internals.inboundRemoteSubsetAcquisitions.values(),
        ].map((acquisition) => acquisition.release!)
        const outcomes = await Promise.allSettled(releases)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))

        expect({
          outcomes: outcomes.map((outcome) =>
            outcome.status === `rejected` ? outcome.reason : outcome.status,
          ),
          unloadOffsets: unloadSubset.mock.calls.map(
            ([options]) => options.offset,
          ),
          ownerErrors,
          unhandled,
        }).toEqual({
          outcomes: [unloadError, `fulfilled`],
          unloadOffsets: [1, 2],
          ownerErrors: [unloadError],
          unhandled: [],
        })
      } finally {
        process.off(`unhandledRejection`, onUnhandled)
        unregisterOwner()
        coordinator.dispose()
      }
    })

    it(`reports local Browser disposal unload rejection once and completes cleanup`, async () => {
      const coordinator = createCoordinator()
      coordinator.subscribe(`todos`, () => {})
      await flush(50)
      expect(coordinator.isLeader(`todos`)).toBe(true)
      const unloadError = new Error(`browser disposal unload failed`)
      const ownerErrors: Array<unknown> = []
      const unloadSubset = vi.fn((options: TransportedLoadSubsetOptions) =>
        options.offset === 23 ? Promise.reject(unloadError) : undefined,
      )
      const owner = Object.assign(vi.fn(), {
        unloadSubset,
        onError: (error: unknown) => ownerErrors.push(error),
      })
      const unregisterOwner = coordinator.registerRemoteSubsetOwner(
        `todos`,
        owner,
      )
      await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 23 })
      await coordinator.requestEnsureRemoteSubset(`todos`, { offset: 24 })
      const unhandled: Array<unknown> = []
      const onUnhandled = (error: unknown) => unhandled.push(error)
      process.on(`unhandledRejection`, onUnhandled)
      const internals = coordinator as unknown as {
        collections: Map<string, unknown>
        pendingRPCs: Map<string, unknown>
        remoteSubsetOwners: Map<string, unknown>
        outboundRemoteSubsetAcquisitions: Map<string, unknown>
        inboundRemoteSubsetAcquisitions: Map<string, unknown>
      }

      try {
        coordinator.dispose()
        await flush(0)

        expect({
          unloadOffsets: unloadSubset.mock.calls.map(
            ([options]) => options.offset,
          ),
          ownerErrors,
          unhandled,
          collections: internals.collections.size,
          pendingRPCs: internals.pendingRPCs.size,
          owners: internals.remoteSubsetOwners.size,
          outbound: internals.outboundRemoteSubsetAcquisitions.size,
          inbound: internals.inboundRemoteSubsetAcquisitions.size,
          channelEndpoints: channels.get(`tsdb:coord:test-db`)?.size ?? 0,
        }).toEqual({
          unloadOffsets: [23, 24],
          ownerErrors: [unloadError],
          unhandled: [],
          collections: 0,
          pendingRPCs: 0,
          owners: 0,
          outbound: 0,
          inbound: 0,
          channelEndpoints: 0,
        })
      } finally {
        process.off(`unhandledRejection`, onUnhandled)
        unregisterOwner()
        coordinator.dispose()
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
    it(`stops Browser RPC retry after disposal and preserves the first failure`, async () => {
      vi.useFakeTimers()
      const coordinator = createCoordinator()
      const firstError = new Error(`browser transport failed during disposal`)
      let firstAttempt = true
      const internals = coordinator as unknown as {
        sendRPC: (
          collectionId: string,
          request: {
            type: `rpc:pullSince:req`
            rpcId: string
            fromRowVersion: number
          },
        ) => Promise<unknown>
        sendRPCOnce: () => Promise<unknown>
      }
      internals.sendRPCOnce = vi.fn(() => {
        if (firstAttempt) {
          firstAttempt = false
          coordinator.dispose()
        }
        return Promise.reject(firstError)
      })
      let outcome: { error: unknown } | undefined

      try {
        const pending = internals
          .sendRPC(`todos`, {
            type: `rpc:pullSince:req`,
            rpcId: `browser-disposal-rpc`,
            fromRowVersion: 0,
          })
          .then(
            () => ({ error: undefined }),
            (error: unknown) => ({ error }),
          )
          .then((result) => {
            outcome = result
            return result
          })
        await vi.advanceTimersByTimeAsync(0)
        const immediate = {
          calls: vi.mocked(internals.sendRPCOnce).mock.calls.length,
          settled: outcome !== undefined,
        }
        await vi.runAllTimersAsync()
        const finalOutcome = await pending

        expect(immediate).toEqual({ calls: 1, settled: true })
        expect(finalOutcome).toEqual({ error: firstError })
        expect(internals.sendRPCOnce).toHaveBeenCalledTimes(1)
      } finally {
        await vi.runAllTimersAsync()
        vi.useRealTimers()
        coordinator.dispose()
      }
    })

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
