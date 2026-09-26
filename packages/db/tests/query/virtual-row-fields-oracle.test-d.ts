/**
 * # Which types represent virtual-field-bearing rows?
 *
 * Law and source: `VirtualRowProps` gives Collection and live-query row roots
 * `$synced`, `$origin`, `$key`, and `$collectionId`. The reusable `Ref<T>`
 * contract in `docs/guides/live-queries.md` accepts nested refs without claiming
 * those refs are rows. The output contract established by `includes.test.ts`
 * keeps inline `toArray` and `materialize` selections in their selected shape.
 *
 * The local type relations classify row roots and unprojected whole-row
 * children as rows. Projected children, nested refs, nested values, and opaque
 * values are values. Discriminated row unions must survive virtual-field
 * removal. A directly selected unmatched nullable row is an empty object, so
 * its known row fields must remain available as optional values.
 *
 * Legal forms include required, optional, and nullable nested `Ref` and
 * `SingleRowRefProxy` helpers; virtual-field-specific root helpers; and inline
 * `toArray` or `materialize` queries with unprojected or directly selected
 * whole rows, an unmatched left-joined whole row, object, nested-object, array,
 * `findOne`, and Date results.
 *
 * The production type paths are `RefsForContext`, `SingleRowRefProxy`, and
 * `GetInlineResult`. The checkpoint is the inferred callback or published
 * `collection.toArray` type. Structural equality checks positive facts;
 * `@ts-expect-error` checks reject virtual fields on values.
 *
 * This oracle does not cover joins, runtime metadata values, publication
 * timing, or mutations. The paired runtime oracle checks published values.
 * Reach is visible through both production callbacks and every selected output.
 * Hostile controls proved that virtual-field-bearing defaults break six
 * nested-helper cells and `GetRawResult` enrichment breaks eleven
 * projected-value cells.
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
import type { SingleRowRefProxy } from '../../src/query/builder/ref-proxy.js'
import type { Ref } from '../../src/query/index.js'
import type {
  WithVirtualProps,
  WithoutVirtualProps,
} from '../../src/virtual-props.js'

type Variant =
  | { kind: `person`; name: string }
  | { kind: `company`; legalName: string }

type VirtualFieldSubject =
  | `row-root`
  | `whole-row-child`
  | `projected-child`
  | `nested-ref`
  | `nested-value`
  | `opaque-value`

// Only row roots and unprojected whole-row children carry virtual row fields.
type PublishedValueFor<
  T extends object,
  TSubject extends VirtualFieldSubject,
> = TSubject extends `row-root` | `whole-row-child`
  ? WithVirtualProps<T, string | number>
  : T

type QueryRefFor<
  T,
  TSubject extends `row-root` | `nested-ref`,
> = TSubject extends `row-root` ? Ref<T, false, true> : Ref<T>

type IndexRefFor<
  T extends object,
  TSubject extends `row-root` | `nested-ref`,
> = TSubject extends `row-root`
  ? SingleRowRefProxy<T, string | number, true>
  : SingleRowRefProxy<T>

type VirtualVariant = PublishedValueFor<Variant, `row-root`>

type Profile = { label: string }
type Row = {
  id: string
  profile: Profile
  optionalProfile?: Profile
  nullableProfile: Profile | null
  createdAt: Date
  tags: Array<string>
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
    const profileLabelIs = (profile: QueryRefFor<Profile, `nested-ref`>) =>
      eq(profile.label, `nested`)
    const rowKey = (row: QueryRefFor<Row, `row-root`>) => row.$key

    const collection = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => {
        expectTypeOf(row.$key).toEqualTypeOf<RefLeaf<string | number>>()
        expectTypeOf(row.$synced).toEqualTypeOf<RefLeaf<boolean>>()
        profileLabelIs(row.profile)
        if (row.optionalProfile) profileLabelIs(row.optionalProfile)
        if (row.nullableProfile) profileLabelIs(row.nullableProfile)
        rowKey(row)

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
    const profileLabelIs = (profile: IndexRefFor<Profile, `nested-ref`>) =>
      eq(profile.label, `nested`)
    const rowKey = (row: IndexRefFor<Row, `row-root`>) => row.$key

    rows.createIndex((row) => {
      expectTypeOf(row.$collectionId).toEqualTypeOf<RefLeaf<string>>()
      expectTypeOf(row.$key).toEqualTypeOf<RefLeaf<string | number>>()
      profileLabelIs(row.profile)
      if (row.optionalProfile) profileLabelIs(row.optionalProfile)
      if (row.nullableProfile) profileLabelIs(row.nullableProfile)
      rowKey(row)

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

  test(`projected child metadata follows row-shaped results`, () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => ({
        id: row.id,
        wholeRows: toArray(
          q.from({ child: rows }).where(({ child }) => eq(child.id, row.id)),
        ),
        selectedWholeRows: toArray(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => {
              expectTypeOf(child).toEqualTypeOf<
                Ref<WithVirtualProps<Row, string | number>, false, true>
              >()
              return child
            }),
        ),
        unmatchedRows: toArray(
          q
            .from({ child: rows })
            .leftJoin({ missing: rows }, ({ child, missing }) =>
              eq(child.id, missing.id),
            )
            .select(({ missing }) => missing),
        ),
        objects: toArray(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => ({ label: child.profile.label })),
        ),
        nestedObjects: toArray(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => ({
              nested: { label: child.profile.label },
            })),
        ),
        arrays: toArray(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => child.tags),
        ),
        firstObject: materialize(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => ({ label: child.profile.label }))
            .findOne(),
        ),
      })),
    )

    const result = collection.toArray[0]!
    expectTypeOf(result.wholeRows[0]!).toEqualTypeOf<
      PublishedValueFor<Row, `whole-row-child`>
    >()
    expectTypeOf(result.selectedWholeRows[0]!.$key).toEqualTypeOf<
      string | number
    >()
    expectTypeOf(result.selectedWholeRows[0]!.$synced).toEqualTypeOf<boolean>()
    expectTypeOf(result.selectedWholeRows[0]!.$origin).toEqualTypeOf<
      `local` | `remote`
    >()
    expectTypeOf(
      result.selectedWholeRows[0]!.$collectionId,
    ).toEqualTypeOf<string>()
    expectTypeOf(result.selectedWholeRows[0]!).toEqualTypeOf<
      PublishedValueFor<Row, `whole-row-child`>
    >()
    expectTypeOf(result.unmatchedRows[0]!.id).toEqualTypeOf<
      string | undefined
    >()
    expectTypeOf(result.unmatchedRows[0]!.$key).toEqualTypeOf<
      string | number | undefined
    >()
    expectTypeOf(result.objects[0]!).toEqualTypeOf<
      PublishedValueFor<{ label: string }, `projected-child`>
    >()
    expectTypeOf(result.nestedObjects[0]!).toEqualTypeOf<
      PublishedValueFor<{ nested: { label: string } }, `projected-child`>
    >()
    expectTypeOf(result.firstObject).toEqualTypeOf<
      PublishedValueFor<{ label: string }, `projected-child`> | undefined
    >()
    expectTypeOf(result.arrays[0]!).toEqualTypeOf<
      PublishedValueFor<Array<string>, `opaque-value`>
    >()

    // @ts-expect-error Projected child objects are values, not rows.
    result.objects[0]!.$key
    // @ts-expect-error Projected child objects remain values when nested.
    result.nestedObjects[0]!.$key
    // @ts-expect-error Nested projection objects are values, not rows.
    result.nestedObjects[0]!.nested.$key
    // @ts-expect-error Selected array values are opaque values, not rows.
    result.arrays[0]!.$key
    // @ts-expect-error Projected findOne results are values, not rows.
    result.firstObject?.$key
  })
})
