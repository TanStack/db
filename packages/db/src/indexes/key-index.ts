import { normalizeValue } from '../utils/comparison.js'
import {
  createSingleRowRefProxy,
  toExpression,
} from '../query/builder/ref-proxy.js'
import { BaseIndex } from './base-index.js'
import type { IndexOperation } from './base-index.js'
import type { BasicExpression } from '../query/ir.js'

/**
 * Synthetic read-only index over a collection's primary key.
 *
 * The collection's keyed state already provides O(1) key lookups, so this
 * index stores nothing itself — `eq`/`in` lookups delegate straight to the
 * collection. It exists so query optimization can serve equality lookups on
 * the key field (most importantly lazy joins on the primary key) without the
 * user having to create an explicit index. It is only consulted as a fallback
 * when no user-created index matches the field.
 */
export class KeyIndex<
  TKey extends string | number = string | number,
> extends BaseIndex<TKey> {
  public readonly supportedOperations = new Set<IndexOperation>([`eq`, `in`])

  private hasKey: (key: TKey) => boolean
  private getKeyCount: () => number

  constructor(
    expression: BasicExpression,
    hasKey: (key: TKey) => boolean,
    getKeyCount: () => number,
  ) {
    // Never registered in collection.indexes — the negative id keeps it
    // distinct from user-created index ids.
    super(-1, expression, `key`)
    this.hasKey = hasKey
    this.getKeyCount = getKeyCount
  }

  protected initialize(): void {}

  // The collection state is the backing store, so there is nothing to maintain.
  add(): void {}
  remove(): void {}
  update(): void {}
  build(): void {}
  clear(): void {}

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
        throw new Error(`Operation ${operation} not supported by KeyIndex`)
    }

    this.trackLookup(startTime)
    return result
  }

  equalityLookup(value: any): Set<TKey> {
    // Normalize like BasicIndex does, so a lookup value behaves the same
    // against the key field as it would against a user-created index.
    const normalizedValue = normalizeValue(value)
    return this.hasKey(normalizedValue)
      ? new Set([normalizedValue as TKey])
      : new Set()
  }

  inArrayLookup(values: Array<any>): Set<TKey> {
    const result = new Set<TKey>()
    for (const value of values) {
      const normalizedValue = normalizeValue(value)
      if (this.hasKey(normalizedValue)) {
        result.add(normalizedValue as TKey)
      }
    }
    return result
  }

  get keyCount(): number {
    return this.getKeyCount()
  }

  get supportsRangeOptimization(): boolean {
    return false
  }

  // The remaining IndexInterface members are mandated by BaseIndex's abstract
  // contract but unreachable in practice: `supports()` reports only eq/in, so
  // the optimizer and order-by never route range or ordered access here.
  // Throwing (rather than returning empty results) keeps any future call path
  // that does reach them loudly wrong instead of silently dropping rows.
  private unsupported(feature: string): never {
    throw new Error(`KeyIndex does not support ${feature}`)
  }

  rangeQuery(): Set<TKey> {
    return this.unsupported(`range queries`)
  }

  rangeQueryReversed(): Set<TKey> {
    return this.unsupported(`range queries`)
  }

  take(): Array<TKey> {
    return this.unsupported(`ordered access`)
  }

  takeFromStart(): Array<TKey> {
    return this.unsupported(`ordered access`)
  }

  takeReversed(): Array<TKey> {
    return this.unsupported(`ordered access`)
  }

  takeReversedFromEnd(): Array<TKey> {
    return this.unsupported(`ordered access`)
  }

  get orderedEntriesArray(): Array<[any, Set<TKey>]> {
    return this.unsupported(`ordered access`)
  }

  get orderedEntriesArrayReversed(): Array<[any, Set<TKey>]> {
    return this.unsupported(`ordered access`)
  }

  get indexedKeysSet(): Set<TKey> {
    return this.unsupported(`key enumeration`)
  }

  get valueMapData(): Map<any, Set<TKey>> {
    return this.unsupported(`value enumeration`)
  }
}

/**
 * Derives a {@link KeyIndex} from a collection's `getKey` function.
 *
 * `getKey` is called once with a ref proxy: when it reads a single property
 * (e.g. `(row) => row.id`), that access is captured as the key field path —
 * the same introspection `createIndex` uses for its index callback. Anything
 * else — composite keys, computed keys, or a `getKey` that throws on the
 * proxy — returns `undefined` and the collection simply has no implicit key
 * index.
 */
export function createKeyIndexFromGetKey<
  T extends object,
  TKey extends string | number,
>(
  getKey: (item: T) => TKey,
  hasKey: (key: TKey) => boolean,
  getKeyCount: () => number,
): KeyIndex<TKey> | undefined {
  let expression: BasicExpression
  try {
    const row = createSingleRowRefProxy<T>()
    expression = toExpression(getKey(row as unknown as T))
  } catch {
    return undefined
  }
  if (expression.type !== `ref` || expression.path.length === 0) {
    return undefined
  }
  return new KeyIndex(expression, hasKey, getKeyCount)
}
