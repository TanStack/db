import { compareKeys } from '@tanstack/db-ivm'
import { areSameValueZeroEqual, normalizeValue } from '../utils/comparison.js'
import {
  compareKeysReversed,
  findInsertPositionInArray,
} from '../utils/array-utils.js'
import { codedMessage, devBuild } from '../error-message.js'
import {
  BaseIndex,
  builtInIndexResolverNames,
  warnRemovalFailure,
} from './base-index.js'
import type { CompareOptions } from '../query/builder/types.js'
import type { IndexOperation } from './base-index.js'

// Map collapses signed zero, while a user comparator may order them apart.
const NEGATIVE_ZERO_ORDER_KEY = Symbol(`negative zero order key`)

function orderedBucketKey(value: unknown): unknown {
  return Object.is(value, -0) ? NEGATIVE_ZERO_ORDER_KEY : value
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
  // Equality and comparator positions are independent: a custom comparator
  // may distinguish values that have one exact query-equality key.
  private sortedValues: Array<any> = []
  private orderedBuckets = new Map<unknown, Map<TKey, unknown>>()
  // Set of all indexed PKs
  private indexedKeys = new Set<TKey>()

  protected initialize(_options?: BasicIndexOptions): void {}

  /**
   * Adds a value to the index
   */
  add(key: TKey, item: any): void {
    const indexedValue = this.evaluateAddedValue(key, item)
    const normalizedValue = normalizeValue(indexedValue)

    this.addToBucket(
      key,
      normalizedValue,
      this.orderValue(indexedValue, normalizedValue),
    )
    this.addRangeValue(indexedValue)

    this.indexedKeys.add(key)
  }

  private addToBucket(
    key: TKey,
    normalizedValue: unknown,
    orderValue: unknown,
  ): void {
    this.addToOrder(key, orderValue)
    const exactKeys = this.valueMap.get(normalizedValue)
    if (exactKeys) exactKeys.add(key)
    else this.valueMap.set(normalizedValue, new Set([key]))
  }

  private addToOrder(key: TKey, orderValue: unknown): void {
    // Compare before changing either partition. One comparator position can
    // contain several exact values, and one exact value can occupy several
    // custom comparator positions.
    const insertIdx = findInsertPositionInArray(
      this.sortedValues,
      orderValue,
      this.compareFn,
    )
    if (
      insertIdx < this.sortedValues.length &&
      this.compareFn(this.sortedValues[insertIdx], orderValue) === 0
    ) {
      this.orderedBuckets
        .get(orderedBucketKey(this.sortedValues[insertIdx]))!
        .set(key, orderValue)
    } else {
      this.sortedValues.splice(insertIdx, 0, orderValue)
      this.orderedBuckets.set(
        orderedBucketKey(orderValue),
        new Map([[key, orderValue]]),
      )
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

    this.removeFromBucket(
      key,
      normalizedValue,
      this.orderValue(indexedValue, normalizedValue),
    )
    this.removeRangeValue(indexedValue)

    this.indexedKeys.delete(key)
  }

  private removeFromBucket(
    key: TKey,
    normalizedValue: unknown,
    orderValue: unknown,
  ): void {
    const exactKeys = this.valueMap.get(normalizedValue)
    if (!exactKeys?.has(key)) return
    this.removeFromOrder(key, orderValue)
    exactKeys.delete(key)
    if (exactKeys.size === 0) this.valueMap.delete(normalizedValue)
  }

  private removeFromOrder(key: TKey, orderValue: unknown): void {
    const index = findInsertPositionInArray(
      this.sortedValues,
      orderValue,
      this.compareFn,
    )
    if (index >= this.sortedValues.length) return
    const representative = this.sortedValues[index]
    if (this.compareFn(representative, orderValue) !== 0) return
    const members = this.orderedBuckets.get(orderedBucketKey(representative))
    if (!members?.has(key)) return
    if (members.size === 1) {
      this.sortedValues.splice(index, 1)
      this.orderedBuckets.delete(orderedBucketKey(representative))
      return
    }
    // Keep a live representative when its row leaves the comparator group.
    if (areSameValueZeroEqual(members.get(key), representative)) {
      const values = members.entries()
      const first = values.next().value!
      const successor = first[0] === key ? values.next().value![1] : first[1]
      // A custom comparator may reject the promoted value against a neighbor.
      // Check before changing either the sorted or exact partition.
      if (index > 0) this.compareFn(this.sortedValues[index - 1], successor)
      if (index + 1 < this.sortedValues.length)
        this.compareFn(successor, this.sortedValues[index + 1])
      this.sortedValues[index] = successor
      this.orderedBuckets.delete(orderedBucketKey(representative))
      this.orderedBuckets.set(orderedBucketKey(successor), members)
    }
    members.delete(key)
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
    const oldOrder = this.orderValue(oldIndexedValue, oldValue)
    const newOrder = this.orderValue(newIndexedValue, newValue)
    if (
      areSameValueZeroEqual(oldValue, newValue) &&
      this.valueMap.get(newValue)?.has(key) &&
      this.indexedKeys.has(key)
    ) {
      if (!areSameValueZeroEqual(oldOrder, newOrder)) {
        this.removeFromOrder(key, oldOrder)
        this.addToOrder(key, newOrder)
      }
      this.removeRangeValue(oldIndexedValue)
      this.addRangeValue(newIndexedValue)
      return
    }

    this.removeFromBucket(key, oldValue, oldOrder)
    this.removeRangeValue(oldIndexedValue)
    this.addToBucket(key, newValue, newOrder)
    this.addRangeValue(newIndexedValue)
    this.indexedKeys.add(key)
  }

  /**
   * Builds the index from a collection of entries
   */
  build(entries: Iterable<[TKey, any]>): void {
    this.clear()

    // Collect all entries first
    const entriesArray: Array<{ key: TKey; value: any; orderValue: any }> = []
    for (const [key, item] of entries) {
      const indexedValue = this.evaluateAddedValue(key, item)
      const value = normalizeValue(indexedValue)
      entriesArray.push({
        key,
        value,
        orderValue: this.orderValue(indexedValue, value),
      })
      this.addRangeValue(indexedValue)
      this.indexedKeys.add(key)
    }

    // Native Array.sort moves raw undefined values last without comparing them.
    // Wrap values so nulls-first comparison also runs during a full build.
    const sortable = entriesArray.map((entry) => ({ entry }))
    sortable.sort((left, right) =>
      this.compareFn(left.entry.orderValue, right.entry.orderValue),
    )
    for (const { entry } of sortable) {
      const exactKeys = this.valueMap.get(entry.value)
      if (exactKeys) exactKeys.add(entry.key)
      else this.valueMap.set(entry.value, new Set([entry.key]))

      const representative = this.sortedValues.at(-1)
      if (
        this.sortedValues.length > 0 &&
        this.compareFn(representative, entry.orderValue) === 0
      ) {
        this.orderedBuckets
          .get(orderedBucketKey(representative))!
          .set(entry.key, entry.orderValue)
      } else {
        this.sortedValues.push(entry.orderValue)
        this.orderedBuckets.set(
          orderedBucketKey(entry.orderValue),
          new Map([[entry.key, entry.orderValue]]),
        )
      }
    }
  }

  /**
   * Clears all data from the index
   */
  clear(): void {
    this.valueMap.clear()
    this.sortedValues = []
    this.orderedBuckets.clear()
    this.indexedKeys.clear()
    this.clearRangeValues()
  }

  /**
   * Performs a lookup operation
   */
  lookup(operation: IndexOperation, value: any): Set<TKey> {
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
        throw new Error(
          devBuild() && process.env.NODE_ENV !== `production`
            ? `Operation ${operation} not supported by BasicIndex`
            : codedMessage(100, { operation }),
        )
    }
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
    const orderFrom = this.orderValue(from, normalizedFrom)
    const orderTo = this.orderValue(to, normalizedTo)
    const hasFrom = `from` in options
    const hasTo = `to` in options

    // Find start index
    let startIdx = 0
    if (hasFrom) {
      startIdx = findInsertPositionInArray(
        this.sortedValues,
        orderFrom,
        this.compareFn,
      )
      // Comparator-equal values form one range boundary even when they are
      // distinct equality keys.
      while (
        !fromInclusive &&
        startIdx < this.sortedValues.length &&
        this.compareFn(this.sortedValues[startIdx], orderFrom) === 0
      ) {
        startIdx++
      }
    }

    // Find end index
    let endIdx = this.sortedValues.length
    if (hasTo) {
      endIdx = findInsertPositionInArray(
        this.sortedValues,
        orderTo,
        this.compareFn,
      )
      // Include the whole comparator group at an inclusive upper boundary.
      while (
        toInclusive &&
        endIdx < this.sortedValues.length &&
        this.compareFn(this.sortedValues[endIdx], orderTo) === 0
      ) {
        endIdx++
      }
    }

    // Collect all keys in range
    for (let i = startIdx; i < endIdx; i++) {
      for (const key of this.orderedBuckets
        .get(orderedBucketKey(this.sortedValues[i]))!
        .keys()) {
        result.add(key)
      }
    }

    return result
  }

  /**
   * Returns the next n items in sorted order
   */
  take(n: number, from: any, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const normalizedFrom = normalizeValue(from)
    const orderFrom = this.orderValue(from, normalizedFrom)
    let startIdx = findInsertPositionInArray(
      this.sortedValues,
      orderFrom,
      this.compareFn,
    )
    // Skip past the 'from' value (exclusive)
    while (
      startIdx < this.sortedValues.length &&
      this.compareFn(this.sortedValues[startIdx], orderFrom) <= 0
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
    const orderFrom = this.orderValue(from, normalizedFrom)
    let startIdx =
      findInsertPositionInArray(this.sortedValues, orderFrom, this.compareFn) -
      1
    // Skip past the 'from' value (exclusive)
    while (
      startIdx >= 0 &&
      this.compareFn(this.sortedValues[startIdx], orderFrom) >= 0
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
        for (const key of this.orderedBuckets
          .get(orderedBucketKey(this.sortedValues[index]))
          ?.keys() ?? []) {
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
}

builtInIndexResolverNames.set(BasicIndex, `BasicIndex`)
