import { compareKeys } from '@tanstack/db-ivm'
import { BTree } from './utils/btree.js'

type SortKey<TKey extends string | number, TValue> = {
  key: TKey
  value: TValue
}

/**
 * A Map implementation that keeps its entries sorted based on a comparator function
 * @template TKey - The type of keys in the map (must be string | number)
 * @template TValue - The type of values in the map
 */
export class SortedMap<TKey extends string | number, TValue> {
  private map: Map<TKey, TValue>
  private sortedKeys: BTree<SortKey<TKey, TValue>, undefined>
  private comparator: ((a: TValue, b: TValue) => number) | undefined

  /**
   * Creates a new SortedMap instance
   *
   * @param comparator - Optional function to compare values for sorting.
   *                     If not provided, entries are sorted by key only.
   */
  constructor(comparator?: (a: TValue, b: TValue) => number) {
    this.map = new Map<TKey, TValue>()
    this.comparator = comparator
    this.sortedKeys = new BTree<SortKey<TKey, TValue>, undefined>(
      (left, right) => this.compareSortKeys(left, right),
    )
  }

  /**
   * Compares sort keys based on value first when a comparator is provided,
   * falling back to the collection key for deterministic tie-breaking.
   *
   * If no comparator is provided, entries are ordered by key only.
   */
  private compareSortKeys(
    left: SortKey<TKey, TValue>,
    right: SortKey<TKey, TValue>,
  ): number {
    if (!this.comparator) {
      return compareKeys(left.key, right.key)
    }

    const valueComparison = this.comparator(left.value, right.value)
    if (valueComparison !== 0) {
      return valueComparison
    }

    return compareKeys(left.key, right.key)
  }

  private createSortKey(key: TKey, value: TValue): SortKey<TKey, TValue> {
    return { key, value }
  }

  private *iterateSortKeys(): IterableIterator<SortKey<TKey, TValue>> {
    let previous: SortKey<TKey, TValue> | undefined

    for (;;) {
      const nextPair = this.sortedKeys.nextHigherPair(previous)
      if (!nextPair) {
        return
      }

      previous = nextPair[0]
      yield previous
    }
  }

  /**
   * Sets a key-value pair in the map and maintains sort order
   *
   * @param key - The key to set
   * @param value - The value to associate with the key
   * @returns This SortedMap instance for chaining
   */
  set(key: TKey, value: TValue): this {
    if (this.map.has(key)) {
      const oldValue = this.map.get(key)!
      this.sortedKeys.delete(this.createSortKey(key, oldValue))
    }

    this.sortedKeys.set(this.createSortKey(key, value), undefined)
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
    if (this.map.has(key)) {
      const oldValue = this.map.get(key)
      this.sortedKeys.delete(this.createSortKey(key, oldValue!))
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
    this.sortedKeys.clear()
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
    for (const sortKey of this.iterateSortKeys()) {
      yield [sortKey.key, this.map.get(sortKey.key)!] as [TKey, TValue]
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
    return function* (this: SortedMap<TKey, TValue>) {
      for (const sortKey of this.iterateSortKeys()) {
        yield sortKey.key
      }
    }.call(this)
  }

  /**
   * Returns an iterator for the map's values in sorted order
   *
   * @returns An iterator for the map's values
   */
  values(): IterableIterator<TValue> {
    return function* (this: SortedMap<TKey, TValue>) {
      for (const sortKey of this.iterateSortKeys()) {
        yield this.map.get(sortKey.key)!
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
    for (const sortKey of this.iterateSortKeys()) {
      callbackfn(this.map.get(sortKey.key)!, sortKey.key, this.map)
    }
  }
}
