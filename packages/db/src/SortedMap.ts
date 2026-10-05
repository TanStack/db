import { compareKeys } from '@tanstack/db-ivm'

/**
 * A Map implementation that keeps its entries sorted based on a comparator function
 * @template TKey - The type of keys in the map (must be string | number)
 * @template TValue - The type of values in the map
 */
export class SortedMap<TKey extends string | number, TValue> {
  private map: Map<TKey, TValue>
  private sortedKeys: Array<TKey>
  private comparator: ((a: TValue, b: TValue) => number) | undefined
  private orderDirty = false
  private runtimeKeyCount = 0

  /**
   * Creates a new SortedMap instance
   *
   * @param comparator - Optional function to compare values for sorting.
   *                     If not provided, entries are sorted by key only.
   */
  constructor(comparator?: (a: TValue, b: TValue) => number) {
    this.map = new Map<TKey, TValue>()
    this.sortedKeys = []
    this.comparator = comparator
  }

  /**
   * Finds the index where a key-value pair should be inserted to maintain sort order.
   * Uses binary search to find the correct position based on the value (if comparator provided),
   * with key-based tie-breaking for deterministic ordering when values compare as equal.
   * If no comparator is provided, sorts by key only.
   * Runs in O(log n) time.
   *
   * @param key - The key to find position for (used as tie-breaker or primary sort when no comparator)
   * @param value - The value to compare against (only used if comparator is provided)
   * @returns The index where the key should be inserted
   */
  private indexOf(key: TKey, value: TValue): number {
    let left = 0
    let right = this.sortedKeys.length

    // Fast path: no comparator means sort by key only
    if (!this.comparator) {
      while (left < right) {
        const mid = Math.floor((left + right) / 2)
        const midKey = this.sortedKeys[mid]!
        const keyComparison = compareKeys(key, midKey)
        if (keyComparison < 0) {
          right = mid
        } else if (keyComparison > 0) {
          left = mid + 1
        } else {
          return mid
        }
      }
      return left
    }

    // With comparator: sort by value first, then key as tie-breaker
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      const midKey = this.sortedKeys[mid]!
      const midValue = this.map.get(midKey)!
      const valueComparison = this.comparator(value, midValue)

      if (valueComparison < 0) {
        right = mid
      } else if (valueComparison > 0) {
        left = mid + 1
      } else {
        // Values are equal, use key as tie-breaker for deterministic ordering
        const keyComparison = compareKeys(key, midKey)
        if (keyComparison < 0) {
          right = mid
        } else if (keyComparison > 0) {
          left = mid + 1
        } else {
          // Same key (shouldn't happen during insert, but handle for lookups)
          return mid
        }
      }
    }

    return left
  }

  /** Restore the ordered view after a synchronous batch of deferred writes. */
  restoreOrder(): void {
    if (!this.orderDirty) return
    this.sortedKeys.length = 0
    for (const key of this.map.keys()) this.sortedKeys.push(key)
    this.sortedKeys.sort((left, right) => {
      const byValue =
        this.comparator?.(this.map.get(left)!, this.map.get(right)!) ?? 0
      return byValue || compareKeys(left, right)
    })
    this.orderDirty = false
  }

  /**
   * Sets a key-value pair in the map and maintains sort order
   *
   * @param key - The key to set
   * @param value - The value to associate with the key
   * @param deferOrder - Defer ordering until restoreOrder or the next ordered read
   * @returns This SortedMap instance for chaining
   */
  set(key: TKey, value: TValue, deferOrder = false): this {
    // Key order cannot change when an existing key gets a new value.
    if (!this.comparator && this.map.has(key)) {
      this.map.set(key, value)
      return this
    }
    // Grouped Collections can produce nullish keys at runtime. compareKeys
    // is not a total order there, so retain the existing binary-insert path.
    const runtimeKey = typeof key !== `string` && typeof key !== `number`
    if (deferOrder && this.runtimeKeyCount === 0 && !runtimeKey) {
      this.map.set(key, value)
      this.orderDirty = true
      return this
    }
    this.restoreOrder()
    const exists = this.map.has(key)
    if (exists) {
      // Need to remove the old key from the sorted keys array
      const oldValue = this.map.get(key)!
      const oldIndex = this.indexOf(key, oldValue)
      this.sortedKeys.splice(oldIndex, 1)
    }

    // Insert the new key at the correct position
    const index = this.indexOf(key, value)
    this.sortedKeys.splice(index, 0, key)

    this.map.set(key, value)
    if (runtimeKey && !exists) this.runtimeKeyCount++

    return this
  }

  /**
   * Gets a value by its key
   *
   * @param key - The key to look up
   * @returns The value associated with the key, or undefined if not found
   */
  get(key: TKey): TValue | undefined {
    return this.map.get(key)
  }

  /**
   * Removes a key-value pair from the map
   *
   * @param key - The key to remove
   * @param deferOrder - Defer ordering until restoreOrder or the next ordered read
   * @returns True if the key was found and removed, false otherwise
   */
  delete(key: TKey, deferOrder = false): boolean {
    if (deferOrder && this.runtimeKeyCount === 0) {
      const deleted = this.map.delete(key)
      this.orderDirty ||= deleted
      return deleted
    }
    this.restoreOrder()
    if (this.map.has(key)) {
      const oldValue = this.map.get(key)
      const index = this.indexOf(key, oldValue!)
      this.sortedKeys.splice(index, 1)
      const deleted = this.map.delete(key)
      if (deleted && typeof key !== `string` && typeof key !== `number`)
        this.runtimeKeyCount--
      return deleted
    }

    return false
  }

  /**
   * Checks if a key exists in the map
   *
   * @param key - The key to check
   * @returns True if the key exists, false otherwise
   */
  has(key: TKey): boolean {
    return this.map.has(key)
  }

  /**
   * Removes all key-value pairs from the map
   */
  clear(): void {
    this.map.clear()
    this.sortedKeys = []
    this.orderDirty = false
    this.runtimeKeyCount = 0
  }

  /**
   * Gets the number of key-value pairs in the map
   */
  get size(): number {
    return this.map.size
  }

  /**
   * Default iterator that returns entries in sorted order
   *
   * @returns An iterator for the map's entries
   */
  *[Symbol.iterator](): IterableIterator<[TKey, TValue]> {
    this.restoreOrder()
    for (const key of this.sortedKeys) {
      yield [key, this.map.get(key)!] as [TKey, TValue]
    }
  }

  /**
   * Returns an iterator for the map's entries in sorted order
   *
   * @returns An iterator for the map's entries
   */
  entries(): IterableIterator<[TKey, TValue]> {
    return this[Symbol.iterator]()
  }

  /**
   * Returns an iterator for the map's keys in sorted order
   *
   * @returns An iterator for the map's keys
   */
  keys(): IterableIterator<TKey> {
    this.restoreOrder()
    return this.sortedKeys[Symbol.iterator]()
  }

  /**
   * Returns an iterator for the map's values in sorted order
   *
   * @returns An iterator for the map's values
   */
  *values(): IterableIterator<TValue> {
    this.restoreOrder()
    for (const key of this.sortedKeys) {
      yield this.map.get(key)!
    }
  }

  /**
   * Executes a callback function for each key-value pair in the map in sorted order
   *
   * @param callbackfn - Function to execute for each entry
   */
  forEach(
    callbackfn: (value: TValue, key: TKey, map: Map<TKey, TValue>) => void,
  ): void {
    this.restoreOrder()
    for (const key of this.sortedKeys) {
      callbackfn(this.map.get(key)!, key, this.map)
    }
  }
}
