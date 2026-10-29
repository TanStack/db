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
 * The attribution grammar crosses direct queries, QueryRef depths one/two,
 * joined and functional QueryRef consumers, both union branch positions and
 * a union consumed through a QueryRef. Null later spreads contribute nothing.
 * Every form observes the same metadata law at preload, pending and settlement.
 * The 1,056 attribution histories compare two rows, then remove the second.
 * Half configure public keys whose expected values are computed independently.
 * The other half compare compiler-generated keys with a clean sibling only as
 * supplemental evidence. Another 264 histories populate both union branches
 * with numeric 1 and string "1", hold either branch's update, and delete/reinsert
 * the peer. Full observations preserve every ordinary field and occurrence.
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
 * does not cover contractual ordering, arbitrary joined projections, framework
 * receiving boundaries or arbitrary ordering. The later timeline grammar adds
 * changing left-join matches, independent-source overlapping/rejected writes,
 * callback payloads and downstream metadata observations. Same-source overlap,
 * functional callback inputs remain separate work. The facade grammar below
 * adds shared/empty buckets, retirement and reactivation across child settlement.
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
  Query,
  createLiveQueryCollection,
  eq,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { hasVirtualProps } from '../../src/virtual-props.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import { mockSyncCollectionOptions } from '../utils.js'
import {
  metadataCollisionCases,
  metadataCompositions,
  metadataProjectionShapes,
} from './virtual-row-fields-grammar-oracle.js'
import {
  checkWithCleanup,
  virtualFieldNames,
} from './virtual-row-fields-support.js'
import { expectedSourceMetadata } from './virtual-row-fields-source-oracle.js'
import {
  advanceFacadeIntervals,
  checkFacadeIntervals,
} from './includes-collection-driver-oracle.js'
import type { QueryBuilder } from '../../src/query/builder/index.js'
import type {
  FacadeIntervals,
  MetadataFacade,
} from './includes-collection-driver-oracle.js'

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
  check: [
    expectPublishedFieldClassification,
    checkRootMetadata,
    checkAttributedRows,
  ],
  model: [expectsVirtualFields, sourceOwnsMetadata, expectedAttributedRows],
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

type AttributionKey = string | number
type AttributionRow = { id: AttributionKey; parentId: string; label: string }
// The finite grammar varies compiler context types, but every accepted root
// has these ordinary fields. Erase only that context union at the driver edge;
// the full runtime shape remains independently checked below.
type AttributionContext = {
  schema: {}
  baseSchema: {}
  fromSourceName: string
  result: { id: AttributionKey; label: string }
  hasResult: true
}
// Model rows are authored source facts, never sampled from the production
// Collection. Pending overlays affect only their named key; settlement without
// source confirmation restores the authored base (optimistic-history contract).
function expectedAttributedRows(
  rows: ReadonlyArray<AttributionRow>,
  shape: string,
  pending: ReadonlySet<AttributionKey>,
  sourceId: string,
  outputId: string,
  outputKey: (id: AttributionKey) => unknown,
) {
  return rows.map((row) => ({
    ordinary:
      shape === `structured-projection`
        ? {
            id: row.id,
            label: row.label,
            hasPendingWrites: pending.has(row.id),
          }
        : shape === `functional-projection`
          ? { id: row.id, label: row.label }
          : { ...row },
    metadata: sourceOwnsMetadata(shape)
      ? expectedSourceMetadata(row.id, sourceId, pending.has(row.id))
      : {
          $key: outputKey(row.id),
          $collectionId: outputId,
          $hasPendingWrites: false,
          $origin: `remote`,
        },
  }))
}
function checkAttributedRows(
  actual: ReadonlyArray<object>,
  expected: ReturnType<typeof expectedAttributedRows>,
): void {
  const observed = actual.map((row) => ({
    ordinary: Object.fromEntries(
      Object.entries(row).filter(
        ([name]) => !virtualFieldNames.some((field) => field === name),
      ),
    ),
    metadata: Object.fromEntries(
      virtualFieldNames.map((field) => [
        field,
        (row as Record<string, unknown>)[field],
      ]),
    ),
  }))
  const identity = (row: { ordinary: object }) => {
    const { id } = row.ordinary as { id: unknown }
    return `${typeof id}:${String(id)}`
  }
  const byId = (a: { ordinary: object }, b: { ordinary: object }) =>
    identity(a).localeCompare(identity(b))
  // Sorting permits unspecified result order but preserves every occurrence,
  // field and extra row. No Map can collapse duplicate contributions here.
  expect(observed.sort(byId)).toEqual([...expected].sort(byId))
}

const metadataReach = createOracleReach(`root metadata`, [
  `joined-pending-source`,
  `single-pending-source`,
  `colliding-projection`,
  `functional-direct`,
  `query-ref-pending`,
  `union-pending`,
  `null-later-spread`,
  `multi-row`,
  `independent-output-key`,
  `non-first-row-deleted`,
  `two-populated-union-branches`,
  `typed-union-keys`,
  `union-peer-reinserted`,
  `output-rejects-authored-pending-true`,
])
afterAll(() => {
  metadataReach.assertReached()
  unionMetadataReach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
    console.info(
      `root metadata reach`,
      Object.fromEntries(metadataReach.counts()),
    )
    console.info(
      `populated union reach`,
      Object.fromEntries(unionMetadataReach.counts()),
    )
  }
})

// Both boolean values are legal authored collisions. True distinguishes an
// output-owned row's mandatory false pending flag; false distinguishes a
// pending source-owned row. Use a legal local origin to challenge remote roots.
const collisionCases = metadataCollisionCases

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
    collisionCases.flatMap(({ collision, authoredPending }) =>
      metadataProjectionShapes
        .filter(
          (shape) => shape !== `functional-direct` || collision === `none`,
        )
        .flatMap((shape) =>
          metadataCompositions.flatMap((composition) =>
            [false, true].map((customKey) => ({
              joined,
              collision,
              authoredPending,
              shape,
              composition,
              customKey,
            })),
          ),
        ),
    ),
  ),
)(
  `attributes root metadata by projection shape: %j`,
  async ({
    joined,
    collision,
    authoredPending,
    shape,
    composition,
    customKey,
  }) => {
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
        initialData: [
          { id: `child`, parentId: `parent`, label: `before` },
          { id: `peer`, parentId: `parent`, label: `untouched` },
        ],
      }),
    )
    const overrides: Record<string, unknown> = {}
    for (const field of virtualFieldNames) {
      if (collision === field || collision === `all`)
        overrides[field] =
          field === `$hasPendingWrites`
            ? authoredPending
            : field === `$origin`
              ? `local`
              : `spoof`
    }
    const selectedQuery = (() => {
      const q = new Query()
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
        hasPendingWrites: chosen.$hasPendingWrites,
        ...overrides,
      }))
    })()
    const compose = (query: typeof selectedQuery) => {
      if (composition === `direct`) return query
      if (composition.startsWith(`union`)) {
        const emptyBranch = new Query()
          .from({ empty: parents })
          .where(({ empty }) => eq(empty.id, `absent`))
          .select(({ empty }) => ({ id: empty.id, label: empty.id }))
        const union =
          composition === `union-last`
            ? new Query().unionAll(emptyBranch, query)
            : new Query().unionAll(query, emptyBranch)
        return composition === `union-query-ref`
          ? new Query().from({ union })
          : union
      }
      if (composition === `joined-query-ref`)
        return new Query()
          .from({ peer: rows })
          .innerJoin({ nested: query }, ({ peer, nested }) =>
            eq(peer.id, nested.id),
          )
          .select(({ nested }) => nested)
      const once = new Query().from({ nested: query })
      if (composition === `functional-query-ref`)
        return once.fn.select(({ nested }) => nested)
      return composition === `query-ref`
        ? once
        : new Query().from({ outer: once })
    }
    const sourceOwned = sourceOwnsMetadata(shape)
    const live = createLiveQueryCollection({
      query: () =>
        compose(selectedQuery) as unknown as QueryBuilder<AttributionContext>,
      ...(customKey
        ? {
            getKey: (row: { id: AttributionKey }) =>
              sourceOwned ? row.id : `projected-${row.id}`,
          }
        : {}),
    })
    const clean = createLiveQueryCollection(() =>
      compose(
        (() => {
          const q = new Query()
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
        })(),
      ),
    )
    let truth: Array<AttributionRow> = [
      { id: `child`, parentId: `parent`, label: `before` },
      { id: `peer`, parentId: `parent`, label: `untouched` },
    ]
    const pendingKeys = new Set<string>()
    let finishMutation = async () => {}
    const check = () => {
      // The custom-key lane has a completely independent key prediction. The
      // default lane retains the old clean-sibling key comparison only as a
      // differential check of undocumented compiler-generated key encoding.
      const outputKey = (id: AttributionKey) =>
        customKey
          ? `projected-${id}`
          : clean.toArray.find((row) => `id` in row && row.id === id)!.$key
      checkAttributedRows(
        live.toArray,
        expectedAttributedRows(
          truth,
          shape,
          pendingKeys,
          rows.id,
          live.id,
          outputKey,
        ),
      )
      if (customKey)
        expect([...live.keys()].sort()).toEqual(
          truth
            .map((row) => (sourceOwned ? row.id : `projected-${row.id}`))
            .sort(),
        )
    }
    await checkWithCleanup(async () => {
      await Promise.all([live.preload(), clean.preload()])
      check()
      if (
        !sourceOwned &&
        authoredPending &&
        (collision === `$hasPendingWrites` || collision === `all`)
      )
        metadataReach.reach(`output-rejects-authored-pending-true`)
      metadataReach.reach(`multi-row`)
      if (customKey && !sourceOwned)
        metadataReach.reach(`independent-output-key`)
      truth = truth.map((row) =>
        row.id === `child` ? { ...row, label: `pending` } : row,
      )
      pendingKeys.add(`child`)
      const mutation = rows.update(`child`, (row) => {
        row.label = `pending`
      })
      finishMutation = async () => {
        rows.utils.resolveSync()
        finishMutation = async () => {}
        await mutation.when(`settled`)
      }
      await vi.waitFor(() =>
        expect(live.toArray.find((row) => row.id === `child`)).toMatchObject({
          label: `pending`,
        }),
      )
      expect(rows.get(`child`)!.$hasPendingWrites).toBe(true)
      metadataReach.reach(
        joined ? `joined-pending-source` : `single-pending-source`,
      )
      if (collision !== `none`) metadataReach.reach(`colliding-projection`)
      if (shape === `functional-direct`)
        metadataReach.reach(`functional-direct`)
      if (composition.startsWith(`union`)) metadataReach.reach(`union-pending`)
      if (composition.endsWith(`query-ref`))
        metadataReach.reach(`query-ref-pending`)
      check()
      await finishMutation()
      pendingKeys.clear()
      truth = truth.map((row) =>
        row.id === `child` ? { ...row, label: `before` } : row,
      )
      check()
      rows.utils.begin()
      rows.utils.write({
        type: `delete`,
        value: { id: `peer`, parentId: `parent`, label: `untouched` },
      })
      rows.utils.commit()
      truth = truth.filter((row) => row.id !== `peer`)
      check()
      metadataReach.reach(`non-first-row-deleted`)
    }, [
      () => finishMutation(),
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

/** A nullish source contributes no fields to a JS spread. The last present
 * structured source owns metadata, independent of join side and spread order.
 * This finite grammar crosses match presence, spread order and which source
 * has a held optimistic update. All checkpoints compare the same public law.
 */
test.each(
  [false, true].flatMap((matched) =>
    [false, true].flatMap((reverse) =>
      [false, true].map((pendingRight) => ({ matched, reverse, pendingRight })),
    ),
  ),
)(
  `retains metadata from the last present spread: %j`,
  async ({ matched, reverse, pendingRight }) => {
    metadataReach.beginHistory()
    const left = createCollection(
      mockSyncCollectionOptions<{ id: string; label: string }>({
        id: `spread-left`,
        getKey: (row) => row.id,
        initialData: [{ id: `left`, label: `left` }],
      }),
    )
    const right = createCollection(
      mockSyncCollectionOptions<{
        id: string
        parentId: string
        label: string
      }>({
        id: `spread-right`,
        getKey: (row) => row.id,
        initialData: [
          {
            id: `right`,
            parentId: matched ? `left` : `missing`,
            label: `right`,
          },
        ],
      }),
    )
    const live = createLiveQueryCollection((q) =>
      q
        .from({ left })
        .leftJoin({ right }, ({ left: a, right: b }) => eq(a.id, b.parentId))
        .select(({ left: a, right: b }) =>
          reverse ? { ...b, ...a } : { ...a, ...b },
        ),
    )
    const owner = matched && !reverse ? right : left
    const key = owner === right ? `right` : `left`
    const check = () => checkRootMetadata(live.toArray[0]!, owner.get(key)!)
    await checkWithCleanup(async () => {
      await live.preload()
      check()
      const mutation = pendingRight
        ? right.update(`right`, (row) => {
            row.label = `pending`
          })
        : left.update(`left`, (row) => {
            row.label = `pending`
          })
      await vi.waitFor(() =>
        expect(
          (pendingRight ? right.get(`right`) : left.get(`left`))!
            .$hasPendingWrites,
        ).toBe(true),
      )
      if (!matched && !reverse) metadataReach.reach(`null-later-spread`)
      check()
      ;(pendingRight ? right : left).utils.resolveSync()
      await mutation.when(`settled`)
      check()
    }, [() => live.cleanup(), () => left.cleanup(), () => right.cleanup()])
  },
)

/**
 * Populated union branches retain both contributions, including numeric 1 and
 * string "1". Equal labels cannot stand in for row identity. Branch order,
 * QueryRef consumption, projection shape and collisions vary independently.
 * A held write in either branch must not change the other's metadata. Removing
 * and reinserting that peer checks retractions and subsequent contributions.
 * Each checkpoint reuses the authored-facts model; no sibling query supplies
 * expected keys in this lane.
 */
const unionHistories = [false, true].flatMap((reverse) =>
  [false, true].flatMap((nested) =>
    [false, true].flatMap((pendingRight) =>
      collisionCases.flatMap(({ collision, authoredPending }) =>
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
          .map((shape) => ({
            reverse,
            nested,
            pendingRight,
            collision,
            authoredPending,
            shape,
          })),
      ),
    ),
  ),
)

// Each receiving form must reach held and post-retraction comparisons for
// both metadata policies and both pending branches. Aggregate reach cannot
// borrow a direct-output witness for a QueryRef consumer.
const unionMetadataReach = createOracleReach(
  `populated union metadata`,
  [`direct`, `query-ref`].flatMap((path) =>
    [`source`, `output`].flatMap((owner) =>
      [`left`, `right`].flatMap((pending) =>
        [`held`, `reinserted`, `settled`].map(
          (cut) => `${path}/${owner}/${pending}/${cut}`,
        ),
      ),
    ),
  ),
)

test.each(unionHistories)(
  `preserves each populated union branch: %j`,
  async ({
    reverse,
    nested,
    pendingRight,
    collision,
    authoredPending,
    shape,
  }) => {
    metadataReach.beginHistory()
    unionMetadataReach.beginHistory()
    const reach = (cut: string) =>
      unionMetadataReach.reach(
        `${nested ? `query-ref` : `direct`}/${sourceOwnsMetadata(shape) ? `source` : `output`}/${pendingRight ? `right` : `left`}/${cut}`,
      )
    const initialLeft: AttributionRow = {
      id: 1,
      parentId: `parent`,
      label: `same`,
    }
    const initialRight: AttributionRow = {
      id: `1`,
      parentId: `parent`,
      label: `same`,
    }
    const left = createCollection(
      mockSyncCollectionOptions<AttributionRow>({
        id: `union-left`,
        getKey: (row) => row.id,
        initialData: [{ ...initialLeft }],
      }),
    )
    const right = createCollection(
      mockSyncCollectionOptions<AttributionRow>({
        id: `union-right`,
        getKey: (row) => row.id,
        initialData: [{ ...initialRight }],
      }),
    )
    const overrides: Record<string, unknown> = {}
    for (const field of virtualFieldNames)
      if (collision === field || collision === `all`)
        overrides[field] =
          field === `$hasPendingWrites`
            ? authoredPending
            : field === `$origin`
              ? `local`
              : `spoof`
    const branch = (source: typeof left, alias: string) => {
      const base = new Query().from({ [alias]: source })
      if (shape === `functional-direct`)
        return base.fn.select((refs) => refs[alias]!)
      if (shape === `functional-spread`)
        return base.fn.select((refs) => ({ ...refs[alias]!, ...overrides }))
      if (shape === `functional-projection`)
        return base.fn.select((refs) => ({
          id: refs[alias]!.id,
          label: refs[alias]!.label,
          ...overrides,
        }))
      if (shape === `structured-spread`)
        return base.select((refs) => ({ ...refs[alias]!, ...overrides }))
      return base.select((refs) => ({
        id: refs[alias]!.id,
        label: refs[alias]!.label,
        hasPendingWrites: refs[alias]!.$hasPendingWrites,
        ...overrides,
      }))
    }
    const a = branch(left, `leftBranch`)
    const b = branch(right, `rightBranch`)
    const union = reverse
      ? new Query().unionAll(b, a)
      : new Query().unionAll(a, b)
    const selected = nested ? new Query().from({ union }) : union
    const keyOf = (id: AttributionKey) => `${typeof id}:${id}`
    const live = createLiveQueryCollection({
      query: () => selected as unknown as QueryBuilder<AttributionContext>,
      getKey: (row) => (sourceOwnsMetadata(shape) ? row.id : keyOf(row.id)),
    })
    let leftTruth = [{ ...initialLeft }]
    let rightTruth = [{ ...initialRight }]
    const pendingKeys = new Set<AttributionKey>()
    const check = () =>
      checkAttributedRows(live.toArray, [
        ...expectedAttributedRows(
          leftTruth,
          shape,
          pendingKeys,
          left.id,
          live.id,
          keyOf,
        ),
        ...expectedAttributedRows(
          rightTruth,
          shape,
          pendingKeys,
          right.id,
          live.id,
          keyOf,
        ),
      ])
    const pendingSource = pendingRight ? right : left
    const pendingId = pendingRight ? initialRight.id : initialLeft.id
    const peer = pendingRight ? left : right
    const peerInitial = pendingRight ? initialLeft : initialRight
    let finishMutation = async () => {}
    await checkWithCleanup(async () => {
      await live.preload()
      check()
      metadataReach.reach(`two-populated-union-branches`)
      metadataReach.reach(`typed-union-keys`)
      pendingKeys.add(pendingId)
      if (pendingRight) rightTruth = [{ ...initialRight, label: `pending` }]
      else leftTruth = [{ ...initialLeft, label: `pending` }]
      const mutation = pendingSource.update(pendingId, (row) => {
        row.label = `pending`
      })
      finishMutation = async () => {
        pendingSource.utils.resolveSync()
        finishMutation = async () => {}
        await mutation.when(`settled`)
      }
      await vi.waitFor(() =>
        expect(pendingSource.get(pendingId)!.$hasPendingWrites).toBe(true),
      )
      check()
      reach(`held`)
      peer.utils.begin()
      peer.utils.write({ type: `delete`, value: { ...peerInitial } })
      peer.utils.commit()
      if (pendingRight) leftTruth = []
      else rightTruth = []
      check()
      peer.utils.begin()
      peer.utils.write({
        type: `insert`,
        value: { ...peerInitial, label: `returned` },
      })
      peer.utils.commit()
      if (pendingRight) leftTruth = [{ ...initialLeft, label: `returned` }]
      else rightTruth = [{ ...initialRight, label: `returned` }]
      check()
      metadataReach.reach(`union-peer-reinserted`)
      reach(`reinserted`)
      await finishMutation()
      pendingKeys.clear()
      if (pendingRight) rightTruth = [{ ...initialRight }]
      else leftTruth = [{ ...initialLeft }]
      check()
      reach(`settled`)
    }, [
      () => finishMutation(),
      () => live.cleanup(),
      () => left.cleanup(),
      () => right.cleanup(),
    ])
  },
)

// Calibration feeds allowed and hostile full results through the very same
// checker. It must see faults away from the first row and retain multiplicity.
test.each(
  [`functional-projection`, `structured-spread`].flatMap((shape) =>
    [
      `missing-peer`,
      `duplicate-peer`,
      `missing-id`,
      `wrong-key`,
      `wrong-owner`,
      `stale-pending`,
      `wrong-origin`,
    ].map((fault) => ({ shape, fault })),
  ),
)(`rejects a hostile complete metadata result: %j`, ({ shape, fault }) => {
  const keyOf = (id: AttributionKey) => `key-${typeof id}:${id}`
  const expected = [
    ...expectedAttributedRows(
      [{ id: 1, parentId: `parent`, label: `same` }],
      shape,
      new Set(),
      `left`,
      `output`,
      keyOf,
    ),
    ...expectedAttributedRows(
      [{ id: `1`, parentId: `parent`, label: `same` }],
      shape,
      new Set([`1`]),
      `right`,
      `output`,
      keyOf,
    ),
  ]
  const allowed = expected.map((row) => ({ ...row.ordinary, ...row.metadata }))
  checkAttributedRows(allowed, expected)
  // A different legal output order remains accepted.
  checkAttributedRows([...allowed].reverse(), expected)
  const hostile: Array<Record<string, unknown>> = allowed.map((row) => ({
    ...row,
  }))
  if (fault === `missing-peer`) hostile.pop()
  if (fault === `duplicate-peer`) hostile.push({ ...hostile[1]! })
  if (fault === `missing-id`) delete hostile[1]!.id
  if (fault === `wrong-key`) hostile[1]!.$key = `wrong`
  if (fault === `wrong-owner`) hostile[1]!.$collectionId = `left`
  if (fault === `stale-pending`)
    hostile[1]!.$hasPendingWrites = !expected[1]!.metadata.$hasPendingWrites
  if (fault === `wrong-origin`)
    hostile[1]!.$origin =
      expected[1]!.metadata.$origin === `local` ? `remote` : `local`
  expect(() => checkAttributedRows(hostile, expected)).toThrow()
})

/**
 * # Can attribution follow a changing join and independent write outcomes?
 *
 * The last present structured spread owns metadata at every publication. A new
 * functional object owns output metadata; direct functional returns own their
 * selected source metadata. The maintainer decision and ARCHITECTURE's
 * publication law apply at each callback, not just after a later microtask.
 *
 * This model recomputes a left join from authored arrays. Optimistic snapshots
 * are separate authored rows. Settling either source removes only its overlay.
 * A same-key sync update accepted during persistence applies at settlement:
 * successful work attributes that first queued write locally; rejected work
 * does not (optimistic-history-oracle.ts). No production attribution machinery
 * participates in this judgment.
 *
 * The finite histories cross join-key/membership topology changes, spread
 * order, five projection shapes, either settlement order and independent
 * success/rejection with distinct caller errors. A held left write spans unmatched -> matched ->
 * unmatched -> matched. A right write then overlaps it and receives a queued
 * authoritative update. An untouched parent checks isolation. These bounds do
 * not cover same-source overlapping writes, truncate or provider scheduling.
 */
type MetadataResult = ReturnType<typeof expectedAttributedRows>[number]
function expectedJoinedMetadata(
  leftRows: ReadonlyArray<AttributionRow>,
  rightRows: ReadonlyArray<AttributionRow>,
  shape: string,
  reverse: boolean,
  pending: ReadonlySet<AttributionKey>,
  rightOrigin: `local` | `remote`,
  leftId: string,
  rightId: string,
  outputId: string,
): Array<MetadataResult> {
  return leftRows.flatMap((a) => {
    const matches = rightRows.filter((b) => b.parentId === a.id)
    return (matches.length ? matches : [undefined]).map((b) => {
      const spread = reverse ? { ...b, ...a } : { ...a, ...b }
      const owner = shape === `functional-direct` || reverse || !b ? a : b
      const selected =
        shape.endsWith(`projection`) || shape === `functional-direct`
          ? a
          : spread
      const expected = expectedAttributedRows(
        [selected],
        shape,
        pending,
        owner === b ? rightId : leftId,
        outputId,
        (id) => `projection-${id}`,
      )[0]!
      if (sourceOwnsMetadata(shape) && owner === b && !pending.has(b.id))
        expected.metadata.$origin = rightOrigin
      return expected
    })
  })
}

// Capture all row fields now. Retaining production row handles could let a
// later metadata getter or mutation rewrite evidence from an earlier callback.
function captureMetadataRows(rows: ReadonlyArray<object>): Array<object> {
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      virtualFieldNames.map((field) => [
        field,
        (row as Record<string, unknown>)[field],
      ]),
    ),
  }))
}
type MetadataBatch = {
  rows: Array<object>
  changes: Array<{
    type: string
    key: AttributionKey
    value: object
    previousValue?: object
  }>
}
function publishedModelRows(rows: ReadonlyArray<MetadataResult>) {
  return rows.map((row) => ({ ...row.ordinary, ...row.metadata }))
}
// Collection change messages are the exact before/after delta for one atomic
// publication. Their ordering is unspecified; duplicate or omitted messages
// remain visible because neither side collapses actual messages into a Map.
function expectedMetadataChanges(
  before: ReadonlyArray<MetadataResult>,
  after: ReadonlyArray<MetadataResult>,
) {
  const changes: MetadataBatch[`changes`] = []
  const same = (a: MetadataResult, b: MetadataResult) =>
    JSON.stringify(a) === JSON.stringify(b)
  for (const row of before) {
    if (!after.some((next) => next.metadata.$key === row.metadata.$key))
      changes.push({
        type: `delete`,
        key: row.metadata.$key as AttributionKey,
        value: publishedModelRows([row])[0]!,
      })
  }
  for (const row of after) {
    const previous = before.find(
      (old) => old.metadata.$key === row.metadata.$key,
    )
    if (!previous || !same(previous, row))
      changes.push({
        type: previous ? `update` : `insert`,
        key: row.metadata.$key as AttributionKey,
        value: publishedModelRows([row])[0]!,
        ...(previous
          ? { previousValue: publishedModelRows([previous])[0]! }
          : {}),
      })
  }
  return changes
}
function checkMetadataPublications(
  actual: ReadonlyArray<MetadataBatch>,
  before: ReadonlyArray<MetadataResult>,
  after: ReadonlyArray<MetadataResult>,
): void {
  const expectedChanges = expectedMetadataChanges(before, after)
  if (expectedChanges.length)
    expect(actual.length, `owed metadata publication`).toBeGreaterThan(0)
  const byChange = (
    a: MetadataBatch[`changes`][number],
    b: MetadataBatch[`changes`][number],
  ) => `${typeof a.key}:${a.key}`.localeCompare(`${typeof b.key}:${b.key}`)
  for (const batch of actual) {
    checkAttributedRows(batch.rows, [...after])
  }
  // Compare every callback's delta together. Splitting a batch stays legal;
  // repeating a whole batch cannot consume the same public change twice.
  expect(actual.flatMap((batch) => batch.changes).sort(byChange)).toEqual(
    [...expectedChanges].sort(byChange),
  )
}
const metadataTimelineShapes = [
  `structured-spread`,
  `functional-spread`,
  `functional-direct`,
  `structured-projection`,
  `functional-projection`,
] as const
const metadataTimelineHistories = metadataTimelineShapes.flatMap((shape) =>
  (shape.endsWith(`spread`) ? [false, true] : [false]).flatMap((reverse) =>
    [`join-key`, `membership`].flatMap((topology) =>
      [`none`, `left`, `right`, `both`].flatMap((reject) =>
        [false, true].map((rightFirst) => ({
          shape,
          reverse,
          topology,
          reject,
          rightFirst,
        })),
      ),
    ),
  ),
)
const metadataTimelineReach = createOracleReach(
  `metadata timeline`,
  metadataTimelineShapes.flatMap((shape) =>
    [`join-key`, `membership`].flatMap((topology) =>
      [
        `rematched-held`,
        `two-pending`,
        `first-settled`,
        `both-settled`,
        `remote-followup`,
        `left-rejected`,
        `right-rejected`,
        `both-rejected`,
        `left-first`,
        `right-first`,
        `root-callback-held`,
        `downstream-callback-held`,
      ].map((cut) => `${shape}/${topology}/${cut}`),
    ),
  ),
)
afterAll(() => {
  metadataTimelineReach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `metadata timeline reach`,
      Object.fromEntries(metadataTimelineReach.counts()),
    )
})
declareOracle({
  model: [expectedJoinedMetadata, expectedMetadataChanges],
  check: [checkMetadataPublications],
  grammar: [metadataTimelineHistories],
})

test.each(metadataTimelineHistories)(
  `publishes metadata through join and write histories: %j`,
  async ({ shape, reverse, topology, reject, rightFirst }) => {
    metadataTimelineReach.beginHistory()
    const reach = (cut: string) =>
      metadataTimelineReach.reach(`${shape}/${topology}/${cut}`)
    let releaseLeft!: () => void
    let rejectLeft!: (reason: Error) => void
    let releaseRight!: () => void
    let rejectRight!: (reason: Error) => void
    const leftGate = new Promise<void>((resolve, rejectGate) => {
      releaseLeft = resolve
      rejectLeft = rejectGate
    })
    const rightGate = new Promise<void>((resolve, rejectGate) => {
      releaseRight = resolve
      rejectRight = rejectGate
    })
    // Attach rejection observers before any path can abandon construction.
    void leftGate.catch(() => {})
    void rightGate.catch(() => {})
    const baseLeft: Array<AttributionRow> = [
      { id: `a`, parentId: `unused`, label: `left-base` },
      { id: `anchor`, parentId: `unused`, label: `untouched` },
    ]
    const rightRow: AttributionRow = {
      id: `r`,
      parentId: `a`,
      label: `right-base`,
    }
    let rightBase =
      topology === `join-key` ? [{ ...rightRow, parentId: `missing` }] : []
    const left = createCollection({
      ...mockSyncCollectionOptions<AttributionRow>({
        id: `timeline-left`,
        getKey: (row) => row.id,
        initialData: baseLeft.map((row) => ({ ...row })),
      }),
      onUpdate: async () => leftGate,
    })
    const right = createCollection({
      ...mockSyncCollectionOptions<AttributionRow>({
        id: `timeline-right`,
        getKey: (row) => row.id,
        initialData: rightBase.map((row) => ({ ...row })),
      }),
      onUpdate: async () => rightGate,
    })
    const baseQuery = new Query()
      .from({ a: left })
      .leftJoin({ b: right }, ({ a, b }) => eq(a.id, b.parentId))
    const selected =
      shape === `functional-direct`
        ? baseQuery.fn.select(({ a }) => a)
        : shape === `functional-spread`
          ? baseQuery.fn.select(({ a, b }) =>
              reverse ? { ...b, ...a } : { ...a, ...b },
            )
          : shape === `functional-projection`
            ? baseQuery.fn.select(({ a }) => ({ id: a.id, label: a.label }))
            : shape === `structured-projection`
              ? baseQuery.select(({ a }) => ({
                  id: a.id,
                  label: a.label,
                  hasPendingWrites: a.$hasPendingWrites,
                }))
              : baseQuery.select(({ a, b }) =>
                  reverse ? { ...b, ...a } : { ...a, ...b },
                )
    const root = createLiveQueryCollection({
      query: () => selected as unknown as QueryBuilder<AttributionContext>,
      getKey: (row) =>
        sourceOwnsMetadata(shape) ? row.id : `projection-${row.id}`,
    })
    const downstream = createLiveQueryCollection({
      query: (q) =>
        q.from({ root }).select(({ root: row }) => ({
          id: row.id,
          label: row.label,
          observedKey: row.$key,
          observedCollectionId: row.$collectionId,
          observedOrigin: row.$origin,
          observedPending: row.$hasPendingWrites,
        })),
      getKey: (row) => `downstream-${row.id}`,
    })
    const pending = new Set<AttributionKey>()
    let rightOrigin: `remote` | `local` = `remote`
    let leftOverlay: AttributionRow | undefined
    let rightOverlay: AttributionRow | undefined
    const expectedRoot = () =>
      expectedJoinedMetadata(
        baseLeft.map((row) =>
          row.id === `a` && leftOverlay ? { ...leftOverlay } : { ...row },
        ),
        rightOverlay
          ? [{ ...rightOverlay }]
          : rightBase.map((row) => ({ ...row })),
        shape,
        reverse,
        pending,
        rightOrigin,
        left.id,
        right.id,
        root.id,
      )
    const expectedDownstream = (rows: ReadonlyArray<MetadataResult>) =>
      rows.map((row) => ({
        ordinary: {
          id: (row.ordinary as { id: AttributionKey }).id,
          label: (row.ordinary as { label: string }).label,
          observedKey: row.metadata.$key,
          observedCollectionId: row.metadata.$collectionId,
          observedOrigin: row.metadata.$origin,
          observedPending: row.metadata.$hasPendingWrites,
        },
        metadata: {
          $key: `downstream-${(row.ordinary as { id: AttributionKey }).id}`,
          $collectionId: downstream.id,
          $hasPendingWrites: false,
          $origin: `remote`,
        },
      }))
    let previous = expectedRoot()
    const rootBatches: Array<MetadataBatch> = []
    const downstreamBatches: Array<MetadataBatch> = []
    const record = (
      collection: typeof root | typeof downstream,
      batches: Array<MetadataBatch>,
    ) =>
      collection.subscribeChanges(
        (changes) =>
          batches.push({
            rows: captureMetadataRows(collection.toArray),
            changes: changes.map((change) => ({
              type: change.type,
              key: change.key,
              value: captureMetadataRows([change.value])[0]!,
              ...(change.previousValue
                ? {
                    previousValue: captureMetadataRows([
                      change.previousValue,
                    ])[0]!,
                  }
                : {}),
            })),
          }),
        { includeInitialState: true },
      )
    let rootSubscription: ReturnType<typeof record> | undefined
    let downstreamSubscription: ReturnType<typeof record> | undefined
    let leftSettlement: Promise<unknown> | undefined
    let rightSettlement: Promise<unknown> | undefined
    const observe = () => {
      const next = expectedRoot()
      const nextDownstream = expectedDownstream(next)
      checkAttributedRows(root.toArray, next)
      checkAttributedRows(downstream.toArray, nextDownstream)
      checkMetadataPublications(rootBatches, previous, next)
      checkMetadataPublications(
        downstreamBatches,
        expectedDownstream(previous),
        nextDownstream,
      )
      if (pending.size && expectedMetadataChanges(previous, next).length)
        reach(`root-callback-held`)
      if (
        pending.size &&
        expectedMetadataChanges(expectedDownstream(previous), nextDownstream)
          .length
      )
        reach(`downstream-callback-held`)
      rootBatches.length = 0
      downstreamBatches.length = 0
      previous = next
    }
    const writeRight = (
      type: `insert` | `update` | `delete`,
      row: AttributionRow,
    ) => {
      right.utils.begin()
      right.utils.write({ type, value: { ...row } })
      right.utils.commit()
    }
    await checkWithCleanup(async () => {
      await downstream.preload()
      checkAttributedRows(root.toArray, previous)
      checkAttributedRows(downstream.toArray, expectedDownstream(previous))
      rootSubscription = record(root, rootBatches)
      downstreamSubscription = record(downstream, downstreamBatches)
      checkMetadataPublications(rootBatches, [], previous)
      checkMetadataPublications(
        downstreamBatches,
        [],
        expectedDownstream(previous),
      )
      rootBatches.length = 0
      downstreamBatches.length = 0
      leftOverlay = { ...baseLeft[0]!, label: `left-pending` }
      pending.add(`a`)
      const leftMutation = left.update(`a`, (row) => {
        row.label = `left-pending`
      })
      leftSettlement = leftMutation.when(`settled`).then(
        () => undefined,
        (error: unknown) => error,
      )
      observe()
      rightBase = [{ ...rightRow }]
      writeRight(topology === `join-key` ? `update` : `insert`, rightRow)
      observe()
      rightBase =
        topology === `join-key` ? [{ ...rightRow, parentId: `missing` }] : []
      writeRight(
        topology === `join-key` ? `update` : `delete`,
        topology === `join-key`
          ? { ...rightRow, parentId: `missing` }
          : rightRow,
      )
      observe()
      rightBase = [{ ...rightRow }]
      writeRight(topology === `join-key` ? `update` : `insert`, rightRow)
      observe()
      reach(`rematched-held`)
      rightOverlay = { ...rightRow, label: `right-pending` }
      pending.add(`r`)
      const rightMutation = right.update(`r`, (row) => {
        row.label = `right-pending`
      })
      rightSettlement = rightMutation.when(`settled`).then(
        () => undefined,
        (error: unknown) => error,
      )
      observe()
      reach(`two-pending`)
      writeRight(`update`, { ...rightRow, label: `server` })
      // Acceptance alone changes neither the applied base nor the active overlay.
      observe()
      const failures = {
        left: new Error(`authored left rejection`),
        right: new Error(`authored right rejection`),
      }
      const settle = async (side: `left` | `right`) => {
        const fails = reject === side || reject === `both`
        const failure = failures[side]
        if (side === `left`) {
          pending.delete(`a`)
          leftOverlay = undefined
          if (fails) rejectLeft(failure)
          else releaseLeft()
          expect(await leftSettlement).toBe(fails ? failure : undefined)
        } else {
          pending.delete(`r`)
          rightOverlay = undefined
          rightBase = [{ ...rightRow, label: `server` }]
          rightOrigin = fails ? `remote` : `local`
          if (fails) rejectRight(failure)
          else releaseRight()
          expect(await rightSettlement).toBe(fails ? failure : undefined)
        }
        observe()
        if (fails) reach(`${side}-rejected`)
      }
      await settle(rightFirst ? `right` : `left`)
      reach(`first-settled`)
      reach(rightFirst ? `right-first` : `left-first`)
      await settle(rightFirst ? `left` : `right`)
      reach(`both-settled`)
      if (reject === `both`) reach(`both-rejected`)
      rightBase = [{ ...rightRow, label: `later` }]
      rightOrigin = `remote`
      writeRight(`update`, rightBase[0]!)
      observe()
      reach(`remote-followup`)
    }, [
      async () => {
        releaseLeft()
        releaseRight()
        await Promise.all([leftSettlement, rightSettlement])
      },
      async () => {
        rootSubscription?.unsubscribe()
      },
      async () => {
        downstreamSubscription?.unsubscribe()
      },
      () => downstream.cleanup(),
      () => root.cleanup(),
      () => right.cleanup(),
      () => left.cleanup(),
    ])
  },
)

// Publication calibrations corrupt an earlier callback while the final public
// answer remains correct. A final-snapshot-only check would miss these faults.
test.each([
  `stale-read`,
  `stale-event`,
  `new-previous-value`,
  `duplicate-message`,
  `duplicate-batch`,
  `missing-message`,
  `no-callback`,
  `early-wrong-later-correct`,
] as const)(`rejects a hostile metadata publication: %s`, (fault) => {
  const base: AttributionRow = { id: `a`, parentId: `parent`, label: `before` }
  const before = expectedAttributedRows(
    [base],
    `structured-spread`,
    new Set(),
    `source`,
    `output`,
    (id) => id,
  )
  const after = expectedAttributedRows(
    [{ ...base, label: `pending` }],
    `structured-spread`,
    new Set([base.id]),
    `source`,
    `output`,
    (id) => id,
  )
  const allowed = {
    rows: publishedModelRows(after),
    changes: expectedMetadataChanges(before, after),
  }
  checkMetadataPublications([allowed], before, after)
  const hostile = structuredClone(allowed)
  if (fault === `stale-read`)
    (hostile.rows[0] as Record<string, unknown>).$hasPendingWrites = false
  if (fault === `stale-event`)
    (hostile.changes[0]!.value as Record<string, unknown>).$origin = `remote`
  if (fault === `new-previous-value`)
    hostile.changes[0]!.previousValue = { ...hostile.changes[0]!.value }
  if (fault === `duplicate-message`)
    hostile.changes.push({ ...hostile.changes[0]! })
  if (fault === `missing-message`) hostile.changes = []
  if (fault === `early-wrong-later-correct`)
    (hostile.rows[0] as Record<string, unknown>).$collectionId = `wrong`
  const trace =
    fault === `no-callback`
      ? []
      : fault === `duplicate-batch`
        ? [allowed, structuredClone(allowed)]
        : fault === `early-wrong-later-correct`
          ? [hostile, allowed]
          : [hostile]
  expect(() => checkMetadataPublications(trace, before, after)).toThrow()
})

/**
 * # Does child metadata survive facade sharing and a new active interval?
 *
 * Collection-valued includes publish child rows. Inline includes publish
 * selected values, including authored reserved names. This receiving driver
 * reuses the attribution model and the facade owner's active-interval model
 * (includes-collection-driver-oracle.ts). It does not infer child attribution
 * from the containing parent or create a second route-lifetime policy.
 *
 * Histories cross all projection/collision descriptions, populated/empty route
 * destinations and successful/rejected unconfirmed writes. Two parents share
 * one bucket. One moves, then the last moves, then a route returns while the
 * child write is held. The returned interval must have a new facade with the
 * current child metadata. Inline toArray/materialize siblings keep their
 * authored shapes. Only single-source child keys are modeled here; composite
 * compiler key encoding, facade mutation and provider scheduling are excluded.
 */
function expectedInlineMetadataValues(
  rows: ReadonlyArray<AttributionRow>,
  shape: string,
  pending: ReadonlySet<AttributionKey>,
  sourceId: string,
  overrides: Readonly<Record<string, unknown>>,
): Array<object> {
  return rows.map((row) => {
    const source = expectedAttributedRows(
      [row],
      `structured-spread`,
      pending,
      sourceId,
      `unused`,
      (id) => id,
    )[0]!
    const selected = shape.endsWith(`projection`)
      ? expectedAttributedRows(
          [row],
          shape,
          pending,
          sourceId,
          `unused`,
          (id) => id,
        )[0]!.ordinary
      : { ...source.ordinary, ...source.metadata }
    return shape === `functional-direct`
      ? selected
      : { ...selected, ...overrides }
  })
}
function checkInlineMetadataValues(
  actual: ReadonlyArray<object>,
  expected: ReadonlyArray<object>,
): void {
  // These values are flat authored records. Sorting ignores unspecified order,
  // but preserves every selected property and duplicate occurrence.
  const byId = (a: object, b: object) =>
    String((a as { id: unknown }).id).localeCompare(
      String((b as { id: unknown }).id),
    )
  expect([...actual].sort(byId)).toEqual([...expected].sort(byId))
}
const facadeMetadataHistories = collisionCases.flatMap(
  ({ collision, authoredPending }) =>
    metadataTimelineShapes
      .filter((shape) => shape !== `functional-direct` || collision === `none`)
      .flatMap((shape) =>
        [false, true].flatMap((destinationPopulated) =>
          [false, true].map((reject) => ({
            collision,
            authoredPending,
            shape,
            destinationPopulated,
            reject,
          })),
        ),
      ),
)
const facadeMetadataReach = createOracleReach(`facade metadata`, [
  ...metadataTimelineShapes.flatMap((shape) =>
    [
      `shared-held`,
      `last-route-retired`,
      `reactivated-held`,
      `settled`,
      `later-source`,
      `reshared`,
      `active-empty-ready`,
    ].map((cut) => `${shape}/${cut}`),
  ),
  ...metadataTimelineShapes.flatMap((shape) =>
    [`facade`, `toArray`, `materialize`].flatMap((form) =>
      [`held`, `reactivated`].map((cut) => `${shape}/${form}/${cut}`),
    ),
  ),
])
afterAll(() => {
  facadeMetadataReach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `facade metadata reach`,
      Object.fromEntries(facadeMetadataReach.counts()),
    )
})
declareOracle({
  model: [expectedInlineMetadataValues],
  check: [checkInlineMetadataValues],
  grammar: [facadeMetadataHistories],
})
test.each(facadeMetadataHistories)(
  `receives metadata through shared facade intervals: %j`,
  async ({
    collision,
    authoredPending,
    shape,
    destinationPopulated,
    reject,
  }) => {
    facadeMetadataReach.beginHistory()
    const reach = (cut: string) => facadeMetadataReach.reach(`${shape}/${cut}`)
    let release!: () => void
    let rejectWrite!: (error: Error) => void
    const gate = new Promise<void>((resolve, rejectGate) => {
      release = resolve
      rejectWrite = rejectGate
    })
    void gate.catch(() => {})
    let parentTruth = [
      { id: `p1`, parentId: `a` },
      { id: `p2`, parentId: `a` },
      { id: `empty`, parentId: `empty` },
    ]
    const initialChildren: Array<AttributionRow> = [
      { id: `c1`, parentId: `a`, label: `first` },
      { id: `c2`, parentId: `a`, label: `second` },
      ...(destinationPopulated
        ? [{ id: `c3`, parentId: `b`, label: `destination` }]
        : []),
    ]
    let childTruth = initialChildren.map((row) => ({ ...row }))
    const parents = createCollection(
      mockSyncCollectionOptions({
        id: `facade-metadata-parents`,
        getKey: (row: { id: string; parentId: string }) => row.id,
        initialData: parentTruth.map((row) => ({ ...row })),
      }),
    )
    const children = createCollection({
      ...mockSyncCollectionOptions<AttributionRow>({
        id: `facade-metadata-children`,
        getKey: (row) => row.id,
        initialData: initialChildren.map((row) => ({ ...row })),
      }),
      onUpdate: async () => gate,
    })
    const overrides: Record<string, unknown> = {}
    for (const field of virtualFieldNames)
      if (collision === field || collision === `all`)
        overrides[field] =
          field === `$hasPendingWrites`
            ? authoredPending
            : field === `$origin`
              ? `local`
              : `spoof`
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents }).select(({ parent }) => {
        const childRows = () => {
          const base = new Query()
            .from({ child: children })
            .where(({ child }) => eq(child.parentId, parent.parentId))
          const selected =
            shape === `functional-direct`
              ? base.fn.select(({ child }) => child)
              : shape === `functional-projection`
                ? base.fn.select(({ child }) => ({
                    id: child.id,
                    label: child.label,
                    ...overrides,
                  }))
                : shape === `structured-projection`
                  ? base.select(({ child }) => ({
                      id: child.id,
                      label: child.label,
                      hasPendingWrites: child.$hasPendingWrites,
                      ...overrides,
                    }))
                  : // Explicit virtual reads make the inline selected shape independent of
                    // whether source metadata properties happen to be enumerable.
                    shape === `functional-spread`
                    ? base.fn.select(({ child }) => ({
                        ...child,
                        $key: child.$key,
                        $collectionId: child.$collectionId,
                        $origin: child.$origin,
                        $hasPendingWrites: child.$hasPendingWrites,
                        ...overrides,
                      }))
                    : base.select(({ child }) => ({
                        ...child,
                        $key: child.$key,
                        $collectionId: child.$collectionId,
                        $origin: child.$origin,
                        $hasPendingWrites: child.$hasPendingWrites,
                        ...overrides,
                      }))
          return selected as unknown as QueryBuilder<AttributionContext>
        }
        return {
          id: parent.id,
          parentId: parent.parentId,
          children: include(childRows()),
          array: toArray(childRows()),
          materialized: materialize(childRows()),
        }
      }),
    )
    const pending = new Set<AttributionKey>()
    let intervals: FacadeIntervals<string> = { active: new Map(), next: 0 }
    const observedIntervals = new Map<number, MetadataFacade>()
    const observe = (cut?: `held` | `reactivated`) => {
      expect(
        live.toArray
          .map(({ id, parentId }) => ({ id, parentId }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual([...parentTruth].sort((a, b) => a.id.localeCompare(b.id)))
      intervals = advanceFacadeIntervals(
        intervals,
        parentTruth.map((row) => row.parentId),
      )
      checkFacadeIntervals(
        intervals,
        live.toArray.map((row) => ({
          group: row.parentId,
          facade: row.children,
        })),
        observedIntervals,
      )
      for (const parent of parentTruth) {
        const actual = live.get(parent.id)!
        const expectedChildren = childTruth.filter(
          (child) => child.parentId === parent.parentId,
        )
        if (!expectedChildren.length) reach(`active-empty-ready`)
        checkAttributedRows(
          actual.children.toArray,
          expectedAttributedRows(
            expectedChildren,
            shape,
            pending,
            children.id,
            actual.children.id,
            (id) => id,
          ),
        )
        const expectedInline = expectedInlineMetadataValues(
          expectedChildren,
          shape,
          pending,
          children.id,
          overrides,
        )
        checkInlineMetadataValues(actual.array, expectedInline)
        checkInlineMetadataValues(actual.materialized, expectedInline)
        if (cut && expectedChildren.length) {
          for (const form of [`facade`, `toArray`, `materialize`])
            facadeMetadataReach.reach(`${shape}/${form}/${cut}`)
        }
      }
    }
    const move = (id: string, parentId: string) => {
      parentTruth = parentTruth.map((row) =>
        row.id === id ? { ...row, parentId } : row,
      )
      parents.utils.begin()
      parents.utils.write({ type: `update`, value: { id, parentId } })
      parents.utils.commit()
      observe()
    }
    let settlement: Promise<unknown> | undefined
    await checkWithCleanup(async () => {
      await live.preload()
      observe()
      childTruth = childTruth.map((row) =>
        row.id === `c1` ? { ...row, label: `pending` } : row,
      )
      pending.add(`c1`)
      const mutation = children.update(`c1`, (row) => {
        row.label = `pending`
      })
      settlement = mutation.when(`settled`).then(
        () => undefined,
        (error: unknown) => error,
      )
      observe(`held`)
      reach(`shared-held`)
      move(`p1`, `b`)
      move(`p2`, `b`)
      reach(`last-route-retired`)
      move(`p1`, `a`)
      observe(`reactivated`)
      reach(`reactivated-held`)
      childTruth = initialChildren.map((row) => ({ ...row }))
      pending.clear()
      const failure = new Error(`authored facade child rejection`)
      if (reject) rejectWrite(failure)
      else release()
      expect(await settlement).toBe(reject ? failure : undefined)
      observe()
      reach(`settled`)
      childTruth = childTruth.map((row) =>
        row.id === `c1` ? { ...row, label: `later` } : row,
      )
      children.utils.begin()
      children.utils.write({
        type: `update`,
        value: { id: `c1`, parentId: `a`, label: `later` },
      })
      children.utils.commit()
      observe()
      reach(`later-source`)
      move(`p2`, `a`)
      reach(`reshared`)
    }, [
      async () => {
        release()
        await settlement
      },
      () => live.cleanup(),
      () => children.cleanup(),
      () => parents.cleanup(),
    ])
  },
)

// Inline values must not receive a facade's publication metadata. These
// controls run the same selected-shape model for absent and authored fields.
test.each([`none`, `$key`, `$hasPendingWrites`, `all`] as const)(
  `rejects facade enrichment of an inline value: %s`,
  (collision) => {
    const overrides: Record<string, unknown> = {}
    for (const field of virtualFieldNames)
      if (collision === field || collision === `all`)
        overrides[field] =
          field === `$hasPendingWrites`
            ? true
            : field === `$origin`
              ? `local`
              : `authored`
    const expected = expectedInlineMetadataValues(
      [{ id: `child`, parentId: `a`, label: `value` }],
      `functional-projection`,
      new Set(),
      `source`,
      overrides,
    )
    checkInlineMetadataValues(expected, expected)
    const hostile = [
      {
        ...expected[0],
        $key: `compiler-key`,
        $collectionId: `facade`,
        $origin: `remote`,
        $hasPendingWrites: false,
      },
    ]
    expect(() => checkInlineMetadataValues(hostile, expected)).toThrow()
  },
)

/**
 * A nullable whole-row selection yields either the complete source row or an
 * empty object. Inline values keep that shape; a facade publishes the empty
 * object as a Collection row with required output metadata. This is the runtime
 * receiving witness for the generated public type law. Presence changes in both
 * directions distinguish a never-matched fixture from the nullable boundary.
 * Compiler-generated empty-row keys are checked against the facade's own public
 * keys, not against an independent key-encoding model.
 */
function expectedNullableSelection(
  match: { id: string; label: string } | undefined,
  sourceId: string,
  facadeId: string,
  facadeKey: string | number,
) {
  const inline = match
    ? [
        {
          ...match,
          $key: match.id,
          $collectionId: sourceId,
          $origin: `remote`,
          $hasPendingWrites: false,
        },
      ]
    : [{}]
  return {
    inline,
    facade: match
      ? inline
      : [
          {
            $key: facadeKey,
            $collectionId: facadeId,
            $origin: `remote`,
            $hasPendingWrites: false,
          },
        ],
  }
}
function checkNullableSelection(
  actual: {
    facade: ReadonlyArray<object>
    inline: ReadonlyArray<ReadonlyArray<object>>
  },
  expected: ReturnType<typeof expectedNullableSelection>,
): void {
  checkInlineMetadataValues(actual.facade, expected.facade)
  for (const value of actual.inline)
    checkInlineMetadataValues(value, expected.inline)
}
const nullableFacadeHistories = [false, true].map((initialMatch) => ({
  initialMatch,
}))
const nullableFacadeReach = createOracleReach(`nullable whole-row facade`, [
  `matched`,
  `unmatched`,
])
afterAll(() => nullableFacadeReach.assertReached())
declareOracle({
  model: [expectedNullableSelection],
  check: [checkNullableSelection],
  grammar: [nullableFacadeHistories],
})
test.each(nullableFacadeHistories)(
  `publishes nullable whole rows through a facade: %j`,
  async ({ initialMatch }) => {
    nullableFacadeReach.beginHistory()
    const children = createCollection(
      mockSyncCollectionOptions<{ id: string }>({
        id: `nullable-facade-children`,
        getKey: (row) => row.id,
        initialData: [{ id: `child` }],
      }),
    )
    const authored = { id: `child`, label: `source` }
    let match = initialMatch ? { ...authored } : undefined
    const matches = createCollection(
      mockSyncCollectionOptions<typeof authored>({
        id: `nullable-facade-matches`,
        getKey: (row) => row.id,
        initialData: match ? [{ ...authored }] : [],
      }),
    )
    children.createIndex((row) => row.id, { indexType: BTreeIndex })
    matches.createIndex((row) => row.id, { indexType: BTreeIndex })
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: children }).select(({ parent }) => {
        const selected = q
          .from({ child: children })
          .where(({ child }) => eq(child.id, parent.id))
          .leftJoin({ maybe: matches }, ({ child, maybe }) =>
            eq(child.id, maybe.id),
          )
          .select(({ maybe }) => maybe)
        return {
          id: parent.id,
          children: include(selected),
          array: toArray(selected),
          materialized: materialize(selected),
          first: materialize(selected.findOne()),
        }
      }),
    )
    const observe = () => {
      const parent = live.toArray[0]!
      expect(live.toArray).toHaveLength(1)
      const keys = [...parent.children.keys()]
      expect(keys).toHaveLength(1)
      checkNullableSelection(
        {
          facade: parent.children.toArray,
          inline: [parent.array, parent.materialized, [parent.first!]],
        },
        expectedNullableSelection(
          match,
          matches.id,
          parent.children.id,
          keys[0]!,
        ),
      )
      nullableFacadeReach.reach(match ? `matched` : `unmatched`)
    }
    await checkWithCleanup(async () => {
      await live.preload()
      observe()
      for (let i = 0; i < 2; i++) {
        matches.utils.begin()
        matches.utils.write({
          type: match ? `delete` : `insert`,
          value: { ...authored },
        })
        matches.utils.commit()
        match = match ? undefined : { ...authored }
        observe()
      }
    }, [
      () => live.cleanup(),
      () => matches.cleanup(),
      () => children.cleanup(),
    ])
  },
)

// The same nullable-boundary checker must reject lost facade metadata, enriched
// inline emptiness and a missing ordinary field on a complete source row.
test.each([
  `empty-facade-metadata`,
  `empty-inline-enriched`,
  `matched-field-missing`,
] as const)(`rejects a hostile nullable whole-row observation: %s`, (fault) => {
  const expected = expectedNullableSelection(
    fault === `matched-field-missing`
      ? { id: `child`, label: `source` }
      : undefined,
    `source`,
    `facade`,
    `generated-key`,
  )
  const observed = {
    facade: structuredClone(expected.facade),
    inline: [structuredClone(expected.inline)],
  }
  checkNullableSelection(observed, expected)
  if (fault === `empty-facade-metadata`) observed.facade = [{}]
  else if (fault === `empty-inline-enriched`)
    observed.inline = [structuredClone(expected.facade)]
  else
    observed.facade = observed.facade.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== `label`),
      ),
    )
  expect(() => checkNullableSelection(observed, expected)).toThrow()
})
