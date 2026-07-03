import { defaultComparator, normalizeValue } from '../utils/comparison.js'
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
  // Values whose key set has emptied are kept as tombstones so that
  // remove-then-re-add cycles avoid the O(n) sorted-array splice; read paths
  // skip empty sets. Compacted beyond a bound.
  private emptyValueTombstones = 0
  private static readonly MAX_VALUE_TOMBSTONES = 1024
  // Number of distinct keys in the index. Kept as a counter instead of a
  // Set: V8 hash tables degrade badly under repeated delete+re-add of the
  // same key (each cycle appends to the data table and forces rehashes),
  // which is exactly the churn incremental row updates produce.
  private indexedKeyCount = 0
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
    this.hasCustomComparator = options?.compareFn != null
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
        { cause: error },
      )
    }

    const normalizedValue = normalizeValue(indexedValue)

    const existingKeySet = this.valueMap.get(normalizedValue)
    if (existingKeySet !== undefined) {
      // Value already exists (possibly as a tombstone), reuse the entry
      if (existingKeySet.size === 0) {
        this.emptyValueTombstones--
      }
      const sizeBefore = existingKeySet.size
      existingKeySet.add(key)
      if (existingKeySet.size !== sizeBefore) {
        this.indexedKeyCount++
      }
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
      this.indexedKeyCount++
    }

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
      this.updateTimestamp()
      return
    }

    const normalizedValue = normalizeValue(indexedValue)

    const keySet = this.valueMap.get(normalizedValue)
    if (keySet !== undefined && keySet.delete(key)) {
      this.indexedKeyCount--

      // Keep the emptied entry as a tombstone (read paths skip empty sets)
      // so a re-add of the same value avoids the sorted-array splice;
      // compact when the tombstone count grows.
      if (keySet.size === 0) {
        this.emptyValueTombstones++
        if (this.emptyValueTombstones > BasicIndex.MAX_VALUE_TOMBSTONES) {
          this.compactValueTombstones()
        }
      }
    }

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
          { cause: error },
        )
      }
      entriesArray.push({ key, value: normalizeValue(indexedValue) })
    }
    this.indexedKeyCount = entriesArray.length

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
    this.indexedKeyCount = 0
    this.emptyValueTombstones = 0
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
    return this.indexedKeyCount
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
  private compactValueTombstones(): void {
    for (const [value, keySet] of this.valueMap) {
      if (keySet.size === 0) {
        this.valueMap.delete(value)
      }
    }
    this.sortedValues = Array.from(this.valueMap.keys()).sort(this.compareFn)
    this.emptyValueTombstones = 0
  }

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
    const { from, to, fromInclusive = true, toInclusive = true } = options

    // Swap from/to and fromInclusive/toInclusive to handle reversed ranges
    // If to is undefined, we want to start from the end (max value)
    // If from is undefined, we want to end at the beginning (min value)
    const swappedFrom =
      to ??
      (this.sortedValues.length > 0
        ? this.sortedValues[this.sortedValues.length - 1]
        : undefined)
    const swappedTo =
      from ?? (this.sortedValues.length > 0 ? this.sortedValues[0] : undefined)

    return this.rangeQuery({
      from: swappedFrom,
      to: swappedTo,
      fromInclusive: toInclusive,
      toInclusive: fromInclusive,
    })
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
   * Returns the first n items in sorted order (from the start)
   */
  takeFromStart(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const result: Array<TKey> = []
    for (let i = 0; i < this.sortedValues.length && result.length < n; i++) {
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
   * Returns the first n items in reverse sorted order (from the end)
   */
  takeReversedFromEnd(
    n: number,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    const result: Array<TKey> = []
    for (
      let i = this.sortedValues.length - 1;
      i >= 0 && result.length < n;
      i--
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
    const keys = new Set<TKey>()
    for (const keySet of this.valueMap.values()) {
      for (const key of keySet) {
        keys.add(key)
      }
    }
    return keys
  }

  get orderedEntriesArray(): Array<[any, Set<TKey>]> {
    // Tombstoned (emptied) values are an internal detail — filter them so
    // snapshot APIs stay consistent with take*/valueMapData
    const result: Array<[any, Set<TKey>]> = []
    for (const value of this.sortedValues) {
      const keySet = this.valueMap.get(value)
      if (keySet !== undefined && keySet.size > 0) {
        result.push([value, keySet])
      }
    }
    return result
  }

  get orderedEntriesArrayReversed(): Array<[any, Set<TKey>]> {
    const result: Array<[any, Set<TKey>]> = []
    for (let i = this.sortedValues.length - 1; i >= 0; i--) {
      const value = this.sortedValues[i]
      const keySet = this.valueMap.get(value)
      if (keySet !== undefined && keySet.size > 0) {
        result.push([value, keySet])
      }
    }
    return result
  }

  get valueMapData(): Map<any, Set<TKey>> {
    if (this.emptyValueTombstones === 0) {
      return this.valueMap
    }
    const result = new Map<any, Set<TKey>>()
    for (const [value, keySet] of this.valueMap) {
      if (keySet.size > 0) {
        result.set(value, keySet)
      }
    }
    return result
  }
}
