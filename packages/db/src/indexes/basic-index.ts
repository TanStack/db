import { defaultComparator, normalizeValue } from '../utils/comparison.js'
import {
  findInsertPositionInArray,
  deleteInSortedArray,
} from '../utils/array-utils.js'
import { BaseIndex } from './base-index.js'
import type { CompareOptions } from '../query/builder/types.js'
import type { BasicExpression } from '../query/ir.js'
import type { IndexOperation } from './base-index.js'

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
 * Options for Basic index
 */
export interface BasicIndexOptions {
  compareFn?: (a: any, b: any) => number
  compareOptions?: CompareOptions
}

/**
 * Basic index using Map + sorted Array.
 *
 * - Map for O(1) equality lookups
 * - Sorted Array for O(log n) range queries via binary search
 * - O(n) updates to maintain sort order
 *
 * Simpler and smaller than BTreeIndex, good for read-heavy workloads.
 * Use BTreeIndex for write-heavy workloads with large collections.
 */
export class BasicIndex<
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

  // Map for O(1) equality lookups: indexedValue -> Set of PKs
  private valueMap = new Map<any, Set<TKey>>()
  // Sorted array of unique indexed values for range queries
  private sortedValues: Array<any> = []
  // Set of all indexed PKs
  private indexedKeys = new Set<TKey>()
  // Comparator function
  private compareFn: (a: any, b: any) => number = defaultComparator

  constructor(
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: any,
  ) {
    super(id, expression, name, options)
    this.compareFn = options?.compareFn ?? defaultComparator
    if (options?.compareOptions) {
      this.compareOptions = options!.compareOptions
    }
  }

  protected initialize(_options?: BasicIndexOptions): void {}

  /**
   * Adds a value to the index
   */
  add(key: TKey, item: any): void {
    let indexedValue: any
    try {
      indexedValue = this.evaluateIndexExpression(item)
    } catch (error) {
      throw new Error(
        `Failed to evaluate index expression for key ${key}: ${error}`,
      )
    }

    const normalizedValue = normalizeValue(indexedValue)

    if (this.valueMap.has(normalizedValue)) {
      // Value already exists, just add the key to the set
      this.valueMap.get(normalizedValue)!.add(key)
    } else {
      // New value - add to map and insert into sorted array
      this.valueMap.set(normalizedValue, new Set([key]))

      // Insert into sorted position
      const insertIdx = findInsertPositionInArray(
        this.sortedValues,
        normalizedValue,
        this.compareFn,
      )
      this.sortedValues.splice(insertIdx, 0, normalizedValue)
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
        error,
      )
      return
    }

    const normalizedValue = normalizeValue(indexedValue)

    if (this.valueMap.has(normalizedValue)) {
      const keySet = this.valueMap.get(normalizedValue)!
      keySet.delete(key)

      if (keySet.size === 0) {
        // No more keys for this value, remove from map and sorted array
        this.valueMap.delete(normalizedValue)
        deleteInSortedArray(this.sortedValues, normalizedValue, this.compareFn)
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

    // Collect all entries first
    const entriesArray: Array<{ key: TKey; value: any }> = []
    for (const [key, item] of entries) {
      let indexedValue: any
      try {
        indexedValue = this.evaluateIndexExpression(item)
      } catch (error) {
        throw new Error(
          `Failed to evaluate index expression for key ${key}: ${error}`,
        )
      }
      entriesArray.push({ key, value: normalizeValue(indexedValue) })
      this.indexedKeys.add(key)
    }

    // Group by value
    for (const { key, value } of entriesArray) {
      if (this.valueMap.has(value)) {
        this.valueMap.get(value)!.add(key)
      } else {
        this.valueMap.set(value, new Set([key]))
      }
    }

    // Build sorted array from unique values
    this.sortedValues = Array.from(this.valueMap.keys()).sort(this.compareFn)

    this.updateTimestamp()
  }

  /**
   * Clears all data from the index
   */
  clear(): void {
    this.valueMap.clear()
    this.sortedValues = []
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
        throw new Error(`Operation ${operation} not supported by BasicIndex`)
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

  /**
   * Performs an equality lookup - O(1)
   */
  equalityLookup(value: any): Set<TKey> {
    const normalizedValue = normalizeValue(value)
    return new Set(this.valueMap.get(normalizedValue) ?? [])
  }

  /**
   * Performs a range query using binary search - O(log n + m)
   */
  rangeQuery(options: RangeQueryOptions = {}): Set<TKey> {
    const { from, to, fromInclusive = true, toInclusive = true } = options
    const result = new Set<TKey>()

    if (this.sortedValues.length === 0) {
      return result
    }

    const normalizedFrom = normalizeValue(from)
    const normalizedTo = normalizeValue(to)

    // Find start index
    let startIdx = 0
    if (normalizedFrom !== undefined) {
      startIdx = findInsertPositionInArray(
        this.sortedValues,
        normalizedFrom,
        this.compareFn,
      )
      // If not inclusive and we found exact match, skip it
      if (
        !fromInclusive &&
        startIdx < this.sortedValues.length &&
        this.compareFn(this.sortedValues[startIdx], normalizedFrom) === 0
      ) {
        startIdx++
      }
    }

    // Find end index
    let endIdx = this.sortedValues.length
    if (normalizedTo !== undefined) {
      endIdx = findInsertPositionInArray(
        this.sortedValues,
        normalizedTo,
        this.compareFn,
      )
      // If inclusive and we found the value, include it
      if (
        toInclusive &&
        endIdx < this.sortedValues.length &&
        this.compareFn(this.sortedValues[endIdx], normalizedTo) === 0
      ) {
        endIdx++
      }
    }

    // Collect all keys in range
    for (let i = startIdx; i < endIdx; i++) {
      const keys = this.valueMap.get(this.sortedValues[i])
      if (keys) {
        keys.forEach((key) => result.add(key))
      }
    }

    return result
  }

  /**
   * Performs a reversed range query
   */
  rangeQueryReversed(options: RangeQueryOptions = {}): Set<TKey> {
    // For BasicIndex, reversed is the same result set, just different iteration order
    // which doesn't matter for Set
    return this.rangeQuery(options)
  }

  /**
   * Returns the next n items in sorted order
   */
  take(n: number, from?: any, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const result: Array<TKey> = []

    let startIdx = 0
    if (from !== undefined) {
      const normalizedFrom = normalizeValue(from)
      startIdx = findInsertPositionInArray(
        this.sortedValues,
        normalizedFrom,
        this.compareFn,
      )
      // Skip past the 'from' value (exclusive)
      while (
        startIdx < this.sortedValues.length &&
        this.compareFn(this.sortedValues[startIdx], normalizedFrom) <= 0
      ) {
        startIdx++
      }
    }

    for (
      let i = startIdx;
      i < this.sortedValues.length && result.length < n;
      i++
    ) {
      const keys = this.valueMap.get(this.sortedValues[i])
      if (keys) {
        for (const key of keys) {
          if (result.length >= n) break
          if (!filterFn || filterFn(key)) {
            result.push(key)
          }
        }
      }
    }

    return result
  }

  /**
   * Returns the next n items in reverse sorted order
   */
  takeReversed(
    n: number,
    from?: any,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    const result: Array<TKey> = []

    let startIdx = this.sortedValues.length - 1
    if (from !== undefined) {
      const normalizedFrom = normalizeValue(from)
      startIdx =
        findInsertPositionInArray(
          this.sortedValues,
          normalizedFrom,
          this.compareFn,
        ) - 1
      // Skip past the 'from' value (exclusive)
      while (
        startIdx >= 0 &&
        this.compareFn(this.sortedValues[startIdx], normalizedFrom) >= 0
      ) {
        startIdx--
      }
    }

    for (let i = startIdx; i >= 0 && result.length < n; i--) {
      const keys = this.valueMap.get(this.sortedValues[i])
      if (keys) {
        for (const key of keys) {
          if (result.length >= n) break
          if (!filterFn || filterFn(key)) {
            result.push(key)
          }
        }
      }
    }

    return result
  }

  /**
   * Performs an IN array lookup - O(k) where k is values.length
   */
  inArrayLookup(values: Array<any>): Set<TKey> {
    const result = new Set<TKey>()

    for (const value of values) {
      const normalizedValue = normalizeValue(value)
      const keys = this.valueMap.get(normalizedValue)
      if (keys) {
        keys.forEach((key) => result.add(key))
      }
    }

    return result
  }

  // Getter methods for testing/compatibility
  get indexedKeysSet(): Set<TKey> {
    return this.indexedKeys
  }

  get orderedEntriesArray(): Array<[any, Set<TKey>]> {
    return this.sortedValues.map((value) => [
      value,
      this.valueMap.get(value) ?? new Set(),
    ])
  }

  get orderedEntriesArrayReversed(): Array<[any, Set<TKey>]> {
    const result: Array<[any, Set<TKey>]> = []
    for (let i = this.sortedValues.length - 1; i >= 0; i--) {
      const value = this.sortedValues[i]
      result.push([value, this.valueMap.get(value) ?? new Set()])
    }
    return result
  }

  get valueMapData(): Map<any, Set<TKey>> {
    return this.valueMap
  }
}
