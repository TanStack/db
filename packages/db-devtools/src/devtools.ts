import { initializeDevtoolsRegistry } from "./registry"
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
  if ((window as any).__TANSTACK_DB_DEVTOOLS__) {
    return
  }

  // Initialize the registry
  const registry = initializeDevtoolsRegistry()

  // Store the registry globally under the namespaced structure
  ;(window as any).__TANSTACK_DB_DEVTOOLS__ = {
    ...registry,
    collectionsSignal: registry.collectionsSignal,
    transactionsSignal: registry.transactionsSignal,
    registerCollection: (collection: any) => {
      const updateCallback = registry.registerCollection(collection)
      // Store the callback on the collection for later use
      if (updateCallback && collection) {
        collection.__devtoolsUpdateCallback = updateCallback
      }
    },
    unregisterCollection: (id: string) => {
      registry.unregisterCollection(id)
    },
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

  const devtools = (window as any).__TANSTACK_DB_DEVTOOLS__ as {
    registerCollection: (collection: any) => (() => void) | undefined
  }
  const updateCallback: (() => void) | undefined =
    devtools.registerCollection(collection)
  // Store the callback on the collection for later use
  if (updateCallback && collection) {
    ;(collection as any).__devtoolsUpdateCallback = updateCallback
  }
}

/**
 * Manually unregister a collection from the devtools.
 * This is automatically called when collections are garbage collected.
 */
export function unregisterCollection(id: string): void {
  if (typeof window === `undefined`) return

  const devtools = (window as any).__TANSTACK_DB_DEVTOOLS__ as {
    unregisterCollection: (id: string) => void
  }
  devtools.unregisterCollection(id)
}

/**
 * Check if devtools are currently enabled (registry is present).
 */
export function isDevtoolsEnabled(): boolean {
  if (typeof window === `undefined`) return false
  return !!(window as any).__TANSTACK_DB_DEVTOOLS__
}

export function getDevtoolsRegistry(): DbDevtoolsRegistry | undefined {
  if (typeof window === `undefined`) return undefined
  const devtools = (window as any).__TANSTACK_DB_DEVTOOLS__!

  // Return the registry part of the devtools object
  return {
    collections: devtools.collections,
    collectionsSignal: devtools.collectionsSignal,
    transactionsSignal: devtools.transactionsSignal,
    registerCollection: devtools.registerCollection,
    unregisterCollection: devtools.unregisterCollection,
    getCollection: devtools.getCollection,
    releaseCollection: devtools.releaseCollection,
    getAllCollectionMetadata: devtools.getAllCollectionMetadata,
    getCollectionMetadata: devtools.getCollectionMetadata,
    updateCollectionMetadata: devtools.updateCollectionMetadata,
    updateTransactions: devtools.updateTransactions,
    getTransactions: devtools.getTransactions,
    getTransaction: devtools.getTransaction,
    getTransactionDetails: devtools.getTransactionDetails,
    clearTransactionHistory: devtools.clearTransactionHistory,
    onTransactionStart: devtools.onTransactionStart,
    onTransactionEnd: devtools.onTransactionEnd,
    cleanup: devtools.cleanup,
    garbageCollect: devtools.garbageCollect,
  } as DbDevtoolsRegistry
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

  const devtools = (window as any).__TANSTACK_DB_DEVTOOLS__
  if (devtools?.updateTransactions) {
    devtools.updateTransactions(collection.id)
  }
}

/**
 * Clean up the devtools registry and all references.
 * This is useful for testing or when you want to completely reset the devtools state.
 */
export function cleanupDevtools(): void {
  if (typeof window === `undefined`) return

  const devtools = (window as any).__TANSTACK_DB_DEVTOOLS__
  if (devtools?.cleanup) {
    devtools.cleanup()
    delete (window as any).__TANSTACK_DB_DEVTOOLS__
  }
}
