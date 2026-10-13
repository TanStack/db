import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils.js'
import { withOracleCleanup } from './utils.js'

/**
 * An ordered Collection snapshot may use an index only when the index executes
 * the requested comparison. The live-query ARCHITECTURE.md Identity contract
 * says that advertised comparison options define the executable comparator.
 * A custom index comparator has no identity in the ordinary ascending query
 * options, so it cannot supply that query's order. Exact equality lookup on
 * the index remains a separate, valid operation.
 *
 * This bounded witness compares public snapshots of three unique numeric rows
 * in an unindexed Collection and a Collection with a descending custom index.
 * It also checks a custom index followed by a compatible ordinary index, and
 * eager index creation when the custom index is present first. Numeric range
 * predicates must likewise find a later compatible index; a range subscriber
 * must trigger eager creation when only a custom index exists, whichever side
 * of a single or paired relational predicate holds the field. It covers
 * BasicIndex and BTreeIndex at the ready checkpoint, with one order term and
 * limit one. A neighboring mixed Date/number snapshot compares public scan
 * order before index creation with optimized order afterward. It promises
 * index installation preserves that order, without prescribing a general
 * cross-family order. These checks do not claim arbitrary custom comparator
 * laws, mutation histories, provider ordering, or live-query publication.
 */
type Row = { id: string; rank: number }

const rows: ReadonlyArray<Row> = [
  { id: `middle`, rank: 20 },
  { id: `last`, rank: 30 },
  { id: `first`, rank: 10 },
]

// The reference sorts source facts numerically. It knows neither index order
// nor the index-selection code; the first public key must be `first`.
const expectedFirstKey = [...rows].sort((a, b) => a.rank - b.rank)[0]!.id
const greaterThanTen = new Func(`gt`, [new PropRef([`rank`]), new Value(10)])
const tenLessThanRank = new Func(`lt`, [new Value(10), new PropRef([`rank`])])
const twentyLessThanOrEqualRank = new Func(`lte`, [
  new Value(20),
  new PropRef([`rank`]),
])
const twentyGreaterThanOrEqualRank = new Func(`gte`, [
  new Value(20),
  new PropRef([`rank`]),
])
const expectedGreaterThanTen = rows
  .filter(({ rank }) => rank > 10)
  .map(({ id }) => id)
  .sort()
const reversedBetweenTenAndThirty = new Func(`and`, [
  tenLessThanRank,
  new Func(`gt`, [new Value(30), new PropRef([`rank`])]),
])
const expectedBetweenTenAndThirty = rows
  .filter(({ rank }) => 10 < rank && rank < 30)
  .map(({ id }) => id)
  .sort()
const expectedAtLeastTwenty = rows
  .filter(({ rank }) => 20 <= rank)
  .map(({ id }) => id)
  .sort()
const expectedAtMostTwenty = rows
  .filter(({ rank }) => 20 >= rank)
  .map(({ id }) => id)
  .sort()
const inclusiveReversedBetweenTwentyAndThirty = new Func(`and`, [
  twentyLessThanOrEqualRank,
  new Func(`gte`, [new Value(30), new PropRef([`rank`])]),
])
const betweenTenAndThirty = new Func(`and`, [
  greaterThanTen,
  new Func(`lt`, [new PropRef([`rank`]), new Value(30)]),
])
const ascendingFirst = {
  orderBy: [
    {
      expression: new PropRef([`rank`]),
      compareOptions: DEFAULT_COMPARE_OPTIONS,
    },
  ],
  limit: 1,
}
const descendingFirst = {
  ...ascendingFirst,
  orderBy: [
    {
      expression: new PropRef([`rank`]),
      compareOptions: {
        ...DEFAULT_COMPARE_OPTIONS,
        direction: `desc` as const,
      },
    },
  ],
}

function collectionWithRows(
  id: string,
  defaultIndexType?: typeof BasicIndex | typeof BTreeIndex,
) {
  return createCollection<Row, string>({
    id,
    getKey: (row) => row.id,
    autoIndex: defaultIndexType ? `eager` : `off`,
    defaultIndexType,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: row })
        commit()
        markReady()
      },
    },
  })
}

// Construction belongs inside the protected check. Register each Collection
// immediately so a later setup failure still releases the earlier ones.
async function withCreatedCollections(
  check: (create: typeof collectionWithRows) => Promise<void>,
): Promise<void> {
  const cleanups: Array<() => unknown> = []
  await withOracleCleanup(
    () =>
      check((id, defaultIndexType) => {
        const collection = collectionWithRows(id, defaultIndexType)
        cleanups.unshift(() => collection.cleanup())
        return collection
      }),
    cleanups,
  )
}

const indexTypes = [
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const

describe.each(indexTypes)(
  `%s custom comparator order selection`,
  (name, IndexType) => {
    it(`selects a later compatible index while exact equality keeps the first custom index`, async () => {
      await withCreatedCollections(async (create) => {
        const collection = create(`custom-index-coexistence-${name}`)
        await collection.stateWhenReady()
        const custom = collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: { compareFn: (a: number, b: number) => b - a },
        })
        const ordinary = collection.createIndex((row) => row.rank, {
          indexType: IndexType,
        })

        // Legal declaration order matters to first-match index search. The
        // custom index is first and still serves exact equality; the ordinary
        // index is second and must serve the ordered read.
        const lookup = vi.spyOn(custom, `lookup`)
        const ordinaryTake = vi.spyOn(ordinary, `takeFromStart`)
        const ordinaryLookup = vi.spyOn(ordinary, `lookup`)
        const ordinaryRange = vi.spyOn(ordinary, `rangeQuery`)
        expect(
          collection
            .currentStateAsChanges({
              where: new Func(`eq`, [new PropRef([`rank`]), new Value(20)]),
              optimizedOnly: true,
            })
            ?.map(({ key }) => key),
        ).toEqual([`middle`])
        expect(lookup).toHaveBeenCalledWith(`eq`, 20)
        expect(
          collection
            .currentStateAsChanges({ ...ascendingFirst, optimizedOnly: true })
            ?.map(({ key }) => key),
        ).toEqual([expectedFirstKey])
        expect(
          collection
            .currentStateAsChanges({ ...descendingFirst, optimizedOnly: true })
            ?.map(({ key }) => key),
        ).toEqual([`last`])
        expect(ordinaryTake).toHaveBeenCalled()

        // Ordinary numeric predicates use relational order rather than the
        // custom index's descending walk. Both single and paired bounds must
        // search past the custom index to use the ordinary one.
        expect(
          collection
            .currentStateAsChanges({
              where: greaterThanTen,
              optimizedOnly: true,
            })
            ?.map(({ key }) => key)
            .sort(),
        ).toEqual([`last`, `middle`])
        expect(ordinaryLookup).toHaveBeenCalledWith(`gt`, 10)
        expect(
          collection
            .currentStateAsChanges({
              where: betweenTenAndThirty,
              optimizedOnly: true,
            })
            ?.map(({ key }) => key),
        ).toEqual([`middle`])
        expect(ordinaryRange).toHaveBeenCalled()
        expect(lookup).not.toHaveBeenCalledWith(`gt`, 10)
      })
    })

    it(`creates a compatible eager index after an existing custom index`, async () => {
      await withCreatedCollections(async (create) => {
        const collection = create(`custom-index-eager-${name}`, IndexType)
        await collection.stateWhenReady()
        collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: { compareFn: (a: number, b: number) => b - a },
        })
        expect(collection.indexes.size).toBe(1)

        // The custom index cannot satisfy the ordinary order request. Eager
        // indexing must add a compatible one before optimizedOnly reads it.
        expect(
          collection
            .currentStateAsChanges({ ...ascendingFirst, optimizedOnly: true })
            ?.map(({ key }) => key),
        ).toEqual([expectedFirstKey])
        expect(collection.indexes.size).toBe(2)
        collection.currentStateAsChanges({
          ...ascendingFirst,
          optimizedOnly: true,
        })
        expect(collection.indexes.size).toBe(2)
      })
    })

    it(`creates a compatible eager index for reversed single and paired ranges`, async () => {
      const forms = [
        {
          name: `field-left`,
          where: greaterThanTen,
          expectedKeys: expectedGreaterThanTen,
        },
        {
          name: `field-right`,
          where: tenLessThanRank,
          expectedKeys: expectedGreaterThanTen,
        },
        {
          name: `paired-field-right`,
          where: reversedBetweenTenAndThirty,
          expectedKeys: expectedBetweenTenAndThirty,
        },
        {
          name: `field-right-inclusive-lower`,
          where: twentyLessThanOrEqualRank,
          expectedKeys: expectedAtLeastTwenty,
        },
        {
          name: `field-right-inclusive-upper`,
          where: twentyGreaterThanOrEqualRank,
          expectedKeys: expectedAtMostTwenty,
        },
        {
          name: `paired-field-right-inclusive`,
          where: inclusiveReversedBetweenTwentyAndThirty,
          expectedKeys: expectedAtLeastTwenty,
        },
      ] as const
      await withCreatedCollections(async (create) => {
        const collections = forms.map(({ name: formName }) =>
          create(`custom-index-eager-range-${name}-${formName}`, IndexType),
        )
        await Promise.all(
          collections.map((collection) => collection.stateWhenReady()),
        )
        const observations = []
        for (const [index, form] of forms.entries()) {
          const collection = collections[index]!
          collection.createIndex((row) => row.rank, {
            indexType: IndexType,
            options: { compareFn: (a: number, b: number) => b - a },
          })
          const initialKeys: Array<string> = []
          const subscription = collection.subscribeChanges(
            (changes) => initialKeys.push(...changes.map(({ key }) => key)),
            { whereExpression: form.where, includeInitialState: true },
          )
          try {
            observations.push({
              form: form.name,
              initialKeys: initialKeys.sort(),
              optimizedKeys: collection
                .currentStateAsChanges({
                  where: form.where,
                  optimizedOnly: true,
                })
                ?.map(({ key }) => key)
                .sort(),
              indexCount: collection.indexes.size,
            })
          } finally {
            subscription.unsubscribe()
          }
        }
        // The first two expressions denote the same numeric relation; the
        // paired and inclusive forms exercise both bound directions. Initial
        // publication and optimized-only snapshots must follow the independent
        // row filters after each subscription's eager index construction.
        expect(observations).toEqual(
          forms.map(({ name: formName, expectedKeys }) => ({
            form: formName,
            initialKeys: expectedKeys,
            optimizedKeys: expectedKeys,
            indexCount: 2,
          })),
        )
      })
    })

    it(`keeps a descending custom index out of an ascending public snapshot`, async () => {
      await withCreatedCollections(async (create) => {
        const scanned = create(`custom-index-order-scan-${name}`)
        const indexed = create(`custom-index-order-indexed-${name}`)
        const ordinary = create(`custom-index-order-ordinary-${name}`)
        await Promise.all([
          scanned.stateWhenReady(),
          indexed.stateWhenReady(),
          ordinary.stateWhenReady(),
        ])
        const customIndex = indexed.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: { compareFn: (a: number, b: number) => b - a },
        })
        const ordinaryIndex = ordinary.createIndex((row) => row.rank, {
          indexType: IndexType,
        })

        // Legal history: install the same three rows, then add the custom index.
        // The exact lookup control checks that excluding the index from order
        // selection does not change its exact-value membership.
        expect(customIndex.equalityLookup(20)).toEqual(new Set([`middle`]))
        expect(customIndex.lookup(`eq`, 20)).toEqual(new Set([`middle`]))
        expect(customIndex.supportsRangeOptimization).toBe(false)
        expect(ordinaryIndex.supportsRangeOptimization).toBe(true)
        expect(
          indexed
            .currentStateAsChanges({
              where: new Func(`eq`, [new PropRef([`rank`]), new Value(20)]),
              optimizedOnly: true,
            })
            ?.map(({ key }) => key),
        ).toEqual([`middle`])

        // Both reads are public Collection snapshots after readiness. The
        // unindexed read is a second formulation of the same first-row law.
        const scannedKeys = scanned
          .currentStateAsChanges(ascendingFirst)
          ?.map(({ key }) => key)
        const indexedKeys = indexed
          .currentStateAsChanges(ascendingFirst)
          ?.map(({ key }) => key)
        expect(scannedKeys).toEqual([expectedFirstKey])
        expect(indexedKeys).toEqual(scannedKeys)
        expect(
          ordinary
            .currentStateAsChanges({ ...ascendingFirst, optimizedOnly: true })
            ?.map(({ key }) => key),
        ).toEqual(scannedKeys)

        // A read that forbids a scan must decline the custom index. Returning
        // `last` here is the hostile design this witness rejects.
        expect(
          indexed.currentStateAsChanges({
            ...ascendingFirst,
            optimizedOnly: true,
          }),
        ).toBeUndefined()
        // A range read also cannot use the custom comparator when it is the
        // only index, even if no later ordinary index is available.
        expect(
          indexed.currentStateAsChanges({
            where: greaterThanTen,
            optimizedOnly: true,
          }),
        ).toBeUndefined()
        expect(
          indexed.currentStateAsChanges({
            where: betweenTenAndThirty,
            optimizedOnly: true,
          }),
        ).toBeUndefined()

        // Reversing the advertised direction would also reverse the unknown
        // custom comparator. The fallback and ordinary reversed index must
        // still agree with an unindexed descending read.
        const scannedDescending = scanned
          .currentStateAsChanges(descendingFirst)
          ?.map(({ key }) => key)
        expect(scannedDescending).toEqual([`last`])
        expect(
          indexed.currentStateAsChanges(descendingFirst)?.map(({ key }) => key),
        ).toEqual(scannedDescending)
        expect(
          ordinary
            .currentStateAsChanges({ ...descendingFirst, optimizedOnly: true })
            ?.map(({ key }) => key),
        ).toEqual(scannedDescending)
        expect(
          indexed.currentStateAsChanges({
            ...descendingFirst,
            optimizedOnly: true,
          }),
        ).toBeUndefined()
      })
    })
  },
)

describe.each(indexTypes)(`%s public mixed-value order`, (name, IndexType) => {
  it(`keeps a Date and number in the same order after indexing`, async () => {
    // The public cross-family order is not prescribed. Installing an index
    // must preserve the scan's full order and first-row window for these
    // immutable source facts. The index call proves the second read reaches
    // the optimized path rather than another scan.
    type MixedRow = { id: string; rank: number | Date }
    const mixedRows: ReadonlyArray<MixedRow> = [
      { id: `date`, rank: new Date(1) },
      { id: `equal-number`, rank: 1 },
      { id: `number`, rank: 2 },
    ]
    let cleanup: (() => unknown) | undefined
    await withOracleCleanup(async () => {
      const collection = createCollection<MixedRow, string>({
        id: `mixed-date-number-order-${name}`,
        getKey: ({ id }) => id,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of mixedRows) write({ type: `insert`, value: row })
            commit()
            markReady()
          },
        },
      })
      cleanup = () => collection.cleanup()
      await collection.stateWhenReady()
      const orderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: DEFAULT_COMPARE_OPTIONS,
        },
      ]
      const keys = (limit?: number, optimizedOnly?: boolean) =>
        collection
          .currentStateAsChanges({ orderBy, limit, optimizedOnly })
          ?.map(({ key }) => key)

      const scanned = keys()
      const scannedFirst = keys(1)
      expect(new Set(scanned)).toEqual(
        new Set([`date`, `equal-number`, `number`]),
      )
      expect(scannedFirst).toEqual(scanned?.slice(0, 1))
      const index = collection.createIndex((row) => row.rank, {
        indexType: IndexType,
      })
      const take = vi.spyOn(index, `takeFromStart`)
      // Query equality puts the Date and its numeric timestamp in one exact
      // class, although their public ordered positions are different.
      expect(index.equalityLookup(1)).toEqual(new Set([`date`, `equal-number`]))
      expect(keys(undefined, true)).toEqual(scanned)
      expect(keys(1, true)).toEqual(scannedFirst)
      expect(take).toHaveBeenCalled()
    }, [() => cleanup?.()])
  })
})
