/**
 * Oracle owner: the compile-time boundary for virtual row fields.
 *
 * `$synced`, `$origin`, `$key`, and `$collectionId` belong to collection and
 * query rows. They remain available on root refs, but nested user objects and
 * opaque scalar child results are values rather than rows. Discriminated row
 * unions must also survive removal of their virtual fields.
 *
 * TypeScript structural equality and negative `@ts-expect-error` cells are the
 * independent judges. The paired runtime oracle verifies the same boundary on
 * published values.
 */
import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { RefLeaf } from '../../src/query/builder/types.js'
import type {
  WithVirtualProps,
  WithoutVirtualProps,
} from '../../src/virtual-props.js'

type Variant =
  | { kind: `person`; name: string }
  | { kind: `company`; legalName: string }
type VirtualVariant = WithVirtualProps<Variant, string>

type Profile = { label: string }
type Row = {
  id: string
  profile: Profile
  optionalProfile?: Profile
  nullableProfile: Profile | null
  createdAt: Date
}

const rows = createCollection(
  mockSyncCollectionOptions<Row>({
    id: `virtual-row-fields-type-oracle`,
    getKey: (row) => row.id,
    initialData: [],
  }),
)

describe(`virtual row field type boundary`, () => {
  test(`WithoutVirtualProps preserves discriminated row unions`, () => {
    expectTypeOf<WithoutVirtualProps<VirtualVariant>>().toEqualTypeOf<Variant>()
  })

  test(`query refs expose virtual fields only at row roots`, () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => {
        expectTypeOf(row.$key).toEqualTypeOf<RefLeaf<string | number>>()
        expectTypeOf(row.$synced).toEqualTypeOf<RefLeaf<boolean>>()

        // @ts-expect-error Nested user objects are not collection rows.
        row.profile.$key
        // @ts-expect-error Optional nested user objects are not collection rows.
        row.optionalProfile?.$synced
        // @ts-expect-error Nullable nested user objects are not collection rows.
        row.nullableProfile?.$origin

        return { id: row.id, profile: row.profile }
      }),
    )

    const result = collection.toArray[0]!
    expectTypeOf(result.profile).toEqualTypeOf<Profile>()
    expectTypeOf(result.$key).toEqualTypeOf<string | number>()
    // @ts-expect-error A selected nested user object remains a value, not a row.
    result.profile.$key
  })

  test(`single-row refs expose virtual fields only at row roots`, () => {
    rows.createIndex((row) => {
      expectTypeOf(row.$collectionId).toEqualTypeOf<RefLeaf<string>>()
      expectTypeOf(row.$key).toEqualTypeOf<RefLeaf<string | number>>()

      // @ts-expect-error Nested user objects are not collection rows.
      row.profile.$key
      // @ts-expect-error Optional nested user objects are not collection rows.
      row.optionalProfile?.$synced
      // @ts-expect-error Nullable nested user objects are not collection rows.
      row.nullableProfile?.$origin

      return row.id
    })
  })

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
    result.firstDate?.$synced
  })
})
