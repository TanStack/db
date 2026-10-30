// Ordinary type test for virtual row fields: opaque scalar child results,
// compared with written types. The row and value classification law is owned
// by virtual-row-fields-types-oracle.test.ts.
import { describe, expectTypeOf, test } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { rows } from './virtual-row-fields-type-fixture.js'

describe(`virtual row field type boundary`, () => {
  test(`opaque scalar child results do not gain virtual row fields`, () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => ({
        id: row.id,
        dates: toArray(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => child.createdAt),
        ),
        firstDate: materialize(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => child.createdAt)
            .findOne(),
        ),
      })),
    )

    const result = collection.toArray[0]!
    expectTypeOf(result.dates[0]!).toEqualTypeOf<Date>()
    expectTypeOf(result.firstDate).toEqualTypeOf<Date | undefined>()

    // @ts-expect-error Date values are not rows and have no virtual row fields.
    result.dates[0]!.$key
    // @ts-expect-error Materialized Date values are not rows either.
    result.firstDate?.$hasPendingWrites
  })
})
