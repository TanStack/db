import { BTree } from "../utils/btree.js"
import { defaultComparator } from "../utils/comparison.js"
import { BaseIndex } from "./base-index.js"
import type { BasicExpression } from "../query/ir.js"
import type { IndexOperation } from "./base-index.js"

/**
 * Normalizes values for use as Map keys to ensure proper equality comparison
 * For Date objects, uses timestamp. For other objects, uses JSON serialization.
 */
function normalizeMapKey(value: any): any {
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === `object` && value !== null) {
    // For other objects, use JSON serialization as a fallback
    // This ensures objects with same content are treated as equal
    return JSON.stringify(value)
  }
  return value
}
/**
 * Options for Ordered index
 */
export interface BTreeIndexOptions {
  compareFn?: (a: any, b: any) => number
}

/**
 * Options for range queries
 */
export interface RangeQueryOptions {
  from?: any
  to?: any
  fromInclusive?: boolean
  toInclusive?: boolean
}

/**
 * B+Tree index for sorted data with range queries
 * This maintains items in sorted order and provides efficient range operations
 */
export class BTreeIndex<
  TKey extends string | number = string | number,
> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set<IndexOperation>([
    `eq`,
    `gt`,
    `gte`,
    `lt`,
    `lte`,
    `in`,
  ])

  // Internal data structures - private to hide implementation details
  // The `orderedEntries` B+ tree is used for efficient range queries
  // The `valueMap` is used for O(1) lookups of PKs by indexed value
  private orderedEntries: BTree<any, undefined> // we don't associate values with the keys of the B+ tree (the keys are indexed values)
  private valueMap = new Map<any, Set<TKey>>() // instead we store a mapping of indexed values to a set of PKs
  private indexedKeys = new Set<TKey>()
  private compareFn: (a: any, b: any) => number = defaultComparator

  constructor(
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: any
  ) {
    super(id, expression, name, options)
    this.compareFn = options?.compareFn ?? defaultComparator
    this.orderedEntries = new BTree(this.compareFn)
  }

  protected initialize(_options?: BTreeIndexOptions): void {}

  /**
   * Adds a value to the index
   */
  add(key: TKey, item: any): void {
    let indexedValue: any
    try {
      indexedValue = this.evaluateIndexExpression(item)
    } catch (error) {
      throw new Error(
        `Failed to evaluate index expression for key ${key}: ${error}`
      )
    }

    // Normalize the value for Map key usage
    const normalizedValue = normalizeMapKey(indexedValue)

    // Check if this value already exists
    if (this.valueMap.has(normalizedValue)) {
      // Add to existing set
      this.valueMap.get(normalizedValue)!.add(key)
    } else {
      // Create new set for this value
      const keySet = new Set<TKey>([key])
      this.valueMap.set(normalizedValue, keySet)
      this.orderedEntries.set(indexedValue, undefined)
    }

    this.indexedKeys.add(key)
    this.updateTimestamp()
  }

  /**
   * Removes a value from the index
   */
  remove(key: TKey, item: any): void {
    let indexedValue: any
    try {
      indexedValue = this.evaluateIndexExpression(item)
    } catch (error) {
      console.warn(
        `Failed to evaluate index expression for key ${key} during removal:`,
        error
      )
      return
    }

    // Normalize the value for Map key usage
    const normalizedValue = normalizeMapKey(indexedValue)

    if (this.valueMap.has(normalizedValue)) {
      const keySet = this.valueMap.get(normalizedValue)!
      keySet.delete(key)

      // If set is now empty, remove the entry entirely
      if (keySet.size === 0) {
        this.valueMap.delete(normalizedValue)

        // Remove from ordered entries
        this.orderedEntries.delete(indexedValue)
      }
    }

    this.indexedKeys.delete(key)
    this.updateTimestamp()
  }

  /**
   * Updates a value in the index
   */
  update(key: TKey, oldItem: any, newItem: any): void {
    this.remove(key, oldItem)
    this.add(key, newItem)
  }

  /**
   * Builds the index from a collection of entries
   */
  build(entries: Iterable<[TKey, any]>): void {
    this.clear()

    for (const [key, item] of entries) {
      this.add(key, item)
    }
  }

  /**
   * Clears all data from the index
   */
  clear(): void {
    this.orderedEntries.clear()
    this.valueMap.clear()
    this.indexedKeys.clear()
    this.updateTimestamp()
  }

  /**
   * Performs a lookup operation
   */
  lookup(operation: IndexOperation, value: any): Set<TKey> {
    const startTime = performance.now()

    let result: Set<TKey>

    switch (operation) {
      case `eq`:
        result = this.equalityLookup(value)
        break
      case `gt`:
        result = this.rangeQuery({ from: value, fromInclusive: false })
        break
      case `gte`:
        result = this.rangeQuery({ from: value, fromInclusive: true })
        break
      case `lt`:
        result = this.rangeQuery({ to: value, toInclusive: false })
        break
      case `lte`:
        result = this.rangeQuery({ to: value, toInclusive: true })
        break
      case `in`:
        result = this.inArrayLookup(value)
        break
      default:
        throw new Error(`Operation ${operation} not supported by BTreeIndex`)
    }

    this.trackLookup(startTime)
    return result
  }

  /**
   * Gets the number of indexed keys
   */
  get keyCount(): number {
    return this.indexedKeys.size
  }

  // Public methods for backward compatibility (used by tests)

  /**
   * Performs an equality lookup
   */
  equalityLookup(value: any): Set<TKey> {
    const normalizedValue = normalizeMapKey(value)
    return new Set(this.valueMap.get(normalizedValue) ?? [])
  }

  /**
   * Performs a range query with options
   * This is more efficient for compound queries like "WHERE a > 5 AND a < 10"
   */
  rangeQuery(options: RangeQueryOptions = {}): Set<TKey> {
    const { from, to, fromInclusive = true, toInclusive = true } = options
    const result = new Set<TKey>()

    const fromKey = from ?? this.orderedEntries.minKey()
    const toKey = to ?? this.orderedEntries.maxKey()

    this.orderedEntries.forRange(
      fromKey,
      toKey,
      toInclusive,
      (indexedValue, _) => {
        if (!fromInclusive && this.compareFn(indexedValue, from) === 0) {
          // the B+ tree `forRange` method does not support exclusive lower bounds
          // so we need to exclude it manually
          return
        }

        const keys = this.valueMap.get(indexedValue)
        if (keys) {
          keys.forEach((key) => result.add(key))
        }
      }
    )

    return result
  }

  /**
   * Returns the next n items after the provided item or the first n items if no from item is provided.
   * @param n - The number of items to return
   * @param from - The item to start from (exclusive). Starts from the smallest item (inclusive) if not provided.
   * @returns The next n items after the provided key. Returns the first n items if no from item is provided.
   */
  take(n: number, from?: any): Array<TKey> {
    const keysInResult: Set<TKey> = new Set()
    const result: Array<TKey> = []
    const nextKey = (k?: any) => this.orderedEntries.nextHigherKey(k)
    let key = from

    while ((key = nextKey(key)) && result.length < n) {
      const keys = this.valueMap.get(key)
      if (keys) {
        const it = keys.values()
        let ks: TKey | undefined
        while (result.length < n && (ks = it.next().value)) {
          if (!keysInResult.has(ks)) {
            result.push(ks)
            keysInResult.add(ks)
          }
        }
      }
    }

    return result
  }

  /**
   * Performs an IN array lookup
   */
  inArrayLookup(values: Array<any>): Set<TKey> {
    const result = new Set<TKey>()

    for (const value of values) {
      const normalizedValue = normalizeMapKey(value)
      const keys = this.valueMap.get(normalizedValue)
      if (keys) {
        keys.forEach((key) => result.add(key))
      }
    }

    return result
  }

  // Getter methods for testing compatibility
  get indexedKeysSet(): Set<TKey> {
    return this.indexedKeys
  }

  get orderedEntriesArray(): Array<[any, Set<TKey>]> {
    return this.orderedEntries
      .keysArray()
      .map((key) => [key, this.valueMap.get(key) ?? new Set()])
  }

  get valueMapData(): Map<any, Set<TKey>> {
    return this.valueMap
  }
}
