import { compareKeys } from '@tanstack/db-ivm'
import { BTree } from '../utils/btree.js'
import {
  areSameValueZeroEqual,
  defaultComparator,
  denormalizeUndefined,
  normalizeForBTree,
} from '../utils/comparison.js'
import { BaseIndex } from './base-index.js'
import type { CompareOptions } from '../query/builder/types.js'
import type { BasicExpression } from '../query/ir.js'
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
  exactValues: Set<unknown>
  keys: Set<TKey>
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
  // The `orderedEntries` B+ tree groups values that occupy the same comparator
  // position. The `valueMap` keeps exact values separate for equality lookups.
  private orderedEntries: BTree<any, OrderedBucket<TKey>>
  private valueMap = new Map<any, Set<TKey>>()
  private indexedKeys = new Set<TKey>()
  private compareFn: (a: any, b: any) => number = defaultComparator

  constructor(
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: any,
  ) {
    super(id, expression, name, options)

    // Get the base compare function
    const baseCompareFn = options?.compareFn ?? defaultComparator
    this.hasCustomComparator = options?.compareFn != null

    // Wrap it to denormalize sentinels before comparison
    // This ensures UNDEFINED_SENTINEL is converted back to undefined
    // before being passed to the baseCompareFn (which can be user-provided and is unaware of the UNDEFINED_SENTINEL)
    this.compareFn = (a: any, b: any) =>
      baseCompareFn(denormalizeUndefined(a), denormalizeUndefined(b))

    if (options?.compareOptions) {
      this.compareOptions = options!.compareOptions
    }
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
        `Failed to evaluate index expression for key ${key}: ${error}`,
      )
    }

    // Normalize the value for Map key usage
    const normalizedValue = normalizeForBTree(indexedValue)

    this.addToBucket(key, normalizedValue)
    this.addRangeValue(indexedValue)

    this.indexedKeys.add(key)
    this.updateTimestamp()
  }

  private addToBucket(key: TKey, normalizedValue: unknown): void {
    const keySet = this.valueMap.get(normalizedValue)
    const isNewExactValue = keySet === undefined
    if (keySet) {
      keySet.add(key)
    } else {
      this.valueMap.set(normalizedValue, new Set([key]))
    }

    const orderedBucket = this.orderedEntries.get(normalizedValue)
    if (orderedBucket) {
      orderedBucket.keys.add(key)
      if (isNewExactValue) orderedBucket.exactValues.add(normalizedValue)
    } else {
      this.orderedEntries.set(normalizedValue, {
        representative: normalizedValue,
        exactValues: new Set([normalizedValue]),
        keys: new Set([key]),
      })
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
      return
    }

    // Normalize the value for Map key usage
    const normalizedValue = normalizeForBTree(indexedValue)

    this.removeFromBucket(key, normalizedValue)
    this.removeRangeValue(indexedValue)

    this.indexedKeys.delete(key)
    this.updateTimestamp()
  }

  private removeFromBucket(key: TKey, normalizedValue: unknown): void {
    const keySet = this.valueMap.get(normalizedValue)
    let removedExactValue = false
    if (keySet) {
      keySet.delete(key)

      if (keySet.size === 0) {
        this.valueMap.delete(normalizedValue)
        removedExactValue = true
      }
    }

    const orderedBucket = this.orderedEntries.get(normalizedValue)
    if (!orderedBucket) return
    orderedBucket.keys.delete(key)
    if (removedExactValue) orderedBucket.exactValues.delete(normalizedValue)

    if (orderedBucket.keys.size === 0) {
      this.orderedEntries.delete(normalizedValue)
    } else if (
      removedExactValue &&
      areSameValueZeroEqual(orderedBucket.representative, normalizedValue)
    ) {
      this.orderedEntries.delete(normalizedValue)
      const representative = orderedBucket.exactValues.values().next().value
      orderedBucket.representative = representative
      this.orderedEntries.set(representative, orderedBucket)
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

    const oldValue = normalizeForBTree(oldIndexedValue)
    const newValue = normalizeForBTree(newIndexedValue)
    if (
      areSameValueZeroEqual(oldValue, newValue) &&
      this.valueMap.get(newValue)?.has(key)
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
    const normalizedValue = normalizeForBTree(value)
    return new Set(this.valueMap.get(normalizedValue) ?? [])
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
      ? normalizeForBTree(from)
      : this.orderedEntries.minKey()
    const toKey = hasTo ? normalizeForBTree(to) : this.orderedEntries.maxKey()

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
          this.compareFn(indexedValue, fromKey) === 0
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
   * Performs a reversed range query
   */
  rangeQueryReversed(options: RangeQueryOptions = {}): Set<TKey> {
    const { from, to, fromInclusive = true, toInclusive = true } = options
    const reversed: RangeQueryOptions = {}
    if (`to` in options) {
      reversed.from = to
      reversed.fromInclusive = toInclusive
    }
    if (`from` in options) {
      reversed.to = from
      reversed.toInclusive = fromInclusive
    }
    return this.rangeQuery(reversed)
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
    const keysInResult: Set<TKey> = new Set()
    const result: Array<TKey> = []
    let pair: [any, OrderedBucket<TKey>] | undefined
    let key = from // Use as-is - it's already normalized by the caller

    while ((pair = nextPair(key)) !== undefined && result.length < n) {
      key = pair[0]
      const keys = pair[1].keys
      // Sort keys for deterministic order, reverse if needed
      const sorted = Array.from(keys).sort(compareKeys)
      if (reversed) sorted.reverse()
      for (const ks of sorted) {
        if (result.length >= n) break
        if (!keysInResult.has(ks) && (filterFn?.(ks) ?? true)) {
          result.push(ks)
          keysInResult.add(ks)
        }
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
    const normalizedFrom = normalizeForBTree(from)
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
    const normalizedFrom = normalizeForBTree(from)
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
      .map((key) => [
        denormalizeUndefined(key),
        this.orderedEntries.get(key)?.keys ?? new Set(),
      ])
  }

  get orderedEntriesArrayReversed(): Array<[any, Set<TKey>]> {
    return this.orderedEntries
      .keysArray()
      .reverse()
      .map((key) => [
        denormalizeUndefined(key),
        this.orderedEntries.get(key)?.keys ?? new Set(),
      ])
  }

  get valueMapData(): Map<any, Set<TKey>> {
    // Return a new Map with denormalized keys
    const result = new Map<any, Set<TKey>>()
    for (const [key, value] of this.valueMap) {
      result.set(denormalizeUndefined(key), value)
    }
    return result
  }
}
