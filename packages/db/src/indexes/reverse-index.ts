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

  // Reversing the original index moves its nullish group to the opposite
  // end, so reads put the group back at the end the query asks for. Nullish
  // keys come in ascending key order; equal non-null values come in the
  // reversed walk's order. Each read gathers the nullish group, so its cost
  // grows with the number of nullish keys.

  take(n: number, from: any, filterFn?: (key: TKey) => boolean): Array<TKey> {
    return this.read(n, filterFn, from ?? null)
  }

  takeFromStart(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    return this.read(n, filterFn)
  }

  /** Reads after `from` (`null` is the nullish group), or from the start. */
  private read(
    n: number,
    filterFn?: (key: TKey) => boolean,
    from?: unknown,
  ): Array<TKey> {
    const nullish = new Set([
      ...this.originalIndex.lookup(`eq`, null),
      ...this.originalIndex.lookup(`eq`, undefined),
    ])
    const keep = (key: TKey) => filterFn?.(key) ?? true
    const accept = (key: TKey) => !nullish.has(key) && keep(key)
    const values = (count: number) =>
      count <= 0
        ? []
        : from == null
          ? this.originalIndex.takeReversedFromEnd(count, accept)
          : this.originalIndex.takeReversed(count, from, accept)
    const nulls = (count: number) =>
      count <= 0
        ? []
        : [...nullish].sort(compareKeys).filter(keep).slice(0, count)
    if (from === null) return this.nullsFirst ? values(n) : []
    if (this.nullsFirst && from === undefined) {
      const head = nulls(n)
      return [...head, ...values(n - head.length)]
    }
    const keys = values(n)
    return this.nullsFirst ? keys : [...keys, ...nulls(n - keys.length)]
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
