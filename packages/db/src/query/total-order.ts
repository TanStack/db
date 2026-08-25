import { compareKeys } from '@tanstack/db-ivm'
import { makeComparator } from '../utils/comparison.js'
import { compileSingleRowExpression } from './compiler/evaluators.js'
import type { CollectionLike, StringCollationConfig } from '../types.js'
import type { CompareOptions } from './builder/types.js'
import type { OrderBy, OrderByClause } from './ir.js'

export type TotalOrderBoundary<TKey extends string | number = string | number> =
  {
    key: TKey
    values: ReadonlyArray<unknown>
  }

/** Resolve every comparison option which can affect ordered membership. */
export function resolveOrderBy(
  orderBy: OrderBy,
  defaults: StringCollationConfig,
): OrderBy {
  return orderBy.map((clause) => ({
    expression: clause.expression,
    compareOptions: resolveCompareOptions(clause, defaults),
  }))
}

export function resolveCompareOptions(
  clause: OrderByClause,
  defaults: StringCollationConfig,
): CompareOptions {
  if (clause.compareOptions.stringSort !== undefined) {
    return clause.compareOptions
  }

  return {
    ...defaults,
    direction: clause.compareOptions.direction,
    nulls: clause.compareOptions.nulls,
  }
}

/**
 * One executable total order for source rows. Query terms compare first; the
 * public collection key is the final, ascending deterministic tie-breaker.
 */
export class TotalOrder<
  TRow extends object = object,
  TKey extends string | number = string | number,
> {
  readonly orderBy: OrderBy
  private readonly terms: ReadonlyArray<{
    extract: (row: TRow) => unknown
    compare: (left: unknown, right: unknown) => number
  }>

  constructor(orderBy: OrderBy, collection: CollectionLike<TRow, TKey>) {
    this.orderBy = resolveOrderBy(orderBy, collection.compareOptions)
    this.terms = this.orderBy.map((clause) => ({
      extract: compileSingleRowExpression(clause.expression) as (
        row: TRow,
      ) => unknown,
      compare: makeComparator(clause.compareOptions),
    }))
  }

  values(row: TRow): Array<unknown> {
    return this.terms.map(({ extract }) => extract(row))
  }

  boundary(row: TRow, key: TKey): TotalOrderBoundary<TKey> {
    return { key, values: this.values(row) }
  }

  compareEntries(
    left: readonly [TKey, TRow],
    right: readonly [TKey, TRow],
  ): number {
    for (const { extract, compare } of this.terms) {
      const result = compare(extract(left[1]), extract(right[1]))
      if (result !== 0) return result
    }
    return compareKeys(left[0], right[0])
  }

  compareBoundary(
    left: TotalOrderBoundary<TKey>,
    right: TotalOrderBoundary<TKey>,
  ): number {
    for (let index = 0; index < this.terms.length; index++) {
      const result = this.terms[index]!.compare(
        left.values[index],
        right.values[index],
      )
      if (result !== 0) return result
    }
    return compareKeys(left.key, right.key)
  }
}
