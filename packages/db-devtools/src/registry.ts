import { createSignal } from "solid-js"
import { initializeDevtoolsStore } from "./devtools-store"
import { getDevtools } from "./global-types"
import type {
  CollectionMetadata,
  DbDevtoolsRegistry,
  TransactionDetails,
} from "./types"

class DbDevtoolsRegistryImpl implements DbDevtoolsRegistry {
  public store = initializeDevtoolsStore()

  // SolidJS signals for reactive updates (kept for backward compatibility)
  private _collectionsSignal = createSignal<Array<CollectionMetadata>>([])
  private _transactionsSignal = createSignal<Array<TransactionDetails>>([])

  // Expose collections map for backward compatibility
  public get collections() {
    return new Map() // Empty map since we're using collections now
  }

  constructor() {}

  // Expose signals for reactive UI updates
  public get collectionsSignal() {
    return this._collectionsSignal[0]
  }

  public get transactionsSignal() {
    return this._transactionsSignal[0]
  }

  private triggerUpdate = () => {
    // Update collections signal with a fresh array reference
    const collectionsData = this.getAllCollectionMetadata()
    this._collectionsSignal[1]([...collectionsData])

    // Update transactions signal
    const transactionsData = this.getTransactions()
    this._transactionsSignal[1](transactionsData)
  }

  private triggerCollectionUpdate = (id: string) => {
    const updatedMetadata = this.getCollectionMetadata(id)
    if (!updatedMetadata) return
    const currentCollections = this._collectionsSignal[0]()
    const next = currentCollections.map((c) =>
      c.id === id ? updatedMetadata : c
    )
    this._collectionsSignal[1](next)
  }

  private triggerTransactionUpdate = (collectionId?: string) => {
    // Get updated transactions data
    const updatedTransactions = this.getTransactions(collectionId)
    this._transactionsSignal[1](updatedTransactions)
  }

  registerCollection = (collection: any): (() => void) | undefined => {
    const updateCallback = this.store.registerCollection(collection)

    // Set the update callback on the collection for future updates
    if (updateCallback && collection) {
      collection.__devtoolsUpdateCallback = updateCallback
    }

    // Trigger reactive update for immediate UI refresh
    this.triggerUpdate()

    // Return the update callback for the collection to use
    return updateCallback
  }

  unregisterCollection = (id: string): void => {
    this.store.unregisterCollection(id)

    // Trigger reactive update for immediate UI refresh
    this.triggerUpdate()
  }

  getCollectionMetadata = (id: string): CollectionMetadata | undefined => {
    const entry = this.store.collections.get(id)
    if (!entry) return undefined
    // Delegate to store snapshot logic to avoid mutating entry metadata here
    const all = this.store.getAllCollectionMetadata()
    return all.find((c) => c.id === id)
  }

  getAllCollectionMetadata = (): Array<CollectionMetadata> => {
    return this.store.getAllCollectionMetadata()
  }

  updateCollectionMetadata = (id: string): void => {
    this.store.updateCollection(id)

    // Use efficient update that only changes the specific collection
    this.triggerCollectionUpdate(id)

    // Also update transactions since they may have changed
    this.triggerTransactionUpdate(id)
  }

  updateTransactions = (collectionId?: string): void => {
    this.store.updateTransactions(collectionId)
    this.triggerTransactionUpdate(collectionId)
  }

  getCollection = (id: string): any => {
    return this.store.getCollection(id)
  }

  releaseCollection = (id: string): void => {
    this.store.releaseCollection(id)
  }

  getTransactions = (collectionId?: string): Array<TransactionDetails> => {
    const devtoolsTransactions = this.store.getTransactions(collectionId)

    // Convert DevtoolsTransactionEntry to TransactionDetails for backward compatibility
    return devtoolsTransactions.map((entry) => ({
      id: entry.id,
      collectionId: entry.collectionId,
      state: entry.state,
      mutations: entry.mutations,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      isPersisted: entry.isPersisted,
    }))
  }

  getTransaction = (id: string): TransactionDetails | undefined => {
    const entry = this.store.transactions.get(id)
    if (!entry) return undefined

    return {
      id: entry.id,
      collectionId: entry.collectionId,
      state: entry.state,
      mutations: entry.mutations,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      isPersisted: entry.isPersisted,
    }
  }

  cleanup = (): void => {
    this.store.cleanup()
  }

  garbageCollect = (): void => {
    this.store.garbageCollect()
  }
}

// Create and export the global registry
export function createDbDevtoolsRegistry(): DbDevtoolsRegistry {
  return new DbDevtoolsRegistryImpl()
}

// Initialize the global registry if not already present
export function initializeDevtoolsRegistry(): DbDevtoolsRegistry {
  // SSR safety check - return a no-op registry for server-side rendering
  if (typeof window === `undefined`) {
    // Create dummy signals that won't be used during SSR
    const dummySignal = () => []
    dummySignal.set = () => {}

    return {
      collections: new Map(),
      store: initializeDevtoolsStore(),
      collectionsSignal: dummySignal as any,
      transactionsSignal: dummySignal as any,
      registerCollection: () => undefined,
      unregisterCollection: () => {},
      getCollection: () => undefined,
      releaseCollection: () => {},
      getAllCollectionMetadata: () => [],
      getCollectionMetadata: () => undefined,
      updateCollectionMetadata: () => {},
      updateTransactions: () => {},
      getTransactions: () => [],
      getTransaction: () => undefined,
      getTransactionDetails: () => undefined,
      clearTransactionHistory: () => {},
      onTransactionStart: () => {},
      onTransactionEnd: () => {},
      cleanup: () => {},
      garbageCollect: () => {},
    } as DbDevtoolsRegistry
  }

  // Only create real signals on the client side
  if (!getDevtools()) {
    window.__TANSTACK_DB_DEVTOOLS__ = createDbDevtoolsRegistry() as any
  }
  return getDevtools() as unknown as DbDevtoolsRegistry
}
