import type { DurableStreamCollectionConfig, OffsetStorage } from './types'

/**
 * Get the storage key for persisting offset.
 * @returns The storage key, or null if persistence is disabled.
 */
export function getStorageKey<TRow extends object>(
  config: DurableStreamCollectionConfig<TRow>,
): string | null {
  if (config.storageKey === false) {
    return null
  }
  const prefix = config.storageKey ?? `durable-stream`
  return `${prefix}:${config.url}:offset`
}

/**
 * Get the default storage adapter.
 * Returns localStorage if available, otherwise null.
 */
function getDefaultStorage(): OffsetStorage | null {
  if (typeof localStorage !== `undefined`) {
    return localStorage
  }
  return null
}

/**
 * Get the storage adapter to use.
 * Returns the configured storage, or the default storage.
 */
function getStorage<TRow extends object>(
  config: DurableStreamCollectionConfig<TRow>,
): OffsetStorage | null {
  return config.storage ?? getDefaultStorage()
}

/**
 * Load the persisted offset from storage.
 * @returns The persisted offset, or null if not found or persistence is disabled.
 */
export async function loadOffset<TRow extends object>(
  config: DurableStreamCollectionConfig<TRow>,
): Promise<string | null> {
  const key = getStorageKey(config)
  if (!key) {
    return null
  }

  const storage = getStorage(config)
  if (!storage) {
    return null
  }

  try {
    const result = storage.getItem(key)
    // Handle both sync and async storage
    if (result instanceof Promise) {
      return (await result) ?? null
    }
    return result ?? null
  } catch {
    // Ignore storage errors (e.g., SecurityError in some browsers)
    return null
  }
}

/**
 * Save the offset to storage.
 * Does nothing if persistence is disabled or storage is unavailable.
 */
export async function saveOffset<TRow extends object>(
  config: DurableStreamCollectionConfig<TRow>,
  offset: string,
): Promise<void> {
  const key = getStorageKey(config)
  if (!key) {
    return
  }

  const storage = getStorage(config)
  if (!storage) {
    return
  }

  try {
    const result = storage.setItem(key, offset)
    // Handle both sync and async storage
    if (result instanceof Promise) {
      await result
    }
  } catch {
    // Ignore storage errors (e.g., QuotaExceededError, SecurityError)
  }
}

/**
 * Clear the persisted offset from storage.
 * Useful for resetting sync state.
 */
export async function clearOffset<TRow extends object>(
  config: DurableStreamCollectionConfig<TRow>,
): Promise<void> {
  const key = getStorageKey(config)
  if (!key) {
    return
  }

  const storage = getStorage(config)
  if (!storage) {
    return
  }

  try {
    // Use setItem with empty string as a fallback since not all storage adapters have removeItem
    const result = storage.setItem(key, ``)
    if (result instanceof Promise) {
      await result
    }
  } catch {
    // Ignore storage errors
  }
}
