import { compareKeys } from '@tanstack/db-ivm'
import {
  areSameValueZeroEqual,
  cacheBinaryKey,
  isUint8Array,
  normalizeValue,
} from '../utils/comparison.js'
import { codedMessage, devBuild } from '../error-message.js'
import {
  compareKeysReversed,
  findInsertPositionInArray,
} from '../utils/array-utils.js'
import {
  BaseIndex,
  builtInIndexResolverNames,
  warnRemovalFailure,
} from './base-index.js'
import type { IndexComparisonOptions, IndexOperation } from './base-index.js'
import type { RangeQueryOptions } from './btree-index.js'

export type { RangeQueryOptions } from './btree-index.js'

/**
 * Options for Basic index
 */
export type BasicIndexOptions = IndexComparisonOptions

function orderValue(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value
}

function storedOrderValue(value: unknown, exact: unknown): unknown {
  if (isUint8Array(value)) {
    const copy = new Uint8Array(value)
    cacheBinaryKey(copy, exact as string)
    return copy
  }
  return orderValue(value)
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
  // Map for O(1) equality lookups: indexedValue -> Set of PKs
  private valueMap = new Map<any, Set<TKey>>()
  // Sorted array of unique indexed values for range queries
  private sortedValues: Array<any> = []
  // Set of all indexed PKs
  private indexedKeys = new Set<TKey>()

  /**
   * Adds a value to the index
   */
  add(key: TKey, item: any): void {
    const indexedValue = this.evaluateAddedValue(key, item)
    const normalizedValue = normalizeValue(indexedValue)

    this.addToBucket(key, normalizedValue, indexedValue)
    this.addRangeValue(indexedValue)

    this.indexedKeys.add(key)
  }

  private addToBucket(
    key: TKey,
    normalizedValue: unknown,
    value: unknown,
  ): void {
    const keySet = this.valueMap.get(normalizedValue)
    if (keySet) {
      // Value already exists, just add the key to the set
      keySet.add(key)
    } else {
      // New value. Find its sorted position first: a comparator failure must
      // throw before the index changes.
      const orderedValue = storedOrderValue(value, normalizedValue)
      const insertIdx = findInsertPositionInArray(
        this.sortedValues,
        orderedValue,
        this.compareFn,
      )
      this.valueMap.set(normalizedValue, new Set([key]))
      this.sortedValues.splice(insertIdx, 0, orderedValue)
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
      warnRemovalFailure(key, error)
      this.indexedKeys.delete(key)
      return
    }

    const normalizedValue = normalizeValue(indexedValue)

    this.removeFromBucket(key, normalizedValue, indexedValue)
    this.removeRangeValue(indexedValue)

    this.indexedKeys.delete(key)
  }

  private removeFromBucket(
    key: TKey,
    normalizedValue: unknown,
    value: unknown,
  ): void {
    const keySet = this.valueMap.get(normalizedValue)
    if (keySet?.has(key)) {
      // The last key for this value leaves the sorted array too. Locate it
      // before any change, so a comparator failure leaves the index unchanged.
      if (keySet.size === 1) {
        const orderedValue = orderValue(value)
        let sortedIndex = findInsertPositionInArray(
          this.sortedValues,
          orderedValue,
          this.compareFn,
        )
        // Distinct equality keys may share one comparator position.
        while (
          sortedIndex < this.sortedValues.length &&
          this.compareFn(this.sortedValues[sortedIndex], orderedValue) === 0
        ) {
          if (
            areSameValueZeroEqual(
              normalizeValue(this.sortedValues[sortedIndex]),
              normalizedValue,
            )
          ) {
            this.sortedValues.splice(sortedIndex, 1)
            break
          }
          sortedIndex++
        }
        this.valueMap.delete(normalizedValue)
      }
      keySet.delete(key)
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

    this.removeFromBucket(key, oldValue, oldIndexedValue)
    this.removeRangeValue(oldIndexedValue)
    this.addToBucket(key, newValue, newIndexedValue)
    this.addRangeValue(newIndexedValue)
    this.indexedKeys.add(key)
  }

  /**
   * Builds the index from a collection of entries
   */
  build(entries: Iterable<[TKey, any]>): void {
    this.clear()

    for (const [key, item] of entries) {
      const indexedValue = this.evaluateAddedValue(key, item)
      const value = normalizeValue(indexedValue)
      const keys = this.valueMap.get(value)
      if (keys) keys.add(key)
      else {
        this.valueMap.set(value, new Set([key]))
        this.sortedValues.push(storedOrderValue(indexedValue, value))
      }
      this.addRangeValue(indexedValue)
      this.indexedKeys.add(key)
    }

    // Array.sort moves raw undefined values last without comparing them.
    // Wrap values so nulls-first comparison runs during a full build.
    const sortable = this.sortedValues.map((value) => ({ value }))
    sortable.sort((left, right) => this.compareFn(left.value, right.value))
    this.sortedValues = sortable.map(({ value }) => value)
  }

  /**
   * Clears all data from the index
   */
  clear(): void {
    this.valueMap.clear()
    this.sortedValues = []
    this.indexedKeys.clear()
    this.clearRangeValues()
  }

  lookup(operation: IndexOperation, value: any): Set<TKey> {
    const result = this.lookupSupportedOperation(operation, value)
    if (result !== undefined) return result
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Operation ${operation} not supported by BasicIndex`
        : codedMessage(100, { operation }),
    )
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

    const orderedFrom = orderValue(from)
    const orderedTo = orderValue(to)
    const hasFrom = `from` in options
    const hasTo = `to` in options

    // Find start index
    let startIdx = 0
    if (hasFrom) {
      startIdx = findInsertPositionInArray(
        this.sortedValues,
        orderedFrom,
        this.compareFn,
      )
      // Comparator-equal values form one range boundary even when they are
      // distinct equality keys.
      while (
        !fromInclusive &&
        startIdx < this.sortedValues.length &&
        this.compareFn(this.sortedValues[startIdx], orderedFrom) === 0
      ) {
        startIdx++
      }
    }

    // Find end index
    let endIdx = this.sortedValues.length
    if (hasTo) {
      endIdx = findInsertPositionInArray(
        this.sortedValues,
        orderedTo,
        this.compareFn,
      )
      // Include the whole comparator group at an inclusive upper boundary.
      while (
        toInclusive &&
        endIdx < this.sortedValues.length &&
        this.compareFn(this.sortedValues[endIdx], orderedTo) === 0
      ) {
        endIdx++
      }
    }

    // Collect all keys in range
    for (let i = startIdx; i < endIdx; i++) {
      const keys = this.valueMap.get(normalizeValue(this.sortedValues[i]))
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
    const orderedFrom = orderValue(from)
    let startIdx = findInsertPositionInArray(
      this.sortedValues,
      orderedFrom,
      this.compareFn,
    )
    // Skip past the 'from' value (exclusive)
    while (
      startIdx < this.sortedValues.length &&
      this.compareFn(this.sortedValues[startIdx], orderedFrom) <= 0
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
    const orderedFrom = orderValue(from)
    let startIdx =
      findInsertPositionInArray(
        this.sortedValues,
        orderedFrom,
        this.compareFn,
      ) - 1
    // Skip past the 'from' value (exclusive)
    while (
      startIdx >= 0 &&
      this.compareFn(this.sortedValues[startIdx], orderedFrom) >= 0
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
        for (const key of this.valueMap.get(
          normalizeValue(this.sortedValues[index]),
        ) ?? []) {
          groupKeys.push(key)
        }
        index += step
      } while (
        index >= 0 &&
        index < this.sortedValues.length &&
        this.compareFn(this.sortedValues[index], groupValue) === 0
      )
      groupKeys.sort(step === 1 ? compareKeys : compareKeysReversed)
      for (const key of groupKeys) {
        if (filterFn?.(key) ?? true) result.push(key)
        if (result.length >= n) break
      }
    }
    return result
  }
}

builtInIndexResolverNames.set(BasicIndex, `BasicIndex`)
