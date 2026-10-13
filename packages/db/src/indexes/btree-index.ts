import { compareKeys } from '@tanstack/db-ivm'
import { compareKeysReversed } from '../utils/array-utils.js'
import { BTree } from '../utils/btree.js'
import { areSameValueZeroEqual, normalizeValue } from '../utils/comparison.js'
import { codedMessage, devBuild } from '../error-message.js'
import {
  BaseIndex,
  builtInIndexResolverNames,
  warnRemovalFailure,
} from './base-index.js'
import type { IndexComparisonOptions, IndexOperation } from './base-index.js'

export type BTreeIndexOptions = IndexComparisonOptions
export interface RangeQueryOptions {
  from?: any
  to?: any
  fromInclusive?: boolean
  toInclusive?: boolean
}

type SortKey = { value: any }
type Group<TKey> = SortKey & {
  keys: Map<TKey, any>
  buckets?: Map<unknown, Set<TKey>>
  representativeKey: TKey
  nextRepresentative?: IterableIterator<[TKey, any]>
}
export class BTreeIndex<
  TKey extends string | number = string | number,
> extends BaseIndex<TKey> {
  private orderedEntries = new BTree<SortKey, Group<TKey>>((a, b) =>
    this.compareFn(a.value, b.value),
  )
  private valueMap = new Map<any, Group<TKey>>()
  private indexedKeys = new Set<TKey>()

  add(key: TKey, item: any): void {
    const value = this.evaluateAddedValue(key, item)
    const exact = normalizeValue(value)
    this.addToBucket(key, value, exact)
    this.addRangeValue(value)
    this.indexedKeys.add(key)
  }

  private addToBucket(key: TKey, value: any, exact: unknown): void {
    const group = this.valueMap.get(exact)
    if (group) {
      group.keys.set(key, value)
      group.buckets?.get(exact)!.add(key)
      return
    }
    const ordered = this.orderedEntries.get({ value })
    if (ordered) {
      ordered.buckets ??= new Map([
        [normalizeValue(ordered.value), new Set(ordered.keys.keys())],
      ])
      ordered.buckets.set(exact, new Set([key]))
      ordered.keys.set(key, value)
      this.valueMap.set(exact, ordered)
    } else {
      const created = {
        value,
        keys: new Map([[key, value]]),
        representativeKey: key,
      }
      // The tree compares before the exact lookup map changes.
      this.orderedEntries.set(created, created)
      this.valueMap.set(exact, created)
    }
  }

  remove(key: TKey, item: any): void {
    let value: any
    try {
      value = this.evaluateIndexExpression(item)
    } catch (error) {
      warnRemovalFailure(key, error)
      return
    }
    const exact = normalizeValue(value)
    this.removeFromBucket(key, exact)
    this.removeRangeValue(value)
    this.indexedKeys.delete(key)
  }

  private removeFromBucket(key: TKey, exact: unknown): void {
    const group = this.valueMap.get(exact)
    if (!group?.keys.has(key)) return
    const bucket = group.buckets?.get(exact)
    if (group.buckets && !bucket?.has(key)) return
    if (group.keys.size === 1) {
      this.orderedEntries.delete(group)
    }
    bucket?.delete(key)
    group.keys.delete(key)
    if (bucket?.size === 0 || group.keys.size === 0) {
      this.valueMap.delete(exact)
      group.buckets?.delete(exact)
    }
    if (group.buckets?.size === 1) group.buckets = undefined
    if (group.keys.size && group.representativeKey === key) {
      // Advancing one iterator skips each removed Map slot at most once.
      const [nextKey, nextValue] = (group.nextRepresentative ??=
        group.keys.entries()).next().value as [TKey, any]
      group.representativeKey = nextKey
      group.value = nextValue
    }
  }

  update(key: TKey, oldItem: any, newItem: any): void {
    let oldValue: any
    let newValue: any
    try {
      oldValue = this.evaluateIndexExpression(oldItem)
      newValue = this.evaluateIndexExpression(newItem)
    } catch {
      this.remove(key, oldItem)
      this.add(key, newItem)
      return
    }
    const oldExact = normalizeValue(oldValue)
    const newExact = normalizeValue(newValue)
    const group = this.valueMap.get(newExact)
    const containsKey = group?.buckets
      ? group.buckets.get(newExact)?.has(key)
      : group?.keys.has(key)
    if (areSameValueZeroEqual(oldExact, newExact) && containsKey) {
      group!.keys.set(key, newValue)
      if (group!.representativeKey === key) group!.value = newValue
      this.removeRangeValue(oldValue)
      this.addRangeValue(newValue)
      return
    }
    this.removeFromBucket(key, oldExact)
    this.removeRangeValue(oldValue)
    this.addToBucket(key, newValue, newExact)
    this.addRangeValue(newValue)
    this.indexedKeys.add(key)
  }

  build(entries: Iterable<[TKey, any]>): void {
    this.clear()
    for (const [key, item] of entries) this.add(key, item)
  }

  clear(): void {
    this.orderedEntries.clear()
    this.valueMap.clear()
    this.indexedKeys.clear()
    this.clearRangeValues()
  }

  lookup(operation: IndexOperation, value: any): Set<TKey> {
    const result = this.lookupSupportedOperation(operation, value)
    if (result !== undefined) return result
    throw new Error(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `Operation ${operation} not supported by BTreeIndex`
        : codedMessage(101, { operation }),
    )
  }

  get keyCount(): number {
    return this.indexedKeys.size
  }

  equalityLookup(value: any): Set<TKey> {
    return new Set(this.exactBucketKeys(value))
  }

  protected exactBucketKeys(value: any): Iterable<TKey> | undefined {
    const exact = normalizeValue(value)
    const group = this.valueMap.get(exact)
    return group?.buckets ? group.buckets.get(exact) : group?.keys.keys()
  }

  rangeQuery(options: RangeQueryOptions = {}): Set<TKey> {
    const result = new Set<TKey>()
    if (this.orderedEntries.size === 0) return result
    const { from, to, fromInclusive = true, toInclusive = true } = options
    const low =
      'from' in options ? { value: from } : this.orderedEntries.minKey()!
    const high = 'to' in options ? { value: to } : this.orderedEntries.maxKey()!
    this.orderedEntries.forRange(
      low,
      high,
      !('to' in options) || toInclusive,
      (sortKey, group) => {
        if (
          'from' in options &&
          !fromInclusive &&
          this.compareFn(sortKey.value, from) === 0
        )
          return
        for (const key of group.keys.keys()) result.add(key)
      },
    )
    return result
  }

  private takeInternal(
    n: number,
    from: SortKey | undefined,
    filterFn: ((key: TKey) => boolean) | undefined,
    reversed: boolean,
  ): Array<TKey> {
    const result: Array<TKey> = []
    let pair = reversed
      ? this.orderedEntries.nextLowerPair(from)
      : this.orderedEntries.nextHigherPair(from)
    while (pair && result.length < n) {
      for (const key of [...pair[1].keys.keys()].sort(
        reversed ? compareKeysReversed : compareKeys,
      )) {
        if (filterFn?.(key) ?? true) result.push(key)
        if (result.length >= n) break
      }
      if (result.length >= n) break
      pair = reversed
        ? this.orderedEntries.nextLowerPair(pair[0])
        : this.orderedEntries.nextHigherPair(pair[0])
    }
    return result
  }

  take(n: number, from: any, filterFn?: (key: TKey) => boolean): Array<TKey> {
    return this.takeInternal(n, { value: from }, filterFn, false)
  }

  takeFromStart(n: number, filterFn?: (key: TKey) => boolean): Array<TKey> {
    return this.takeInternal(n, undefined, filterFn, false)
  }

  takeReversed(
    n: number,
    from: any,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    return this.takeInternal(n, { value: from }, filterFn, true)
  }

  takeReversedFromEnd(
    n: number,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey> {
    return this.takeInternal(n, undefined, filterFn, true)
  }
}

builtInIndexResolverNames.set(BTreeIndex, 'BTreeIndex')
