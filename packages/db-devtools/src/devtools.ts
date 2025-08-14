import { initializeDevtoolsRegistry } from "./registry"
import { initializeDevtoolsStore } from "./devtools-store"
import { getDevtools } from "./global-types"
import type { CollectionImpl } from "../../db/src/collection"
import type { DbDevtoolsRegistry } from "./types"

/**
 * Initialize the DB devtools registry.
 * This should be called once in your application, typically in your main entry point.
 * Collections will automatically register themselves if this registry is present.
 */
export function initializeDbDevtools(): void {
  // SSR safety check
  if (typeof window === `undefined`) {
    return
  }

  // Check if devtools are already initialized
  if (getDevtools()) {
    return
  }

  // Initialize the registry and store
  const registry = initializeDevtoolsRegistry()
  const store = initializeDevtoolsStore()

  // Store the registry globally with proper typing
  window.__TANSTACK_DB_DEVTOOLS__ = {
    ...registry,
    // Keep store available for registerTransaction from core package
    store,
  }

  // Flush any transactions that were queued before devtools initialized
  const w: any = window as any
  const pending = w.__TANSTACK_DB_PENDING_TRANSACTIONS__ as
    | Array<{ transaction: any; collectionId: string }>
    | undefined
  if (Array.isArray(pending) && pending.length) {
    for (const { transaction, collectionId } of pending) {
      store.registerTransaction(transaction, collectionId)
    }
    w.__TANSTACK_DB_PENDING_TRANSACTIONS__ = []
  }
}

/**
 * Manually register a collection with the devtools.
 * This is automatically called by collections when they are created if devtools are enabled.
 */
export function registerCollection(
  collection: CollectionImpl<any, any, any> | undefined
): void {
  if (typeof window === `undefined`) return

  const devtools = getDevtools()
  if (devtools?.registerCollection && collection) {
    const updateCallback = devtools.registerCollection(collection)
    if (updateCallback && collection) {
      ;(collection as any).__devtoolsUpdateCallback = updateCallback
    }
  }
}

/**
 * Manually unregister a collection from the devtools.
 * This is automatically called when collections are garbage collected.
 */
export function unregisterCollection(id: string): void {
  if (typeof window === `undefined`) return

  const devtools = getDevtools()
  devtools?.unregisterCollection(id)
}

/**
 * Check if devtools are currently enabled (registry is present).
 */
export function isDevtoolsEnabled(): boolean {
  if (typeof window === `undefined`) return false
  return !!getDevtools()
}

export function getDevtoolsRegistry(): DbDevtoolsRegistry | undefined {
  if (typeof window === `undefined`) return undefined
  const devtools = getDevtools()
  if (!devtools) return undefined

  // Return the actual registry instance that has the store property
  return devtools as unknown as DbDevtoolsRegistry
}

/**
 * Trigger a metadata update for a collection in the devtools.
 * This should be called by collections when their state changes significantly.
 */
export function triggerCollectionUpdate(
  collection: CollectionImpl<any, any, any>
): void {
  if (typeof window === `undefined`) return

  const updateCallback = (collection as any).__devtoolsUpdateCallback
  if (typeof updateCallback === `function`) {
    updateCallback()
  }
}

/**
 * Trigger a transaction update for a collection in the devtools.
 * This should be called by collections when their transactions change.
 */
export function triggerTransactionUpdate(
  collection: CollectionImpl<any, any, any>
): void {
  if (typeof window === `undefined`) return

  const devtools = getDevtools()
  // Delegate to store/registry through the public API
  devtools?.store.updateTransactions(collection.id)
}

/**
 * Clean up the devtools registry and all references.
 * This is useful for testing or when you want to completely reset the devtools state.
 */
export function cleanupDevtools(): void {
  if (typeof window === `undefined`) return

  const devtools = getDevtools()
  if (devtools) {
    devtools.store.cleanup()
    delete window.__TANSTACK_DB_DEVTOOLS__
  }
}
