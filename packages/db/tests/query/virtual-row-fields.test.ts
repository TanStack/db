// Ordinary tests for virtual row fields: a fixed root-shape scenario compared
// with written values, and a harness self-test for checkWithCleanup. The
// published-row classification law is owned by virtual-row-fields-oracle.test.ts.
import { describe, expect, test, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  createLiveQueryCollection,
  eq,
  include,
  toArray,
} from '../../src/query/index.js'
import { hasVirtualProps } from '../../src/virtual-props.js'
import { mockSyncCollectionOptions } from '../utils.js'
import { expectedSourceMetadata } from './virtual-row-fields-source-oracle.js'
import {
  boundaryPublicationHistories,
  checkAttributedRows,
  checkBoundaryPublication,
  checkInlineMetadataValues,
  checkMetadataPublications,
  checkNullableSelection,
  expectedAttributedRows,
  expectedBoundaryPublication,
  expectedInlineMetadataValues,
  expectedMetadataChanges,
  expectedNullableSelection,
  publishedModelRows,
} from './virtual-row-fields-model-oracle.js'
import {
  checkWithCleanup,
  virtualFieldNames,
} from './virtual-row-fields-support.js'
import type {
  AttributionKey,
  AttributionRow,
} from './virtual-row-fields-model-oracle.js'

type Profile = { label: string }

type Row = {
  id: string
  profile: Profile
  optionalProfile?: Profile
  createdAt: Date
  tags: Array<string>
}

function assertPublishedRootFields(row: unknown, name: string): void {
  for (const field of virtualFieldNames) {
    if (!(field in Object(row))) {
      throw new Error(`${name} root must expose ${field}`)
    }
  }
  expect(hasVirtualProps(row), `${name} root classification`).toBe(true)
}

describe(`virtual row field runtime boundary`, () => {
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
        expect(row!.$hasPendingWrites, `${name} legacy inverse`).toBe(
          !!row!.$hasPendingWrites,
        )
      }

      expect(implicit.toArray[0]?.id).toBe(`row-1`)
      expect(expression.toArray[0]).toMatchObject({
        id: `row-1`,
        label: `nested`,
      })
      expect(functional.toArray[0]).toMatchObject({
        id: `row-1`,
        label: `nested`,
      })

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
})

describe(`virtual metadata attribution regressions`, () => {
  test(`gives projected Collection-valued include rows their facade metadata`, async () => {
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
        children: include(
          q
            .from({ child: children })
            .where(({ child }) => eq(child.parentId, parent.id))
            .select(({ child }) => ({
              id: child.id,
              $key: `selected-key`,
              $collectionId: `selected-collection`,
              $hasPendingWrites: true,
              $origin: `local`,
            })),
        ),
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
    // An authored projection acquires its output Collection metadata, including
    // inside a child facade. Inline values keep their selected shape.
    await checkWithCleanup(async () => {
      await live.preload()
      const child = live.toArray[0]!.children.toArray[0]!
      expect(child.$collectionId).toBe(live.toArray[0]!.children.id)
      expect(child.$key).toBe(`child-1`)
      expect(child.$hasPendingWrites).toBe(false)
      expect(child.$origin).toBe(`remote`)
      expect(live.toArray[0]!.inlineChildren).toEqual([
        { id: `child-1`, $key: `inline-selected-key` },
      ])
    }, [
      () => live.cleanup(),
      () => children.cleanup(),
      () => parents.cleanup(),
    ])
  })

  test(`keeps joined identity and source attribution across a pending update`, async () => {
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
        .fn.select(({ item }) => item ?? {}),
    )

    // The pair owns identity; the whole-row selection names its attribution
    // source. These supplemental examples use the source's public metadata.
    // The join key oracle independently checks multiplicity and key agreement.
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
          for (const output of [live, extended, lastItem, functional])
            expect(output.toArray[0]![name], name).toBe(
              name === `$key` ? [...output.keys()][0] : item[name],
            )
        }
      }

      expectItemMetadata()
      for (const name of virtualFieldNames) {
        expect(fromLive.toArray[0]![name], name).toBe(
          name === `$key`
            ? [...fromLive.keys()][0]
            : lists.get(`list-1`)![name],
        )
        expect(lastList.toArray[0]![name], `last list ${name}`).toBe(
          name === `$key`
            ? [...lastList.keys()][0]
            : lists.get(`list-1`)![name],
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
        expect(live.toArray[0]![name], name).toBe(
          name === `$key` ? [...live.keys()][0] : items.get(`item-1`)![name],
        )
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

    // Ordinary projections receive output metadata even while the source has
    // a pending optimistic update; their fields cannot spoof system metadata.
    await checkWithCleanup(async () => {
      await Promise.all([live.preload(), functional.preload()])
      const update = rows.update(`row-1`, (draft) => {
        draft.label = `pending`
      })
      await vi.waitFor(() => {
        expect(rows.get(`row-1`)?.$hasPendingWrites).toBe(true)
        expect(live.toArray[0]?.label).toBe(`pending`)
      })

      for (const output of [live, functional]) {
        expect(output.toArray[0]).toMatchObject({
          $hasPendingWrites: false,
          $origin: `remote`,
          $collectionId: output.id,
        })
        expect(output.toArray[0]!.$key).not.toBe(`selected-key`)
      }

      rows.utils.resolveSync()
      await update.when(`settled`)
    }, [() => functional.cleanup(), () => live.cleanup(), () => rows.cleanup()])
  })
})

// Checker calibrations for the virtual-field publication oracle in
// virtual-row-fields-oracle.test.ts. They run no production: each builds a
// hostile observation from the independent model and feeds it to the oracle's
// check, which must reject it.
// Calibrate the same comparison against the former source-attribution rule.
// Mutate one metadata observation at a time; ordinary group values stay valid.
test.each(
  boundaryPublicationHistories.filter(
    ({ kind }) => kind === `grouped` || kind === `aggregate`,
  ),
)(`rejects source metadata on a grouped output: %j`, (history) => {
  const parent = { id: `parent`, parentId: `root`, label: `parent` }
  const child = { id: `child`, parentId: `parent`, label: `held` }
  const expected = expectedBoundaryPublication(
    history,
    parent,
    [child],
    new Set([child.id]),
    `parent-source`,
    `child-source`,
    `output`,
  )
  const sourceMetadata = expectedSourceMetadata(child.id, `child-source`, true)
  for (const field of virtualFieldNames) {
    const wrong = expected.map(
      ({ ordinary, metadata }) =>
        [
          metadata.$key as AttributionKey,
          { ...ordinary, ...metadata, [field]: sourceMetadata[field] },
        ] as const,
    )
    expect(() => checkBoundaryPublication(wrong, expected), field).toThrow()
  }
})

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
