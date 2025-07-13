import type {
  CollectionMetadata,
  CollectionRegistryEntry,
  DbDevtoolsRegistry,
  TransactionDetails,
} from "./types"

class DbDevtoolsRegistryImpl implements DbDevtoolsRegistry {
  public collections = new Map<string, CollectionRegistryEntry>()
  private pollingInterval: number | null = null
  private readonly POLLING_INTERVAL_MS = 1000 // Poll every second for metadata updates

  constructor() {
    // Start polling for metadata updates
    this.startPolling()
  }

  registerCollection = (collection: any): void => {
    console.log('Registry: Registering collection', {
      id: collection.id,
      type: this.detectCollectionType(collection),
      status: collection.status,
      size: collection.size,
      hasTransactions: collection.transactions.size > 0,
      registrySize: this.collections.size
    })

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

    const entry: CollectionRegistryEntry = {
      weakRef: new WeakRef(collection),
      metadata,
      isActive: false,
    }

    this.collections.set(collection.id, entry)
    
    console.log('Registry: Collection registered successfully', {
      id: collection.id,
      totalCollections: this.collections.size,
      allCollectionIds: Array.from(this.collections.keys())
    })

    // Track performance for live queries
    if (this.isLiveQuery(collection)) {
      this.instrumentLiveQuery(collection, entry)
    }
  }

  unregisterCollection = (id: string): void => {
    const entry = this.collections.get(id)
    if (entry) {
      // Release any hard reference
      entry.hardRef = undefined
      entry.isActive = false
      this.collections.delete(id)
    }
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
    console.log('Registry: getAllCollectionMetadata called, total collections:', this.collections.size)
    
    const results: Array<CollectionMetadata> = []

    for (const [id, entry] of this.collections) {
      const collection = entry.weakRef.deref()
      if (collection) {
        // Collection is still alive, update metadata
        entry.metadata.status = collection.status
        entry.metadata.size = collection.size
        entry.metadata.hasTransactions = collection.transactions.size > 0
        entry.metadata.transactionCount = collection.transactions.size
        entry.metadata.lastUpdated = new Date()
        results.push({ ...entry.metadata })
        console.log('Registry: Found live collection:', {
          id,
          status: collection.status,
          size: collection.size,
          type: entry.metadata.type
        })
      } else {
        // Collection was garbage collected, mark it
        entry.metadata.status = `cleaned-up`
        entry.metadata.lastUpdated = new Date()
        results.push({ ...entry.metadata })
        console.log('Registry: Found GC\'d collection:', id)
      }
    }

    console.log('Registry: Returning metadata for', results.length, 'collections')
    return results
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

    for (const [id, entry] of this.collections) {
      if (collectionId && id !== collectionId) continue

      const collection = entry.weakRef.deref()
      if (!collection) continue

      for (const [txId, transaction] of collection.transactions) {
        transactions.push({
          id: txId,
          collectionId: id,
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
    for (const [collectionId, entry] of this.collections) {
      const collection = entry.weakRef.deref()
      if (!collection) continue

      const transaction = collection.transactions.get(id)
      if (transaction) {
        return {
          id,
          collectionId,
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
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }

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

  private startPolling = (): void => {
    if (this.pollingInterval) return

    this.pollingInterval = window.setInterval(() => {
      // Garbage collect dead references
      this.garbageCollect()

      // Update metadata for active collections
      for (const [_id, entry] of this.collections) {
        if (!entry.isActive) continue // Only update metadata for inactive collections to avoid holding refs

        const collection = entry.weakRef.deref()
        if (collection) {
          entry.metadata.status = collection.status
          entry.metadata.size = collection.size
          entry.metadata.hasTransactions = collection.transactions.size > 0
          entry.metadata.transactionCount = collection.transactions.size
          entry.metadata.lastUpdated = new Date()
        }
      }
    }, this.POLLING_INTERVAL_MS)
  }

  private detectCollectionType = (
    collection: any
  ): `collection` | `live-query` => {
    // Check the devtools type marker first
    if (collection.config.__devtoolsType) {
      return collection.config.__devtoolsType
    }

    // Check if the collection ID suggests it's a live query
    if (collection.id.startsWith(`live-query-`)) {
      return `live-query`
    }

    // Default to regular collection
    return `collection`
  }

  private isLiveQuery = (
    collection: any
  ): boolean => {
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
  // SSR safety check
  if (typeof window === 'undefined') {
    // Return a no-op registry for server-side rendering
    return {
      collections: new Map(),
      registerCollection: () => {},
      unregisterCollection: () => {},
      getCollection: () => undefined,
      releaseCollection: () => {},
      getAllCollectionMetadata: () => [],
      getCollectionMetadata: () => undefined,
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
  
  if (!(window as any).__TANSTACK_DB_DEVTOOLS__) {
    (window as any).__TANSTACK_DB_DEVTOOLS__ = createDbDevtoolsRegistry()
  }
  return (window as any).__TANSTACK_DB_DEVTOOLS__ as DbDevtoolsRegistry
}


