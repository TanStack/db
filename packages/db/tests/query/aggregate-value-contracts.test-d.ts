import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import {
  add,
  avg,
  coalesce,
  count,
  eq,
  max,
  min,
  sum,
} from '../../src/query/builder/functions.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { Aggregate, BasicExpression } from '../../src/query/ir.js'
import type { RefProxy } from '../../src/query/builder/ref-proxy.js'
import type { RefLeaf } from '../../src/query/builder/types.js'
import type { OutputWithVirtual } from '../utils.js'

type BrandedAmount = number & { readonly __brand: `amount` }

type AggregateRow = {
  id: number
  group: string
  amount: number
  maybeAmount?: number | null
  label: string
  createdAt: Date
  sequence: bigint
  enabled: boolean
  temporalLike: {
    year: number
    month: number
    day: number
  }
}

const rows = createCollection(
  mockSyncCollectionOptions<AggregateRow>({
    id: `aggregate-value-contracts`,
    getKey: (row) => row.id,
    initialData: [],
  }),
)

const details = createCollection(
  mockSyncCollectionOptions<{
    id: number
    rowId: number
    amount: BrandedAmount
  }>({
    id: `aggregate-value-contract-details`,
    getKey: (row) => row.id,
    initialData: [],
  }),
)

describe(`aggregate value contracts`, () => {
  test(`numeric and orderable aggregates expose their runtime result domains`, () => {
    const result = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: rows })
          .groupBy(({ row }) => row.group)
          .select(({ row }) => {
            expectTypeOf(count(row.maybeAmount)).toEqualTypeOf<
              Aggregate<number>
            >()
            expectTypeOf(sum(row.amount)).toEqualTypeOf<Aggregate<number>>()
            expectTypeOf(avg(row.amount)).toEqualTypeOf<Aggregate<number>>()
            expectTypeOf(sum(row.maybeAmount)).toEqualTypeOf<
              Aggregate<number>
            >()
            expectTypeOf(avg(row.maybeAmount)).toEqualTypeOf<
              Aggregate<number>
            >()
            expectTypeOf(min(row.label)).toEqualTypeOf<Aggregate<string>>()
            expectTypeOf(max(row.createdAt)).toEqualTypeOf<Aggregate<Date>>()
            expectTypeOf(min(row.sequence)).toEqualTypeOf<Aggregate<bigint>>()

            return {
              group: row.group,
              count: count(row.maybeAmount),
              total: sum(row.amount),
              average: avg(row.amount),
              maybeTotal: sum(row.maybeAmount),
              maybeAverage: avg(row.maybeAmount),
              firstLabel: min(row.label),
              latest: max(row.createdAt),
              firstSequence: min(row.sequence),
            }
          }),
    })

    expectTypeOf(result.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          group: string
          count: number
          total: number
          average: number
          maybeTotal: number
          maybeAverage: number
          firstLabel: string
          latest: Date
          firstSequence: bigint
        }>
      >
    >()
  })

  test(`rejects values outside each aggregate's documented domain`, () => {
    const loose = undefined as unknown as RefLeaf<any>
    const unknownValue = undefined as unknown as RefLeaf<unknown>
    const nullLeaf = undefined as unknown as RefLeaf<null>
    const nullProxy = undefined as unknown as RefProxy<null>

    expectTypeOf(sum(loose)).toEqualTypeOf<Aggregate<number>>()
    expectTypeOf(min(loose)).toEqualTypeOf<Aggregate<any>>()
    // @ts-expect-error null-only wrappers have no numeric domain
    sum(nullLeaf)
    // @ts-expect-error null-only wrappers have no orderable domain
    min(nullProxy)

    createLiveQueryCollection({
      query: (q) =>
        q.from({ row: rows }).select(({ row }) => ({
          // sum() and avg() are numeric aggregates. String coercion would
          // return a number while falsely advertising a string result.
          // @ts-expect-error string values are not a sum domain
          stringSum: sum(row.label),
          // @ts-expect-error dates are not an average domain
          dateAverage: avg(row.createdAt),
          // min()/max() support number, string, bigint, and Date only.
          // @ts-expect-error booleans have no supported aggregate ordering
          booleanMinimum: min(row.enabled),
          // @ts-expect-error Temporal-like objects are not supported yet
          temporalMaximum: max(row.temporalLike),
          // @ts-expect-error unknown values must be narrowed first
          unknownSum: sum(unknownValue),
          // @ts-expect-error null alone has no orderable value domain
          nullMinimum: min(null),
        })),
    })
  })

  test(`supported generic wrappers compose without widening their domains`, () => {
    const sumNumber = <T extends number>(value: T) => sum(value)
    const sumNumericRef = <T extends RefLeaf<number | null | undefined>>(
      value: T,
    ) => sum(value)
    const avgNumericExpression = <
      T extends BasicExpression<number | null | undefined>,
    >(
      value: T,
    ) => avg(value)
    const minOrderableRef = <
      T extends RefLeaf<number | string | bigint | Date | null | undefined>,
    >(
      value: T,
    ) => min(value)
    const maxOrderableValue = <T extends number | string | bigint | Date>(
      value: T,
    ) => max(value)

    const branded = 1 as BrandedAmount
    const nullableBrandedRef = undefined as unknown as RefLeaf<
      BrandedAmount | null | undefined,
      true
    >
    const mixedOrderableRef = undefined as unknown as RefLeaf<number | string>

    expectTypeOf(sumNumber(branded)).toEqualTypeOf<Aggregate<number>>()
    expectTypeOf(sum(1)).toEqualTypeOf<Aggregate<number>>()
    expectTypeOf(avg(1)).toEqualTypeOf<Aggregate<number>>()
    expectTypeOf(sumNumericRef(nullableBrandedRef)).toEqualTypeOf<
      Aggregate<number>
    >()
    expectTypeOf(avgNumericExpression(add(1, 2))).toEqualTypeOf<
      Aggregate<number>
    >()
    expectTypeOf(sum(coalesce(nullableBrandedRef, 0))).toEqualTypeOf<
      Aggregate<number>
    >()
    expectTypeOf(minOrderableRef(mixedOrderableRef)).toMatchTypeOf<Aggregate>()
    expectTypeOf(min(mixedOrderableRef)).toEqualTypeOf<
      Aggregate<number | string>
    >()
    expectTypeOf(maxOrderableValue(new Date())).toEqualTypeOf<Aggregate<Date>>()

    type BroadExpressionLike =
      | Aggregate
      | BasicExpression
      | RefProxy<any>
      | RefLeaf<any>
      | string
      | number
      | boolean
      | bigint
      | Date
      | null
      | undefined
      | Array<unknown>

    const unsupportedBroadForwarder = <T extends BroadExpressionLike>(
      value: T,
    ) => {
      // @ts-expect-error an unconstrained expression may not be numeric
      sum(value)
      // @ts-expect-error an unconstrained expression may not be numeric
      avg(value)
      // @ts-expect-error an unconstrained expression may not be orderable
      min(value)
      // @ts-expect-error an unconstrained expression may not be orderable
      max(value)
    }

    expectTypeOf(unsupportedBroadForwarder).toBeFunction()
  })

  test(`left-join nullable branded refs remain valid numeric inputs`, () => {
    createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: rows })
          .leftJoin({ detail: details }, ({ row, detail }) =>
            eq(row.id, detail.rowId),
          )
          .groupBy(({ row }) => row.group)
          .select(({ row, detail }) => {
            expectTypeOf(sum(detail.amount)).toEqualTypeOf<Aggregate<number>>()
            return {
              group: row.group,
              total: sum(detail.amount),
            }
          }),
    })
  })
})
