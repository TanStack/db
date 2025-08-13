import { createSignal } from "solid-js"
import type {
  CollectionMetadata,
  CollectionRegistryEntry,
  DbDevtoolsRegistry,
  TransactionDetails,
} from "./types"

class DbDevtoolsRegistryImpl implements DbDevtoolsRegistry {
  public collections = new Map<string, CollectionRegistryEntry>()

  // SolidJS signals for reactive updates
  private _collectionsSignal = createSignal<Array<CollectionMetadata>>([])
  private _transactionsSignal = createSignal<Array<TransactionDetails>>([])

  constructor() {
    // No polling needed; updates are now immediate via signals
  }

  // Expose signals for reactive UI updates
  public get collectionsSignal() {
    return this._collectionsSignal[0]
  }

  public get transactionsSignal() {
    return this._transactionsSignal[0]
  }

  private triggerUpdate = () => {
    // Update collections signal
    const collectionsData = this.getAllCollectionMetadata()
    this._collectionsSignal[1](collectionsData)

    // Update transactions signal
    const transactionsData = this.getTransactions()
    this._transactionsSignal[1](transactionsData)
  }

  private triggerCollectionUpdate = (id: string) => {
    // Get the current collections array
    const currentCollections = this._collectionsSignal[0]()

    // Find the index of the collection to update
    const index = currentCollections.findIndex((c) => c.id === id)

    if (index !== -1) {
      // Get updated metadata for this specific collection
      const updatedMetadata = this.getCollectionMetadata(id)
      if (updatedMetadata) {
        // Create a new array with the updated collection
        const newCollections = [...currentCollections]
        newCollections[index] = updatedMetadata
        this._collectionsSignal[1](newCollections)
      }
    }
  }

  private triggerTransactionUpdate = (collectionId?: string) => {
    // Get updated transactions data
    const updatedTransactions = this.getTransactions(collectionId)
    this._transactionsSignal[1](updatedTransactions)
  }

  registerCollection = (collection: any): (() => void) | undefined => {
    const metadata: CollectionMetadata = {
      id: collection.id,
      type: this.detectCollectionType(collection),
      status: collection.status,
      size: collection.size,
      hasTransactions: collection.transactions.size > 0,
      transactionCount: collection.transactions.size,
      createdAt: new Date(),
      lastUpdated: new Date(),
      gcTime: collection.config.gcTime,
      timings: this.isLiveQuery(collection)
        ? {
            totalIncrementalRuns: 0,
          }
        : undefined,
    }

    // Create a callback that updates metadata for this specific collection
    // This callback doesn't hold strong references to the collection
    const updateCallback = () => {
      this.updateCollectionMetadata(collection.id)
    }

    // Create a callback that updates only transactions for this collection
    const updateTransactionsCallback = () => {
      this.triggerTransactionUpdate(collection.id)
    }

    const entry: CollectionRegistryEntry = {
      weakRef: new WeakRef(collection),
      metadata,
      isActive: false,
      updateCallback,
      updateTransactionsCallback,
    }

    this.collections.set(collection.id, entry)

    // Track performance for live queries
    if (this.isLiveQuery(collection)) {
      this.instrumentLiveQuery(collection, entry)
    }

    // Call the update callback immediately so devtools UI updates right away
    updateCallback()

    // Trigger reactive update for immediate UI refresh
    this.triggerUpdate()

    // Return the update callback for the collection to use
    return updateCallback
  }

  unregisterCollection = (id: string): void => {
    const entry = this.collections.get(id)
    if (entry) {
      // Release any hard reference
      entry.hardRef = undefined
      entry.isActive = false
      this.collections.delete(id)
    }

    // Trigger reactive update for immediate UI refresh
    this.triggerUpdate()
  }

  getCollectionMetadata = (id: string): CollectionMetadata | undefined => {
    const entry = this.collections.get(id)
    if (!entry) return undefined

    // Try to get fresh data from the collection if it's still alive
    const collection = entry.weakRef.deref()
    if (collection) {
      // Update metadata with fresh data
      entry.metadata.status = collection.status
      entry.metadata.size = collection.size
      entry.metadata.hasTransactions = collection.transactions.size > 0
      entry.metadata.transactionCount = collection.transactions.size
      entry.metadata.lastUpdated = new Date()
    }

    return { ...entry.metadata }
  }

  getAllCollectionMetadata = (): Array<CollectionMetadata> => {
    const results: Array<CollectionMetadata> = []

    for (const [_id, entry] of this.collections) {
      const collection = entry.weakRef.deref()
      if (collection) {
        // Collection is still alive, update metadata
        entry.metadata.status = collection.status
        entry.metadata.size = collection.size
        entry.metadata.hasTransactions = collection.transactions.size > 0
        entry.metadata.transactionCount = collection.transactions.size
        entry.metadata.lastUpdated = new Date()
        results.push({ ...entry.metadata })
      } else {
        // Collection was garbage collected, mark it
        entry.metadata.status = `cleaned-up`
        entry.metadata.lastUpdated = new Date()
        results.push({ ...entry.metadata })
      }
    }

    return results
  }

  updateCollectionMetadata = (id: string): void => {
    const entry = this.collections.get(id)
    if (!entry) return

    const collection = entry.weakRef.deref()
    if (collection) {
      // Update metadata with fresh data from the collection
      entry.metadata.status = collection.status
      entry.metadata.size = collection.size
      entry.metadata.hasTransactions = collection.transactions.size > 0
      entry.metadata.transactionCount = collection.transactions.size
      entry.metadata.lastUpdated = new Date()
    }

    // Use efficient update that only changes the specific collection
    this.triggerCollectionUpdate(id)

    // Also update transactions since they may have changed
    this.triggerTransactionUpdate(id)
  }

  updateTransactions = (collectionId?: string): void => {
    this.triggerTransactionUpdate(collectionId)
  }

  getCollection = (id: string): any => {
    const entry = this.collections.get(id)
    if (!entry) return undefined

    const collection = entry.weakRef.deref()
    if (collection && !entry.isActive) {
      // Create hard reference
      entry.hardRef = collection
      entry.isActive = true
    }

    return collection
  }

  releaseCollection = (id: string): void => {
    const entry = this.collections.get(id)
    if (entry && entry.isActive) {
      // Release hard reference
      entry.hardRef = undefined
      entry.isActive = false
    }
  }

  getTransactions = (collectionId?: string): Array<TransactionDetails> => {
    const transactions: Array<TransactionDetails> = []

    for (const [_id, entry] of this.collections) {
      if (collectionId && _id !== collectionId) continue

      const collection = entry.weakRef.deref()
      if (!collection) continue

      for (const [txId, transaction] of collection.transactions) {
        transactions.push({
          id: txId,
          collectionId: _id,
          state: transaction.state,
          mutations: transaction.mutations.map((m: any) => ({
            id: m.mutationId,
            type: m.type,
            key: m.key,
            optimistic: m.optimistic,
            createdAt: m.createdAt,
            original: m.original,
            modified: m.modified,
            changes: m.changes,
          })),
          createdAt: transaction.createdAt,
          updatedAt: transaction.createdAt, // Transaction doesn't have updatedAt, using createdAt
          isPersisted: transaction.state === `completed`,
        })
      }
    }

    return transactions.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )
  }

  getTransaction = (id: string): TransactionDetails | undefined => {
    for (const [_collectionId, entry] of this.collections) {
      const collection = entry.weakRef.deref()
      if (!collection) continue

      const transaction = collection.transactions.get(id)
      if (transaction) {
        return {
          id,
          collectionId: _collectionId,
          state: transaction.state,
          mutations: transaction.mutations.map((m: any) => ({
            id: m.mutationId,
            type: m.type,
            key: m.key,
            optimistic: m.optimistic,
            createdAt: m.createdAt,
            original: m.original,
            modified: m.modified,
            changes: m.changes,
          })),
          createdAt: transaction.createdAt,
          updatedAt: transaction.createdAt, // Transaction doesn't have updatedAt, using createdAt
          isPersisted: transaction.state === `completed`,
        }
      }
    }
    return undefined
  }

  cleanup = (): void => {
    // Stop polling
    // No polling to stop

    // Release all hard references
    for (const [_id, entry] of this.collections) {
      if (entry.isActive) {
        entry.hardRef = undefined
        entry.isActive = false
      }
    }
  }

  garbageCollect = (): void => {
    // Remove entries for collections that have been garbage collected
    for (const [id, entry] of this.collections) {
      const collection = entry.weakRef.deref()
      if (!collection) {
        this.collections.delete(id)
      }
    }
  }

  private detectCollectionType = (collection: any): string => {
    // Check the new collection type marker first
    if (collection.config.collectionType) {
      return collection.config.collectionType
    }

    // Default to generic collection
    return `generic`
  }

  private isLiveQuery = (collection: any): boolean => {
    return this.detectCollectionType(collection) === `live-query`
  }

  private instrumentLiveQuery = (
    collection: any,
    entry: CollectionRegistryEntry
  ): void => {
    // This is where we would add performance tracking for live queries
    // We'll need to hook into the query execution pipeline to track timings
    // For now, this is a placeholder
    if (!entry.metadata.timings) {
      entry.metadata.timings = {
        totalIncrementalRuns: 0,
      }
    }
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
  if (!(window as any).__TANSTACK_DB_DEVTOOLS__) {
    ;(window as any).__TANSTACK_DB_DEVTOOLS__ = createDbDevtoolsRegistry()
  }
  return (window as any).__TANSTACK_DB_DEVTOOLS__ as DbDevtoolsRegistry
}
