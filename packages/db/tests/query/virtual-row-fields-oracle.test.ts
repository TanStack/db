/**
 * # Which published values carry virtual row fields?
 *
 * Law and source: `VirtualRowProps` gives Collection and live-query row roots
 * `$synced`, `$origin`, `$key`, and `$collectionId`. The output contract
 * established by `includes.test.ts` keeps inline `toArray` and `materialize`
 * selections in their selected shape instead of publishing each selected value
 * as a Collection row.
 *
 * `expectsVirtualFields` is the independent model: row roots and unprojected
 * whole-row children are rows. Projected children, nested values, and opaque
 * values are values. The paired type oracle uses the same classification.
 *
 * The legal query forms exercised here are unprojected and directly selected
 * whole-row children plus object, nested-object, array, `findOne`, and Date
 * child projections. The production driver calls `createLiveQueryCollection`,
 * `preload`, `toArray`, and `materialize`. The checkpoint is `live.toArray`
 * after `preload` resolves.
 *
 * `hasVirtualProps` observes all four virtual fields. Exact `$key`, selected
 * shapes, and nonempty child results prove the intended paths ran. This oracle
 * does not cover joins, ordering, updates, callback boundaries, or sync-state
 * transitions. Prior hostile controls made projected-value enrichment and a
 * missing whole-row classification fail at these observations.
 */
import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { hasVirtualProps } from '../../src/virtual-props.js'
import { mockSyncCollectionOptions } from '../utils.js'

type Profile = { label: string }

type Row = {
  id: string
  profile: Profile
  optionalProfile?: Profile
  createdAt: Date
  tags: Array<string>
}

type VirtualFieldSubject =
  | `row-root`
  | `whole-row-child`
  | `projected-child`
  | `nested-ref`
  | `nested-value`
  | `opaque-value`

const virtualFieldNames = [
  `$key`,
  `$synced`,
  `$origin`,
  `$collectionId`,
] as const

// Only row roots and unprojected whole-row children carry virtual row fields.
function expectsVirtualFields(subject: VirtualFieldSubject): boolean {
  return subject === `row-root` || subject === `whole-row-child`
}

describe(`virtual row field runtime boundary`, () => {
  test(`matches the row and value classification after publication`, async () => {
    const createdAt = new Date(`2026-09-20T12:34:56.000Z`)
    const rows = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-row-fields-runtime-oracle-source`,
        getKey: (row) => row.id,
        initialData: [
          {
            id: `row-1`,
            profile: { label: `nested` },
            createdAt,
            tags: [`one`, `two`],
          },
        ],
      }),
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => ({
        id: row.id,
        profile: row.profile,
        createdAt: row.createdAt,
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
        wholeRows: toArray(
          q.from({ child: rows }).where(({ child }) => eq(child.id, row.id)),
        ),
        selectedWholeRows: toArray(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .select(({ child }) => child),
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

    try {
      await live.preload()

      const result = live.toArray[0]!
      const observations: Array<{
        name: string
        subject: VirtualFieldSubject
        value: unknown
      }> = [
        { name: `published query row`, subject: `row-root`, value: result },
        {
          name: `nested profile`,
          subject: `nested-value`,
          value: result.profile,
        },
        {
          name: `selected Date`,
          subject: `opaque-value`,
          value: result.createdAt,
        },
        {
          name: `toArray Date`,
          subject: `opaque-value`,
          value: result.dates[0],
        },
        {
          name: `materialized Date`,
          subject: `opaque-value`,
          value: result.firstDate,
        },
        {
          name: `whole-row child`,
          subject: `whole-row-child`,
          value: result.wholeRows[0],
        },
        {
          name: `directly selected whole-row child`,
          subject: `whole-row-child`,
          value: result.selectedWholeRows[0],
        },
        {
          name: `projected child object`,
          subject: `projected-child`,
          value: result.objects[0],
        },
        {
          name: `projected child wrapper`,
          subject: `projected-child`,
          value: result.nestedObjects[0],
        },
        {
          name: `nested projected value`,
          subject: `nested-value`,
          value: result.nestedObjects[0]!.nested,
        },
        {
          name: `selected array value`,
          subject: `opaque-value`,
          value: result.arrays[0],
        },
        {
          name: `materialized projected child`,
          subject: `projected-child`,
          value: result.firstObject,
        },
      ]

      for (const observation of observations) {
        const expectsFields = expectsVirtualFields(observation.subject)
        expect(hasVirtualProps(observation.value), observation.name).toBe(
          expectsFields,
        )
        if (!expectsFields) {
          for (const field of virtualFieldNames) {
            expect(
              field in Object(observation.value),
              `${observation.name} must not expose ${field}`,
            ).toBe(false)
          }
        }
      }

      expect(result.$key).toBe(`row-1`)

      expect(result.profile).toEqual({ label: `nested` })
      expect(`$key` in result.profile).toBe(false)

      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.dates).toHaveLength(1)
      expect(result.dates[0]).toBeInstanceOf(Date)
      expect(result.firstDate).toBeInstanceOf(Date)

      expect(result.wholeRows).toHaveLength(1)
      expect(result.wholeRows[0]!.$key).toBe(`row-1`)
      expect(result.selectedWholeRows).toHaveLength(1)
      expect(result.selectedWholeRows[0]!.$key).toBe(`row-1`)
      expect(`optionalProfile` in result.selectedWholeRows[0]!).toBe(false)
      expect(result.objects).toEqual([{ label: `nested` }])
      expect(result.nestedObjects).toEqual([{ nested: { label: `nested` } }])
      expect(result.arrays).toEqual([[`one`, `two`]])
      expect(result.firstObject).toEqual({ label: `nested` })
    } finally {
      await live.cleanup()
      await rows.cleanup()
    }
  })
})
