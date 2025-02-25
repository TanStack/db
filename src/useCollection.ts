import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector.js"
import type { SyncConfig, MutationFn, Transaction } from "./types"
import { Collection } from "./collection"
import { Store } from "@tanstack/store"

interface UseCollectionConfig {
  id: string
  sync: SyncConfig
  mutationFn: MutationFn
}

// Store collections in memory using Tanstack store
const collectionsStore = new Store(new Map<string, Collection>())

// Cache for snapshots to prevent infinite loops
let snapshotCache: Map<
  string,
  { state: Map<unknown, unknown>; transactions: Transaction[] }
> | null = null

export function useCollections() {
  return useSyncExternalStoreWithSelector(
    (callback) => {
      // Subscribe to the collections store for new collections
      const storeUnsubscribe = collectionsStore.subscribe(() => {
        snapshotCache = null // Invalidate cache when collections change
        callback()
      })

      // Subscribe to all collections' derived states and transactions
      const collectionUnsubscribes = Array.from(
        collectionsStore.state.values()
      ).map((collection) => {
        const derivedStateUnsub = collection.derivedState.subscribe(() => {
          snapshotCache = null // Invalidate cache when state changes
          callback()
        })
        const transactionsUnsub =
          collection.transactionManager.transactions.subscribe(() => {
            snapshotCache = null // Invalidate cache when transactions change
            callback()
          })
        return () => {
          derivedStateUnsub()
          transactionsUnsub()
        }
      })

      return () => {
        storeUnsubscribe()
        collectionUnsubscribes.forEach((unsubscribe) => unsubscribe())
      }
    },
    // Get snapshot of all collections and their transactions
    () => {
      if (snapshotCache) {
        return snapshotCache
      }

      const snapshot = new Map<
        string,
        { state: Map<unknown, unknown>; transactions: Transaction[] }
      >()
      for (const [id, collection] of collectionsStore.state) {
        snapshot.set(id, {
          state: collection.derivedState.state,
          transactions: collection.transactionManager.transactions.state,
        })
      }
      snapshotCache = snapshot
      return snapshot
    },
    // Server snapshot (same as client for now)
    () => {
      if (snapshotCache) {
        return snapshotCache
      }

      const snapshot = new Map<
        string,
        { state: Map<unknown, unknown>; transactions: Transaction[] }
      >()
      for (const [id, collection] of collectionsStore.state) {
        snapshot.set(id, {
          state: collection.derivedState.state,
          transactions: collection.transactionManager.transactions.state,
        })
      }
      snapshotCache = snapshot
      return snapshot
    },
    // Identity selector
    (state) => state,
    // Custom equality function for Maps
    (a, b) => {
      if (a === b) return true
      if (!(a instanceof Map) || !(b instanceof Map)) return false
      if (a.size !== b.size) return false
      for (const [key, value] of a) {
        const bValue = b.get(key)
        if (!b.has(key)) return false
        if (value instanceof Map) {
          if (!(bValue instanceof Map)) return false
          if (!shallow(value, bValue)) return false
        } else if (!Object.is(value, bValue)) {
          return false
        }
      }
      return true
    }
  )
}

export function useCollection(
  config: UseCollectionConfig,
  selector = (d) => d as unknown
) {
  // Get or create collection instance
  if (!collectionsStore.state.has(config.id)) {
    collectionsStore.setState((prev) => {
      const next = new Map(prev)
      next.set(
        config.id,
        new Collection({
          sync: config.sync,
          mutationFn: config.mutationFn,
        })
      )
      return next
    })
  }
  const collection = collectionsStore.state.get(config.id)!

  // Subscribe to collection's derivedState
  const data = useSyncExternalStoreWithSelector(
    collection.derivedState.subscribe,
    () => collection.derivedState.state,
    () => collection.derivedState.state,
    selector,
    shallow
  )

  return {
    data,
    update: collection.update.bind(collection),
    insert: collection.insert.bind(collection),
    delete: collection.delete.bind(collection),
  }
}

export function shallow<T>(objA: T, objB: T) {
  if (Object.is(objA, objB)) {
    return true
  }

  if (
    typeof objA !== `object` ||
    objA === null ||
    typeof objB !== `object` ||
    objB === null
  ) {
    return false
  }

  if (objA instanceof Map && objB instanceof Map) {
    if (objA.size !== objB.size) return false
    for (const [k, v] of objA) {
      if (!objB.has(k) || !Object.is(v, objB.get(k))) return false
    }
    return true
  }

  if (objA instanceof Set && objB instanceof Set) {
    if (objA.size !== objB.size) return false
    for (const v of objA) {
      if (!objB.has(v)) return false
    }
    return true
  }

  const keysA = Object.keys(objA)
  if (keysA.length !== Object.keys(objB).length) {
    return false
  }

  for (let i = 0; i < keysA.length; i++) {
    if (
      !Object.prototype.hasOwnProperty.call(objB, keysA[i] as string) ||
      !Object.is(objA[keysA[i] as keyof T], objB[keysA[i] as keyof T])
    ) {
      return false
    }
  }
  return true
}
