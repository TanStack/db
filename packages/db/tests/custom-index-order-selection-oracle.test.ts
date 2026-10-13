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
 * limit one. It does not claim arbitrary custom comparator laws, mutation
 * histories, provider ordering, or live-query publication.
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

const indexTypes = [
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const

describe.each(indexTypes)(
  `%s custom comparator order selection`,
  (name, IndexType) => {
    it(`selects a later compatible index while exact equality keeps the first custom index`, async () => {
      const collection = collectionWithRows(`custom-index-coexistence-${name}`)
      await withOracleCleanup(async () => {
        await collection.stateWhenReady()
        const custom = collection.createIndex((row) => row.rank, {
          indexType: IndexType,
          options: { compareFn: (a: number, b: number) => b - a },
        })
        collection.createIndex((row) => row.rank, { indexType: IndexType })

        // Legal declaration order matters to first-match index search. The
        // custom index is first and still serves exact equality; the ordinary
        // index is second and must serve the ordered read.
        const lookup = vi.spyOn(custom, `lookup`)
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
        expect(
          collection
            .currentStateAsChanges({
              where: betweenTenAndThirty,
              optimizedOnly: true,
            })
            ?.map(({ key }) => key),
        ).toEqual([`middle`])
        expect(lookup).not.toHaveBeenCalledWith(`gt`, 10)
      }, [() => collection.cleanup()])
    })

    it(`creates a compatible eager index after an existing custom index`, async () => {
      const collection = collectionWithRows(
        `custom-index-eager-${name}`,
        IndexType,
      )
      await withOracleCleanup(async () => {
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
      }, [() => collection.cleanup()])
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
      ] as const
      const collections = forms.map(({ name: formName }) =>
        collectionWithRows(
          `custom-index-eager-range-${name}-${formName}`,
          IndexType,
        ),
      )
      await withOracleCleanup(
        async () => {
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
          // paired form narrows it. Initial publication and optimized-only
          // snapshots must follow those independent row filters after the
          // subscription's eager index construction.
          expect(observations).toEqual(
            forms.map(({ name: formName, expectedKeys }) => ({
              form: formName,
              initialKeys: expectedKeys,
              optimizedKeys: expectedKeys,
              indexCount: 2,
            })),
          )
        },
        collections.map((collection) => () => collection.cleanup()),
      )
    })

    it(`keeps a descending custom index out of an ascending public snapshot`, async () => {
      const scanned = collectionWithRows(`custom-index-order-scan-${name}`)
      const indexed = collectionWithRows(`custom-index-order-indexed-${name}`)
      const ordinary = collectionWithRows(`custom-index-order-ordinary-${name}`)

      await withOracleCleanup(async () => {
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
      }, [
        () => indexed.cleanup(),
        () => ordinary.cleanup(),
        () => scanned.cleanup(),
      ])
    })
  },
)
