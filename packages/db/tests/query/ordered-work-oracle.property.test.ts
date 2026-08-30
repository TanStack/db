import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { ReverseIndex } from '../../src/indexes/reverse-index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { eq } from '../../src/query/builder/functions.js'
import { PropRef } from '../../src/query/ir.js'
import { TotalOrder } from '../../src/query/total-order.js'
import { WindowState } from '../../src/query/live/window-state.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import type * as DbIvm from '@tanstack/db-ivm'
import type { CollectionImpl } from '../../src/collection/index.js'
import type {
  ChangeMessage,
  CurrentStateAsChangesOptions,
} from '../../src/types.js'
import type { OrderBy, OrderByDirection } from '../../src/query/ir.js'

const keyComparisonCounter = vi.hoisted(() => ({ count: 0 }))

vi.mock(`@tanstack/db-ivm`, async (importOriginal) => {
  const actual = await importOriginal<typeof DbIvm>()
  return {
    ...actual,
    compareKeys: (left: string | number, right: string | number) => {
      keyComparisonCounter.count++
      return actual.compareKeys(left, right)
    },
  }
})

type RankedRow = {
  id: string
  rank: number
  included: boolean
}

type OrderedWork = {
  keys: Array<string>
  sourceReads: Array<string>
  expectedKeyComparisons: number
  keyComparisons: number
  totalOrderComparisons: number
}

function orderedWorkCampaigns(property: string, fixedSeed: number) {
  return [
    {
      label: `fixed seed ${fixedSeed}`,
      options: { numRuns: oracleRuns(40), seed: fixedSeed },
    },
    {
      label: `random or replayed seed`,
      options: oraclePropertyOptions(40, property),
    },
  ] as const
}

function orderBy(
  direction: OrderByDirection,
  nulls: `first` | `last` = `first`,
): OrderBy {
  return [
    {
      expression: new PropRef([`rank`]),
      compareOptions: { direction, nulls },
    },
  ]
}

async function observeDescendingPrefix(
  rows: ReadonlyArray<RankedRow>,
  limit: number,
): Promise<OrderedWork> {
  const collection = createCollection(
    localOnlyCollectionOptions<RankedRow>({
      id: `ordered-work-${Math.random()}`,
      getKey: (row) => row.id,
      initialData: [...rows],
    }),
  )

  try {
    await collection.preload()
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: {
        compareOptions: {
          direction: `asc`,
          nulls: `last`,
          stringSort: `locale`,
        },
      },
    }) as BTreeIndex<string>

    let expectedKeyComparisons = 0
    let expectedMatches = 0
    for (const [, bucket] of index.orderedBucketsReversed()) {
      const orderedKeys = [...bucket]
      orderedKeys.sort((left, right) => {
        expectedKeyComparisons++
        return left < right ? -1 : left > right ? 1 : 0
      })
      expectedMatches += orderedKeys.filter(
        (key) => rows.find((row) => row.id === key)?.included === true,
      ).length
      if (expectedMatches >= limit) break
    }

    const sourceReads: Array<string> = []
    const originalGet = collection.get.bind(collection)
    collection.get = (key) => {
      sourceReads.push(String(key))
      return originalGet(key)
    }
    const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)

    try {
      keyComparisonCounter.count = 0
      const changes = collection.currentStateAsChanges({
        where: eq(new PropRef([`included`]), true),
        orderBy: orderBy(`desc`),
        limit,
      })!

      return {
        keys: changes.map(({ key }) => String(key)),
        sourceReads,
        expectedKeyComparisons,
        keyComparisons: keyComparisonCounter.count,
        totalOrderComparisons: compareEntries.mock.calls.length,
      }
    } finally {
      compareEntries.mockRestore()
    }
  } finally {
    await collection.cleanup()
  }
}

function createReversePrefixRows(options: {
  leadingRejects: number
  limit: number
  extraBoundaryMatches: number
  boundaryRejects: number
  trailingRows: number
}): {
  rows: Array<RankedRow>
  expectedKeys: Array<string>
  expectedSourceReads: number
} {
  const leading = Array.from(
    { length: options.leadingRejects },
    (_, index): RankedRow => ({
      id: `leading-${index.toString().padStart(2, `0`)}`,
      rank: 100 + index,
      included: false,
    }),
  )
  const matchingBoundary = Array.from(
    { length: options.limit + options.extraBoundaryMatches },
    (_, index): RankedRow => ({
      id: `boundary-match-${index.toString().padStart(2, `0`)}`,
      rank: 50,
      included: true,
    }),
  ).reverse()
  const rejectedBoundary = Array.from(
    { length: options.boundaryRejects },
    (_, index): RankedRow => ({
      id: `boundary-reject-${index.toString().padStart(2, `0`)}`,
      rank: 50,
      included: false,
    }),
  )
  const trailing = Array.from(
    { length: options.trailingRows },
    (_, index): RankedRow => ({
      id: `trailing-${index.toString().padStart(3, `0`)}`,
      rank: 10 - index,
      included: true,
    }),
  )
  const expectedKeys = matchingBoundary
    .map(({ id }) => id)
    .sort()
    .slice(0, options.limit)
  return {
    rows: [...trailing, ...rejectedBoundary, ...matchingBoundary, ...leading],
    expectedKeys,
    // Every row through the boundary bucket is tested once. The selected rows
    // are then read once more to materialize their change messages.
    expectedSourceReads:
      leading.length +
      matchingBoundary.length +
      rejectedBoundary.length +
      options.limit,
  }
}

describe(`ordered source work oracle`, () => {
  it(`does not read worse reverse-index buckets after filling top-K`, async () => {
    const scenario = createReversePrefixRows({
      leadingRejects: 2,
      limit: 2,
      extraBoundaryMatches: 1,
      boundaryRejects: 2,
      trailingRows: 40,
    })

    const observed = await observeDescendingPrefix(scenario.rows, 2)

    expect(observed.keys).toEqual(scenario.expectedKeys)
    expect(observed.sourceReads).toHaveLength(scenario.expectedSourceReads)
    expect(observed.sourceReads).not.toContain(`trailing-000`)
    expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
    expect(observed.totalOrderComparisons).toBe(0)
  })

  for (const campaign of orderedWorkCampaigns(
    `ordered-work.reverse-prefix`,
    1_780_101,
  )) {
    fcTest.prop(
      [
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 60 }),
      ],
      campaign.options,
    )(
      `bounds reverse-index reads at the sufficient bucket (${campaign.label})`,
      async (
        leadingRejects,
        limit,
        extraBoundaryMatches,
        boundaryRejects,
        trailingRows,
      ) => {
        const scenario = createReversePrefixRows({
          leadingRejects,
          limit,
          extraBoundaryMatches,
          boundaryRejects,
          trailingRows,
        })
        const observed = await observeDescendingPrefix(scenario.rows, limit)

        expect(observed.keys).toEqual(scenario.expectedKeys)
        expect(observed.sourceReads).toHaveLength(scenario.expectedSourceReads)
        expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
        expect(observed.totalOrderComparisons).toBe(0)
      },
    )
  }

  it(`reads the complete tied boundary when every candidate is tied`, async () => {
    const rows = Array.from(
      { length: 25 },
      (_, index): RankedRow => ({
        id: `tied-${index.toString().padStart(2, `0`)}`,
        rank: 1,
        included: index % 2 === 0,
      }),
    ).reverse()

    const observed = await observeDescendingPrefix(rows, 3)
    expect(observed.keys).toEqual([`tied-00`, `tied-02`, `tied-04`])
    expect(observed.sourceReads).toHaveLength(rows.length + 3)
    expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
    expect(observed.totalOrderComparisons).toBe(0)
  })

  it(`keeps comparator-equivalent BTree values in one ordered tie class`, async () => {
    type NullableRankedRow = Omit<RankedRow, `rank`> & {
      rank: number | null | undefined
    }
    const rows: Array<NullableRankedRow> = [
      { id: `undefined`, rank: undefined, included: true },
      { id: `null`, rank: null, included: true },
      { id: `one`, rank: 1, included: true },
    ]
    const collection = createCollection(
      localOnlyCollectionOptions<NullableRankedRow>({
        id: `ordered-work-nullish-tie`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )

    try {
      await collection.preload()
      collection.createIndex((row) => row.rank, { indexType: BTreeIndex })

      const changes = collection.currentStateAsChanges({
        orderBy: orderBy(`desc`, `last`),
        limit: rows.length,
      })!

      expect(changes.map(({ key }) => key)).toEqual([
        `one`,
        `null`,
        `undefined`,
      ])
    } finally {
      await collection.cleanup()
    }
  })

  it(`does not reverse an index with incompatible null placement`, async () => {
    type NullableRankedRow = Omit<RankedRow, `rank`> & {
      rank: number | null | undefined
    }
    const collection = createCollection(
      localOnlyCollectionOptions<NullableRankedRow>({
        id: `ordered-work-null-placement`,
        getKey: (row) => row.id,
        initialData: [
          { id: `undefined`, rank: undefined, included: true },
          { id: `null`, rank: null, included: true },
          { id: `one`, rank: 1, included: true },
        ],
      }),
    )

    try {
      await collection.preload()
      collection.createIndex((row) => row.rank, { indexType: BTreeIndex })

      const changes = collection.currentStateAsChanges({
        orderBy: orderBy(`desc`, `first`),
      })!

      expect(changes.map(({ key }) => key)).toEqual([
        `null`,
        `undefined`,
        `one`,
      ])
    } finally {
      await collection.cleanup()
    }
  })

  it(`keeps custom indexes on the materialized reverse-order fallback`, async () => {
    const rows: Array<RankedRow> = [
      { id: `later`, rank: 1, included: true },
      { id: `tie-b`, rank: 2, included: true },
      { id: `tie-a`, rank: 2, included: true },
    ]
    const collection = createCollection(
      localOnlyCollectionOptions<RankedRow>({
        id: `ordered-work-custom-index-fallback`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )

    try {
      await collection.preload()
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
        options: {
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            stringSort: `locale`,
          },
        },
      }) as BTreeIndex<string>
      const customIndex = new Proxy(index, {
        get(target, property) {
          if (
            property === `orderedBuckets` ||
            property === `orderedBucketsReversed`
          ) {
            return undefined
          }
          const value = Reflect.get(target, property, target) as unknown
          return typeof value === `function` ? value.bind(target) : value
        },
      })
      collection.indexes.set(index.id, customIndex)
      expect(new ReverseIndex(customIndex).supportsOrderedBucketIteration).toBe(
        false,
      )

      const changes = collection.currentStateAsChanges({
        orderBy: orderBy(`desc`, `first`),
        limit: 2,
      })!

      expect(changes.map(({ key }) => key)).toEqual([`tie-a`, `tie-b`])
    } finally {
      await collection.cleanup()
    }
  })

  it(`groups comparator-equivalent values in every built-in index direction`, () => {
    type TextRow = { id: string; value: string }
    const rows: Array<TextRow> = [
      { id: `upper`, value: `A` },
      { id: `lower`, value: `a` },
      { id: `later`, value: `b` },
    ]

    for (const IndexType of [BasicIndex, BTreeIndex]) {
      const index = new IndexType<string>(
        1,
        new PropRef([`value`]),
        undefined,
        {
          compareFn: (left: string, right: string) =>
            left.toLowerCase().localeCompare(right.toLowerCase()),
        },
      )
      index.build(rows.map((row) => [row.id, row]))

      expect(
        [...index.orderedBuckets()].map(([, keys]) => [...keys].sort()),
      ).toEqual([[`lower`, `upper`], [`later`]])
      expect(
        [...index.orderedBucketsReversed()].map(([, keys]) => [...keys].sort()),
      ).toEqual([[`later`], [`lower`, `upper`]])
      expect(
        [...new ReverseIndex(index).orderedBuckets()].map(([, keys]) =>
          [...keys].sort(),
        ),
      ).toEqual([[`later`], [`lower`, `upper`]])

      index.remove(`upper`, rows[0])
      expect(
        [...index.orderedBuckets()].map(([, keys]) => [...keys].sort()),
      ).toEqual([[`lower`], [`later`]])
    }
  })
})

type SnapshotFixture = {
  collection: CollectionImpl<RankedRow, string>
  snapshotRevisions: Array<number>
  replace: (row: RankedRow) => void
}

function createSnapshotFixture(
  initialRows: ReadonlyArray<RankedRow>,
): SnapshotFixture {
  let rows = new Map(initialRows.map((row) => [row.id, row]))
  let revision = 0
  const snapshotRevisions: Array<number> = []
  const collection = {
    compareOptions: { stringSort: `lexical` },
    get _stateRevision() {
      return revision
    },
    currentStateAsChanges: (options: CurrentStateAsChangesOptions) => {
      snapshotRevisions.push(revision)
      return [...rows]
        .filter(([, value]) => options.where === undefined || value.included)
        .sort((left, right) =>
          left[1].rank === right[1].rank
            ? left[0].localeCompare(right[0])
            : left[1].rank - right[1].rank,
        )
        .map(
          ([key, value]): ChangeMessage<RankedRow, string> => ({
            type: `insert`,
            key,
            value,
          }),
        )
    },
    entries: () => rows.entries(),
    get: (key: string) => rows.get(key),
  } as unknown as CollectionImpl<RankedRow, string>

  return {
    collection,
    snapshotRevisions,
    replace: (row) => {
      rows = new Map(rows).set(row.id, row)
      revision++
    },
  }
}

function observeWindow<TRow extends RankedRow, TKey extends string | number>(
  window: WindowState<TRow, TKey>,
) {
  return {
    localPrefixSize: window.localPrefixSize,
    rowsNeeded: window.rowsNeeded(),
    publication: window.publicationEntries().map(([key]) => key),
    boundary: window.boundary(),
    requestBoundary: window.requestBoundary(),
    progressBoundary: window.progressBoundary(),
    changes: window.reconcile(new Map()).map(({ key }) => key),
  }
}

function createCoveredWindow(fixture: SnapshotFixture, size: number) {
  const window = new WindowState(
    fixture.collection,
    orderBy(`asc`),
    eq(new PropRef([`included`]), true),
    size,
  )
  window.recordInitialCoverage(undefined, true)
  return window
}

it(`reuses one ordered source snapshot until the collection revision changes`, () => {
  const fixture = createSnapshotFixture([
    { id: `a`, rank: 1, included: true },
    { id: `b`, rank: 2, included: true },
    { id: `hidden`, rank: 0, included: false },
  ])
  const window = createCoveredWindow(fixture, 2)

  expect(observeWindow(window)).toMatchObject({
    localPrefixSize: 2,
    rowsNeeded: 0,
    publication: [`a`, `b`],
  })
  expect(observeWindow(window)).toMatchObject({ publication: [`a`, `b`] })
  expect(fixture.snapshotRevisions).toEqual([0])

  fixture.replace({ id: `b`, rank: -1, included: true })

  expect(observeWindow(window)).toMatchObject({ publication: [`b`, `a`] })
  expect(observeWindow(window)).toMatchObject({ publication: [`b`, `a`] })
  expect(fixture.snapshotRevisions).toEqual([0, 1])
})

it(`compiles the ordered predicate once for the lifetime of a window`, () => {
  const fixture = createSnapshotFixture([
    { id: `a`, rank: 1, included: true },
    { id: `hidden`, rank: 0, included: false },
  ])
  let compilationReads = 0
  const where = new Proxy(eq(new PropRef([`included`]), true), {
    get(target, property, receiver) {
      if (property === `type`) compilationReads++
      return Reflect.get(target, property, receiver)
    },
  })
  const window = new WindowState(fixture.collection, orderBy(`asc`), where, 1)
  const readsAfterConstruction = compilationReads
  expect(readsAfterConstruction).toBeGreaterThan(0)
  window.recordInitialCoverage(undefined, true)

  observeWindow(window)
  observeWindow(window)
  fixture.replace({ id: `a`, rank: 2, included: true })
  observeWindow(window)

  expect(compilationReads).toBe(readsAfterConstruction)
})

it(`invalidates the ordered snapshot after a committed collection write`, async () => {
  const collection = createCollection(
    localOnlyCollectionOptions<RankedRow>({
      id: `ordered-work-revision-write`,
      getKey: (row) => row.id,
      initialData: [
        { id: `a`, rank: 1, included: true },
        { id: `b`, rank: 2, included: true },
      ],
    }),
  )

  try {
    await collection.preload()
    collection.createIndex((row) => row.rank, { indexType: BTreeIndex })
    const snapshotRevisions: Array<number> = []
    const originalSnapshot = collection.currentStateAsChanges.bind(collection)
    collection.currentStateAsChanges = (options) => {
      snapshotRevisions.push(collection._stateRevision)
      return originalSnapshot(options)
    }
    const window = new WindowState(
      collection,
      orderBy(`asc`),
      eq(new PropRef([`included`]), true),
      2,
    )
    window.recordInitialCoverage(undefined, true)

    expect(observeWindow(window).publication).toEqual([`a`, `b`])
    expect(observeWindow(window).publication).toEqual([`a`, `b`])
    const initialRevision = collection._stateRevision
    expect(snapshotRevisions).toEqual([initialRevision])

    collection.update(`b`, (draft) => {
      draft.rank = -1
    })

    expect(observeWindow(window).publication).toEqual([`b`, `a`])
    expect(observeWindow(window).publication).toEqual([`b`, `a`])
    expect(collection._stateRevision).toBeGreaterThan(initialRevision)
    expect(snapshotRevisions).toEqual([
      initialRevision,
      collection._stateRevision,
    ])
  } finally {
    await collection.cleanup()
  }
})

for (const campaign of orderedWorkCampaigns(
  `ordered-work.snapshot-reuse`,
  1_780_102,
)) {
  fcTest.prop(
    [
      fc.array(fc.integer({ min: -20, max: 20 }), {
        minLength: 1,
        maxLength: 12,
      }),
      fc.integer({ min: 1, max: 8 }),
      fc.array(fc.integer({ min: -20, max: 20 }), {
        minLength: 0,
        maxLength: 8,
      }),
    ],
    campaign.options,
  )(
    `takes at most one ordered snapshot per source revision (${campaign.label})`,
    (initialRanks, observationCount, replacementRanks) => {
      const fixture = createSnapshotFixture(
        initialRanks.map((rank, index) => ({
          id: `row-${index}`,
          rank,
          included: index % 3 !== 0,
        })),
      )
      const window = createCoveredWindow(
        fixture,
        Math.min(3, initialRanks.length),
      )

      for (let index = 0; index < observationCount; index++) {
        observeWindow(window)
      }
      for (let index = 0; index < replacementRanks.length; index++) {
        fixture.replace({
          id: `row-${index % initialRanks.length}`,
          rank: replacementRanks[index]!,
          included: index % 2 === 0,
        })
        for (let repeat = 0; repeat < observationCount; repeat++) {
          observeWindow(window)
        }
      }

      expect(fixture.snapshotRevisions).toEqual(
        Array.from(
          { length: replacementRanks.length + 1 },
          (_, index) => index,
        ),
      )
    },
  )
}
