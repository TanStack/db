import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { avg, count, max, min, sum } from '../../src/query/builder/functions.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { Aggregate } from '../../src/query/ir.js'
import type { RefLeaf } from '../../src/query/builder/types.js'
import type { OutputWithVirtual } from '../utils.js'

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

    expectTypeOf(sum(loose)).toEqualTypeOf<Aggregate<number>>()
    expectTypeOf(min(loose)).toEqualTypeOf<Aggregate<any>>()

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
})
