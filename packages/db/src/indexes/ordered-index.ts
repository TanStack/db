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
      console.warn(`Failed to evaluate index expression for key ${key}:`, error)
      return
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
      case `gte`:
      case `lt`:
      case `lte`:
        result = this.rangeQuery(operation, value)
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
   * Performs a range query
   */
  rangeQuery(operation: `gt` | `gte` | `lt` | `lte`, value: any): Set<TKey> {
    const result = new Set<TKey>()

    // Use binary search to find the starting position
    const insertIndex = findInsertPosition(
      this.orderedEntries,
      value,
      this.compareFn
    )

    let startIndex = 0
    let endIndex = this.orderedEntries.length

    switch (operation) {
      case `lt`:
        endIndex = insertIndex
        break
      case `lte`:
        endIndex = insertIndex
        // Include the value if it exists
        if (
          insertIndex < this.orderedEntries.length &&
          this.compareFn(this.orderedEntries[insertIndex]![0], value) === 0
        ) {
          endIndex = insertIndex + 1
        }
        break
      case `gt`:
        startIndex = insertIndex
        // Skip the value if it exists
        if (
          insertIndex < this.orderedEntries.length &&
          this.compareFn(this.orderedEntries[insertIndex]![0], value) === 0
        ) {
          startIndex = insertIndex + 1
        }
        endIndex = this.orderedEntries.length
        break
      case `gte`:
        startIndex = insertIndex
        endIndex = this.orderedEntries.length
        break
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
