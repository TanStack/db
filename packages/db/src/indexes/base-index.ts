import { compileSingleRowExpression } from '../query/compiler/evaluators.js'
import { comparisonFunctions } from '../query/builder/functions.js'
import { DEFAULT_COMPARE_OPTIONS, deepEquals } from '../utils.js'
import { makeCheckedComparator, makeComparator } from '../utils/comparison.js'
import { codedMessage, devBuild } from '../error-message.js'
import type { CompiledSingleRowExpression } from '../query/compiler/evaluators.js'
import type { RangeQueryOptions } from './btree-index.js'
import type { CompareOptions } from '../query/builder/types.js'
import type { BasicExpression, OrderByDirection } from '../query/ir.js'

function normalizeLocaleOptions(options: object | undefined): object {
  return Object.fromEntries(
    Object.entries(options ?? {}).filter(([, value]) => value !== undefined),
  )
}

function canonicalizeLocale(locale: string | undefined): string | undefined {
  return locale === undefined ? undefined : Intl.getCanonicalLocales(locale)[0]
}

type LocaleCompareOptions = CompareOptions & {
  stringSort: `locale`
  locale?: string
  localeOptions?: object
}

function resolveStringSort(
  options: CompareOptions,
): NonNullable<CompareOptions[`stringSort`]> {
  return options.stringSort ?? DEFAULT_COMPARE_OPTIONS.stringSort!
}

/**
 * Operations that indexes can support, imported from available comparison functions
 */
export const IndexOperation = comparisonFunctions

export const builtInIndexResolverNames = new WeakMap<object, string>()

/**
 * Type for index operation values
 */
export type IndexOperation = (typeof comparisonFunctions)[number]

/** The read-side surface consumers use on a resolved (possibly reversed) index. */
export type IndexReader<TKey extends string | number = string | number> = Pick<
  IndexInterface<TKey>,
  | `lookup`
  | `rangeQuery`
  | `take`
  | `takeFromStart`
  | `keyCount`
  | `supports`
  | `supportsRangeOptimization`
  | `canOptimizeRangeFor`
>

export interface IndexInterface<
  TKey extends string | number = string | number,
> {
  add: (key: TKey, item: any) => void
  remove: (key: TKey, item: any) => void
  update: (key: TKey, oldItem: any, newItem: any) => void

  build: (entries: Iterable<[TKey, any]>) => void
  clear: () => void

  lookup: (operation: IndexOperation, value: any) => Set<TKey>

  equalityLookup: (value: any) => Set<TKey>
  inArrayLookup: (values: Array<any>) => Set<TKey>

  rangeQuery: (options: RangeQueryOptions) => Set<TKey>
  rangeQueryReversed: (options: RangeQueryOptions) => Set<TKey>

  take: (
    n: number,
    from: unknown,
    filterFn?: (key: TKey) => boolean,
  ) => Array<TKey>
  takeFromStart: (n: number, filterFn?: (key: TKey) => boolean) => Array<TKey>
  takeReversed: (
    n: number,
    from: unknown,
    filterFn?: (key: TKey) => boolean,
  ) => Array<TKey>
  takeReversedFromEnd: (
    n: number,
    filterFn?: (key: TKey) => boolean,
  ) => Array<TKey>

  get keyCount(): number
  supports: (operation: IndexOperation) => boolean

  /**
   * Whether range lookups (gt/gte/lt/lte) on this index can be trusted to
   * return every matching key. Range traversal relies on the index ordering, so
   * it is unsafe when the index uses a custom comparator, whose order may not
   * match the WHERE evaluator's relational operators. Callers must fall back to
   * a full scan when this is `false`.
   */
  get supportsRangeOptimization(): boolean

  /**
   * Whether the live values in this index share the predicate operand's
   * relational domain. Mixed domains can sort differently in the index and
   * WHERE evaluator, which can make a range lookup omit matching rows.
   */
  canOptimizeRangeFor?: (value: unknown) => boolean

  matchesField: (fieldPath: Array<string>) => boolean
  matchesCompareOptions: (compareOptions: CompareOptions) => boolean
  matchesDirection: (direction: OrderByDirection) => boolean
}

/**
 * Base abstract class that all index types extend
 */
export abstract class BaseIndex<
  TKey extends string | number = string | number,
> implements IndexInterface<TKey> {
  public readonly id: number
  public readonly name?: string
  public readonly expression: BasicExpression
  public abstract readonly supportedOperations: Set<IndexOperation>
  protected readonly compareOptions: CompareOptions
  /**
   * Orders indexed values. Every result is checked, because a custom
   * comparator or custom collation may be supplied by the user.
   */
  protected readonly compareFn: (a: any, b: any) => number
  private compiledIndexEvaluator: CompiledSingleRowExpression | undefined
  /**
   * A user-supplied comparator's ordering may not match the WHERE evaluator's
   * relational operators.
   */
  protected readonly hasCustomComparator: boolean
  private rangeValueDomains = new Map<string, number>()

  constructor(
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: any,
  ) {
    this.id = id
    this.expression = expression
    this.compareOptions = options?.compareOptions ?? DEFAULT_COMPARE_OPTIONS
    this.hasCustomComparator = options?.compareFn != null
    this.compareFn = makeCheckedComparator(
      options?.compareFn ?? makeComparator(this.compareOptions),
    )
    this.name = name
    this.initialize(options)
  }

  // Abstract methods that each index type must implement
  abstract add(key: TKey, item: any): void
  abstract remove(key: TKey, item: any): void
  abstract update(key: TKey, oldItem: any, newItem: any): void
  abstract build(entries: Iterable<[TKey, any]>): void
  abstract clear(): void
  abstract lookup(operation: IndexOperation, value: any): Set<TKey>
  abstract take(
    n: number,
    from: unknown,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey>
  abstract takeFromStart(
    n: number,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey>
  abstract takeReversed(
    n: number,
    from: unknown,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey>
  abstract takeReversedFromEnd(
    n: number,
    filterFn?: (key: TKey) => boolean,
  ): Array<TKey>
  abstract get keyCount(): number
  abstract equalityLookup(value: any): Set<TKey>
  abstract inArrayLookup(values: Array<any>): Set<TKey>
  abstract rangeQuery(options: RangeQueryOptions): Set<TKey>

  // Common methods
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

  supports(operation: IndexOperation): boolean {
    return this.supportedOperations.has(operation)
  }

  get supportsRangeOptimization(): boolean {
    return !this.hasCustomComparator
  }

  protected addRangeValue(value: unknown): void {
    const domain = rangeValueDomain(value)
    if (domain === undefined) return
    this.rangeValueDomains.set(
      domain,
      (this.rangeValueDomains.get(domain) ?? 0) + 1,
    )
  }

  protected removeRangeValue(value: unknown): void {
    const domain = rangeValueDomain(value)
    if (domain === undefined) return
    const count = this.rangeValueDomains.get(domain)
    if (count === undefined) return
    if (count === 1) this.rangeValueDomains.delete(domain)
    else this.rangeValueDomains.set(domain, count - 1)
  }

  protected clearRangeValues(): void {
    this.rangeValueDomains.clear()
  }

  canOptimizeRangeFor(value: unknown): boolean {
    const domain = rangeValueDomain(value)
    if (domain === undefined) return true
    if (!isNativeRangeDomain(domain)) return false
    return (
      this.rangeValueDomains.size === 0 ||
      (this.rangeValueDomains.size === 1 && this.rangeValueDomains.has(domain))
    )
  }

  matchesField(fieldPath: Array<string>): boolean {
    return (
      this.expression.type === `ref` &&
      this.expression.path.length === fieldPath.length &&
      this.expression.path.every((part, i) => part === fieldPath[i])
    )
  }

  /**
   * Checks if the compare options match the index's compare options.
   * The direction is ignored because the index can be reversed if the direction is different.
   */
  matchesCompareOptions(compareOptions: CompareOptions): boolean {
    const indexCompareOptions = this.compareOptions
    const indexStringSort = resolveStringSort(indexCompareOptions)
    const requestedStringSort = resolveStringSort(compareOptions)

    if (
      indexCompareOptions.nulls !== compareOptions.nulls ||
      indexStringSort !== requestedStringSort
    ) {
      return false
    }

    if (indexStringSort === `custom` && requestedStringSort === `custom`) {
      return (
        indexCompareOptions.stringSort === `custom` &&
        compareOptions.stringSort === `custom` &&
        indexCompareOptions.compare === compareOptions.compare
      )
    }

    if (indexStringSort !== `locale` || requestedStringSort !== `locale`) {
      return true
    }

    const indexLocaleOptions = indexCompareOptions as LocaleCompareOptions
    const requestedLocaleOptions = compareOptions as LocaleCompareOptions

    return (
      canonicalizeLocale(indexLocaleOptions.locale) ===
        canonicalizeLocale(requestedLocaleOptions.locale) &&
      deepEquals(
        normalizeLocaleOptions(indexLocaleOptions.localeOptions),
        normalizeLocaleOptions(requestedLocaleOptions.localeOptions),
      )
    )
  }

  /**
   * Checks if the index matches the provided direction.
   */
  matchesDirection(direction: OrderByDirection): boolean {
    return this.compareOptions.direction === direction
  }

  protected abstract initialize(options?: any): void

  protected evaluateIndexExpression(item: any): any {
    const evaluator = (this.compiledIndexEvaluator ??=
      compileSingleRowExpression(this.expression))
    return evaluator(item as Record<string, unknown>)
  }

  /** The indexed value of a row being added. A throwing expression fails the write. */
  protected evaluateAddedValue(key: TKey, item: any): any {
    try {
      return this.evaluateIndexExpression(item)
    } catch (error) {
      throw new Error(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `Failed to evaluate index expression for key ${key}: ${error}`
          : codedMessage(99, { key, error }),
        { cause: error },
      )
    }
  }
}

function rangeValueDomain(value: unknown): string | undefined {
  if (value == null) return undefined
  if (value instanceof Date) return `date`
  return typeof value
}

function isNativeRangeDomain(domain: string): boolean {
  return (
    domain === `number` ||
    domain === `bigint` ||
    domain === `boolean` ||
    domain === `string` ||
    domain === `date`
  )
}

/**
 * Type for index constructor
 */
export type IndexConstructor<TKey extends string | number = string | number> =
  new (
    id: number,
    expression: BasicExpression,
    name?: string,
    options?: any,
  ) => BaseIndex<TKey>

/** A row being removed whose expression throws: warn, and skip the row. */
export function warnRemovalFailure(key: unknown, error: unknown): void {
  console.warn(
    devBuild() && process.env.NODE_ENV !== `production`
      ? `Failed to evaluate index expression for key ${key} during removal:`
      : codedMessage(216, { key }),
    error,
  )
}
