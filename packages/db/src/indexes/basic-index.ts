import { compareKeys } from '@tanstack/db-ivm'
import {
  areSameValueZeroEqual,
  defaultComparator,
  makeComparator,
  normalizeValue,
} from '../utils/comparison.js'
import { findInsertPositionInArray } from '../utils/array-utils.js'
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
    if (options?.compareOptions) {
      this.compareOptions = options!.compareOptions
    }
    this.compareFn = options?.compareFn ?? makeComparator(this.compareOptions)
    this.hasCustomComparator = options?.compareFn != null
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
        { cause: error },
      )
    }

    const normalizedValue = normalizeValue(indexedValue)

    this.addToBucket(key, normalizedValue)
    this.addRangeValue(indexedValue)

    this.indexedKeys.add(key)
    this.updateTimestamp()
  }

  private addToBucket(key: TKey, normalizedValue: unknown): void {
    const keySet = this.valueMap.get(normalizedValue)
    if (keySet) {
      // Value already exists, just add the key to the set
      keySet.add(key)
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
      this.indexedKeys.delete(key)
      this.updateTimestamp()
      return
    }

    const normalizedValue = normalizeValue(indexedValue)

    this.removeFromBucket(key, normalizedValue)
    this.removeRangeValue(indexedValue)

    this.indexedKeys.delete(key)
    this.updateTimestamp()
  }

  private removeFromBucket(key: TKey, normalizedValue: unknown): void {
    const keySet = this.valueMap.get(normalizedValue)
    if (keySet) {
      keySet.delete(key)

      if (keySet.size === 0) {
        // No more keys for this value, remove from map and sorted array
        this.valueMap.delete(normalizedValue)
        let sortedIndex = findInsertPositionInArray(
          this.sortedValues,
          normalizedValue,
          this.compareFn,
        )
        // Distinct equality keys may share one comparator position.
        while (
          sortedIndex < this.sortedValues.length &&
          this.compareFn(this.sortedValues[sortedIndex], normalizedValue) === 0
        ) {
          if (
            areSameValueZeroEqual(
              this.sortedValues[sortedIndex],
              normalizedValue,
            )
          ) {
            this.sortedValues.splice(sortedIndex, 1)
            break
          }
          sortedIndex++
        }
      }
    }
  }

  /**
   * Updates a value in the index
   */
  update(key: TKey, oldItem: any, newItem: any): void {
    let oldIndexedValue: unknown
    let newIndexedValue: unknown
    try {
      oldIndexedValue = this.evaluateIndexExpression(oldItem)
      newIndexedValue = this.evaluateIndexExpression(newItem)
    } catch {
      this.remove(key, oldItem)
      this.add(key, newItem)
      return
    }

    const oldValue = normalizeValue(oldIndexedValue)
    const newValue = normalizeValue(newIndexedValue)
    if (
      areSameValueZeroEqual(oldValue, newValue) &&
      this.valueMap.get(newValue)?.has(key) &&
      this.indexedKeys.has(key)
    ) {
      this.removeRangeValue(oldIndexedValue)
      this.addRangeValue(newIndexedValue)
      return
    }

    this.removeFromBucket(key, oldValue)
    this.removeRangeValue(oldIndexedValue)
    this.addToBucket(key, newValue)
    this.addRangeValue(newIndexedValue)
    this.indexedKeys.add(key)
    this.updateTimestamp()
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
          { cause: error },
        )
      }
      entriesArray.push({ key, value: normalizeValue(indexedValue) })
      this.addRangeValue(indexedValue)
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
    this.clearRangeValues()
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
    return this.valueMap.get(normalizedValue) ?? new Set()
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
    const hasFrom = `from` in options
    const hasTo = `to` in options

    // Find start index
    let startIdx = 0
    if (hasFrom) {
      startIdx = findInsertPositionInArray(
        this.sortedValues,
        normalizedFrom,
        this.compareFn,
      )
      // Comparator-equal values form one range boundary even when they are
      // distinct equality keys.
      while (
        !fromInclusive &&
        startIdx < this.sortedValues.length &&
        this.compareFn(this.sortedValues[startIdx], normalizedFrom) === 0
      ) {
        startIdx++
      }
    }

    // Find end index
    let endIdx = this.sortedValues.length
    if (hasTo) {
      endIdx = findInsertPositionInArray(
        this.sortedValues,
        normalizedTo,
        this.compareFn,
      )
      // Include the whole comparator group at an inclusive upper boundary.
      while (
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
   * Returns the next n items in sorted order
   */
  take(n: number, from: any, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const normalizedFrom = normalizeValue(from)
    let startIdx = findInsertPositionInArray(
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

    return this.takeFromIndex(n, startIdx, 1, filterFn)
  }

  /**
   * Returns the next n items in reverse sorted order
   */
  takeReversed(
    n: number,
    from: any,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    const normalizedFrom = normalizeValue(from)
    let startIdx =
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

    return this.takeFromIndex(n, startIdx, -1, filterFn)
  }

  /**
   * Returns the first n items in sorted order (from the start)
   */
  takeFromStart(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    return this.takeFromIndex(n, 0, 1, filterFn)
  }

  /**
   * Returns the first n items in reverse sorted order (from the end)
   */
  takeReversedFromEnd(
    n: number,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    return this.takeFromIndex(n, this.sortedValues.length - 1, -1, filterFn)
  }

  private takeFromIndex(
    n: number,
    startIndex: number,
    step: 1 | -1,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    const result: Array<TKey> = []
    let index = startIndex
    while (
      index >= 0 &&
      index < this.sortedValues.length &&
      result.length < n
    ) {
      const groupValue = this.sortedValues[index]
      const groupKeys: Array<TKey> = []
      do {
        for (const key of this.valueMap.get(this.sortedValues[index]) ?? []) {
          groupKeys.push(key)
        }
        index += step
      } while (
        index >= 0 &&
        index < this.sortedValues.length &&
        this.compareFn(this.sortedValues[index], groupValue) === 0
      )
      groupKeys.sort(compareKeys)
      if (step === -1) groupKeys.reverse()
      for (const key of groupKeys) {
        if (filterFn?.(key) ?? true) result.push(key)
        if (result.length >= n) break
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
