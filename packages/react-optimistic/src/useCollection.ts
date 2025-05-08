import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector.js"
import {
  Collection,
  collectionsStore,
  preloadCollection,
} from "@tanstack/optimistic"
import type {
  CollectionConfig,
  SortedMap,
  Transaction,
} from "@tanstack/optimistic"

export { preloadCollection }

// Cache for snapshots to prevent infinite loops
let snapshotCache: Map<
  string,
  { state: Map<unknown, unknown>; transactions: SortedMap<string, Transaction> }
> | null = null

/**
 * Hook that provides access to all collections
 *
 * @returns A Map of all collections with their states and transactions
 */
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

        return derivedStateUnsub
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
        {
          state: Map<unknown, unknown>
          transactions: SortedMap<string, Transaction>
        }
      >()
      for (const [id, collection] of collectionsStore.state) {
        snapshot.set(id, {
          state: collection.derivedState.state,
          transactions: collection.transactions.state,
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
        {
          state: Map<unknown, unknown>
          transactions: SortedMap<string, Transaction>
        }
      >()
      for (const [id, collection] of collectionsStore.state) {
        snapshot.set(id, {
          state: collection.derivedState.state,
          transactions: collection.transactions.state,
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

/**
 * Hook to use a specific collection with React
 *
 * @template T - Type of data in the collection
 * @template R - Return type of the selector function
 * @param config - Configuration for the collection
 * @param selector - TODO Optional selector function to transform the collection data
 * @returns Object containing collection data and CRUD operations
 */
// Overload for when selector is not provided

export function useCollection<T extends object>(
  config: CollectionConfig<T>
): {
  /**
   * The collection data as a Map with keys as identifiers
   */
  state: Map<string, T>
  /**
   * The collection data as an Array of data
   */
  data: Array<T>
  /**
   * Updates an existing item in the collection
   *
   * @param item - The item to update (must exist in collection)
   * @param configOrCallback - Update configuration or callback function
   * @param maybeCallback - Callback function if config was provided
   * @returns {Transaction} A Transaction object representing the update operation
   * @throws {SchemaValidationError} If the updated data fails schema validation
   * @throws {Error} If mutationFn is not provided in the collection config
   * @example
   * // Update a single item
   * update(todo, (draft) => { draft.completed = true })
   *
   * // Update multiple items
   * update([todo1, todo2], (drafts) => {
   *   drafts.forEach(draft => { draft.completed = true })
   * })
   *
   * // Update with metadata
   * update(todo, { metadata: { reason: "user update" } }, (draft) => { draft.text = "Updated text" })
   */
  update: Collection<T>[`update`]
  /**
   * Inserts a new item or items into the collection
   *
   * @param data - Single item or array of items to insert
   * @param config - Optional configuration including key(s) and metadata
   * @returns {Transaction} A Transaction object representing the insert operation
   * @throws {SchemaValidationError} If the data fails schema validation
   * @throws {Error} If more keys provided than items to insert
   * @throws {Error} If mutationFn is not provided in the collection config
   * @example
   * // Insert a single item
   * insert({ text: "Buy groceries", completed: false })
   *
   * // Insert multiple items
   * insert([
   *   { text: "Buy groceries", completed: false },
   *   { text: "Walk dog", completed: false }
   * ])
   *
   * // Insert with custom key
   * insert({ text: "Buy groceries" }, { key: "grocery-task" })
   */
  insert: Collection<T>[`insert`]
  /**
   * Deletes an item or items from the collection
   *
   * @param items - Item(s) to delete (must exist in collection) or their key(s)
   * @param config - Optional configuration including metadata
   * @returns {Transaction} A Transaction object representing the delete operation
   * @throws {Error} If mutationFn is not provided in the collection config
   * @example
   * // Delete a single item
   * delete(todo)
   *
   * // Delete multiple items
   * delete([todo1, todo2])
   *
   * // Delete with metadata
   * delete(todo, { metadata: { reason: "completed" } })
   */
  delete: Collection<T>[`delete`]
}

// Overload for when selector is provided
// eslint-disable-next-line
export function useCollection<T extends object, R>(
  config: CollectionConfig<T>,
  selector: (d: Map<string, T>) => R
): {
  /**
   * The collection data as a Map with keys as identifiers
   */
  state: Map<string, T>
  /**
   * The collection data as an Array of items
   */
  data: Array<T>
  /**
   * Updates an existing item in the collection
   *
   * @param item - The item to update (must exist in collection)
   * @param configOrCallback - Update configuration or callback function
   * @param maybeCallback - Callback function if config was provided
   * @returns {Transaction} A Transaction object representing the update operation
   * @throws {SchemaValidationError} If the updated data fails schema validation
   * @throws {Error} If mutationFn is not provided in the collection config
   * @example
   * // Update a single item
   * update(todo, (draft) => { draft.completed = true })
   *
   * // Update multiple items
   * update([todo1, todo2], (drafts) => {
   *   drafts.forEach(draft => { draft.completed = true })
   * })
   *
   * // Update with metadata
   * update(todo, { metadata: { reason: "user update" } }, (draft) => { draft.text = "Updated text" })
   */
  update: Collection<T>[`update`]
  /**
   * Inserts a new item or items into the collection
   *
   * @param data - Single item or array of items to insert
   * @param config - Optional configuration including key(s) and metadata
   * @returns {Transaction} A Transaction object representing the insert operation
   * @throws {SchemaValidationError} If the data fails schema validation
   * @throws {Error} If more keys provided than items to insert
   * @throws {Error} If mutationFn is not provided in the collection config
   * @example
   * // Insert a single item
   * insert({ text: "Buy groceries", completed: false })
   *
   * // Insert multiple items
   * insert([
   *   { text: "Buy groceries", completed: false },
   *   { text: "Walk dog", completed: false }
   * ])
   *
   * // Insert with custom key
   * insert({ text: "Buy groceries" }, { key: "grocery-task" })
   */
  insert: Collection<T>[`insert`]
  /**
   * Deletes an item or items from the collection
   *
   * @param items - Item(s) to delete (must exist in collection) or their key(s)
   * @param config - Optional configuration including metadata
   * @returns {Transaction} A Transaction object representing the delete operation
   * @throws {Error} If mutationFn is not provided in the collection config
   * @example
   * // Delete a single item
   * delete(todo)
   *
   * // Delete multiple items
   * delete([todo1, todo2])
   *
   * // Delete with metadata
   * delete(todo, { metadata: { reason: "completed" } })
   */
  delete: Collection<T>[`delete`]
}

// Implementation
// eslint-disable-next-line
export function useCollection<T extends object, R = any>(
  config: CollectionConfig<T>,
  selector?: (d: Map<string, T>) => R
) {
  if (selector) {
    console.log(`selector support not yet implemented`, selector)
  }
  // Get or create collection instance
  if (!collectionsStore.state.has(config.id)) {
    // If collection doesn't exist yet, create it
    // This will reuse any existing collection created by preloadCollection
    collectionsStore.setState((prev) => {
      const next = new Map(prev)
      next.set(
        config.id,
        new Collection<T>({
          id: config.id,
          sync: config.sync,
          schema: config.schema,
        })
      )
      return next
    })
  }

  const collection = collectionsStore.state.get(config.id)! as Collection<T>

  // Use a single subscription to get all the data we need
  const result = useSyncExternalStoreWithSelector<
    Map<string, T>,
    { state: Map<string, T>; data: Array<T> }
  >(
    collection.derivedState.subscribe,
    () => collection.derivedState.state,
    () => collection.derivedState.state,
    (stateMap) => {
      return {
        state: stateMap,
        // derivedState & derivedArray are recomputed at the same time.
        data: collection.derivedArray.state,
      }
    },
    (a, b) => {
      // Custom equality function that checks each property
      if (a === b) return true

      // Check if state maps are equal
      const stateEqual =
        a.state.size === b.state.size &&
        Array.from(a.state.keys()).every((key) =>
          shallow(a.state.get(key), b.state.get(key))
        )

      // Check if data arrays are equal
      const dataEqual =
        a.data.length === b.data.length &&
        a.data.every((datum, i) => shallow(datum, b.data[i]))

      return stateEqual && dataEqual
    }
  )

  const returnValue = {
    state: result.state,
    data: result.data,
    insert: collection.insert.bind(collection),
    update: collection.update.bind(collection),
    delete: collection.delete.bind(collection),
  }

  return returnValue
}

/**
 * Performs a shallow comparison between two objects
 * Used for equality checking in React hooks
 *
 * @template T - Type of objects to compare
 * @param objA - First object
 * @param objB - Second object
 * @returns True if objects are shallowly equal, false otherwise
 */
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

  for (const key of keysA) {
    if (
      !Object.prototype.hasOwnProperty.call(objB, key) ||
      !Object.is(objA[key as keyof T], objB[key as keyof T])
    ) {
      return false
    }
  }
  return true
}
