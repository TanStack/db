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
 * Collection-valued child is compared with its source Collection, while its
 * inline sibling must retain the selected `$key` value. The root-shape
 * matrix rejects the wrong rule that only expression projections receive
 * virtual row fields. Prior hostile controls made projected-value
 * enrichment and a missing whole-row classification fail at these
 * observations. `checkWithCleanup` retains the primary mismatch as the cause
 * when Collection cleanup also fails and attempts every cleanup.
 */
import { describe, expect, test, vi } from 'vitest'
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
  `$hasPendingWrites`,
  `$origin`,
  `$collectionId`,
] as const

// Only row roots and unprojected whole-row children carry virtual row fields.
function expectsVirtualFields(subject: VirtualFieldSubject): boolean {
  return subject === `row-root` || subject === `whole-row-child`
}

function assertPublishedRootFields(row: unknown, name: string): void {
  for (const field of virtualFieldNames) {
    if (!(field in Object(row))) {
      throw new Error(`${name} root must expose ${field}`)
    }
  }
  expect(hasVirtualProps(row), `${name} root classification`).toBe(true)
}

async function checkWithCleanup(
  check: () => Promise<void>,
  cleanups: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
  let primaryFailure: unknown
  let checkFailed = false
  try {
    await check()
  } catch (error) {
    primaryFailure = error
    checkFailed = true
  }

  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }

  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      `Virtual row oracle check and cleanup failed`,
      {
        cause: primaryFailure,
      },
    )
  }
  if (checkFailed) throw primaryFailure
}

describe(`virtual row field runtime boundary`, () => {
  test(`keeps source metadata authoritative on Collection-valued include rows`, async () => {
    const parents = createCollection(
      mockSyncCollectionOptions<{ id: string }>({
        id: `included-virtual-parents`,
        getKey: (row) => row.id,
        initialData: [{ id: `parent-1` }],
      }),
    )
    const children = createCollection(
      mockSyncCollectionOptions<{ id: string; parentId: string }>({
        id: `included-virtual-children`,
        getKey: (row) => row.id,
        initialData: [{ id: `child-1`, parentId: `parent-1` }],
      }),
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents }).select(({ parent }) => ({
        id: parent.id,
        children: q
          .from({ child: children })
          .where(({ child }) => eq(child.parentId, parent.id))
          .select(({ child }) => ({
            id: child.id,
            $key: `selected-key`,
            $collectionId: `selected-collection`,
            $hasPendingWrites: true,
            $origin: `local`,
          })),
        inlineChildren: toArray(
          q
            .from({ child: children })
            .where(({ child }) => eq(child.parentId, parent.id))
            .select(({ child }) => ({
              id: child.id,
              $key: `inline-selected-key`,
            })),
        ),
      })),
    )
    // A child facade is a public Collection, unlike an inline toArray value.
    // Its row cannot publish selected literals as system metadata.
    await checkWithCleanup(async () => {
      await live.preload()
      const child = live.toArray[0]!.children.toArray[0]!
      const source = children.get(`child-1`)!
      for (const name of virtualFieldNames) {
        expect(child[name], name).toBe(source[name])
      }
      expect(live.toArray[0]!.inlineChildren).toEqual([
        { id: `child-1`, $key: `inline-selected-key` },
      ])
    }, [
      () => live.cleanup(),
      () => children.cleanup(),
      () => parents.cleanup(),
    ])
  })

  test(`keeps a selected joined row's source metadata across match and pending update`, async () => {
    const lists = createCollection(
      mockSyncCollectionOptions<{ id: string }>({
        id: `joined-virtual-lists`,
        getKey: (row) => row.id,
        initialData: [{ id: `list-1` }],
      }),
    )
    const items = createCollection(
      mockSyncCollectionOptions<{
        id: string
        listId: string
        label: string
      }>({
        id: `joined-virtual-items`,
        getKey: (row) => row.id,
        initialData: [{ id: `item-1`, listId: `list-1`, label: `before` }],
      }),
    )
    const live = createLiveQueryCollection((q) =>
      q
        .from({ list: lists })
        .join({ item: items }, ({ list, item }) => eq(list.id, item.listId))
        .select(({ item }) => ({ ...item })),
    )
    const fromLive = createLiveQueryCollection((q) =>
      q
        .from({ list: lists })
        .join({ item: items }, ({ list, item }) => eq(list.id, item.listId))
        .select(({ list }) => ({ ...list })),
    )
    const extended = createLiveQueryCollection((q) =>
      q
        .from({ list: lists })
        .join({ item: items }, ({ list, item }) => eq(list.id, item.listId))
        .select(({ item }) => ({
          ...item,
          copyOfLabel: item.label,
          $key: `selected-key`,
        })),
    )
    const lastItem = createLiveQueryCollection((q) =>
      q
        .from({ list: lists })
        .join({ item: items }, ({ list, item }) => eq(list.id, item.listId))
        .select(({ list, item }) => ({ ...list, ...item })),
    )
    const lastList = createLiveQueryCollection((q) =>
      q
        .from({ list: lists })
        .join({ item: items }, ({ list, item }) => eq(list.id, item.listId))
        .select(({ list, item }) => ({ ...item, ...list })),
    )
    const functional = createLiveQueryCollection((q) =>
      q
        .from({ list: lists })
        .join({ item: items }, ({ list, item }) => eq(list.id, item.listId))
        .fn.select(({ item }) => ({ ...item })),
    )

    // A whole-row selection names the joined item as its metadata source.
    // The independent expected row is the item's public Collection row at
    // each checkpoint; list metadata has a different key and Collection ID.
    await checkWithCleanup(async () => {
      await Promise.all([
        live.preload(),
        fromLive.preload(),
        extended.preload(),
        lastItem.preload(),
        lastList.preload(),
        functional.preload(),
      ])
      const expectItemMetadata = () => {
        const actual = live.toArray[0]!
        const item = items.get(`item-1`)!
        expect(actual.label).toBe(item.label)
        for (const name of virtualFieldNames) {
          expect(actual[name], name).toBe(item[name])
          expect(extended.toArray[0]![name], `extended ${name}`).toBe(
            item[name],
          )
          expect(lastItem.toArray[0]![name], `last item ${name}`).toBe(
            item[name],
          )
          expect(functional.toArray[0]![name], `functional ${name}`).toBe(
            item[name],
          )
        }
      }

      expectItemMetadata()
      for (const name of virtualFieldNames) {
        expect(fromLive.toArray[0]![name], name).toBe(
          lists.get(`list-1`)![name],
        )
        expect(lastList.toArray[0]![name], `last list ${name}`).toBe(
          lists.get(`list-1`)![name],
        )
      }
      const update = items.update(`item-1`, (draft) => {
        draft.label = `pending`
      })
      await vi.waitFor(() => expect(live.toArray[0]?.label).toBe(`pending`))
      expect(items.get(`item-1`)?.$hasPendingWrites).toBe(true)
      expectItemMetadata()
      items.utils.resolveSync()
      await update.when(`settled`)
      expectItemMetadata()
    }, [
      () => fromLive.cleanup(),
      () => extended.cleanup(),
      () => lastItem.cleanup(),
      () => lastList.cleanup(),
      () => functional.cleanup(),
      () => live.cleanup(),
      () => items.cleanup(),
      () => lists.cleanup(),
    ])
  })

  test(`keeps the selected right-join row's metadata when the FROM row is absent`, async () => {
    const lists = createCollection(
      mockSyncCollectionOptions<{ id: string }>({
        id: `right-virtual-lists`,
        getKey: (row) => row.id,
        initialData: [],
      }),
    )
    const items = createCollection(
      mockSyncCollectionOptions<{ id: string; listId: string }>({
        id: `right-virtual-items`,
        getKey: (row) => row.id,
        initialData: [{ id: `item-1`, listId: `missing` }],
      }),
    )
    const live = createLiveQueryCollection((q) =>
      q
        .from({ list: lists })
        .rightJoin({ item: items }, ({ list, item }) =>
          eq(list.id, item.listId),
        )
        .select(({ item }) => item),
    )

    await checkWithCleanup(async () => {
      await live.preload()
      expect(live.toArray).toHaveLength(1)
      for (const name of virtualFieldNames) {
        expect(live.toArray[0]![name], name).toBe(items.get(`item-1`)![name])
      }
    }, [() => live.cleanup(), () => items.cleanup(), () => lists.cleanup()])
  })

  test(`keeps source write metadata authoritative over selected field names`, async () => {
    const rows = createCollection(
      mockSyncCollectionOptions<{ id: string; label: string }>({
        id: `virtual-row-fields-colliding-projection-source`,
        getKey: (row) => row.id,
        initialData: [{ id: `row-1`, label: `before` }],
      }),
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => ({
        id: row.id,
        label: row.label,
        $hasPendingWrites: false,
        $origin: `remote`,
        $key: `selected-key`,
        $collectionId: `selected-collection`,
      })),
    )
    const functional = createLiveQueryCollection((q) =>
      q.from({ row: rows }).fn.select(({ row }) => ({
        id: row.id,
        label: row.label,
        $hasPendingWrites: false,
        $origin: `remote`,
        $key: `selected-key`,
        $collectionId: `selected-collection`,
      })),
    )

    // The model is the source Collection's public row during a held optimistic
    // update. Selection changes user fields, but cannot author system metadata.
    await checkWithCleanup(async () => {
      await Promise.all([live.preload(), functional.preload()])
      const update = rows.update(`row-1`, (draft) => {
        draft.label = `pending`
      })
      await vi.waitFor(() => {
        expect(rows.get(`row-1`)?.$hasPendingWrites).toBe(true)
        expect(live.toArray[0]?.label).toBe(`pending`)
      })

      expect(live.toArray[0]).toMatchObject({
        $hasPendingWrites: true,
        $origin: `local`,
        $key: `row-1`,
        $collectionId: rows.id,
      })
      expect(functional.toArray[0]).toMatchObject({
        $hasPendingWrites: true,
        $origin: `local`,
        $key: `row-1`,
        $collectionId: rows.id,
      })

      rows.utils.resolveSync()
      await update.when(`settled`)
    }, [() => functional.cleanup(), () => live.cleanup(), () => rows.cleanup()])
  })

  test(`publishes every virtual field on implicit, expression, and functional root shapes`, async () => {
    const rows = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-row-fields-root-shapes-source`,
        getKey: (row) => row.id,
        initialData: [
          {
            id: `row-1`,
            profile: { label: `nested` },
            createdAt: new Date(`2026-09-20T12:34:56.000Z`),
            tags: [`one`],
          },
        ],
      }),
    )
    const implicit = createLiveQueryCollection((q) => q.from({ row: rows }))
    const expression = createLiveQueryCollection((q) =>
      q.from({ row: rows }).select(({ row }) => ({
        id: row.id,
        label: row.profile.label,
      })),
    )
    const functional = createLiveQueryCollection((q) =>
      q.from({ row: rows }).fn.select(({ row }) => ({
        id: row.id,
        label: row.profile.label,
      })),
    )

    await checkWithCleanup(async () => {
      await Promise.all([
        implicit.preload(),
        expression.preload(),
        functional.preload(),
      ])

      const observed = [
        { name: `implicit`, row: implicit.toArray[0] },
        { name: `expression`, row: expression.toArray[0] },
        { name: `functional`, row: functional.toArray[0] },
      ]
      for (const { name, row } of observed) {
        expect(row, `${name} root must publish`).toBeDefined()
        assertPublishedRootFields(row, name)
        expect(row!.$hasPendingWrites, `${name} has no pending write`).toBe(
          false,
        )
        expect(`$synced` in row!, `${name} omits the removed alias`).toBe(false)
      }

      expect(implicit.toArray[0]?.id).toBe(`row-1`)
      expect(implicit.toArray[0]?.$collectionId).toBe(rows.id)
      expect(expression.toArray[0]).toMatchObject({
        id: `row-1`,
        label: `nested`,
      })
      expect(expression.toArray[0]?.$collectionId).toBe(expression.id)
      expect(functional.toArray[0]).toMatchObject({
        id: `row-1`,
        label: `nested`,
      })
      expect(functional.toArray[0]?.$collectionId).toBe(functional.id)

      // Wrong rule: functional projection outputs are treated as ordinary
      // values and never receive root fields. The direct field check above
      // rejects this observation at the same post-preload checkpoint.
      const wrongFunctionalRoot = Object.fromEntries(
        Object.entries(functional.toArray[0]!).filter(
          ([field]) => field !== `$collectionId`,
        ),
      )
      expect(() =>
        assertPublishedRootFields(wrongFunctionalRoot, `functional`),
      ).toThrow(`functional root must expose $collectionId`)
    }, [
      () => functional.cleanup(),
      () => expression.cleanup(),
      () => implicit.cleanup(),
      () => rows.cleanup(),
    ])
  })

  test(`keeps the primary mismatch and attempts every cleanup`, async () => {
    const mismatch = new Error(`published row mismatch`)
    const firstCleanupError = new Error(`first cleanup failed`)
    const lastCleanupError = new Error(`last cleanup failed`)
    const attempted: Array<string> = []

    await expect(
      checkWithCleanup(async () => {
        throw mismatch
      }, [
        async () => {
          attempted.push(`first`)
          throw firstCleanupError
        },
        async () => {
          attempted.push(`middle`)
        },
        async () => {
          attempted.push(`last`)
          throw lastCleanupError
        },
      ]),
    ).rejects.toMatchObject({
      cause: mismatch,
      errors: [firstCleanupError, lastCleanupError],
    })
    expect(attempted).toEqual([`first`, `middle`, `last`])
  })

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
