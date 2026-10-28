// Shared harness for the Browser coordinator tests. The ordinary tests and the
// oracle tests in browser-coordinator-oracle.test.ts run this mock in their own
// module instances, so each test file binds its transport controls.

import { vi } from 'vitest'
import { IR } from '@tanstack/db'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { BrowserCollectionCoordinatorOptions } from '../src/browser-coordinator'
import type {
  HydrationPersistenceAdapter,
  PersistedStorageTarget,
  PersistedTx,
  PersistenceAdapter,
  RemoteSubsetOwner,
  TransportedLoadSubsetOptions,
} from '@tanstack/db-sqlite-persistence-core'

// ---------------------------------------------------------------------------
// BroadcastChannel mock
// ---------------------------------------------------------------------------

export type MessageHandler = (event: { data: unknown }) => void
export const channels: Map<
  string,
  Set<{ onmessage: MessageHandler | null }>
> = new Map()
export const durableTerms = new Map<string, number>()

/**
 * The transport controls are variables in the test file that drives the mock,
 * so its assignments (`dropNextMessageWhen = ...`) reach the mock. The file
 * binds accessors for them once, and the mock reads and clears them through
 * the binding.
 */
export type TransportControls = {
  dropNextMessageWhen: ((data: unknown) => boolean) | undefined
  observePostedMessage: ((data: unknown) => void) | undefined
  dropNextBroadcastMessage: ((data: unknown) => boolean) | undefined
  duplicateNextBroadcastMessage:
    ((data: unknown) => unknown | undefined) | undefined
  observeBroadcastMessage: ((data: unknown) => void) | undefined
}
let transportControls: TransportControls | undefined

export function bindTransportControls(controls: TransportControls): void {
  transportControls = controls
}

function boundTransportControls(): TransportControls {
  if (!transportControls) {
    throw new Error(`transport controls are not bound`)
  }
  return transportControls
}

export class MockBroadcastChannel {
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
    const controls = boundTransportControls()
    controls.observePostedMessage?.(data)
    if (controls.dropNextMessageWhen?.(data)) {
      controls.dropNextMessageWhen = undefined
      return
    }
    controls.observeBroadcastMessage?.(data)
    if (controls.dropNextBroadcastMessage?.(data)) {
      controls.dropNextBroadcastMessage = undefined
      return
    }

    const duplicate = controls.duplicateNextBroadcastMessage?.(data)
    if (duplicate !== undefined) {
      controls.duplicateNextBroadcastMessage = undefined
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

export function injectBroadcastMessage(
  channelName: string,
  data: unknown,
): void {
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

export type LockGrantedCallback = (lock: { name: string }) => Promise<unknown>

export const heldLocks = new Map<string, { release: () => void }>()
export const lockQueues = new Map<
  string,
  Array<{
    callback: LockGrantedCallback
    signal?: AbortSignal
    resolve: (v: unknown) => void
    reject: (e: Error) => void
  }>
>()

export function tryGrantNextLock(name: string): void {
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

export const mockNavigatorLocks = {
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

export function installGlobals(): void {
  ;(globalThis as Record<string, unknown>).BroadcastChannel =
    MockBroadcastChannel as unknown
  Object.defineProperty(globalThis, `navigator`, {
    value: {
      ...(((globalThis as Record<string, unknown>).navigator as
        object | undefined) ?? {}),
      locks: mockNavigatorLocks,
    },
    writable: true,
    configurable: true,
  })
}

export function cleanupGlobals(): void {
  const controls = boundTransportControls()
  controls.dropNextMessageWhen = undefined
  controls.observePostedMessage = undefined
  controls.dropNextBroadcastMessage = undefined
  controls.duplicateNextBroadcastMessage = undefined
  controls.observeBroadcastMessage = undefined
  channels.clear()
  heldLocks.clear()
  lockQueues.clear()
  durableTerms.clear()
}

// ---------------------------------------------------------------------------
// Adapter stub
// ---------------------------------------------------------------------------

export function storageId(target: PersistedStorageTarget): string {
  return target.kind === `managed`
    ? target.storageCollectionId
    : target.collectionId
}

export function createStubAdapter(): PersistenceAdapter & {
  pullSince: (
    target: PersistedStorageTarget,
    fromRowVersion: number,
  ) => Promise<{
    latestRowVersion: number
    requiresFullReload: false
    changedKeys: Array<string | number>
    deletedKeys: Array<string | number>
  }>
  getStreamPosition: (target: PersistedStorageTarget) => Promise<{
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
    loadResumeSnapshot: () =>
      Promise.resolve({
        rows: [],
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }),
    applyCommittedTx: (target, tx) => {
      appliedTxs.push({ collectionId: storageId(target), tx })
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
    async reserveLeadershipTerm(target, observedTerm) {
      const collectionId = storageId(target)
      const position = await this.getStreamPosition(target)
      const latestTerm =
        Math.max(
          position.latestTerm,
          durableTerms.get(collectionId) ?? 0,
          observedTerm,
        ) + 1
      durableTerms.set(collectionId, latestTerm)
      return { ...position, latestTerm }
    },
  }
}

export function createCoordinator(
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

export const liveCoordinators = new Set<BrowserCollectionCoordinator>()

export function subsetWithNestedValue(value: unknown): LoadSubsetOptions {
  return {
    where: new IR.Func(`in`, [
      new IR.PropRef([`todos`, `status`]),
      new IR.Value([`kept`, value]),
    ]),
  }
}

export function withUnusedUnloadSubset<
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

export class UnsupportedSubsetValue {
  constructor(readonly label: string) {}
}

export function withEnumerableExpando<T extends object>(value: T): T {
  Object.defineProperty(value, `extra`, {
    value: `would be lost`,
    enumerable: true,
  })
  return value
}

export function detachBufferWithView(
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

export type ResizableArrayBufferConstructor = {
  new (byteLength: number, options: { maxByteLength: number }): ArrayBuffer
}

export type Float16ArrayConstructor = {
  new (values: ArrayLike<number>): ArrayBufferView
}

export function createResizableArrayBuffer(): ArrayBuffer | undefined {
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

export const unsupportedValuePath = `options.where.args[1].value[1]`
export const resizableArrayBufferValueCases = createResizableArrayBuffer()
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
export const Float16ArrayValue = Reflect.get(globalThis, `Float16Array`) as
  Float16ArrayConstructor | undefined
export const float16ArrayValueCases = Float16ArrayValue
  ? ([
      [
        `Float16Array outside the exported typed-array union`,
        () => new Float16ArrayValue([1, 2]),
        unsupportedValuePath,
      ],
    ] as const)
  : ([] as const)

export const unsupportedSubsetValueCases = [
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

export async function flush(ms: number = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

export function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

export type CoordinatorInspection = {
  collectionAdapters: Map<string, unknown>
  collections: Map<string, unknown>
  appliedEnvelopes: Map<string, unknown>
}

export function inspectCoordinator(
  coordinator: BrowserCollectionCoordinator,
): CoordinatorInspection {
  return coordinator as unknown as CoordinatorInspection
}

export function createQueuedReadAdapter() {
  const adapter = createStubAdapter()
  const queuedRead = createDeferred()
  // The queued read holds regular work and every barrier behind it.
  adapter.runInRegularScope = Object.assign(
    async <T>(task: (adapter: HydrationPersistenceAdapter) => Promise<T>) => {
      await queuedRead.promise
      return task(adapter)
    },
    { afterQueuedWork: () => queuedRead.promise },
  )
  adapter.reconcileCommittedTx = (target, tx) => {
    adapter.appliedTxs.push({ collectionId: storageId(target), tx })
    return Promise.resolve({
      kind: `applied-now` as const,
      committed: { term: tx.term, seq: tx.seq, rowVersion: tx.rowVersion },
      latestRowVersion: tx.rowVersion,
    })
  }
  return { adapter, queuedRead }
}
