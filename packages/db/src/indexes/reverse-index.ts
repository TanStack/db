import { compareKeys } from '@tanstack/db-ivm'
import type { IndexInterface, IndexOperation, IndexReader } from './base-index'
import type { RangeQueryOptions } from './btree-index'

export class ReverseIndex<
  TKey extends string | number,
> implements IndexReader<TKey> {
  private originalIndex: IndexInterface<TKey>

  /**
   * @param nullsFirst - Whether nullish values come first in the reversed
   * order. The original index keeps them at the opposite end, so reversing
   * it alone would move them; ordered reads put them back.
   */
  constructor(
    index: IndexInterface<TKey>,
    private readonly nullsFirst: boolean,
  ) {
    this.originalIndex = index
  }

  // Define the reversed operations

  lookup(operation: IndexOperation, value: any): Set<TKey> {
    const reverseOperation =
      operation === `gt`
        ? `lt`
        : operation === `gte`
          ? `lte`
          : operation === `lt`
            ? `gt`
            : operation === `lte`
              ? `gte`
              : operation
    return this.originalIndex.lookup(reverseOperation, value)
  }

  rangeQuery(options: RangeQueryOptions = {}): Set<TKey> {
    return this.originalIndex.rangeQueryReversed(options)
  }

  take(n: number, from: any, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const nulls = this.nullKeys()
    const nonNull = (key: TKey) => !nulls.has(key) && (filterFn?.(key) ?? true)
    if (this.nullsFirst) {
      return from == null
        ? this.originalIndex.takeReversedFromEnd(n, nonNull)
        : this.originalIndex.takeReversed(n, from, nonNull)
    }
    if (from == null) return []
    const keys = this.originalIndex.takeReversed(n, from, nonNull)
    return [...keys, ...this.takeNulls(n - keys.length, nulls, filterFn)]
  }

  takeFromStart(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const nulls = this.nullKeys()
    const nonNull = (key: TKey) => !nulls.has(key) && (filterFn?.(key) ?? true)
    if (this.nullsFirst) {
      const keys = this.takeNulls(n, nulls, filterFn)
      return [
        ...keys,
        ...this.originalIndex.takeReversedFromEnd(n - keys.length, nonNull),
      ]
    }
    const keys = this.originalIndex.takeReversedFromEnd(n, nonNull)
    return [...keys, ...this.takeNulls(n - keys.length, nulls, filterFn)]
  }

  /** Keys whose indexed value is `null` or `undefined`. */
  private nullKeys(): Set<TKey> {
    return new Set([
      ...this.originalIndex.lookup(`eq`, null),
      ...this.originalIndex.lookup(`eq`, undefined),
    ])
  }

  private takeNulls(
    n: number,
    nulls: Set<TKey>,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    if (n <= 0) return []
    return [...nulls]
      .sort(compareKeys)
      .filter((key) => filterFn?.(key) ?? true)
      .slice(0, n)
  }

  // All operations below delegate to the original index

  supports(operation: IndexOperation): boolean {
    return this.originalIndex.supports(operation)
  }

  get supportsRangeOptimization(): boolean {
    return this.originalIndex.supportsRangeOptimization
  }

  canOptimizeRangeFor(value: unknown): boolean {
    return this.originalIndex.canOptimizeRangeFor?.(value) ?? true
  }

  get keyCount(): number {
    return this.originalIndex.keyCount
  }
}
