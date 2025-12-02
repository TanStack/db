import type { StorageApi } from "./persistenceAdapter"

/**
 * Configuration interface for Electric collection persistence
 * @template T - The type of items in the collection
 */
export interface ElectricPersistenceConfig {
  /**
   * The key to use for storing the collection data in localStorage/sessionStorage
   */
  storageKey: string

  /**
   * Storage API to use (defaults to window.localStorage)
   * Can be any object that implements the Storage interface (e.g., sessionStorage)
   */
  storage?: StorageApi
}

// Envelope we persist to storage
type PersistedEnvelope<T> = {
  v: 1
  value: Record<string, T>
  lastOffset?: number
  shapeHandle?: string
}

export interface ElectricPersistenceConfig {
  storageKey: string
  storage?: StorageApi
}

export function createPersistence<T>(cfg: ElectricPersistenceConfig) {
  const key = cfg.storageKey
  const storage =
    cfg.storage || (typeof window !== `undefined` ? window.localStorage : null)

  const safeParse = (raw: string | null): PersistedEnvelope<T> | null => {
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === `object` && parsed.v === 1) {
        return parsed as PersistedEnvelope<T>
      }
      return null
    } catch {
      return null
    }
  }

  const read = (): PersistedEnvelope<T> | null => {
    if (!storage) return null
    return safeParse(storage.getItem(key))
  }

  const write = (next: PersistedEnvelope<T>) => {
    if (!storage) return
    storage.setItem(key, JSON.stringify(next))
  }

  const clear = () => {
    if (!storage) return
    storage.removeItem(key)
  }

  const size = (): number => {
    if (!storage) return 0
    const data = storage.getItem(key)
    return data ? new Blob([data]).size : 0
  }

  const saveCollectionSnapshot = (collection: any, stream?: any) => {
    if (!storage) return
    // 1) snapshot collection state
    const value: Record<string, T> = {}
    for (const [k, v] of collection.state) value[String(k)] = v as T

    // 2) load previous envelope (to preserve cursor when no stream present)
    const prev = read() ?? { v: 1, value: {} as Record<string, T> }

    // 3) only advance cursor if we’re called from the stream
    const lastOffset =
      (stream?.lastOffset as number | undefined) ?? prev.lastOffset
    const shapeHandle = stream?.shapeHandle ?? prev.shapeHandle

    const next: PersistedEnvelope<T> = { v: 1, value, lastOffset, shapeHandle }
    write(next)
  }

  const loadSnapshotInto = (
    begin: () => void,
    writeOp: (op: { type: `insert`; value: T }) => void,
    commit: () => void
  ) => {
    const env = read()
    if (!env?.value) return
    const entries = Object.entries(env.value)
    if (!entries.length) return
    begin()
    for (const [, row] of entries) {
      writeOp({ type: `insert`, value: row })
    }
    commit()
  }

  return {
    read,
    write,
    clear,
    size,
    saveCollectionSnapshot,
    loadSnapshotInto,
  }
}
