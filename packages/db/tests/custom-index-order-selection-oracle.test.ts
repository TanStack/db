import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
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
 * cross-family order. Changelog #958 and the temporal index order oracle
 * establish key-ascending ties in public ordered snapshots. The witnesses
 * below add equal numeric and custom-collation values, nullish values, finite
 * windows, and unbounded reads. A direct on-demand ordered subscription
 * checks initial and cursor snapshots of an equal-rank group. Raw escaped
 * strings must reach custom-collation callbacks without their exact-key
 * encoding; direct range and cursor operations use those same positions.
 * A mixed string, number, and byte fixture checks that opaque byte order
 * still matches the public scan while byte content retains exact equality.
 * They do not claim mutation histories, provider ordering, arbitrary binary
 * values, or live-query publication.
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
const inclusiveReversedBetweenTwentyAndTwentyFive = new Func(`and`, [
  twentyLessThanOrEqualRank,
  new Func(`gte`, [new Value(25), new PropRef([`rank`])]),
])
const expectedBetweenTwentyAndTwentyFive = rows
  .filter(({ rank }) => 20 <= rank && rank <= 25)
  .map(({ id }) => id)
  .sort()
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
        const ordinaryReverseTake = vi.spyOn(ordinary, `takeReversedFromEnd`)
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
        expect(ordinaryTake).toHaveBeenCalled()
        expect(
          collection
            .currentStateAsChanges({ ...descendingFirst, optimizedOnly: true })
            ?.map(({ key }) => key),
        ).toEqual([`last`])
        expect(ordinaryReverseTake).toHaveBeenCalled()

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
        ordinaryRange.mockClear()
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
          where: inclusiveReversedBetweenTwentyAndTwentyFive,
          expectedKeys: expectedBetweenTwentyAndTwentyFive,
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
      expect(take).toHaveBeenCalled()
      take.mockClear()
      expect(keys(1, true)).toEqual(scannedFirst)
      expect(take).toHaveBeenCalled()
    }, [() => cleanup?.()])
  })
})

describe.each(indexTypes)(`%s public key ties`, (name, IndexType) => {
  it(`publishes key-first ties through limited ordered subscriptions`, async () => {
    // A direct ordered subscription is a second public receiving path. The
    // first history begins inside a tie; the second first emits a unique rank
    // and then continues into a tied rank. The provider accepts each request
    // immediately, so callbacks are observed after each local snapshot.
    const observe = async (
      suffix: string,
      source: ReadonlyArray<Row>,
      requests: ReadonlyArray<{ minValues?: Array<number> }>,
    ) => {
      const batches: Array<Array<string>> = []
      const collection = createCollection<Row, string>({
        id: `subscription-public-ties-${name}-${suffix}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of source) write({ type: `insert`, value: row })
            commit()
            markReady()
            return { loadSubset: () => true }
          },
        },
      })
      await withOracleCleanup(async () => {
        await collection.stateWhenReady()
        const index = collection.createIndex((row) => row.rank, {
          indexType: IndexType,
        })
        const subscription = collection.subscribeChanges(
          (changes) => {
            if (changes.length) batches.push(changes.map(({ key }) => key))
          },
          { includeInitialState: false },
        )
        try {
          subscription.setOrderByIndex(new ReverseIndex(index, true))
          for (const request of requests) {
            subscription.requestLimitedSnapshot({
              orderBy: descendingFirst.orderBy,
              limit: 1,
              ...request,
            })
          }
        } finally {
          subscription.unsubscribe()
        }
      }, [() => collection.cleanup()])
      return batches
    }

    // Numeric rank descending, then source key ascending, predicts `a` in
    // the initial tie. The unique rank-2 row is an adjacent non-tie control;
    // a cursor at rank 2 then reaches the complete rank-1 tie group.
    expect(
      await observe(
        `initial`,
        [
          { id: `c`, rank: 1 },
          { id: `b`, rank: 1 },
          { id: `a`, rank: 1 },
        ],
        [{}],
      ),
    ).toEqual([[`a`]])
    expect(
      await observe(
        `cursor`,
        [
          { id: `z`, rank: 2 },
          { id: `c`, rank: 1 },
          { id: `b`, rank: 1 },
          { id: `a`, rank: 1 },
        ],
        [{}, { minValues: [2] }],
      ),
    ).toEqual([[`z`], [`a`]])
  })
  it(`uses ascending keys within numeric ties in both order directions`, async () => {
    type TiedRow = { id: string | number; rank: number }
    const source: ReadonlyArray<TiedRow> = [
      { id: 2, rank: 1 },
      { id: 1, rank: 1 },
      { id: `c`, rank: 1 },
      { id: `b`, rank: 1 },
      { id: `a`, rank: 1 },
      { id: `z`, rank: 0 },
      { id: `y`, rank: 0 },
    ]
    let cleanup: (() => unknown) | undefined
    await withOracleCleanup(async () => {
      const collection = createCollection<TiedRow, string | number>({
        id: `numeric-public-ties-${name}`,
        getKey: ({ id }) => id,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of source) write({ type: `insert`, value: row })
            commit()
            markReady()
          },
        },
      })
      cleanup = () => collection.cleanup()
      await collection.stateWhenReady()

      // The independent reference sorts source facts by numeric rank, then
      // by source key: strings before numbers, each in ascending order.
      // Reverse admission distinguishes that law from a stable scan. A
      // descending window cuts through the rank-1 group and the string-to-
      // number boundary within it.
      const keyOrder = (left: string | number, right: string | number) =>
        typeof left !== typeof right
          ? typeof left === `string`
            ? -1
            : 1
          : left < right
            ? -1
            : left > right
              ? 1
              : 0
      const expected = (direction: `asc` | `desc`, limit?: number) =>
        [...source]
          .sort(
            (left, right) =>
              (direction === `asc`
                ? left.rank - right.rank
                : right.rank - left.rank) || keyOrder(left.id, right.id),
          )
          .slice(0, limit)
          .map(({ id }) => id)
      const read = (
        direction: `asc` | `desc`,
        limit?: number,
        optimizedOnly?: boolean,
      ) =>
        collection
          .currentStateAsChanges({
            orderBy: [
              {
                expression: new PropRef([`rank`]),
                compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction },
              },
            ],
            limit,
            optimizedOnly,
          })
          ?.map(({ key }) => key)
      const cases = [
        { direction: `asc`, limit: 1 },
        { direction: `asc`, limit: 3 },
        { direction: `desc`, limit: 1 },
        { direction: `desc`, limit: 2 },
        { direction: `desc`, limit: 4 },
        { direction: `desc`, limit: undefined },
      ] as const

      // Before index creation, the public scan is one receiving formulation.
      for (const { direction, limit } of cases) {
        expect(read(direction, limit)).toEqual(expected(direction, limit))
      }
      const index = collection.createIndex((row) => row.rank, {
        indexType: IndexType,
      })
      const take = vi.spyOn(index, `takeFromStart`)
      const reverseTake = vi.spyOn(index, `takeReversedFromEnd`)
      // optimizedOnly forbids scan fallback. The take spies show that the
      // index path supplies the same public observation after readiness.
      for (const { direction, limit } of cases) {
        expect(read(direction, limit, true)).toEqual(expected(direction, limit))
      }
      expect(take).toHaveBeenCalled()
      expect(reverseTake).toHaveBeenCalled()
    }, [() => cleanup?.()])
  })

  it(`uses source keys within custom-collation and nullish ties`, async () => {
    type LabelRow = { id: string; label: string | null | undefined }
    const source: ReadonlyArray<LabelRow> = [
      { id: `b`, label: `yy` },
      { id: `a`, label: `xx` },
      { id: `n`, label: null },
      { id: `m`, label: undefined },
      { id: `c`, label: `z` },
    ]
    const compare = (left: string, right: string) => left.length - right.length
    let cleanup: (() => unknown) | undefined
    await withOracleCleanup(async () => {
      const collection = createCollection<LabelRow, string>({
        id: `custom-public-ties-${name}`,
        getKey: ({ id }) => id,
        autoIndex: `off`,
        defaultStringCollation: { stringSort: `custom`, compare },
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of source) write({ type: `insert`, value: row })
            commit()
            markReady()
          },
        },
      })
      cleanup = () => collection.cleanup()
      await collection.stateWhenReady()

      // Null and undefined share one position. The callback compares only
      // non-null strings by length. The independent reference applies the
      // public key rule to both comparator-equal groups.
      const expected = (direction: `asc` | `desc`, limit?: number) =>
        [...source]
          .sort((left, right) => {
            const order =
              left.label == null
                ? right.label == null
                  ? 0
                  : -1
                : right.label == null
                  ? 1
                  : direction === `asc`
                    ? left.label.length - right.label.length
                    : right.label.length - left.label.length
            return (
              order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
            )
          })
          .slice(0, limit)
          .map(({ id }) => id)
      const read = (
        direction: `asc` | `desc`,
        limit?: number,
        optimizedOnly?: boolean,
      ) =>
        collection
          .currentStateAsChanges({
            orderBy: [
              {
                expression: new PropRef([`label`]),
                compareOptions: { direction, nulls: `first` },
              },
            ],
            limit,
            optimizedOnly,
          })
          ?.map(({ key }) => key)
      const cases = [
        { direction: `asc`, limit: 1 },
        { direction: `asc`, limit: 4 },
        { direction: `desc`, limit: 3 },
        { direction: `desc`, limit: undefined },
      ] as const

      for (const { direction, limit } of cases) {
        expect(read(direction, limit)).toEqual(expected(direction, limit))
      }
      const index = collection.createIndex((row) => row.label, {
        indexType: IndexType,
        options: {
          compareOptions: {
            direction: `asc`,
            nulls: `first`,
            stringSort: `custom`,
            compare,
          },
        },
      })
      const take = vi.spyOn(index, `takeFromStart`)
      const reverseTake = vi.spyOn(index, `takeReversedFromEnd`)
      for (const { direction, limit } of cases) {
        expect(read(direction, limit, true)).toEqual(expected(direction, limit))
      }
      expect(take).toHaveBeenCalled()
      expect(reverseTake).toHaveBeenCalled()

      // A cursor at `xx` names the callback's length-two position. Its
      // comparator-equal `yy` peer remains eligible even though exact string
      // equality would find only the already-sent `xx` row.
      const batches: Array<Array<string>> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          if (changes.length) batches.push(changes.map(({ key }) => key))
        },
        { includeInitialState: false },
      )
      try {
        subscription.setOrderByIndex(new ReverseIndex(index, true))
        const orderBy = [
          {
            expression: new PropRef([`label`]),
            compareOptions: {
              direction: `desc` as const,
              nulls: `first` as const,
            },
          },
        ]
        subscription.requestLimitedSnapshot({ orderBy, limit: 3 })
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [`xx`],
        })
        expect(batches).toEqual([[`m`, `n`, `a`], [`b`]])
      } finally {
        subscription.unsubscribe()
      }
    }, [() => cleanup?.()])
  })

  it(`passes raw escaped strings to a direct custom comparator`, () => {
    const source = [
      { id: `a`, label: `abcdefghijklmnopq` },
      { id: `b`, label: `\u0000tanstack-db:x` },
      { id: `c`, label: `abcdefghij` },
    ]
    const index = new IndexType(1, new PropRef([`label`]), undefined, {
      compareFn: (left: string, right: string) => left.length - right.length,
    })
    for (const row of source) index.add(row.id, row)

    // This callback's law is raw length: 10 < 14 < 17. Exact equality has
    // its own normalized key, while every direct traversal boundary uses the
    // callback position. Soft comparisons record all boundary failures on
    // the original implementation before any production edit.
    expect.soft(index.takeFromStart(3)).toEqual([`c`, `b`, `a`])
    expect.soft(index.take(3, source[2]!.label)).toEqual([`b`, `a`])
    expect.soft(index.take(3, source[0]!.label)).toEqual([])
    expect
      .soft(index.rangeQuery({ from: source[2]!.label, to: source[0]!.label }))
      .toEqual(new Set([`c`, `b`, `a`]))
    expect(index.equalityLookup(source[1]!.label)).toEqual(new Set([`b`]))
  })

  it(`orders escaped strings by their raw custom-collation values`, async () => {
    type LabelRow = { id: string; label: string }
    const source: ReadonlyArray<LabelRow> = [
      { id: `a`, label: `abcdefghijklmnopq` },
      { id: `b`, label: `\u0000tanstack-db:x` },
      { id: `c`, label: `abcdefghij` },
    ]
    const compare = (left: string, right: string) => left.length - right.length
    const model = [...source]
      .sort(
        (left, right) =>
          left.label.length - right.label.length ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .map(({ id }) => id)
    let cleanup: (() => unknown) | undefined
    await withOracleCleanup(async () => {
      const collection = createCollection<LabelRow, string>({
        id: `escaped-custom-collation-${name}`,
        getKey: ({ id }) => id,
        autoIndex: `off`,
        defaultStringCollation: { stringSort: `custom`, compare },
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of source) write({ type: `insert`, value: row })
            commit()
            markReady()
          },
        },
      })
      cleanup = () => collection.cleanup()
      await collection.stateWhenReady()
      const orderBy = [
        {
          expression: new PropRef([`label`]),
          compareOptions: {
            direction: `asc` as const,
            nulls: `first` as const,
          },
        },
      ]
      const read = (limit?: number, optimizedOnly?: boolean) =>
        collection
          .currentStateAsChanges({ orderBy, limit, optimizedOnly })
          ?.map(({ key }) => key)

      // The model reads the supplied string lengths, not an index key. The
      // leading zero marks an ordinary user string; it has length 14, between
      // c's 10 and a's 17. A finite prefix exposes the wrong encoded order.
      expect(model).toEqual([`c`, `b`, `a`])
      expect(read()).toEqual(model)
      expect(read(2)).toEqual(model.slice(0, 2))
      const index = collection.createIndex((row) => row.label, {
        indexType: IndexType,
        options: {
          compareOptions: {
            direction: `asc`,
            nulls: `first`,
            stringSort: `custom`,
            compare,
          },
        },
      })
      const take = vi.spyOn(index, `takeFromStart`)
      expect(read(undefined, true)).toEqual(model)
      expect(read(2, true)).toEqual(model.slice(0, 2))
      expect(take).toHaveBeenCalled()

      // Direct ordered traversal, both boundaries, and exact equality are
      // separate observations of the same installed index. A cursor after a
      // excludes every earlier callback position; equality still uses its
      // normalized key, so another spelling cannot alias b.
      expect(index.takeFromStart(3)).toEqual(model)
      expect(index.take(3, source[2]!.label)).toEqual([`b`, `a`])
      expect(index.take(3, source[0]!.label)).toEqual([])
      expect(
        index.rangeQuery({ from: source[2]!.label, to: source[0]!.label }),
      ).toEqual(new Set(model))
      expect(index.equalityLookup(source[1]!.label)).toEqual(new Set([`b`]))
      expect(
        index.equalityLookup(`\u0000tanstack-db:string:\u0000tanstack-db:x`),
      ).toEqual(new Set())
    }, [() => cleanup?.()])
  })

  it(`continues a custom-collation subscription from the raw string position`, async () => {
    type LabelRow = { id: string; label: string }
    const source: ReadonlyArray<LabelRow> = [
      { id: `a`, label: `abcdefghijklmnopq` },
      { id: `b`, label: `\u0000tanstack-db:x` },
      { id: `c`, label: `abcdefghij` },
    ]
    const compare = (left: string, right: string) => left.length - right.length
    let cleanup: (() => unknown) | undefined
    await withOracleCleanup(async () => {
      const collection = createCollection<LabelRow, string>({
        id: `escaped-custom-cursor-${name}`,
        getKey: ({ id }) => id,
        autoIndex: `off`,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of source) write({ type: `insert`, value: row })
            commit()
            markReady()
            return { loadSubset: () => true }
          },
        },
      })
      cleanup = () => collection.cleanup()
      await collection.stateWhenReady()
      const index = collection.createIndex((row) => row.label, {
        indexType: IndexType,
        options: {
          compareOptions: {
            direction: `asc`,
            nulls: `first`,
            stringSort: `custom`,
            compare,
          },
        },
      })
      const batches: Array<Array<string>> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          if (changes.length) batches.push(changes.map(({ key }) => key))
        },
        { includeInitialState: false },
      )
      try {
        subscription.setOrderByIndex(index)
        const orderBy = [
          {
            expression: new PropRef([`label`]),
            compareOptions: {
              direction: `asc` as const,
              nulls: `first` as const,
            },
          },
        ]
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [source[2]!.label],
        })
        expect(batches).toEqual([[`c`], [`b`]])
      } finally {
        subscription.unsubscribe()
      }
    }, [() => cleanup?.()])
  })

  it(`keeps an escaped user string distinct from the undefined order marker`, () => {
    const literal = `\u0000tanstack-db:undefined:`
    const index = new IndexType(1, new PropRef([`value`]), undefined, {
      compareOptions: {
        direction: `asc`,
        nulls: `first`,
        stringSort: `lexical`,
      },
    })
    index.add(`z`, { value: `z` })
    index.add(`literal`, { value: literal })
    index.add(`missing`, { value: undefined })

    // BTree uses a traversal marker for undefined, but this exact string is
    // ordinary user data. The two have different order and equality classes.
    expect(index.takeFromStart(3)).toEqual([`missing`, `literal`, `z`])
    expect(index.rangeQuery({ from: literal, to: literal })).toEqual(
      new Set([`literal`]),
    )
    expect(index.equalityLookup(undefined)).toEqual(new Set([`missing`]))
    expect(index.equalityLookup(literal)).toEqual(new Set([`literal`]))
  })

  it(`keeps raw byte order distinct from content-based equality`, async () => {
    type MixedRow = { id: string; value: string | number | Uint8Array }
    const firstByte = new Uint8Array([1])
    const secondByte = new Uint8Array([1])
    const source: ReadonlyArray<MixedRow> = [
      { id: `s`, value: `z` },
      { id: `n`, value: 1 },
      { id: `z-byte`, value: firstByte },
      { id: `a-byte`, value: secondByte },
    ]
    let cleanup: (() => unknown) | undefined
    await withOracleCleanup(async () => {
      const collection = createCollection<MixedRow, string>({
        id: `mixed-byte-order-${name}`,
        getKey: ({ id }) => id,
        autoIndex: `off`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of source) write({ type: `insert`, value: row })
            commit()
            markReady()
          },
        },
      })
      cleanup = () => collection.cleanup()
      await collection.stateWhenReady()
      const orderBy = [
        {
          expression: new PropRef([`value`]),
          compareOptions: DEFAULT_COMPARE_OPTIONS,
        },
      ]
      const read = (optimizedOnly?: boolean) =>
        collection
          .currentStateAsChanges({ orderBy, optimizedOnly })
          ?.map(({ key }) => key)

      // Public scan order is the independent receiving path for opaque byte
      // references. The value-kind law puts string and number before bytes;
      // the scan also records the runtime order of these two distinct views.
      const scanned = read()
      expect(scanned?.slice(0, 2)).toEqual([`s`, `n`])
      expect(scanned?.slice(2)).toEqual([`z-byte`, `a-byte`])
      expect(new Set(scanned)).toEqual(new Set([`s`, `n`, `z-byte`, `a-byte`]))
      const index = collection.createIndex((row) => row.value, {
        indexType: IndexType,
      })
      const take = vi.spyOn(index, `takeFromStart`)
      expect(read(true)).toEqual(scanned)
      expect(take).toHaveBeenCalled()
      expect(index.equalityLookup(new Uint8Array([1]))).toEqual(
        new Set([`z-byte`, `a-byte`]),
      )
      expect(index.equalityLookup(`\u0000tanstack-db:binary:\u0001`)).toEqual(
        new Set(),
      )
    }, [() => cleanup?.()])
  })
})
