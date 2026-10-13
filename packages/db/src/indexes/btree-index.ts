import { compareKeys } from '@tanstack/db-ivm'
import { compareKeysReversed } from '../utils/array-utils.js'
import { BTree } from '../utils/btree.js'
import {
  areSameValueZeroEqual,
  denormalizeUndefined,
  indexCustomComparatorValue,
  normalizeForBTree,
} from '../utils/comparison.js'
import { codedMessage, devBuild } from '../error-message.js'
import {
  BaseIndex,
  builtInIndexResolverNames,
  warnRemovalFailure,
} from './base-index.js'
import type { CompareOptions } from '../query/builder/types.js'
import type { IndexOperation } from './base-index.js'

/**
 * Options for Ordered index
 */
export interface BTreeIndexOptions {
  compareFn?: (a: any, b: any) => number
  compareOptions?: CompareOptions
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

type OrderedBucket<TKey> = {
  representative: unknown
  // One comparator position may contain several exact values, while one
  // exact value may occupy several custom comparator positions.
  values: Map<TKey, unknown>
  keys: Set<TKey>
}

// Map uses SameValueZero, but a custom callback may order -0 apart from +0.
const NEGATIVE_ZERO_ORDER_OPERAND = Symbol(`negative zero order operand`)

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
  // The `orderedEntries` B+ tree groups values that occupy the same comparator
  // position. The `valueMap` keeps exact values separate for equality lookups.
  private orderedEntries = new BTree<any, OrderedBucket<TKey>>((a, b) =>
    this.compareStored(a, b),
  )
  private valueMap = new Map<unknown, { keys: Set<TKey> }>()
  // Repeated identical callback operands belong to the same comparator
  // position. This avoids another tree search for every row in a hot bucket.
  private orderOperands = new Map<
    unknown,
    { bucket: OrderedBucket<TKey>; owners: number }
  >()
  private indexedKeys = new Set<TKey>()

  // Stored keys use UNDEFINED_SENTINEL; the comparator, which may be
  // user-supplied, expects undefined.
  private compareStored(a: any, b: any): number {
    return this.compareFn(denormalizeUndefined(a), denormalizeUndefined(b))
  }

  private orderOperand(value: unknown): unknown {
    const operand = this.hasCustomComparator
      ? indexCustomComparatorValue(value)
      : value
    return Object.is(operand, -0) ? NEGATIVE_ZERO_ORDER_OPERAND : operand
  }

  protected initialize(_options?: BTreeIndexOptions): void {}

  /**
   * Adds a value to the index
   */
  add(key: TKey, item: any): void {
    const indexedValue = this.evaluateAddedValue(key, item)

    // Normalize the value for Map key usage
    const normalizedValue = normalizeForBTree(indexedValue)

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
    const exact = this.valueMap.get(normalizedValue)
    if (exact) exact.keys.add(key)
    else this.valueMap.set(normalizedValue, { keys: new Set([key]) })
  }

  private addToOrder(key: TKey, orderValue: unknown): void {
    const operand = this.orderOperand(orderValue)
    const cached = this.orderOperands.get(operand)
    if (cached) {
      cached.bucket.keys.add(key)
      cached.bucket.values.set(key, orderValue)
      cached.owners++
      return
    }

    let orderedBucket = this.orderedEntries.get(orderValue)
    if (orderedBucket) {
      orderedBucket.keys.add(key)
      orderedBucket.values.set(key, orderValue)
    } else {
      orderedBucket = {
        representative: orderValue,
        values: new Map([[key, orderValue]]),
        keys: new Set([key]),
      }
      this.orderedEntries.set(orderValue, orderedBucket)
    }
    this.orderOperands.set(operand, { bucket: orderedBucket, owners: 1 })
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
      return
    }

    // Normalize the value for Map key usage
    const normalizedValue = normalizeForBTree(indexedValue)

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
    const exact = this.valueMap.get(normalizedValue)
    if (!exact?.keys.has(key)) return
    this.removeFromOrder(key, orderValue)
    exact.keys.delete(key)
    if (exact.keys.size === 0) this.valueMap.delete(normalizedValue)
  }

  private removeFromOrder(key: TKey, orderValue: unknown): void {
    const operand = this.orderOperand(orderValue)
    const cached = this.orderOperands.get(operand)
    const orderedBucket = cached?.bucket ?? this.orderedEntries.get(orderValue)
    if (!orderedBucket?.keys.has(key)) return
    const replacesRepresentative =
      orderedBucket.keys.size > 1 &&
      areSameValueZeroEqual(
        orderedBucket.representative,
        orderedBucket.values.get(key),
      )

    // Tree writes compare first, so a comparator failure throws before the
    // index changes. A comparator-equal `set` overwrites the entry's key.
    if (orderedBucket.keys.size === 1) {
      this.orderedEntries.delete(orderedBucket.representative)
    } else if (replacesRepresentative) {
      const values = orderedBucket.values.entries()
      const first = values.next().value!
      const representative =
        first[0] === key ? values.next().value![1] : first[1]
      if (!areSameValueZeroEqual(representative, orderedBucket.representative))
        this.orderedEntries.set(representative, orderedBucket)
      orderedBucket.representative = representative
    }
    orderedBucket.keys.delete(key)
    orderedBucket.values.delete(key)
    if (cached && --cached.owners === 0) this.orderOperands.delete(operand)
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

    const oldValue = normalizeForBTree(oldIndexedValue)
    const newValue = normalizeForBTree(newIndexedValue)
    const oldOrder = this.orderValue(oldIndexedValue, oldValue)
    const newOrder = this.orderValue(newIndexedValue, newValue)
    if (
      areSameValueZeroEqual(oldValue, newValue) &&
      this.valueMap.get(newValue)?.keys.has(key)
    ) {
      if (!Object.is(oldOrder, newOrder)) {
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
    this.orderOperands.clear()
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
            ? `Operation ${operation} not supported by BTreeIndex`
            : codedMessage(101, { operation }),
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

  // Public methods for backward compatibility (used by tests)

  /**
   * Performs an equality lookup
   */
  equalityLookup(value: any): Set<TKey> {
    const normalizedValue = normalizeForBTree(value)
    return new Set(this.valueMap.get(normalizedValue)?.keys ?? [])
  }

  /**
   * Performs a range query with options
   * This is more efficient for compound queries like "WHERE a > 5 AND a < 10"
   */
  rangeQuery(options: RangeQueryOptions = {}): Set<TKey> {
    const { from, to, fromInclusive = true, toInclusive = true } = options
    const result = new Set<TKey>()

    // Check if from/to were explicitly provided (even if undefined)
    // vs not provided at all (should use min/max key)
    const hasFrom = `from` in options
    const hasTo = `to` in options

    const fromKey = hasFrom
      ? this.orderValue(from, normalizeForBTree(from))
      : this.orderedEntries.minKey()
    const toKey = hasTo
      ? this.orderValue(to, normalizeForBTree(to))
      : this.orderedEntries.maxKey()

    this.orderedEntries.forRange(
      fromKey,
      toKey,
      toInclusive,
      (indexedValue, bucket) => {
        // Only exclude the boundary when an exclusive lower bound was
        // actually provided. Without a `from` bound, `fromKey` defaults to
        // the minimum key and must not be dropped. Compare against the
        // normalized key since indexed values are stored normalized
        // (e.g. dates as timestamps), so the raw `from` would never match.
        if (
          hasFrom &&
          !fromInclusive &&
          this.compareStored(indexedValue, fromKey) === 0
        ) {
          // the B+ tree `forRange` method does not support exclusive lower bounds
          // so we need to exclude it manually
          return
        }

        bucket.keys.forEach((key) => result.add(key))
      },
    )

    return result
  }

  /**
   * Internal method for taking items from the index.
   * @param n - The number of items to return
   * @param nextPair - Function to get the next pair from the BTree
   * @param from - Already normalized! undefined means "start from beginning/end", sentinel means "start from the key undefined"
   * @param filterFn - Optional filter function
   * @param reversed - Whether to reverse the order of keys within each value
   */
  private takeInternal(
    n: number,
    nextPair: (k?: any) => [any, OrderedBucket<TKey>] | undefined,
    from: any,
    filterFn?: (key: TKey) => boolean,
    reversed: boolean = false,
  ): Array<TKey> {
    const result: Array<TKey> = []
    let pair: [any, OrderedBucket<TKey>] | undefined
    let key = from // Use as-is - it's already normalized by the caller

    // Every key owns exactly one bucket, so the walk never repeats a key.
    while ((pair = nextPair(key)) !== undefined && result.length < n) {
      key = pair[0]
      // Sort keys for deterministic order within a comparator position.
      const sorted = Array.from(pair[1].keys).sort(
        reversed ? compareKeysReversed : compareKeys,
      )
      for (const ks of sorted) {
        if (result.length >= n) break
        if (filterFn?.(ks) ?? true) result.push(ks)
      }
    }

    return result
  }

  /**
   * Returns the next n items after the provided item.
   * @param n - The number of items to return
   * @param from - The item to start from (exclusive).
   * @returns The next n items after the provided key.
   */
  take(n: number, from: any, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const nextPair = (k?: any) => this.orderedEntries.nextHigherPair(k)
    // Normalize the from value
    const normalizedFrom = this.orderValue(from, normalizeForBTree(from))
    return this.takeInternal(n, nextPair, normalizedFrom, filterFn)
  }

  /**
   * Returns the first n items from the beginning.
   * @param n - The number of items to return
   * @param filterFn - Optional filter function
   * @returns The first n items
   */
  takeFromStart(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const nextPair = (k?: any) => this.orderedEntries.nextHigherPair(k)
    // Pass undefined to mean "start from beginning" (BTree's native behavior)
    return this.takeInternal(n, nextPair, undefined, filterFn)
  }

  /**
   * Returns the next n items **before** the provided item (in descending order).
   * @param n - The number of items to return
   * @param from - The item to start from (exclusive). Required.
   * @returns The next n items **before** the provided key.
   */
  takeReversed(
    n: number,
    from: any,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    const nextPair = (k?: any) => this.orderedEntries.nextLowerPair(k)
    // Normalize the from value
    const normalizedFrom = this.orderValue(from, normalizeForBTree(from))
    return this.takeInternal(n, nextPair, normalizedFrom, filterFn, true)
  }

  /**
   * Returns the last n items from the end.
   * @param n - The number of items to return
   * @param filterFn - Optional filter function
   * @returns The last n items
   */
  takeReversedFromEnd(
    n: number,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    const nextPair = (k?: any) => this.orderedEntries.nextLowerPair(k)
    // Pass undefined to mean "start from end" (BTree's native behavior)
    return this.takeInternal(n, nextPair, undefined, filterFn, true)
  }

  /**
   * Performs an IN array lookup
   */
  inArrayLookup(values: Array<any>): Set<TKey> {
    const result = new Set<TKey>()

    for (const value of values) {
      const normalizedValue = normalizeForBTree(value)
      const keys = this.valueMap.get(normalizedValue)?.keys
      if (keys) {
        keys.forEach((key) => result.add(key))
      }
    }

    return result
  }
}

builtInIndexResolverNames.set(BTreeIndex, `BTreeIndex`)
