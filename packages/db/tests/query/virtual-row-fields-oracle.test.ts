/**
 * # Which published values carry virtual row fields?
 *
 * Law and source: `VirtualRowProps` gives Collection and live-query row roots
 * `$hasPendingWrites`, `$origin`, `$key`, and `$collectionId`. The output contract
 * established by `includes.test.ts` keeps inline `toArray` and `materialize`
 * selections in their selected shape instead of publishing each selected value
 * as a Collection row. Whole-row roots retain source metadata; ordinary
 * projections receive the live-query Collection's metadata. An explicit
 * selected virtual name cannot replace source metadata at root publication.
 *
 * `expectsVirtualFields` is the independent model: row roots and unprojected
 * whole-row children are rows. Projected children, nested values, and opaque
 * values are values. The paired type oracle uses the same classification.
 * A directly selected unmatched nullable row is `{}` because direct selection
 * merges the source row into a new object. Its known row fields are optional.
 *
 * The legal query forms exercised here are expression-projected, unprojected,
 * and functional root rows; unprojected and directly selected whole-row
 * children; an unmatched left-joined whole row; matched and unmatched
 * whole-row joins, including an extended spread and both orders of two source
 * spreads; a Collection-valued child with colliding selected metadata
 * and its inline-value control; and object, nested-object, array, `findOne`,
 * and Date child projections. The production
 * driver calls `createLiveQueryCollection`, `preload`, `toArray`, and
 * `materialize`. The checkpoint is `live.toArray` after `preload` resolves.
 *
 * The refinement check observes each field directly as well as through
 * `hasVirtualProps`, so a missing field cannot hide behind the production
 * classifier. Exact `$key`, selected shapes, and nonempty child results prove
 * the intended paths ran. This oracle
 * does not cover ordering, arbitrary joined projections, framework receiving
 * boundaries, or sync-state transitions beyond one pending joined-row update.
 * The selected joined row is compared with the joined source's public row at
 * preload, pending-write, and settled cuts; a FROM-source selection, two
 * opposite spread orders, and an unmatched RIGHT join distinguish a
 * main-source, first-spread, or last-join shortcut. The
 * projection grammar compares source metadata for direct source returns and
 * structured spreads, and output Collection metadata for new objects, including
 * functional spreads (maintainer decision). Virtual-name collisions cannot
 * alter attribution. Supplemental facade and inline witnesses live in
 * `virtual-row-fields.test.ts`. The root-shape
 * matrix rejects the wrong rule that only expression projections receive
 * virtual row fields. Prior hostile controls made projected-value
 * enrichment and a missing whole-row classification fail at these
 * observations. `checkWithCleanup` retains the primary mismatch as the cause
 * when Collection cleanup also fails and attempts every cleanup.
 */
import { afterAll, describe, expect, test, vi } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { hasVirtualProps } from '../../src/virtual-props.js'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import { mockSyncCollectionOptions } from '../utils.js'
import {
  checkWithCleanup,
  virtualFieldNames,
} from './virtual-row-fields-support.js'

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

// Only row roots and unprojected whole-row children carry virtual row fields.
function expectsVirtualFields(subject: VirtualFieldSubject): boolean {
  return subject === `row-root` || subject === `whole-row-child`
}

// Each observed value publishes the virtual row fields exactly when the model
// classifies its subject as a row, so a missing or leaked field fails at the
// observation that shows it.
function expectPublishedFieldClassification(
  observations: Array<{
    name: string
    subject: VirtualFieldSubject
    value: unknown
  }>,
): void {
  for (const observation of observations) {
    const expectsFields = expectsVirtualFields(observation.subject)
    expect(hasVirtualProps(observation.value), observation.name).toBe(
      expectsFields,
    )
    for (const field of virtualFieldNames) {
      expect(
        field in Object(observation.value),
        `${observation.name} ${expectsFields ? `must expose` : `must not expose`} ${field}`,
      ).toBe(expectsFields)
    }
  }
}

declareOracle({
  check: [expectPublishedFieldClassification, checkRootMetadata],
  model: [expectsVirtualFields, sourceOwnsMetadata],
})

// The independent attribution law uses authoring shape, never selected values.
function sourceOwnsMetadata(shape: string): boolean {
  return shape === `structured-spread` || shape === `functional-direct`
}

function checkRootMetadata(
  actual: Record<(typeof virtualFieldNames)[number], unknown>,
  expected: Record<(typeof virtualFieldNames)[number], unknown>,
): void {
  for (const field of virtualFieldNames)
    expect(actual[field], field).toBe(expected[field])
}

const metadataReach = createOracleReach(`root metadata`, [
  `joined-pending-source`,
  `single-pending-source`,
  `colliding-projection`,
  `functional-direct`,
])
afterAll(() => metadataReach.assertReached())

/**
 * Projection shape controls attribution, not the spelling of selected fields.
 * An authored new object has its own live-query metadata; a direct source or
 * structured spread retains source metadata. A functional spread is a new
 * object (maintainer decision). The finite grammar crosses all four reserved
 * collisions and their union with joined and single sources. The clean sibling
 * supplies only the compiler-generated key; Collection IDs and pending status
 * come from the independent shape rule. A held source update distinguishes
 * source metadata from output metadata before and after settlement.
 */
test.each(
  [false, true].flatMap((joined) =>
    [`none`, ...virtualFieldNames, `all`].flatMap((collision) =>
      [
        `structured-projection`,
        `structured-spread`,
        `functional-projection`,
        `functional-spread`,
        `functional-direct`,
      ]
        .filter(
          (shape) => shape !== `functional-direct` || collision === `none`,
        )
        .map((shape) => ({ joined, collision, shape })),
    ),
  ),
)(
  `attributes root metadata by projection shape: %j`,
  async ({ joined, collision, shape }) => {
    metadataReach.beginHistory()
    const parents = createCollection(
      mockSyncCollectionOptions<{ id: string }>({
        id: `metadata-parent`,
        getKey: (row) => row.id,
        initialData: [{ id: `parent` }],
      }),
    )
    const rows = createCollection(
      mockSyncCollectionOptions<{
        id: string
        parentId: string
        label: string
      }>({
        id: `metadata-child`,
        getKey: (row) => row.id,
        initialData: [{ id: `child`, parentId: `parent`, label: `before` }],
      }),
    )
    const overrides: Record<string, unknown> = {}
    for (const field of virtualFieldNames) {
      if (collision === field || collision === `all`)
        overrides[field] = field === `$hasPendingWrites` ? false : `spoof`
    }
    const live = createLiveQueryCollection((q) => {
      const base = joined
        ? q
            .from({ parent: parents })
            .innerJoin({ chosen: rows }, ({ parent, chosen }) =>
              eq(parent.id, chosen.parentId),
            )
        : q.from({ chosen: rows })
      if (shape === `functional-direct`)
        return base.fn.select(({ chosen }) => chosen)
      if (shape === `functional-spread`)
        return base.fn.select(({ chosen }) => ({ ...chosen, ...overrides }))
      if (shape === `functional-projection`)
        return base.fn.select(({ chosen }) => ({
          id: chosen.id,
          label: chosen.label,
          ...overrides,
        }))
      if (shape === `structured-spread`)
        return base.select(({ chosen }) => ({ ...chosen, ...overrides }))
      return base.select(({ chosen }) => ({
        id: chosen.id,
        label: chosen.label,
        ...overrides,
      }))
    })
    const clean = createLiveQueryCollection((q) => {
      const base = joined
        ? q
            .from({ parent: parents })
            .innerJoin({ chosen: rows }, ({ parent, chosen }) =>
              eq(parent.id, chosen.parentId),
            )
        : q.from({ chosen: rows })
      return base.select(({ chosen }) => ({
        id: chosen.id,
        label: chosen.label,
      }))
    })
    const sourceOwned = sourceOwnsMetadata(shape)
    const check = () => {
      const sourceRow = rows.get(`child`)!
      const actual = live.toArray[0]!
      expect(actual.label).toBe(sourceRow.label)
      const expected = sourceOwned
        ? sourceRow
        : {
            $key: clean.toArray[0]!.$key,
            $collectionId: live.id,
            $hasPendingWrites: false,
            $origin: `remote`,
          }
      checkRootMetadata(actual, expected)
    }
    await checkWithCleanup(async () => {
      await Promise.all([live.preload(), clean.preload()])
      check()
      const mutation = rows.update(`child`, (row) => {
        row.label = `pending`
      })
      await vi.waitFor(() => expect(live.toArray[0]?.label).toBe(`pending`))
      expect(rows.get(`child`)!.$hasPendingWrites).toBe(true)
      metadataReach.reach(
        joined ? `joined-pending-source` : `single-pending-source`,
      )
      if (collision !== `none`) metadataReach.reach(`colliding-projection`)
      if (shape === `functional-direct`)
        metadataReach.reach(`functional-direct`)
      check()
      rows.utils.resolveSync()
      await mutation.when(`settled`)
      check()
    }, [
      () => live.cleanup(),
      () => clean.cleanup(),
      () => rows.cleanup(),
      () => parents.cleanup(),
    ])
  },
)

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
    const missingRows = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-row-fields-runtime-oracle-missing-source`,
        getKey: (row) => row.id,
        initialData: [],
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
        unmatchedRows: toArray(
          q
            .from({ child: rows })
            .where(({ child }) => eq(child.id, row.id))
            .leftJoin({ missing: missingRows }, ({ child, missing }) =>
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

    await checkWithCleanup(async () => {
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

      expectPublishedFieldClassification(observations)
      expect(result.$key).toBe(`row-1`)
      expect(result.$hasPendingWrites).toBe(false)
      expect(result.wholeRows[0]!.$hasPendingWrites).toBe(false)
      expect(result.selectedWholeRows[0]!.$hasPendingWrites).toBe(false)

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
      expect(result.unmatchedRows).toEqual([{}])
      expect(result.objects).toEqual([{ label: `nested` }])
      expect(result.nestedObjects).toEqual([{ nested: { label: `nested` } }])
      expect(result.arrays).toEqual([[`one`, `two`]])
      expect(result.firstObject).toEqual({ label: `nested` })
    }, [
      () => live.cleanup(),
      () => missingRows.cleanup(),
      () => rows.cleanup(),
    ])
  })
})
