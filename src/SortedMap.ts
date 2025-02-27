/**
 * A Map implementation that keeps its entries sorted based on a comparator function
 * @template K - The type of keys in the map
 * @template V - The type of values in the map
 */
export class SortedMap<K, V> {
  private map: Map<K, V>
  private sortedKeys: K[]
  private comparator: (a: V, b: V) => number

  /**
   * Creates a new SortedMap instance
   *
   * @param comparator - Optional function to compare values for sorting
   */
  constructor(comparator?: (a: V, b: V) => number) {
    this.map = new Map<K, V>()
    this.sortedKeys = []
    this.comparator = comparator || this.defaultComparator
  }

  /**
   * Default comparator function used when none is provided
   *
   * @param a - First value to compare
   * @param b - Second value to compare
   * @returns -1 if a < b, 1 if a > b, 0 if equal
   */
  private defaultComparator(a: V, b: V): number {
    if (a < b) return -1
    if (a > b) return 1
    return 0
  }

  /**
   * Sets a key-value pair in the map and maintains sort order
   *
   * @param key - The key to set
   * @param value - The value to associate with the key
   * @returns This SortedMap instance for chaining
   */
  set(key: K, value: V): this {
    this.map.set(key, value)

    if (!this.sortedKeys.includes(key)) {
      this.sortedKeys.push(key)
    }

    // Re-sort keys based on values
    this.sortedKeys.sort((a, b) => {
      const valueA = this.map.get(a)!
      const valueB = this.map.get(b)!
      return this.comparator(valueA, valueB)
    })

    return this
  }

  /**
   * Gets a value by its key
   *
   * @param key - The key to look up
   * @returns The value associated with the key, or undefined if not found
   */
  get(key: K): V | undefined {
    return this.map.get(key)
  }

  /**
   * Removes a key-value pair from the map
   *
   * @param key - The key to remove
   * @returns True if the key was found and removed, false otherwise
   */
  delete(key: K): boolean {
    if (this.map.delete(key)) {
      const index = this.sortedKeys.indexOf(key)
      this.sortedKeys.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Checks if a key exists in the map
   *
   * @param key - The key to check
   * @returns True if the key exists, false otherwise
   */
  has(key: K): boolean {
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
  *[Symbol.iterator](): Iterator<[K, V]> {
    for (const key of this.sortedKeys) {
      yield [key, this.map.get(key)!]
    }
  }

  /**
   * Returns an iterator for the map's entries in sorted order
   *
   * @returns An iterator for the map's entries
   */
  entries(): IterableIterator<[K, V]> {
    return this[Symbol.iterator]()
  }

  /**
   * Returns an iterator for the map's keys in sorted order
   *
   * @returns An iterator for the map's keys
   */
  keys(): IterableIterator<K> {
    return this.sortedKeys[Symbol.iterator]()
  }

  /**
   * Returns an iterator for the map's values in sorted order
   *
   * @returns An iterator for the map's values
   */
  values(): IterableIterator<V> {
    return function* (this: SortedMap<K, V>) {
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
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void {
    for (const key of this.sortedKeys) {
      callbackfn(this.map.get(key)!, key, this.map)
    }
  }
}
