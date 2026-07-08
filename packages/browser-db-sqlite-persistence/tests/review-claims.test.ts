/**
 * Red/green verification for external-review claims about
 * BrowserCollectionCoordinator:
 *
 * 1. (#1498) Cross-tab RPC posts raw LoadSubsetOptions — including the
 *    `subscription` object, which contains functions — over BroadcastChannel,
 *    crashing structured clone.
 * 2. (#1589 bug 1) The coordinator has a single mutable adapter slot, so
 *    resolving persistence for a second collection with a different
 *    schemaVersion cross-wires collection A's leader-side operations through
 *    collection B's adapter, wiping A's rows via a spurious schema mismatch.
 */
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import { createBrowserWASQLitePersistence } from '../src/browser-persistence'
import type { BrowserWASQLiteDatabase } from '../src/wa-sqlite-driver'
import type { PersistenceAdapter } from '@tanstack/db-sqlite-persistence-core'

// ---------------------------------------------------------------------------
// Browser-faithful BroadcastChannel mock: structured-clones at SEND time,
// exactly like real browsers (DataCloneError throws synchronously in
// postMessage even if nobody is listening).
// ---------------------------------------------------------------------------

type MessageHandler = (event: { data: unknown }) => void
const channels: Map<string, Set<{ onmessage: MessageHandler | null }>> =
  new Map()

class StrictBroadcastChannel {
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
    const cloned = structuredClone(data)
    const peers = channels.get(this.name)
    if (!peers) return
    for (const peer of peers) {
      if (peer !== this && peer.onmessage) {
        const handler = peer.onmessage
        queueMicrotask(() => handler({ data: cloned }))
      }
    }
  }

  close(): void {
    channels.get(this.name)?.delete(this)
  }
}

// ---------------------------------------------------------------------------
// Web Locks mock (same semantics as browser-coordinator.test.ts)
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
    tryGrantNextLock(name)
    return
  }

  let releaseCallback!: () => void
  void new Promise<void>((resolve) => {
    releaseCallback = resolve
  })

  heldLocks.set(name, { release: releaseCallback })

  const result = next.callback({ name })
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

function installGlobals(): void {
  ;(globalThis as Record<string, unknown>).BroadcastChannel =
    StrictBroadcastChannel as unknown
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

async function flush(ms: number = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Helpers
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
} {
  return {
    loadSubset: () => Promise.resolve([]),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
    pullSince: () =>
      Promise.resolve({
        latestRowVersion: 0,
        requiresFullReload: false as const,
        changedKeys: [],
        deletedKeys: [],
      }),
    getStreamPosition: () =>
      Promise.resolve({ latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }),
  }
}

function toBindable(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

function createNodeSqliteBackedDatabase(): BrowserWASQLiteDatabase {
  const db = new DatabaseSync(`:memory:`)
  return {
    execute: (sql, params = []) => {
      const isQuery = /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql)
      if (isQuery) {
        const rows = db
          .prepare(sql)
          .all(...params.map(toBindable))
          .map((row) => ({ ...row }))
        return Promise.resolve(rows as Array<never>)
      }
      if (params.length > 0) {
        db.prepare(sql).run(...params.map(toBindable))
      } else {
        db.exec(sql)
      }
      return Promise.resolve([])
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe(`review claims: BrowserCollectionCoordinator`, () => {
  beforeEach(() => {
    installGlobals()
  })

  afterEach(() => {
    cleanupGlobals()
  })

  it(`ships follower ensureRemoteSubset requests without crashing structured clone (#1498)`, async () => {
    const leader = new BrowserCollectionCoordinator({
      dbName: `clone-db`,
      adapter: createStubAdapter(),
    })
    leader.subscribe(`todos`, () => {})
    await flush(50)
    expect(leader.isLeader(`todos`)).toBe(true)

    const follower = new BrowserCollectionCoordinator({
      dbName: `clone-db`,
      adapter: createStubAdapter(),
    })
    follower.subscribe(`todos`, () => {})
    await flush(50)
    expect(follower.isLeader(`todos`)).toBe(false)

    // Real LoadSubsetOptions from a live query carry the triggering
    // Subscription — a class instance with methods — which structured clone
    // rejects. This currently throws "Function object could not be cloned"
    // on every retry, flooding the console.
    const subscriptionLike = {
      requestSnapshot: () => true,
      onUnsubscribe: () => {},
    }

    // DESIRED INVARIANT: the RPC must be serializable — the payload the
    // leader needs is plain data; per-tab objects must not cross the wire.
    await expect(
      follower.requestEnsureRemoteSubset(`todos`, {
        limit: 10,
        subscription: subscriptionLike as never,
      }),
    ).resolves.toBeUndefined()

    leader.dispose()
    follower.dispose()
  })

  it(`does not let a second collection's schemaVersion wipe another collection through the shared adapter slot (#1589)`, async () => {
    const coordinator = new BrowserCollectionCoordinator({
      dbName: `slot-db`,
    })
    const persistence = createBrowserWASQLitePersistence({
      database: createNodeSqliteBackedDatabase(),
      coordinator,
    })

    // Collection A at schemaVersion 1 persists a row.
    const persistenceA = persistence.resolvePersistenceForCollection!({
      collectionId: `collection-a`,
      mode: `sync-present`,
      schemaVersion: 1,
    })
    await persistenceA.adapter.applyCommittedTx(`collection-a`, {
      txId: `tx-1`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        { type: `insert`, key: `1`, value: { id: `1`, title: `Keep me` } },
      ],
    })
    expect(await persistenceA.adapter.loadSubset(`collection-a`, {})).toHaveLength(1)

    // Collection B resolves at schemaVersion 2 — this overwrites the
    // coordinator's single adapter slot with a v2 adapter.
    persistence.resolvePersistenceForCollection!({
      collectionId: `collection-b`,
      mode: `sync-present`,
      schemaVersion: 2,
    })

    // Collection A acquires leadership; the coordinator restores its stream
    // position through the slot adapter. If that is B's v2 adapter, A's
    // registry (v1) looks like a schema mismatch and A's rows get wiped.
    coordinator.subscribe(`collection-a`, () => {})
    await flush(50)
    expect(coordinator.isLeader(`collection-a`)).toBe(true)

    // DESIRED INVARIANT: resolving persistence for collection B must never
    // destroy collection A's data.
    expect(
      await persistenceA.adapter.loadSubset(`collection-a`, {}),
    ).toHaveLength(1)

    coordinator.dispose()
  })
})
