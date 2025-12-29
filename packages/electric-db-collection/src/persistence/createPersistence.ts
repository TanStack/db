import DebugModule from 'debug'
import type { StorageApi } from './persistenceAdapter'

const debug = DebugModule.debug(`ts/db:electric:persistence`)

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

  /**
   * Optional pre-loaded cache data. When provided, initial reads will use this cache
   * instead of calling storage.getItem(). This is useful for async storage adapters
   * (like OPFS) that need to load data before the collection is created.
   * The Map keys are storage keys and values are the JSON strings.
   */
  cache?: Map<string, string>

  /**
   * Callback which triggers after data has been loaded from the persistence adapter.
   * Receives markReady function to allow marking the collection ready (e.g., when offline).
   */
  onPersistenceLoaded?: () => void
}

// Envelope we persist to storage
type PersistedEnvelope<T> = {
  v: 1
  value: Record<string, T>
  lastOffset?: number
  shapeHandle?: string
  isReady?: boolean
}

export function createPersistence<T>(cfg: ElectricPersistenceConfig) {
  const key = cfg.storageKey
  const storage =
    cfg.storage || (typeof window !== `undefined` ? window.localStorage : null)
  const cache = cfg.cache

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
    // Try cache first if available (for async storage adapters like OPFS)
    if (cache) {
      const cachedRaw = cache.get(key)
      if (cachedRaw) {
        const parsed = safeParse(cachedRaw)
        if (parsed) {
          const itemCount = Object.keys(parsed.value).length
          debug(
            `[%s] read from cache: found %d items, offset=%s, handle=%s, isReady=%s`,
            key,
            itemCount,
            parsed.lastOffset ?? `none`,
            parsed.shapeHandle ?? `none`,
            parsed.isReady ?? false,
          )
        }
        return parsed
      }
      debug(`[%s] read: no data in cache`, key)
    }

    // Fall back to storage
    if (!storage) {
      debug(`[%s] read: no storage available`, key)
      return null
    }
    const raw = storage.getItem(key)
    const parsed = safeParse(raw)
    if (parsed) {
      const itemCount = Object.keys(parsed.value).length
      debug(
        `[%s] read: found %d items, offset=%s, handle=%s, isReady=%s`,
        key,
        itemCount,
        parsed.lastOffset ?? `none`,
        parsed.shapeHandle ?? `none`,
        parsed.isReady ?? false,
      )
    } else {
      debug(`[%s] read: no persisted data found`, key)
    }
    return parsed
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

    // 3) only advance cursor if we're called from the stream
    const lastOffset =
      (stream?.lastOffset as number | undefined) ?? prev.lastOffset
    const shapeHandle = stream?.shapeHandle ?? prev.shapeHandle

    // 4) Capture isReady status from collection, have to write isReady so compare to true so it's false if not
    const isReady = collection.isReady() || false
    const next: PersistedEnvelope<T> = {
      v: 1,
      value,
      lastOffset,
      shapeHandle,
      isReady,
    }
    write(next)
  }

  const loadSnapshotInto = (
    begin: () => void,
    writeOp: (op: { type: `insert`; value: T }) => void,
    commit: () => void,
  ) => {
    debug(`[%s] loadSnapshotInto: starting`, key)
    const env = read()
    if (!env?.value) {
      debug(`[%s] loadSnapshotInto: no envelope or value, skipping`, key)
      return
    }
    const entries = Object.entries(env.value)
    if (!entries.length) {
      debug(`[%s] loadSnapshotInto: envelope empty, skipping`, key)
      return
    }
    debug(
      `[%s] loadSnapshotInto: loading %d entries into collection`,
      key,
      entries.length,
    )
    begin()
    for (const [, row] of entries) {
      writeOp({ type: `insert`, value: row })
    }
    commit()
    debug(`[%s] loadSnapshotInto: completed`, key)
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
