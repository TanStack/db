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
  /**
   * With a custom comparator, ordering is maintained lazily: writes are O(1)
   * (append + mark dirty) and `sortedKeys` is rebuilt from the map on the
   * next ordered read. Value comparators (e.g. fractional-index comparators
   * on live query collections) are much more expensive per probe than key
   * comparisons, and reads typically follow batches of writes.
   */
  private dirty = false

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
   * Rebuilds the sorted key order from the map when lazy writes have made it
   * stale. `sortedKeys` may contain deleted keys until this runs.
   */
  private ensureSorted(): void {
    if (!this.dirty) {
      return
    }
    const comparator = this.comparator!
    this.sortedKeys = [...this.map.keys()]
    this.sortedKeys.sort((a, b) => {
      const valueComparison = comparator(this.map.get(a)!, this.map.get(b)!)
      if (valueComparison !== 0) {
        return valueComparison
      }
      return compareKeys(a, b)
    })
    this.dirty = false
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

  /**
   * Sets a key-value pair in the map and maintains sort order
   *
   * @param key - The key to set
   * @param value - The value to associate with the key
   * @returns This SortedMap instance for chaining
   */
  set(key: TKey, value: TValue): this {
    if (this.comparator) {
      // Lazy ordering: append new keys, defer sorting to the next read
      if (!this.map.has(key)) {
        this.sortedKeys.push(key)
      }
      this.map.set(key, value)
      this.dirty = true
      return this
    }

    if (this.map.has(key)) {
      // Need to remove the old key from the sorted keys array
      const oldValue = this.map.get(key)!
      const oldIndex = this.indexOf(key, oldValue)
      this.sortedKeys.splice(oldIndex, 1)
    }

    // Insert the new key at the correct position
    const index = this.indexOf(key, value)
    this.sortedKeys.splice(index, 0, key)

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
   * @returns True if the key was found and removed, false otherwise
   */
  delete(key: TKey): boolean {
    if (this.comparator) {
      // Lazy ordering: leave the stale key in sortedKeys; the next ordered
      // read rebuilds from the map
      const had = this.map.delete(key)
      if (had) {
        this.dirty = true
      }
      return had
    }

    if (this.map.has(key)) {
      const oldValue = this.map.get(key)
      const index = this.indexOf(key, oldValue!)
      this.sortedKeys.splice(index, 1)
      return this.map.delete(key)
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
    this.ensureSorted()
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
    this.ensureSorted()
    return this.sortedKeys[Symbol.iterator]()
  }

  /**
   * Returns an iterator for the map's values in sorted order
   *
   * @returns An iterator for the map's values
   */
  values(): IterableIterator<TValue> {
    return function* (this: SortedMap<TKey, TValue>) {
      this.ensureSorted()
      for (const key of this.sortedKeys) {
        yield this.map.get(key)!
      }
    }.call(this)
  }

  /**
   * Executes a callback function for each key-value pair in the map in sorted order
   *
   * @param callbackfn - Function to execute for each entry
   */
  forEach(
    callbackfn: (value: TValue, key: TKey, map: Map<TKey, TValue>) => void,
  ): void {
    this.ensureSorted()
    for (const key of this.sortedKeys) {
      callbackfn(this.map.get(key)!, key, this.map)
    }
  }
}
