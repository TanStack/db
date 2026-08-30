import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { ReverseIndex } from '../../src/indexes/reverse-index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { eq } from '../../src/query/builder/functions.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { PropRef } from '../../src/query/ir.js'
import { TotalOrder } from '../../src/query/total-order.js'
import { WindowState } from '../../src/query/live/window-state.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import type * as DbIvm from '@tanstack/db-ivm'
import type { CollectionImpl } from '../../src/collection/index.js'
import type { CompareOptions } from '../../src/query/builder/types.js'
import type {
  ChangeMessage,
  CurrentStateAsChangesOptions,
  StringCollationConfig,
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

type PublicKeyRankedRow = Omit<RankedRow, `id`> & {
  id: string | number
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

function orderByWithOptions(compareOptions: CompareOptions): OrderBy {
  return [{ expression: new PropRef([`rank`]), compareOptions }]
}

const publicKeyIndexCompareOptions = {
  direction: `asc`,
  nulls: `last`,
  stringSort: `locale`,
} satisfies CompareOptions

function publicKeyOrderBy(direction: OrderByDirection): OrderBy {
  return orderByWithOptions({
    ...publicKeyIndexCompareOptions,
    direction,
    nulls: direction === `asc` ? `last` : `first`,
  })
}

function comparePublicKeys(
  left: string | number,
  right: string | number,
): number {
  if (typeof left !== typeof right) {
    return typeof left === `string` ? -1 : 1
  }
  if (typeof left === `number` && typeof right === `number`) {
    const leftIsNaN = Number.isNaN(left)
    const rightIsNaN = Number.isNaN(right)
    if (leftIsNaN || rightIsNaN) {
      if (leftIsNaN && rightIsNaN) return 0
      return leftIsNaN ? 1 : -1
    }
  }
  return left < right ? -1 : left > right ? 1 : 0
}

const orderedIndexCompatibilityCases = ([`basic`, `btree`] as const).flatMap(
  (indexKind) =>
    ([`asc`, `desc`] as const).flatMap((indexDirection) =>
      ([`first`, `last`] as const).flatMap((indexNulls) =>
        ([`asc`, `desc`] as const).flatMap((queryDirection) =>
          ([`first`, `last`] as const).map((queryNulls) => ({
            indexKind,
            indexDirection,
            indexNulls,
            queryDirection,
            queryNulls,
            compatible:
              indexDirection === queryDirection
                ? indexNulls === queryNulls
                : indexNulls !== queryNulls,
          })),
        ),
      ),
    ),
)

const stringComparisonVariants = [
  {
    name: `the same locale options`,
    collation: {
      stringSort: `locale`,
      locale: `en`,
      localeOptions: { numeric: true, sensitivity: `base` },
    },
    compatible: true,
  },
  {
    name: `lexical string order`,
    collation: { stringSort: `lexical` },
    compatible: false,
  },
  {
    name: `another locale`,
    collation: {
      stringSort: `locale`,
      locale: `de`,
      localeOptions: { numeric: true, sensitivity: `base` },
    },
    compatible: false,
  },
  {
    name: `another numeric option`,
    collation: {
      stringSort: `locale`,
      locale: `en`,
      localeOptions: { numeric: false, sensitivity: `base` },
    },
    compatible: false,
  },
  {
    name: `another sensitivity option`,
    collation: {
      stringSort: `locale`,
      locale: `en`,
      localeOptions: { numeric: true, sensitivity: `accent` },
    },
    compatible: false,
  },
] satisfies Array<{
  name: string
  collation: StringCollationConfig
  compatible: boolean
}>

const orderedStringCompatibilityCases = ([`basic`, `btree`] as const).flatMap(
  (indexKind) =>
    ([`asc`, `desc`] as const).flatMap((queryDirection) =>
      stringComparisonVariants.map(({ name, collation, compatible }) => ({
        name,
        indexKind,
        queryDirection,
        compareOptions: {
          ...collation,
          direction: queryDirection,
          nulls:
            queryDirection === `asc` ? (`last` as const) : (`first` as const),
        } satisfies CompareOptions,
        compatible,
      })),
    ),
)

async function observeOrderedPrefix(
  rows: ReadonlyArray<RankedRow>,
  limit: number,
  indexKind: `basic` | `btree` = `btree`,
  direction: OrderByDirection = `desc`,
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
      indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
      options: {
        compareOptions: {
          direction: `asc`,
          nulls: `last`,
          stringSort: `locale`,
        },
      },
    }) as BasicIndex<string> | BTreeIndex<string>

    let expectedKeyComparisons = 0
    let expectedMatches = 0
    const expectedBuckets =
      direction === `asc`
        ? index.orderedBuckets()
        : index.orderedBucketsReversed()
    for (const [, bucket] of expectedBuckets) {
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
        orderBy: orderBy(direction, direction === `asc` ? `last` : `first`),
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

function createOrderedPrefixRows(
  options: {
    leadingRejects: number
    limit: number
    extraBoundaryMatches: number
    boundaryRejects: number
    trailingRows: number
  },
  direction: OrderByDirection = `desc`,
): {
  rows: Array<RankedRow>
  expectedKeys: Array<string>
  expectedSourceReads: Array<string>
} {
  const rank = (descendingRank: number) =>
    direction === `desc` ? descendingRank : -descendingRank
  const leading = Array.from(
    { length: options.leadingRejects },
    (_, index): RankedRow => ({
      id: `leading-${index.toString().padStart(2, `0`)}`,
      rank: rank(100 + index),
      included: false,
    }),
  )
  const matchingBoundary = Array.from(
    { length: options.limit + options.extraBoundaryMatches },
    (_, index): RankedRow => ({
      id: `boundary-match-${index.toString().padStart(2, `0`)}`,
      rank: rank(50),
      included: true,
    }),
  ).reverse()
  const rejectedBoundary = Array.from(
    { length: options.boundaryRejects },
    (_, index): RankedRow => ({
      id: `boundary-reject-${index.toString().padStart(2, `0`)}`,
      rank: rank(50),
      included: false,
    }),
  )
  const trailing = Array.from(
    { length: options.trailingRows },
    (_, index): RankedRow => ({
      id: `trailing-${index.toString().padStart(3, `0`)}`,
      rank: rank(10 - index),
      included: true,
    }),
  )
  const expectedKeys = matchingBoundary
    .map(({ id }) => id)
    .sort()
    .slice(0, options.limit)
  const expectedCandidateReads = [
    ...leading,
    ...matchingBoundary,
    ...rejectedBoundary,
  ]
    .sort((left, right) => {
      const valueOrder = left.rank - right.rank
      if (valueOrder !== 0) {
        return direction === `asc` ? valueOrder : -valueOrder
      }
      return comparePublicKeys(left.id, right.id)
    })
    .map(({ id }) => id)
  return {
    rows: [...trailing, ...rejectedBoundary, ...matchingBoundary, ...leading],
    expectedKeys,
    // Every row through the boundary bucket is tested once. The selected rows
    // are then read once more to materialize their change messages.
    expectedSourceReads: [...expectedCandidateReads, ...expectedKeys],
  }
}

describe(`ordered source work oracle`, () => {
  it.each([
    { indexKind: `basic`, direction: `asc` },
    { indexKind: `basic`, direction: `desc` },
    { indexKind: `btree`, direction: `asc` },
    { indexKind: `btree`, direction: `desc` },
  ] as const)(
    `does not read worse $indexKind index buckets in $direction order`,
    async ({ indexKind, direction }) => {
      const scenario = createOrderedPrefixRows(
        {
          leadingRejects: 2,
          limit: 2,
          extraBoundaryMatches: 1,
          boundaryRejects: 2,
          trailingRows: 40,
        },
        direction,
      )

      const observed = await observeOrderedPrefix(
        scenario.rows,
        2,
        indexKind,
        direction,
      )

      expect(observed.keys).toEqual(scenario.expectedKeys)
      expect(observed.sourceReads).toEqual(scenario.expectedSourceReads)
      expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
      expect(observed.totalOrderComparisons).toBe(0)
    },
  )

  for (const direction of [`asc`, `desc`] as const) {
    const property =
      direction === `asc`
        ? `ordered-work.forward-prefix`
        : `ordered-work.reverse-prefix`
    const seed = direction === `asc` ? 1_780_103 : 1_780_101
    for (const campaign of orderedWorkCampaigns(property, seed)) {
      fcTest.prop(
        [
          fc.integer({ min: 0, max: 8 }),
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 0, max: 5 }),
          fc.integer({ min: 0, max: 8 }),
          fc.integer({ min: 0, max: 60 }),
          fc.constantFrom<`basic` | `btree`>(`basic`, `btree`),
        ],
        campaign.options,
      )(
        `bounds ${direction} index reads at the sufficient bucket (${campaign.label})`,
        async (
          leadingRejects,
          limit,
          extraBoundaryMatches,
          boundaryRejects,
          trailingRows,
          indexKind,
        ) => {
          const scenario = createOrderedPrefixRows(
            {
              leadingRejects,
              limit,
              extraBoundaryMatches,
              boundaryRejects,
              trailingRows,
            },
            direction,
          )
          const observed = await observeOrderedPrefix(
            scenario.rows,
            limit,
            indexKind,
            direction,
          )

          expect(observed.keys).toEqual(scenario.expectedKeys)
          expect(observed.sourceReads).toEqual(scenario.expectedSourceReads)
          expect(observed.keyComparisons).toBe(observed.expectedKeyComparisons)
          expect(observed.totalOrderComparisons).toBe(0)
        },
      )
    }
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

    const observed = await observeOrderedPrefix(rows, 3)
    expect(observed.keys).toEqual([`tied-00`, `tied-02`, `tied-04`])
    expect(observed.sourceReads).toEqual([
      ...rows.map(({ id }) => id).sort(comparePublicKeys),
      `tied-00`,
      `tied-02`,
      `tied-04`,
    ])
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

  it.each(orderedIndexCompatibilityCases)(
    `matches $indexKind index $indexDirection/nulls-$indexNulls to query $queryDirection/nulls-$queryNulls: $compatible`,
    async ({
      indexKind,
      indexDirection,
      indexNulls,
      queryDirection,
      queryNulls,
      compatible,
    }) => {
      type NullableRankedRow = Omit<RankedRow, `rank`> & {
        rank: number | null | undefined
      }
      const collection = createCollection(
        localOnlyCollectionOptions<NullableRankedRow>({
          id: `ordered-work-index-compatibility-${indexDirection}-${indexNulls}-${queryDirection}-${queryNulls}`,
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
        collection.createIndex((row) => row.rank, {
          indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
          options: {
            compareOptions: {
              direction: indexDirection,
              nulls: indexNulls,
              stringSort: `locale`,
            },
          },
        })

        const changes = collection.currentStateAsChanges({
          orderBy: orderBy(queryDirection, queryNulls),
          optimizedOnly: true,
        })

        expect(changes?.map(({ key }) => key)).toEqual(
          compatible
            ? queryNulls === `first`
              ? [`null`, `undefined`, `one`]
              : [`one`, `null`, `undefined`]
            : undefined,
        )
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each([`asc`, `desc`] as const)(
    `keeps custom indexes on the materialized %s-order fallback`,
    async (direction) => {
      const tieRank = direction === `asc` ? 1 : 2
      const laterRank = direction === `asc` ? 2 : 1
      const rows: Array<RankedRow> = [
        { id: `later`, rank: laterRank, included: true },
        { id: `tie-b`, rank: tieRank, included: true },
        { id: `tie-a`, rank: tieRank, included: true },
      ]
      const collection = createCollection(
        localOnlyCollectionOptions<RankedRow>({
          id: `ordered-work-custom-index-fallback-${direction}`,
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
            if (property === `orderedEntriesArray`) {
              return [
                ...(direction === `desc`
                  ? [[laterRank, new Set([`later`])]]
                  : []),
                [tieRank, new Set([`tie-b`])],
                [tieRank, new Set([`tie-a`])],
                ...(direction === `asc`
                  ? [[laterRank, new Set([`later`])]]
                  : []),
              ]
            }
            if (property === `orderedEntriesArrayReversed`) {
              return [
                ...(direction === `asc`
                  ? [[laterRank, new Set([`later`])]]
                  : []),
                [tieRank, new Set([`tie-b`])],
                [tieRank, new Set([`tie-a`])],
                ...(direction === `desc`
                  ? [[laterRank, new Set([`later`])]]
                  : []),
              ]
            }
            const value = Reflect.get(target, property, target) as unknown
            return typeof value === `function` ? value.bind(target) : value
          },
        })
        collection.indexes.set(index.id, customIndex)
        if (direction === `desc`) {
          expect(
            new ReverseIndex(customIndex).supportsOrderedBucketIteration,
          ).toBe(false)
        }

        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            orderBy: orderBy(direction, direction === `asc` ? `last` : `first`),
            limit: 1,
          })!

          expect(changes.map(({ key }) => key)).toEqual([`tie-a`])
          expect(compareEntries).toHaveBeenCalled()
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(
    (
      [
        { name: `BasicIndex`, IndexType: BasicIndex },
        { name: `BTreeIndex`, IndexType: BTreeIndex },
      ] as const
    ).flatMap(({ name, IndexType }) =>
      ([`asc`, `desc`] as const).map((direction) => ({
        name,
        IndexType,
        direction,
      })),
    ),
  )(
    `fully refines a $name custom comparator in $direction order`,
    async ({ name, IndexType, direction }) => {
      const collection = createCollection(
        localOnlyCollectionOptions<RankedRow>({
          id: `ordered-work-custom-comparator-${name}-${direction}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `one`, rank: 1, included: true },
            { id: `two`, rank: 2, included: true },
            { id: `three`, rank: 3, included: true },
          ],
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: {
            compareOptions: publicKeyIndexCompareOptions,
            compareFn: (left: number, right: number) => right - left,
          },
        })

        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            orderBy: publicKeyOrderBy(direction),
            limit: 2,
          })!

          expect(changes.map(({ key }) => key)).toEqual(
            direction === `asc` ? [`one`, `two`] : [`three`, `two`],
          )
          expect(compareEntries).toHaveBeenCalled()
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  for (const campaign of orderedWorkCampaigns(
    `ordered-work.custom-comparator-fallback`,
    1_780_104,
  )) {
    fcTest.prop(
      [
        fc.array(fc.integer({ min: -20, max: 20 }), {
          minLength: 2,
          maxLength: 8,
        }),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom<`basic` | `btree`>(`basic`, `btree`),
        fc.constantFrom<OrderByDirection>(`asc`, `desc`),
      ],
      campaign.options,
    )(
      `fully refines generated custom comparator indexes (${campaign.label})`,
      async (ranks, requestedLimit, indexKind, direction) => {
        const rows = ranks.map(
          (rank, index): RankedRow => ({
            id: `row-${index.toString().padStart(2, `0`)}`,
            rank,
            included: true,
          }),
        )
        const limit = Math.min(requestedLimit, rows.length)
        const expectedKeys = [...rows]
          .sort((left, right) => {
            const rankOrder = left.rank - right.rank
            if (rankOrder !== 0) {
              return direction === `asc` ? rankOrder : -rankOrder
            }
            return comparePublicKeys(left.id, right.id)
          })
          .slice(0, limit)
          .map(({ id }) => id)
        const collection = createCollection(
          localOnlyCollectionOptions<RankedRow>({
            id: `ordered-work-custom-comparator-property-${Math.random()}`,
            getKey: (row) => row.id,
            initialData: rows,
          }),
        )

        try {
          await collection.preload()
          collection.createIndex((row) => row.rank, {
            indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
            options: {
              compareOptions: publicKeyIndexCompareOptions,
              compareFn: (left: number, right: number) => right - left,
            },
          })

          const compareEntries = vi.spyOn(
            TotalOrder.prototype,
            `compareEntries`,
          )
          try {
            const changes = collection.currentStateAsChanges({
              orderBy: publicKeyOrderBy(direction),
              limit,
            })!

            expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
            expect(compareEntries).toHaveBeenCalled()
          } finally {
            compareEntries.mockRestore()
          }
        } finally {
          await collection.cleanup()
        }
      },
    )
  }

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

      index.remove(`lower`, rows[1])
      expect([...index.equalityLookup(`A`)]).toEqual([`upper`])
      expect([...index.equalityLookup(`a`)]).toEqual([])
      expect(
        [...index.orderedBuckets()].map(([, keys]) => [...keys].sort()),
      ).toEqual([[`upper`], [`later`]])
    }
  })

  it.each([
    {
      name: `BasicIndex`,
      IndexType: BasicIndex,
      direction: `asc`,
      expectedKeys: [`a`, `z`],
    },
    {
      name: `BasicIndex`,
      IndexType: BasicIndex,
      direction: `desc`,
      expectedKeys: [`m`, `a`],
    },
    {
      name: `BTreeIndex`,
      IndexType: BTreeIndex,
      direction: `asc`,
      expectedKeys: [`a`, `z`],
    },
    {
      name: `BTreeIndex`,
      IndexType: BTreeIndex,
      direction: `desc`,
      expectedKeys: [`m`, `a`],
    },
  ] as const)(
    `keeps the public-key suffix ascending for $name in $direction order`,
    async ({ name, IndexType, direction, expectedKeys }) => {
      const collection = createCollection(
        localOnlyCollectionOptions<RankedRow>({
          id: `ordered-work-key-suffix-${name}-${direction}`,
          getKey: (row) => row.id,
          initialData: [{ id: `m`, rank: 2, included: true }],
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: { compareOptions: publicKeyIndexCompareOptions },
        })
        const z = collection.insert({ id: `z`, rank: 1, included: true })
        await z.isPersisted.promise
        const a = collection.insert({ id: `a`, rank: 1, included: true })
        await a.isPersisted.promise

        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            orderBy: publicKeyOrderBy(direction),
            limit: 2,
            optimizedOnly: true,
          })!

          expect(changes.map(({ key }) => key)).toEqual(expectedKeys)
          expect(compareEntries).not.toHaveBeenCalled()
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(
    (
      [
        { name: `BasicIndex`, IndexType: BasicIndex },
        { name: `BTreeIndex`, IndexType: BTreeIndex },
      ] as const
    ).flatMap(({ name, IndexType }) =>
      ([`asc`, `desc`] as const).flatMap((direction) =>
        [
          { domain: `signed number`, keys: [1, -2] },
          { domain: `NaN number`, keys: [Number.NaN, 2, -1] },
          { domain: `case-sensitive string`, keys: [`a`, `A`] },
          { domain: `mixed`, keys: [10, `2`, 2, `10`] },
        ].map(({ domain, keys }) => ({
          name,
          IndexType,
          direction,
          domain,
          keys,
        })),
      ),
    ),
  )(
    `keeps $domain public keys in compareKeys order for $name in $direction order`,
    async ({ name, IndexType, direction, keys }) => {
      const collection = createCollection(
        localOnlyCollectionOptions<PublicKeyRankedRow, string | number>({
          id: `ordered-work-${name}-${direction}-${keys.join(`-`)}`,
          getKey: (row) => row.id,
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: { compareOptions: publicKeyIndexCompareOptions },
        })
        for (const key of keys) {
          const transaction = collection.insert({
            id: key,
            rank: 1,
            included: true,
          })
          await transaction.isPersisted.promise
        }

        const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
        try {
          const changes = collection.currentStateAsChanges({
            orderBy: publicKeyOrderBy(direction),
            limit: keys.length,
            optimizedOnly: true,
          })!

          expect(changes.map(({ key }) => key)).toEqual(
            [...keys].sort(comparePublicKeys),
          )
          expect(compareEntries).not.toHaveBeenCalled()
        } finally {
          compareEntries.mockRestore()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  for (const campaign of orderedWorkCampaigns(
    `ordered-work.public-key-suffix`,
    1_780_102,
  )) {
    fcTest.prop(
      [
        fc.uniqueArray(
          fc.oneof(
            fc.integer({ min: -999, max: 999 }),
            fc.constant(Number.NaN),
          ),
          {
            minLength: 2,
            maxLength: 8,
          },
        ),
        fc.integer({ min: 1, max: 16 }),
        fc.constantFrom<`basic` | `btree`>(`basic`, `btree`),
        fc.constantFrom<OrderByDirection>(`asc`, `desc`),
        fc.constantFrom<`string` | `number` | `mixed`>(
          `string`,
          `number`,
          `mixed`,
        ),
      ],
      campaign.options,
    )(
      `orders dynamic tie keys for every built-in path (${campaign.label})`,
      async (keyNumbers, requestedLimit, indexKind, direction, keyDomain) => {
        const keys: Array<string | number> =
          keyDomain === `string`
            ? keyNumbers.map((key, index) =>
                index % 2 === 0 ? `key-${key}` : `Key-${key}`,
              )
            : keyDomain === `number`
              ? keyNumbers
              : keyNumbers.flatMap((key) => [String(key), key])
        const limit = Math.min(requestedLimit, keys.length)
        const collection = createCollection(
          localOnlyCollectionOptions<PublicKeyRankedRow, string | number>({
            id: `ordered-work-key-property-${Math.random()}`,
            getKey: (row) => row.id,
          }),
        )

        try {
          await collection.preload()
          collection.createIndex((row) => row.rank, {
            indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
            options: { compareOptions: publicKeyIndexCompareOptions },
          })
          for (const key of keys) {
            const transaction = collection.insert({
              id: key,
              rank: 1,
              included: true,
            })
            await transaction.isPersisted.promise
          }

          const compareEntries = vi.spyOn(
            TotalOrder.prototype,
            `compareEntries`,
          )
          try {
            const changes = collection.currentStateAsChanges({
              orderBy: publicKeyOrderBy(direction),
              limit,
              optimizedOnly: true,
            })!

            expect(changes.map(({ key }) => key)).toEqual(
              [...keys].sort(comparePublicKeys).slice(0, limit),
            )
            expect(compareEntries).not.toHaveBeenCalled()
          } finally {
            compareEntries.mockRestore()
          }
        } finally {
          await collection.cleanup()
        }
      },
    )
  }

  it(`retains requested comparison metadata on an automatic index`, async () => {
    type NullableRankedRow = Omit<RankedRow, `rank`> & {
      rank: string | null | undefined
    }
    const compareOptions = {
      direction: `desc`,
      nulls: `first`,
      stringSort: `locale`,
      locale: `en`,
      localeOptions: { numeric: true, sensitivity: `base` },
    } satisfies CompareOptions
    const collection = createCollection(
      localOnlyCollectionOptions<NullableRankedRow>({
        id: `ordered-work-auto-index-options`,
        getKey: (row) => row.id,
        initialData: [
          { id: `undefined`, rank: undefined, included: true },
          { id: `null`, rank: null, included: true },
          { id: `item-2`, rank: `item-2`, included: true },
          { id: `item-10`, rank: `item-10`, included: true },
        ],
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
      }),
    )

    try {
      await collection.preload()
      const compareEntries = vi.spyOn(TotalOrder.prototype, `compareEntries`)
      try {
        const changes = collection.currentStateAsChanges({
          orderBy: orderByWithOptions(compareOptions),
          limit: 4,
          optimizedOnly: true,
        })

        expect(changes?.map(({ key }) => key)).toEqual([
          `null`,
          `undefined`,
          `item-10`,
          `item-2`,
        ])
        expect(compareEntries).not.toHaveBeenCalled()
      } finally {
        compareEntries.mockRestore()
      }
    } finally {
      await collection.cleanup()
    }
  })

  it.each(orderedStringCompatibilityCases)(
    `matches a $indexKind index against $name in $queryDirection order: $compatible`,
    async ({ indexKind, queryDirection, compareOptions, compatible }) => {
      type TextRankedRow = Omit<RankedRow, `rank`> & { rank: string }
      const indexCompareOptions = {
        direction: `asc`,
        nulls: `last`,
        stringSort: `locale`,
        locale: `en`,
        localeOptions: { numeric: true, sensitivity: `base` },
      } satisfies CompareOptions
      const collection = createCollection(
        localOnlyCollectionOptions<TextRankedRow>({
          id: `ordered-work-string-options-${Math.random()}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `item-10`, rank: `item-10`, included: true },
            { id: `item-2`, rank: `item-2`, included: true },
          ],
        }),
      )

      try {
        await collection.preload()
        collection.createIndex((row) => row.rank, {
          indexType: indexKind === `basic` ? BasicIndex : BTreeIndex,
          options: { compareOptions: indexCompareOptions },
        })

        const changes = collection.currentStateAsChanges({
          orderBy: orderByWithOptions(compareOptions),
          optimizedOnly: true,
        })

        expect(changes?.map(({ key }) => key)).toEqual(
          compatible
            ? queryDirection === `asc`
              ? [`item-2`, `item-10`]
              : [`item-10`, `item-2`]
            : undefined,
        )
      } finally {
        await collection.cleanup()
      }
    },
  )
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
  let referenceCompilationReads = 0
  const referenceWhere = new Proxy(eq(new PropRef([`included`]), true), {
    get(target, property, receiver) {
      if (property === `type`) referenceCompilationReads++
      return Reflect.get(target, property, receiver)
    },
  })
  compileSingleRowExpression(referenceWhere)
  expect(referenceCompilationReads).toBeGreaterThan(0)

  let compilationReads = 0
  const where = new Proxy(eq(new PropRef([`included`]), true), {
    get(target, property, receiver) {
      if (property === `type`) compilationReads++
      return Reflect.get(target, property, receiver)
    },
  })
  const window = new WindowState(fixture.collection, orderBy(`asc`), where, 1)
  const readsAfterConstruction = compilationReads
  expect(readsAfterConstruction).toBe(referenceCompilationReads)
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
