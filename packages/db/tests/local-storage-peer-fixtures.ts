// Shared fixtures for the LocalStorage peer tests: a fake same-origin Storage
// host with its event bus, and Collections that share one key. The fixed peer
// histories are in local-storage-peer-history.test.ts.
import { createCollection } from '../src/collection/index'
import { localStorageCollectionOptions } from '../src/local-storage'
import type { StorageApi, StorageEventApi } from '../src/local-storage'

export type Row = { id: string | number; value: number }

export function createHost() {
  const data = new Map<string, string>()
  const listeners = new Set<(event: StorageEvent) => void>()
  let storageReads = 0
  const storage: StorageApi = {
    getItem: (key) => {
      storageReads++
      return data.get(key) ?? null
    },
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
  const events: StorageEventApi = {
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
  }
  function deliver(key: string) {
    const event = {
      key,
      storageArea: storage,
      newValue: data.get(key) ?? null,
    } as StorageEvent
    for (const listener of [...listeners]) listener(event)
  }
  return {
    storage,
    events,
    deliver,
    listenerCount: () => listeners.size,
    readCount: () => storageReads,
    resetReadCount: () => {
      storageReads = 0
    },
  }
}

export function makeCollection(
  host: ReturnType<typeof createHost>,
  storageKey: string,
  id: string,
) {
  return createCollection(
    localStorageCollectionOptions<Row>({
      id,
      storageKey,
      storage: host.storage,
      storageEventApi: host.events,
      getKey: (row) => row.id,
    }),
  )
}
