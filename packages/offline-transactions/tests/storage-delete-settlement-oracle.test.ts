import { afterEach, expect, it, vi } from 'vitest'
import { LocalStorageAdapter } from '../src/storage/LocalStorageAdapter'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { FakeStorageAdapter } from './harness'
import type { OfflineTransaction } from '../src/types'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it(`rejects localStorage deletion failure and retains the key`, async () => {
  const stored = new Map([[`offline-tx:key`, `value`]])
  const error = new DOMException(`storage blocked`, `SecurityError`)
  vi.stubGlobal(`localStorage`, {
    getItem: (key: string) => stored.get(key) ?? null,
    removeItem: () => {
      throw error
    },
  })
  vi.spyOn(console, `warn`).mockImplementation(() => {})
  const adapter = new LocalStorageAdapter()

  expect(await adapter.get(`key`)).toBe(`value`)
  await expect(adapter.delete(`key`)).rejects.toBe(error)
  expect(await adapter.get(`key`)).toBe(`value`)
})

it(`keeps a failed outbox removal visible to a read already in flight`, async () => {
  let deliverRead!: () => void
  let readStarted!: () => void
  const readGate = new Promise<void>((resolve) => {
    deliverRead = resolve
  })
  const started = new Promise<void>((resolve) => {
    readStarted = resolve
  })
  const deletionError = new Error(`durable deletion failed`)
  let holdRead = false
  class Storage extends FakeStorageAdapter {
    override async get(key: string): Promise<string | null> {
      if (holdRead && key === `tx:retained`) {
        readStarted()
        await readGate
      }
      return super.get(key)
    }

    override async delete(key: string): Promise<void> {
      if (key === `tx:retained`) throw deletionError
      await super.delete(key)
    }
  }
  const transaction: OfflineTransaction = {
    id: `retained`,
    mutationFnName: `syncData`,
    mutations: [],
    keys: [],
    idempotencyKey: `retained/once`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }
  const storage = new Storage()
  const outbox = new OutboxManager(storage, {})
  await outbox.add(transaction)
  holdRead = true
  const pendingRead = outbox.getAll()
  await started

  try {
    await expect(outbox.remove(transaction.id)).rejects.toBe(deletionError)
    deliverRead()
    expect(await pendingRead).toEqual([transaction])
    expect(await outbox.get(transaction.id)).toEqual(transaction)
  } finally {
    holdRead = false
    deliverRead()
  }
})
