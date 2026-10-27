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
  // Keys set or deleted with deferOrder since the last restoreOrder. A dirty
  // key can still hold a slot in sortedKeys that its old value ordered.
  private dirtyKeys = new Set<TKey>()

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
   * @param keys - The ordered keys to search
   * @returns The index where the key should be inserted
   */
  private indexOf(
    key: TKey,
    value: TValue,
    keys: Array<TKey> = this.sortedKeys,
  ): number {
    let left = 0
    let right = keys.length

    // Fast path: no comparator means sort by key only
    if (!this.comparator) {
      while (left < right) {
        const mid = Math.floor((left + right) / 2)
        const midKey = keys[mid]!
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
      const midKey = keys[mid]!
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

  /**
   * Restore the ordered view after a synchronous batch of deferred writes.
   * Dirty keys leave their old slots by Set membership, so a deleted value or
   * one a sync source mutated in place cannot strand a slot. The dirty keys
   * still present are sorted and merged into the rest in one pass:
   * O(n + k log n) for k dirty keys. The merge rewrites sortedKeys in place,
   * so an open key iterator reads the restored order.
   */
  restoreOrder(): void {
    if (this.dirtyKeys.size === 0) return
    const keys = this.sortedKeys
    const kept = keys.filter((key) => !this.dirtyKeys.has(key))
    const placed = [...this.dirtyKeys]
      .filter((key) => this.map.has(key))
      .sort(
        (left, right) =>
          (this.comparator?.(this.map.get(left)!, this.map.get(right)!) ?? 0) ||
          compareKeys(left, right),
      )
    keys.length = 0
    let next = 0
    for (const key of placed) {
      const index = this.indexOf(key, this.map.get(key)!, kept)
      while (next < index) keys.push(kept[next++]!)
      keys.push(key)
    }
    while (next < kept.length) keys.push(kept[next++]!)
    this.dirtyKeys.clear()
  }

  /** Removes a key's slot while its placed value is still mapped. */
  private unplace(key: TKey): void {
    // Binary search misses a value that a sync source mutated in place after
    // it was placed, so fall back to a scan.
    let index = this.indexOf(key, this.map.get(key)!)
    if (this.sortedKeys[index] !== key) index = this.sortedKeys.indexOf(key)
    this.sortedKeys.splice(index, 1)
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
    if (deferOrder) {
      this.map.set(key, value)
      this.dirtyKeys.add(key)
      return this
    }
    this.restoreOrder()
    // The old slot leaves before the search, since an in-place mutation can
    // misorder it.
    if (this.map.has(key)) this.unplace(key)
    this.sortedKeys.splice(this.indexOf(key, value), 0, key)
    this.map.set(key, value)
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
    if (deferOrder) {
      const deleted = this.map.delete(key)
      if (deleted) this.dirtyKeys.add(key)
      return deleted
    }
    this.restoreOrder()
    if (this.map.has(key)) this.unplace(key)
    return this.map.delete(key)
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
    this.dirtyKeys.clear()
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
    for (const key of this.keys()) yield [key, this.map.get(key)!]
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
    for (const key of this.keys()) yield this.map.get(key)!
  }
}
