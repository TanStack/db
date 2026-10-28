/**
 * Direct-index and Collection tests that compare with hand-written values:
 * range-domain flags, compare options, a harness self-test, and fixed collation
 * and prefixed-string cells. The index-update-oracle.property.test.ts file owns
 * the index update, nullish, and comparator laws.
 */
import { describe, expect, expectTypeOf, test, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils.js'
import { indexTypes, withCollectionCleanup } from './index-update-support'
import type { BaseIndex, IndexInterface } from '../src/indexes/base-index.js'
import type { StringCollationConfig } from '../src/types.js'

/**
 * Auto-indexes refine the Collection's declared collation: an ordered public
 * read must return the independent label order through the index path, and
 * repeated reads must reuse the one index for that field. These fixed cells
 * differ from the direct-index model above because index creation is driven
 * by the public Collection API rather than by the test.
 */
const collationCases = [
  {
    name: `lexical`,
    collation: { stringSort: `lexical` as const },
    clause: { direction: `asc`, nulls: `first` },
    expected: [`item10`, `item2`],
  },
  {
    name: `numeric locale`,
    collation: {
      stringSort: `locale` as const,
      locale: `en-US`,
      localeOptions: { numeric: true },
    },
    clause: { direction: `asc`, nulls: `first` },
    expected: [`item2`, `item10`],
  },
  {
    name: `explicit ordinary locale override`,
    collation: {
      stringSort: `locale` as const,
      locale: `en-US`,
      localeOptions: { numeric: true },
    },
    clause: {
      direction: `asc`,
      nulls: `first`,
      stringSort: `locale`,
      locale: `en-US`,
    },
    expected: [`item10`, `item2`],
  },
] as const

function createCollationCollection(
  collation: StringCollationConfig,
  autoIndex: `off` | `eager`,
  defaultIndexType?: typeof BasicIndex | typeof BTreeIndex,
  labels: ReadonlyArray<string> = [`item10`, `item2`],
) {
  return createCollection<{ id: string; label: string }>({
    getKey: (row) => row.id,
    autoIndex,
    defaultIndexType,
    defaultStringCollation: collation,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const [ordinal, label] of labels.entries()) {
          write({ type: `insert`, value: { id: String(ordinal), label } })
        }
        commit()
        markReady()
      },
    },
  })
}

/**
 * Public ordered reads compare the user's string values. An index escapes a
 * leading internal prefix for exact-key storage; that storage encoding must
 * not change the Collection's declared string order. The en-US locale and a
 * custom callback both place the prefixed value first. The scan and the
 * bounded indexed read must return that same first row.
 */
const prefixedLabel = `\u0000tanstack-db:a`

const plainLabel = `tanstack-db:r`

const prefixedStringCases = [
  {
    name: `locale`,
    collation: { stringSort: `locale`, locale: `en-US` },
  },
  {
    name: `custom collation`,
    collation: {
      stringSort: `custom`,
      compare: (left: string, right: string) =>
        left.localeCompare(right, `en-US`),
    },
  },
] as const satisfies ReadonlyArray<{
  name: string
  collation: StringCollationConfig
}>

describe.each(indexTypes)(`%s update properties`, (_indexName, IndexType) => {
  test(`tracks range-domain safety through updates, rebuilds, and clear`, () => {
    const index = new IndexType(1, new PropRef([`value`]))
    const other = [20]

    index.add(`number`, { value: 50 })
    expect(index.canOptimizeRangeFor(100)).toBe(true)

    index.add(`other`, { value: other })
    expect(index.canOptimizeRangeFor(100)).toBe(false)

    index.update(`other`, { value: other }, { value: 20 })
    expect(index.canOptimizeRangeFor(100)).toBe(true)

    index.update(`number`, { value: 50 }, { value: new Date(50) })
    expect(index.canOptimizeRangeFor(100)).toBe(false)
    index.remove(`other`, { value: 20 })
    expect(index.canOptimizeRangeFor(new Date(100))).toBe(true)

    index.clear()
    expect(index.canOptimizeRangeFor(100)).toBe(true)

    index.build([
      [`number`, { value: 50 }],
      [`other`, { value: [20] }],
    ])
    expect(index.canOptimizeRangeFor(100)).toBe(false)
  })
  test(`accepts indexed values rather than row keys through the index interface`, () => {
    const index: IndexInterface<string> = new IndexType(
      1,
      new PropRef([`value`]),
    )
    expectTypeOf<
      Parameters<IndexInterface<string>[`take`]>[1]
    >().toEqualTypeOf<unknown>()
    expectTypeOf<
      Parameters<IndexInterface<string>[`takeReversed`]>[1]
    >().toEqualTypeOf<unknown>()
    expectTypeOf<
      Parameters<BaseIndex<string>[`take`]>[1]
    >().toEqualTypeOf<unknown>()
    expectTypeOf<
      Parameters<BaseIndex<string>[`takeReversed`]>[1]
    >().toEqualTypeOf<unknown>()
    index.add(`undefined`, { value: undefined })
    index.add(`zero`, { value: 0 })
    index.add(`one`, { value: 1 })

    expect(index.take(3, 0)).toEqual([`one`])
    expect(index.takeReversed(3, 1)).toEqual([`zero`, `undefined`])
    expect(index.take(3, undefined)).toEqual([`zero`, `one`])
    expect(index.takeReversed(3, undefined)).toEqual([])
  })
  test(`distinguishes explicit undefined range and cursor bounds`, () => {
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(`undefined`, { value: undefined })
    index.add(`null`, { value: null })
    index.add(`one`, { value: 1 })

    expect(index.rangeQuery({ to: undefined })).toEqual(
      new Set([`undefined`, `null`]),
    )
    expect(index.rangeQueryReversed({ from: undefined })).toEqual(
      new Set([`undefined`, `null`]),
    )
    expect(index.take(3, undefined)).toEqual([`one`])
    expect(index.takeReversed(3, undefined)).toEqual([])
  })
  test(`executes the ordering advertised by compare options`, () => {
    const compareOptions = {
      ...DEFAULT_COMPARE_OPTIONS,
      nulls: `last` as const,
      stringSort: `lexical` as const,
    }
    const index = new IndexType(1, new PropRef([`value`]), undefined, {
      compareOptions,
    })
    index.add(`undefined`, { value: undefined })
    index.add(`null`, { value: null })
    index.add(`one`, { value: 1 })

    expect(index.matchesCompareOptions(compareOptions)).toBe(true)
    expect(index.takeFromStart(3)).toEqual([`one`, `null`, `undefined`])
    expect(index.rangeQuery({ to: 1 })).toEqual(new Set([`one`]))
  })
})
describe.each(indexTypes)(
  `%s invalid comparator results`,
  (_name, IndexType) => {
    test(`checks a custom collation compare from compareOptions`, () => {
      const index = new IndexType(1, new PropRef([`value`]), undefined, {
        compareOptions: {
          ...DEFAULT_COMPARE_OPTIONS,
          stringSort: `custom`,
          compare: () => NaN,
        },
      })
      index.add(`ann`, { value: `ann` })
      expect(() => index.add(`bob`, { value: `bob` })).toThrow(TypeError)
      expect(index.keyCount).toBe(1)
    })
    test(`keeps NaN keys after other values with the default comparator`, () => {
      const index = new IndexType(1, new PropRef([`value`]))
      index.add(`nan`, { value: NaN })
      index.add(`one`, { value: 1 })
      expect(index.lookup(`eq`, NaN)).toEqual(new Set([`nan`]))
      expect(index.keyCount).toBe(2)
      expect(index.takeFromStart(3)).toEqual([`one`, `nan`])
    })
  },
)
test(`preserves the index mismatch when Collection cleanup also fails`, async () => {
  const mismatch = new Error(`ordered index result differs`)
  const cleanupFailure = new Error(`adapter cleanup failed`)
  let caught: unknown
  try {
    await withCollectionCleanup(
      {
        cleanup: async () => {
          throw cleanupFailure
        },
      },
      () => {
        throw mismatch
      },
    )
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(AggregateError)
  expect((caught as AggregateError).cause).toBe(mismatch)
  expect((caught as AggregateError).errors).toEqual([cleanupFailure])
})
describe.each([
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const)(`%s Collection auto-index collation`, (_name, IndexType) => {
  test.each(collationCases)(
    `$name ordered public reads reuse one compatible index`,
    async ({ collation, clause, expected }) => {
      const collection = createCollationCollection(
        collation,
        `eager`,
        IndexType,
      )
      const createIndex = vi.spyOn(collection, `createIndex`)

      await withCollectionCleanup(collection, async () => {
        try {
          await collection.stateWhenReady()
          expect(collection.indexes.size).toBe(0)
          const read = () =>
            collection
              .currentStateAsChanges({
                orderBy: [
                  {
                    expression: new PropRef([`label`]),
                    compareOptions: clause,
                  },
                ],
                optimizedOnly: true,
              })
              ?.map(({ value }) => value.label)

          expect.soft(read(), `first indexed read`).toEqual(expected)
          expect.soft(read(), `second indexed read`).toEqual(expected)
          expect(createIndex, `one index construction`).toHaveBeenCalledTimes(1)
          expect(collection.indexes.size, `one index per field`).toBe(1)
        } finally {
          createIndex.mockRestore()
        }
      })
    },
  )
})
test.each(collationCases)(
  `$name ordered public reads honor Collection collation without an index`,
  async ({ collation, clause, expected }) => {
    const collection = createCollationCollection(collation, `off`)

    await withCollectionCleanup(collection, async () => {
      await collection.stateWhenReady()
      const rows = collection.currentStateAsChanges({
        orderBy: [
          {
            expression: new PropRef([`label`]),
            compareOptions: clause,
          },
        ],
      })
      expect(rows?.map(({ value }) => value.label)).toEqual(expected)
      expect(collection.indexes.size, `scan path reached`).toBe(0)
    })
  },
)
test(`ordered scan resolves inherited collation outside each comparison`, async () => {
  const collection = createCollationCollection(
    { stringSort: `lexical` },
    `off`,
    undefined,
    [`f`, `e`, `d`, `c`, `b`, `a`],
  )

  await withCollectionCleanup(collection, async () => {
    await collection.stateWhenReady()
    const optionReads = vi.spyOn(collection, `compareOptions`, `get`)
    const rows = collection.currentStateAsChanges({
      orderBy: [
        {
          expression: new PropRef([`label`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ],
    })

    expect(rows?.map(({ value }) => value.label)).toEqual([
      `a`,
      `b`,
      `c`,
      `d`,
      `e`,
      `f`,
    ])
    // One resolution can check the index path; the scan needs only one more.
    expect(optionReads.mock.calls.length).toBeLessThanOrEqual(2)
    expect(collection.indexes.size).toBe(0)
  })
})
describe.each([
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const)(`%s prefixed-string public order`, (_name, IndexType) => {
  test.each(prefixedStringCases)(
    `$name scan and bounded index return the same first row`,
    async ({ collation }) => {
      const labels = [plainLabel, prefixedLabel]
      expect(prefixedLabel.localeCompare(plainLabel, `en-US`)).toBeLessThan(0)
      const orderBy = [
        {
          expression: new PropRef([`label`]),
          compareOptions: {
            direction: `asc` as const,
            nulls: `first` as const,
          },
        },
      ]

      const scan = createCollationCollection(
        collation,
        `off`,
        undefined,
        labels,
      )
      await withCollectionCleanup(scan, async () => {
        await scan.stateWhenReady()
        const changes = scan.currentStateAsChanges({ orderBy, limit: 1 })
        expect(changes?.map(({ value }) => value.label)).toEqual([
          prefixedLabel,
        ])
        expect(scan.indexes.size, `scan path reached`).toBe(0)
      })

      const indexed = createCollationCollection(
        collation,
        `eager`,
        IndexType,
        labels,
      )
      await withCollectionCleanup(indexed, async () => {
        await indexed.stateWhenReady()
        const changes = indexed.currentStateAsChanges({
          orderBy,
          limit: 1,
          optimizedOnly: true,
        })
        expect(changes?.map(({ value }) => value.label)).toEqual([
          prefixedLabel,
        ])
        expect(indexed.indexes.size, `index path reached`).toBe(1)
      })
    },
  )
})
describe.each(indexTypes)(`%s binary-value ownership`, (_name, IndexType) => {
  test.each([2, 8193])(
    `compares every byte for exact membership (%i bytes)`,
    (length) => {
      const index = new IndexType(1, new PropRef([`value`]))
      const left = new Uint8Array(length)
      left[0] = 1
      const right = left.slice()
      right[length - 1] = 1
      index.add(`left`, { value: left })
      index.add(`right`, { value: right })
      expect(index.equalityLookup(left.slice())).toEqual(new Set([`left`]))
      expect(index.equalityLookup(right.slice())).toEqual(new Set([`right`]))
      for (const read of [
        index.takeFromStart(3),
        index.takeReversedFromEnd(3),
      ]) {
        expect(read).toHaveLength(2)
        expect(new Set(read)).toEqual(new Set([`left`, `right`]))
      }
    },
  )
})
/**
 * A bounded read should not make more comparator calls as retired values
 * accumulate. A fixed history retains one row while adding and removing 16,
 * 64, or 256 earlier values. A user comparator records calls made by the
 * public takeFromStart method after each history. This witnesses comparator
 * work only: a traversal over tombstones that avoids the comparator could
 * pass, and retained memory is measured separately.
 */
describe.each(indexTypes)(`%s retired-value read work`, (_name, IndexType) => {
  test(`takeFromStart comparator work does not grow with retired values`, () => {
    const comparisons = [16, 64, 256].map((retiredCount) => {
      let calls = 0
      const index = new IndexType(1, new PropRef([`value`]), undefined, {
        compareFn: (left: unknown, right: unknown) => {
          calls++
          return (left as number) - (right as number)
        },
      })
      index.add(`live`, { value: 1000 })
      for (let value = 0; value < retiredCount; value++) {
        const key = String(value)
        index.add(key, { value })
        index.remove(key, { value })
      }
      expect(index.keyCount).toBe(1)
      calls = 0
      expect(index.takeFromStart(1)).toEqual([`live`])
      return calls
    })

    expect(comparisons[2]).toBeLessThanOrEqual(comparisons[0]! + 4)
  })
})
/**
 * Distinct exact values can share one comparator position. An ordered first
 * row still requires sorting that group's keys, but it need not recompare
 * every value in the group. The fixed 16/64/256 sizes distinguish a grouped
 * read from one tree search per tied exact value. This bounds comparator work
 * at the direct read checkpoint, not elapsed time or retained memory.
 */
test(`BTreeIndex bounded reads do not recompare every live tie`, () => {
  const comparisons = [16, 64, 256].map((count) => {
    let calls = 0
    const index = new BTreeIndex<string>(1, new PropRef([`value`]), undefined, {
      compareFn: () => {
        calls++
        return 0
      },
    })
    for (let value = 0; value < count; value++) {
      index.add(String(value), { value })
    }
    calls = 0
    expect(index.takeFromStart(1)).toEqual([`0`])
    return calls
  })
  expect(comparisons[2]).toBeLessThanOrEqual(comparisons[0]! + 4)
})
/**
 * Preserve a bounded legacy callback input: older indexes supplied a Date's
 * timestamp and a string for Temporal and binary values. For two immutable
 * values of each named kind, a direct add comparison supplies that same scalar
 * kind in both index types. The model uses two values with a known order; it
 * does not copy or specify the index's string encoding. A callback that accepts
 * only the old scalar kind distinguishes a raw-object leak. After both adds,
 * full ordered keys and exact owners must match the supplied facts. This does
 * not establish arbitrary callbacks, build/update/range paths, or mutation of
 * the value objects after admission.
 */
describe.each(indexTypes)(
  `%s comparator input compatibility`,
  (_name, IndexType) => {
    test.each([
      {
        name: `Date`,
        values: [new Date(1), new Date(2)],
        kind: `number`,
      },
      {
        name: `Temporal.Instant`,
        values: [
          Temporal.Instant.from(`2020-01-01T00:00:00Z`),
          Temporal.Instant.from(`2021-01-01T00:00:00Z`),
        ],
        kind: `string`,
      },
      {
        name: `Uint8Array`,
        values: [new Uint8Array([1]), new Uint8Array([2])],
        kind: `string`,
      },
    ])(
      `passes $name to callbacks in its legacy scalar kind`,
      ({ values, kind }) => {
        let comparisons = 0
        const index = new IndexType(1, new PropRef([`value`]), undefined, {
          compareFn: (left, right) => {
            comparisons++
            expect(typeof left).toBe(kind)
            expect(typeof right).toBe(kind)
            if (kind === `number`) return (left as number) - (right as number)
            const a = left as string
            const b = right as string
            return a < b ? -1 : a > b ? 1 : 0
          },
        })
        // Keys oppose value order, so collapsing both inputs to one comparator
        // position cannot pass by key-tie ordering alone.
        index.add(`a`, { value: values[1] })
        index.add(`z`, { value: values[0] })
        expect(comparisons).toBeGreaterThan(0)
        expect(index.takeFromStart(2)).toEqual([`z`, `a`])
        expect(index.equalityLookup(values[0])).toEqual(new Set([`z`]))
        expect(index.equalityLookup(values[1])).toEqual(new Set([`a`]))
      },
    )
  },
)
