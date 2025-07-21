import { ascComparator } from "../utils/comparison.js"
import { findInsertPosition } from "../utils/array-utils.js"
import { BaseIndex } from "./base-index.js"
import type { IndexOperation } from "./base-index.js"

/**
 * Options for Ordered index
 */
export interface OrderedIndexOptions {
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
 * Ordered index for sorted data with range queries
 * This maintains items in sorted order and provides efficient range operations
 */
export class OrderedIndex<
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
  private orderedEntries: Array<[any, Set<TKey>]> = []
  private valueMap = new Map<any, Set<TKey>>()
  private indexedKeys = new Set<TKey>()
  private compareFn: (a: any, b: any) => number = ascComparator

  protected initialize(options?: OrderedIndexOptions): void {
    this.compareFn = options?.compareFn ?? ascComparator
  }

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

    // Check if this value already exists
    if (this.valueMap.has(indexedValue)) {
      // Add to existing set
      this.valueMap.get(indexedValue)!.add(key)
    } else {
      // Create new set for this value
      const keySet = new Set<TKey>([key])
      this.valueMap.set(indexedValue, keySet)

      // Find correct position in ordered entries using binary search
      const insertIndex = findInsertPosition(
        this.orderedEntries,
        indexedValue,
        this.compareFn
      )
      this.orderedEntries.splice(insertIndex, 0, [indexedValue, keySet])
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

    if (this.valueMap.has(indexedValue)) {
      const keySet = this.valueMap.get(indexedValue)!
      keySet.delete(key)

      // If set is now empty, remove the entry entirely
      if (keySet.size === 0) {
        this.valueMap.delete(indexedValue)

        // Find and remove from ordered entries
        const index = this.orderedEntries.findIndex(
          ([value]) => this.compareFn(value, indexedValue) === 0
        )
        if (index !== -1) {
          this.orderedEntries.splice(index, 1)
        }
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
    this.orderedEntries = []
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
        throw new Error(`Operation ${operation} not supported by OrderedIndex`)
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
    return new Set(this.valueMap.get(value) ?? [])
  }

  /**
   * Performs a range query with options
   * This is more efficient for compound queries like "WHERE a > 5 AND a < 10"
   */
  rangeQuery(options: RangeQueryOptions = {}): Set<TKey> {
    const { from, to, fromInclusive = true, toInclusive = true } = options
    const result = new Set<TKey>()

    if (this.orderedEntries.length === 0) {
      return result
    }

    // Find start position
    let startIndex = 0
    if (from !== undefined) {
      const fromInsertIndex = findInsertPosition(
        this.orderedEntries,
        from,
        this.compareFn
      )

      if (fromInclusive) {
        // Include values equal to 'from'
        startIndex = fromInsertIndex
      } else {
        // Exclude values equal to 'from'
        startIndex = fromInsertIndex
        // Skip the value if it exists at this position
        if (
          startIndex < this.orderedEntries.length &&
          this.compareFn(this.orderedEntries[startIndex]![0], from) === 0
        ) {
          startIndex++
        }
      }
    }

    // Find end position
    let endIndex = this.orderedEntries.length
    if (to !== undefined) {
      const toInsertIndex = findInsertPosition(
        this.orderedEntries,
        to,
        this.compareFn
      )

      if (toInclusive) {
        // Include values equal to 'to'
        endIndex = toInsertIndex
        // Include the value if it exists at this position
        if (
          toInsertIndex < this.orderedEntries.length &&
          this.compareFn(this.orderedEntries[toInsertIndex]![0], to) === 0
        ) {
          endIndex = toInsertIndex + 1
        }
      } else {
        // Exclude values equal to 'to'
        endIndex = toInsertIndex
      }
    }

    // Ensure startIndex doesn't exceed endIndex
    if (startIndex >= endIndex) {
      return result
    }

    // Collect keys from the range
    for (let i = startIndex; i < endIndex; i++) {
      const keys = this.orderedEntries[i]![1]
      keys.forEach((key) => result.add(key))
    }

    return result
  }

  /**
   * Performs an IN array lookup
   */
  inArrayLookup(values: Array<any>): Set<TKey> {
    const result = new Set<TKey>()

    for (const value of values) {
      const keys = this.valueMap.get(value)
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
  }

  get valueMapData(): Map<any, Set<TKey>> {
    return this.valueMap
  }
}
