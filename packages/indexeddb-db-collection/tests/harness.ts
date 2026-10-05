import { createCollection } from '@tanstack/db'
import { expect, vi } from 'vitest'
import { createIndexedDB, indexedDBCollectionOptions } from '../src'
import type { Collection } from '@tanstack/db'
import type {
  IndexedDBCollectionConfig,
  IndexedDBCollectionUtils,
  IndexedDBInstance,
} from '../src'

export type Row = {
  id: string | number
  name: string
  optional?: number
  unsupported?: () => void
}
export type Operation = 'insert' | 'update' | 'delete'

export function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// A controlled transport, not an implementation of browser scheduling. Only the
// sender supplies payloads. Delivery preserves structured cloning and routing;
// the test controls the handoff and awaits the receiver's work, without sleeps.
export class Channel {
  static peers = new Set<Channel>()
  static pending: Array<{ peer: Channel; data: unknown }> = []
  static sent: Array<unknown> = []
  onmessage: ((event: MessageEvent) => void | Promise<void>) | null = null
  constructor(readonly name: string) {
    Channel.peers.add(this)
  }
  postMessage(data: unknown) {
    Channel.sent.push(structuredClone(data))
    for (const peer of Channel.peers) {
      if (peer !== this && peer.name === this.name)
        Channel.pending.push({ peer, data: structuredClone(data) })
    }
  }
  close() {
    Channel.peers.delete(this)
  }
  static async deliver() {
    const messages = Channel.pending.splice(0)
    for (const { peer, data } of messages) {
      if (Channel.peers.has(peer))
        await peer.onmessage?.(new MessageEvent('message', { data }))
    }
    return messages.length
  }
}

export function userRow(value: Row): Row {
  // Strip only the five virtual Collection fields, retaining every user field.
  const {
    $key: _key,
    $origin: _origin,
    $hasPendingWrites: _pending,
    $synced: _synced,
    $collectionId: _collectionId,
    ...row
  } = value as Row & Record<string, unknown>
  return row
}
export function sorted(rows: Iterable<Row>): Array<Row> {
  return [...rows]
    .map(userRow)
    .sort((a, b) => JSON.stringify(a.id).localeCompare(JSON.stringify(b.id)))
}
export function assertRows(
  actual: Iterable<Row>,
  expected: Iterable<Row>,
  cut: string,
) {
  expect(sorted(actual), cut).toEqual(sorted(expected))
}

// Raw IndexedDB requests keep the durable observation independent of the
// wrapper under test. A transaction's complete/abort, not request success, is
// the durability checkpoint.
export function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}
export function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener('complete', () => resolve())
    tx.addEventListener('abort', () => reject(tx.error ?? new Error('aborted')))
  })
}
export async function readStore<T>(db: IndexedDBInstance, name: string) {
  const tx = db.db.transaction(name, 'readonly')
  const done = completed(tx)
  const store = tx.objectStore(name)
  const [keys, rows] = await Promise.all([
    request(store.getAllKeys()),
    request(store.getAll() as IDBRequest<Array<T>>),
  ])
  await done
  return { keys, rows }
}
export async function seed(
  db: IndexedDBInstance,
  name: string,
  rows: Array<Row>,
) {
  const tx = db.db.transaction([name, '_versions'], 'readwrite')
  const done = completed(tx)
  for (const row of rows) {
    tx.objectStore(name).put(row, row.id)
    tx.objectStore('_versions').put(
      { versionKey: crypto.randomUUID(), updatedAt: 1 },
      [name, row.id],
    )
  }
  await done
}

export async function withHarness(
  run: (
    harness: Awaited<ReturnType<typeof createHarness>>,
  ) => Promise<void> | void,
  stores = ['items', 'other'],
) {
  const harness = await createHarness(stores)
  let primary: unknown
  let failed = false
  try {
    await run(harness)
  } catch (error) {
    primary = error
    failed = true
  }
  const cleanupErrors: Array<unknown> = []
  for (const collection of harness.collections) {
    try {
      await collection.cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  harness.db.close()
  Channel.peers.clear()
  Channel.pending = []
  Channel.sent = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (cleanupErrors.length)
    throw new AggregateError(
      failed ? [primary, ...cleanupErrors] : cleanupErrors,
      'Oracle cleanup failed; first error is the primary failure when present',
      { cause: failed ? primary : cleanupErrors[0] },
    )
  if (failed) throw primary
}
async function createHarness(stores: Array<string>) {
  vi.stubGlobal('BroadcastChannel', Channel)
  const db = await createIndexedDB({
    name: crypto.randomUUID(),
    version: 1,
    stores,
  })
  function make(
    name = 'items',
    config: Partial<IndexedDBCollectionConfig<Row>> = {},
  ): Collection<Row, string | number, IndexedDBCollectionUtils<Row>, never> {
    const collection = createCollection(
      indexedDBCollectionOptions<Row>({
        db,
        name,
        getKey: (row) => row.id,
        ...config,
      }),
    )
    collections.push(collection)
    return collection
  }
  const collections: Array<ReturnType<typeof make>> = []
  async function open(
    name = 'items',
    config: Partial<IndexedDBCollectionConfig<Row>> = {},
  ) {
    const collection = make(name, config)
    await collection.preload()
    return collection
  }
  return { db, collections, make, open }
}
