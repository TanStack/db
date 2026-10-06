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

  // The nullish group sits at one end of the original index. `nullsFirst`
  // says it is at the original's start, so the reversed walk reaches it last.
  // Nullish keys come back in ascending key order; equal non-null values come
  // back in descending key order, as the reversed walk returns them.

  take(n: number, from: any, filterFn?: (key: TKey) => boolean): Array<TKey> {
    if (from == null) return this.nullsFirst ? this.values(n, filterFn) : []
    const keys = this.values(n, filterFn, from)
    return this.nullsFirst
      ? keys
      : [...keys, ...this.nullish(n - keys.length, filterFn)]
  }

  takeFromStart(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    if (!this.nullsFirst) {
      const keys = this.values(n, filterFn)
      return [...keys, ...this.nullish(n - keys.length, filterFn)]
    }
    const keys = this.nullish(n, filterFn)
    return [...keys, ...this.values(n - keys.length, filterFn)]
  }

  /** Non-null keys in reversed order, after `from` when it is given. */
  private values(
    n: number,
    filterFn?: (key: TKey) => boolean,
    from?: unknown,
  ): Array<TKey> {
    if (n <= 0) return []
    if (!this.nullsFirst) {
      // The nullish group is above every value, so a walk down from it, or
      // from any value, never reaches it.
      return this.originalIndex.takeReversed(n, from ?? null, filterFn)
    }
    // The walk reaches the nullish group only after every value.
    let nullish: Set<TKey> | undefined
    const accept = (key: TKey) =>
      !(nullish ??= this.nullishKeys()).has(key) && (filterFn?.(key) ?? true)
    return from === undefined
      ? this.originalIndex.takeReversedFromEnd(n, accept)
      : this.originalIndex.takeReversed(n, from, accept)
  }

  private nullish(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    const keys: Array<TKey> = []
    if (n <= 0) return keys
    for (const key of [...this.nullishKeys()].sort(compareKeys)) {
      if (keys.length >= n) break
      if (filterFn?.(key) ?? true) keys.push(key)
    }
    return keys
  }

  private nullishKeys(): Set<TKey> {
    return new Set([
      ...this.originalIndex.lookup(`eq`, null),
      ...this.originalIndex.lookup(`eq`, undefined),
    ])
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
