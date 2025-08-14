import { createCollection, localOnlyCollectionOptions } from "@tanstack/db"
import type { CollectionImpl } from "../../db/src/collection"
import type { Transaction } from "../../db/src/transactions"
import type { 
  DevtoolsCollectionEntry, 
  DevtoolsTransactionEntry, 
  DevtoolsStore,
  CollectionMetadata 
} from "./types"

// Collections collection - stores devtools collection entries
const devtoolsCollectionsCollection = createCollection(
  localOnlyCollectionOptions({
    id: '__devtools_collections',
    __devtoolsInternal: true, // Prevent self-registration
    getKey: (entry: DevtoolsCollectionEntry) => entry.id,
  })
)

// Transactions collection - stores devtools transaction entries
const devtoolsTransactionsCollection = createCollection(
  localOnlyCollectionOptions({
    id: '__devtools_transactions',
    __devtoolsInternal: true, // Prevent self-registration
    getKey: (entry: DevtoolsTransactionEntry) => entry.id,
  })
)

class DevtoolsStoreImpl implements DevtoolsStore {
  public collections = devtoolsCollectionsCollection as any
  public transactions = devtoolsTransactionsCollection as any

  registerCollection = (collection: CollectionImpl<any, any, any>): (() => void) | undefined => {
    // Check if collection is already registered
    const existingEntry = this.collections.get(collection.id)
    if (existingEntry) {
      // Collection already exists, just update the weak ref and return existing callback
      existingEntry.weakRef = new WeakRef(collection)
      return existingEntry.updateCallback
    }

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
    const updateCallback = () => {
      this.updateCollection(collection.id)
    }

    // Create a callback that updates only transactions for this collection
    const updateTransactionsCallback = () => {
      this.updateTransactions(collection.id)
    }

    const entry: DevtoolsCollectionEntry = {
      id: collection.id,
      weakRef: new WeakRef(collection),
      metadata,
      isActive: false,
      updateCallback,
      updateTransactionsCallback,
    }

    // Insert into collections collection
    this.collections.insert(entry)

    // Track performance for live queries
    if (this.isLiveQuery(collection)) {
      this.instrumentLiveQuery(collection, entry)
    }

    // Call the update callback immediately so devtools UI updates right away
    queueMicrotask(updateCallback)

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
  }

  registerTransaction = (transaction: Transaction<any>, collectionId: string): void => {
    // Check if transaction is already registered
    const existingEntry = this.transactions.get(transaction.id)
    if (existingEntry) {
      // Transaction already exists, just update the weak ref and state
      existingEntry.weakRef = new WeakRef(transaction)
      existingEntry.state = transaction.state
      existingEntry.isPersisted = transaction.state === `completed`
      existingEntry.updatedAt = new Date()
      return
    }

    const entry: DevtoolsTransactionEntry = {
      id: transaction.id,
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
      updatedAt: transaction.createdAt,
      isPersisted: transaction.state === `completed`,
      weakRef: new WeakRef(transaction),
    }

    // Insert into transactions collection
    this.transactions.insert(entry)
    console.debug(`[devtools] transaction inserted`, {
      id: entry.id,
      collectionId: entry.collectionId,
      state: entry.state,
      mutations: entry.mutations.length,
    })
    // Also bump the parent collection metadata to reflect transaction counts immediately
    const parent = this.collections.get(collectionId)
    if (parent) {
      this.updateCollection(collectionId)
    }
  }

  getCollection = (id: string): CollectionImpl<any, any, any> | undefined => {
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

  getAllCollectionMetadata = (): Array<CollectionMetadata> => {
    const results: Array<CollectionMetadata> = []

    for (const entry of this.collections.values()) {
      const collection = entry.weakRef.deref()
      if (collection) {
        // Compute fresh metadata snapshot without mutating stored entry in-place
        const snapshot: CollectionMetadata = {
          ...entry.metadata,
          status: collection.status,
          size: collection.size,
          hasTransactions: collection.transactions.size > 0,
          transactionCount: collection.transactions.size,
          lastUpdated: new Date(),
        }
        results.push(snapshot)
      } else {
        // Collection was garbage collected, report cleaned-up snapshot (do not mutate entry)
        const snapshot: CollectionMetadata = {
          ...entry.metadata,
          status: `cleaned-up`,
          lastUpdated: new Date(),
        }
        results.push(snapshot)
      }
    }

    return results
  }

  getTransactions = (collectionId?: string): Array<DevtoolsTransactionEntry> => {
    const transactions: Array<DevtoolsTransactionEntry> = []

    for (const entry of this.transactions.values()) {
      if (collectionId && entry.collectionId !== collectionId) continue

      // Update transaction state from weak ref if available
      const transaction = entry.weakRef.deref()
      if (transaction) {
        entry.state = transaction.state
        entry.isPersisted = transaction.state === `completed`
        entry.updatedAt = new Date()
      }

      transactions.push({ ...entry })
    }

    return transactions.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )
  }

  updateCollection = (id: string): void => {
    const entry = this.collections.get(id)
    if (!entry) return

    const collection = entry.weakRef.deref()
    if (collection) {
      // Build fresh metadata snapshot (avoid mutating stored entry to ensure change detection)
      const newMetadata: CollectionMetadata = {
        ...entry.metadata,
        status: collection.status,
        size: collection.size,
        hasTransactions: collection.transactions.size > 0,
        transactionCount: collection.transactions.size,
        lastUpdated: new Date(),
      }

      this.collections.update(id, (draft: any) => {
        draft.metadata = newMetadata
      })
    }
  }

  updateTransactions = (collectionId?: string): void => {
    // Update all transactions for the collection
    for (const entry of this.transactions.values()) {
      if (collectionId && entry.collectionId !== collectionId) continue

      const transaction = entry.weakRef.deref()
      if (transaction) {
        const newState = transaction.state
        const newPersisted = transaction.state === `completed`
        const newUpdatedAt = new Date()

        this.transactions.update(entry.id, (draft: any) => {
          draft.state = newState
          draft.isPersisted = newPersisted
          draft.updatedAt = newUpdatedAt
        })

        // Optional: when a transaction completes, ensure parent metadata updates
        if (newPersisted) {
          const parent = this.collections.get(entry.collectionId)
          if (parent) this.updateCollection(entry.collectionId)
        }
      }
    }
  }

  cleanup = (): void => {
    // Release all hard references
    for (const entry of this.collections.values()) {
      if (entry.isActive) {
        entry.hardRef = undefined
        entry.isActive = false
      }
    }
  }

  garbageCollect = (): void => {
    // Remove entries for collections that have been garbage collected
    const collectionsToRemove: string[] = []
    for (const entry of this.collections.values()) {
      const collection = entry.weakRef.deref()
      if (!collection) {
        collectionsToRemove.push(entry.id)
      }
    }

    // Remove dead collections
    for (const id of collectionsToRemove) {
      this.collections.delete(id)
    }

    // Remove entries for transactions that have been garbage collected
    const transactionsToRemove: string[] = []
    for (const entry of this.transactions.values()) {
      const transaction = entry.weakRef.deref()
      if (!transaction) {
        transactionsToRemove.push(entry.id)
      }
    }

    // Remove dead transactions
    for (const id of transactionsToRemove) {
      this.transactions.delete(id)
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
    entry: DevtoolsCollectionEntry
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

// Create and export the devtools store
export function createDevtoolsStore(): DevtoolsStore {
  return new DevtoolsStoreImpl() as any
}

// Initialize the global devtools store
export function initializeDevtoolsStore(): DevtoolsStore {
  // SSR safety check - return a no-op store for server-side rendering
  if (typeof window === `undefined`) {
    return {
      collections: {} as any,
      transactions: {} as any,
      registerCollection: () => undefined,
      unregisterCollection: () => {},
      registerTransaction: () => {},
      getCollection: () => undefined,
      releaseCollection: () => {},
      getAllCollectionMetadata: () => [],
      getTransactions: () => [],
      updateCollection: () => {},
      updateTransactions: () => {},
      cleanup: () => {},
      garbageCollect: () => {},
    } as DevtoolsStore
  }

  // Only create real store on the client side
  if (!(window as any).__TANSTACK_DB_DEVTOOLS_STORE__) {
    ;(window as any).__TANSTACK_DB_DEVTOOLS_STORE__ = createDevtoolsStore()
  }
  return (window as any).__TANSTACK_DB_DEVTOOLS_STORE__ as DevtoolsStore
}
