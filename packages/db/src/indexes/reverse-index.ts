import type { IndexInterface, IndexOperation, IndexReader } from './base-index'
import type { RangeQueryOptions } from './btree-index'

export class ReverseIndex<
  TKey extends string | number,
> implements IndexReader<TKey> {
  private originalIndex: IndexInterface<TKey>

  constructor(index: IndexInterface<TKey>) {
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
    return this.originalIndex.takeReversed(n, from, filterFn)
  }

  takeFromStart(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    return this.originalIndex.takeReversedFromEnd(n, filterFn)
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
