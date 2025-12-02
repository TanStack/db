import { normalizeValue } from "../utils/comparison.js"
import { BaseIndex } from "./base-index.js"
import type { CompareOptions } from "../query/builder/types.js"
import type { BasicExpression } from "../query/ir.js"
import type { IndexOperation } from "./base-index.js"
import type { RangeQueryOptions } from "./btree-index.js"

/**
 * Options for Map index
 */
export interface MapIndexOptions {
  compareOptions?: CompareOptions
}

/**
 * Simple Map-based index for equality lookups.
 * This is a lightweight alternative to BTreeIndex when you only need
 * equality (`eq`) and `in` operations, without sorted iteration.
 *
 * Use BTreeIndex instead when you need:
 * - Range queries (gt, gte, lt, lte)
 * - ORDER BY optimization with sorted iteration
 * - Large collections (10k+ items) with sorting
 */
export class MapIndex<
  TKey extends string | number = string | number,
> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set<IndexOperation>([`eq`, `in`])

  private valueMap = new Map<any, Set<TKey>>()
  private indexedKeys = new Set<TKey>()

  constructor(
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: any
  ) {
    super(id, expression, name, options)
    if (options?.compareOptions) {
      this.compareOptions = options!.compareOptions
    }
  }

  protected initialize(_options?: MapIndexOptions): void {}

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

    const normalizedValue = normalizeValue(indexedValue)

    if (this.valueMap.has(normalizedValue)) {
      this.valueMap.get(normalizedValue)!.add(key)
    } else {
      const keySet = new Set<TKey>([key])
      this.valueMap.set(normalizedValue, keySet)
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

    const normalizedValue = normalizeValue(indexedValue)

    if (this.valueMap.has(normalizedValue)) {
      const keySet = this.valueMap.get(normalizedValue)!
      keySet.delete(key)

      if (keySet.size === 0) {
        this.valueMap.delete(normalizedValue)
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
      case `in`:
        result = this.inArrayLookup(value)
        break
      default:
        throw new Error(
          `Operation ${operation} not supported by MapIndex. ` +
            `Use BTreeIndex for range queries (gt, gte, lt, lte).`
        )
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
   * Performs an equality lookup
   */
  equalityLookup(value: any): Set<TKey> {
    const normalizedValue = normalizeValue(value)
    return new Set(this.valueMap.get(normalizedValue) ?? [])
  }

  /**
   * Performs an IN array lookup
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

  /**
   * Range queries are not supported by MapIndex.
   * Use BTreeIndex for range queries.
   */
  rangeQuery(_options: RangeQueryOptions = {}): Set<TKey> {
    throw new Error(
      `Range queries are not supported by MapIndex. ` +
        `Use BTreeIndex for range queries (gt, gte, lt, lte).`
    )
  }

  /**
   * Range queries are not supported by MapIndex.
   * Use BTreeIndex for range queries.
   */
  rangeQueryReversed(_options: RangeQueryOptions = {}): Set<TKey> {
    throw new Error(
      `Range queries are not supported by MapIndex. ` +
        `Use BTreeIndex for range queries.`
    )
  }

  /**
   * Sorted iteration is not supported by MapIndex.
   * Use BTreeIndex for ORDER BY optimization.
   */
  take(
    _n: number,
    _from?: any,
    _filterFn?: (key: TKey) => boolean
  ): Array<TKey> {
    throw new Error(
      `Sorted iteration (take) is not supported by MapIndex. ` +
        `Use BTreeIndex for ORDER BY optimization on large collections.`
    )
  }

  /**
   * Sorted iteration is not supported by MapIndex.
   * Use BTreeIndex for ORDER BY optimization.
   */
  takeReversed(
    _n: number,
    _from?: any,
    _filterFn?: (key: TKey) => boolean
  ): Array<TKey> {
    throw new Error(
      `Sorted iteration (takeReversed) is not supported by MapIndex. ` +
        `Use BTreeIndex for ORDER BY optimization.`
    )
  }

  // Getter methods for testing compatibility
  get indexedKeysSet(): Set<TKey> {
    return this.indexedKeys
  }

  /**
   * Ordered entries are not available in MapIndex (no sorting).
   * Returns entries in arbitrary Map iteration order.
   */
  get orderedEntriesArray(): Array<[any, Set<TKey>]> {
    return Array.from(this.valueMap.entries())
  }

  /**
   * Ordered entries are not available in MapIndex (no sorting).
   * Returns entries in arbitrary Map iteration order.
   */
  get orderedEntriesArrayReversed(): Array<[any, Set<TKey>]> {
    return Array.from(this.valueMap.entries()).reverse()
  }

  get valueMapData(): Map<any, Set<TKey>> {
    return this.valueMap
  }
}
