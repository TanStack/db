import { describe, expect, expectTypeOf, test, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { compareKeys } from '@tanstack/db-ivm'
import { createCollection } from '../src/collection/index.js'
import { CollectionInErrorStateError } from '../src/errors.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils.js'
import { makeComparator } from '../src/utils/comparison.js'
import { indexedKeysSet, orderedEntriesArray, valueMapData } from './utils'
import type { BaseIndex, IndexInterface } from '../src/indexes/base-index.js'
import type { CompareOptions } from '../src/query/builder/types.js'

/**
 * An index is a derived multimap from indexed value to source keys.
 *
 * A native Map is the sole ownership model. After put, delete, or full build,
 * the oracle groups that Map by value and freshly sorts the groups. BasicIndex
 * and BTreeIndex must agree on key count, key membership, equality/range lookup,
 * ordered entries, and rebuild behavior. Small duplicate values and signed zero
 * force collisions in the value groups without copying either index structure.
 */

type IndexValue = number

type IndexConstructor = new (
  id: number,
  expression: PropRef,
  name?: string,
  options?: {
    compareFn?: (left: unknown, right: unknown) => number
    compareOptions?: CompareOptions
  },
) => BaseIndex<string>

type IndexAction =
  | { type: `put`; key: string; value: IndexValue }
  | { type: `delete`; key: string }
  | { type: `build`; entries: Array<[string, IndexValue]> }

const indexTypes: Array<[string, IndexConstructor]> = [
  [`BasicIndex`, BasicIndex as IndexConstructor],
  [`BTreeIndex`, BTreeIndex as IndexConstructor],
]

const arbitraryValue: fc.Arbitrary<IndexValue> = fc.integer({
  min: -3,
  max: 3,
})

const arbitraryAction: fc.Arbitrary<IndexAction> = fc.oneof(
  fc.record({
    type: fc.constant(`put` as const),
    key: fc.integer({ min: 0, max: 7 }).map(String),
    value: arbitraryValue,
  }),
  fc.record({
    type: fc.constant(`delete` as const),
    key: fc.integer({ min: 0, max: 7 }).map(String),
  }),
  fc.record({
    type: fc.constant(`build` as const),
    entries: fc.array(
      fc.tuple(fc.integer({ min: 0, max: 7 }).map(String), arbitraryValue),
      { maxLength: 8 },
    ),
  }),
)

const probeValues: Array<IndexValue> = [-3, -2, -1, -0, 0, 1, 2, 3, 99]
const rangeBoundaries: Array<IndexValue> = [-2, 0, 2]

function groupKeysByValue(
  rows: Map<string, IndexValue>,
): Map<IndexValue, Set<string>> {
  const groups = new Map<IndexValue, Set<string>>()
  for (const [key, value] of rows) {
    const keys = groups.get(value)
    if (keys) {
      keys.add(key)
    } else {
      groups.set(value, new Set([key]))
    }
  }
  return groups
}

function expectIndexMatchesModel(
  index: BaseIndex<string>,
  rows: Map<string, IndexValue>,
): void {
  const groups = groupKeysByValue(rows)

  expect(index.keyCount).toBe(rows.size)
  expect(indexedKeysSet(index)).toEqual(new Set(rows.keys()))
  expect(valueMapData(index)).toEqual(groups)
  expect(orderedEntriesArray(index)).toEqual(
    [...groups].sort(([left], [right]) => left - right),
  )

  for (const value of probeValues) {
    expect(index.lookup(`eq`, value)).toEqual(groups.get(value) ?? new Set())
  }

  for (const boundary of rangeBoundaries) {
    const keysAtOrAbove = new Set(
      [...rows].filter(([, value]) => value >= boundary).map(([key]) => key),
    )
    const keysAtOrBelow = new Set(
      [...rows].filter(([, value]) => value <= boundary).map(([key]) => key),
    )

    expect(index.rangeQuery({ from: boundary })).toEqual(keysAtOrAbove)
    expect(index.rangeQuery({ to: boundary })).toEqual(keysAtOrBelow)
    expect(index.rangeQueryReversed({ from: boundary })).toEqual(keysAtOrBelow)
    expect(index.rangeQueryReversed({ to: boundary })).toEqual(keysAtOrAbove)
  }
  expect(index.rangeQueryReversed({})).toEqual(new Set(rows.keys()))
}

type GroupRow<T> = Readonly<{ key: string; value: T; groupId: number }>

// Handles preserve exact identity; expected memberships come only from live
// descriptors. Keep retired handles so a stale bucket cannot leave the query set.
function expectExactIdentities<T>(
  index: Pick<BaseIndex<string>, `equalityLookup`>,
  rows: ReadonlyArray<GroupRow<T>>,
  identities: ReadonlyArray<T>,
): void {
  for (const value of identities) {
    expect(index.equalityLookup(value)).toEqual(
      new Set(rows.filter((row) => row.value === value).map((row) => row.key)),
    )
  }
}

function expectCustomGroups(
  index: BaseIndex<string>,
  rows: ReadonlyArray<GroupRow<{ groupId: number; position: number }>>,
  identities: ReadonlyArray<{ groupId: number; position: number }>,
): void {
  // groupId belongs to an immutable descriptor, never to the driver payload.
  const ordered = [...rows].sort(
    (left, right) =>
      left.groupId - right.groupId ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  )
  const forward = ordered.map(({ key }) => key)
  expect(index.keyCount).toBe(rows.length)
  expect(index.takeFromStart(rows.length + 1)).toEqual(forward)
  expect(index.takeReversedFromEnd(rows.length + 1)).toEqual(
    [...forward].reverse(),
  )
  expectExactIdentities(index, rows, identities)
  for (const row of rows) {
    expect(index.rangeQuery({ from: row.value, to: row.value })).toEqual(
      new Set(
        rows
          .filter((candidate) => candidate.groupId === row.groupId)
          .map(({ key }) => key),
      ),
    )
  }
}

describe.each(indexTypes)(`%s update properties`, (_indexName, IndexType) => {
  fcTest.prop(
    [
      fc.array(arbitraryAction, {
        minLength: 1,
        maxLength: 100,
      }),
    ],
    {
      examples: [
        [
          [
            { type: `put`, key: `0`, value: 1 },
            { type: `build`, entries: [[`1`, -1]] },
            { type: `put`, key: `1`, value: 2 },
          ],
        ],
      ],
    },
  )(`matches a reference model across valid operation sequences`, (actions) => {
    const index = new IndexType(1, new PropRef([`value`]))
    const rows = new Map<string, IndexValue>()

    expectIndexMatchesModel(index, rows)
    // Required replacement/continuation cuts precede the shrinkable tail.
    const required: Array<IndexAction> = [
      { type: `put`, key: `old`, value: -3 },
      { type: `build`, entries: [[`new`, 1]] },
      { type: `put`, key: `new`, value: 2 },
      { type: `delete`, key: `new` },
      { type: `put`, key: `old`, value: 3 },
      { type: `build`, entries: [] },
      { type: `put`, key: `old`, value: -2 },
    ]
    for (const action of [...required, ...actions]) {
      if (action.type === `put`) {
        if (rows.has(action.key)) {
          index.update(
            action.key,
            { value: rows.get(action.key) },
            { value: action.value },
          )
        } else {
          index.add(action.key, { value: action.value })
        }
        rows.set(action.key, action.value)
      } else if (action.type === `build`) {
        // Duplicate generated keys are resolved in the input world, not by
        // assuming any policy for invalid duplicate build entries.
        const replacement = new Map(action.entries)
        index.build([...replacement].map(([key, value]) => [key, { value }]))
        rows.clear()
        for (const [key, value] of replacement) rows.set(key, value)
      } else if (rows.has(action.key)) {
        index.remove(action.key, { value: rows.get(action.key) })
        rows.delete(action.key)
      }

      expectIndexMatchesModel(index, rows)
    }

    const rebuilt = new IndexType(2, new PropRef([`value`]))
    rebuilt.build([...rows].map(([key, value]) => [key, { value }] as const))
    expectIndexMatchesModel(rebuilt, rows)
  })

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

/**
 * A custom index comparator must return a number that is not NaN.
 *
 * A broken comparator is a programming error, so the index crashes: the
 * operation that receives an invalid result must throw. It must never report
 * success from an operation that consumed an invalid result, and it must never
 * reject an operation whose comparisons were all valid. A rejected add or
 * remove throws before it changes the index, so the index still refines the
 * accepted rows. Update and build are not atomic; the Collection boundary
 * below crashes the whole collection instead.
 *
 * Model: a recording comparator counts invalid results during one operation.
 * The operation throws exactly when that count is nonzero. The model does not
 * use the production check.
 *
 * Grammar: index type x comparator x accepted numeric prefix x one probe
 * operation. The probe inserts or reads the non-numeric value `ann`. An
 * empty prefix is included: its first write compares nothing, so it must
 * succeed, and the next comparing operation must throw. Comparator
 * transitivity is outside this owner.
 */
describe.each(indexTypes)(
  `%s invalid comparator results`,
  (_name, IndexType) => {
    const comparators: Array<{
      name: string
      compare: (left: any, right: any) => unknown
      // Whether the comparator orders numbers, so the numeric model can
      // observe the index after a rejected write.
      ordersNumbers: boolean
    }> = [
      {
        name: `subtraction`,
        compare: (left, right) => left - right,
        ordersNumbers: true,
      },
      {
        name: `boolean`,
        compare: (left, right) => left > right,
        ordersNumbers: false,
      },
      {
        name: `signed infinity`,
        compare: (left, right) =>
          left === right ? 0 : left < right ? -Infinity : Infinity,
        ordersNumbers: true,
      },
    ]
    const probes: Array<{
      name: string
      run: (index: BaseIndex<string>, size: number) => unknown
      atomic?: true
    }> = [
      {
        name: `add`,
        run: (index) => index.add(`ann`, { value: `ann` }),
        atomic: true,
      },
      {
        name: `update`,
        run: (index) => index.update(`0`, { value: 0 }, { value: `ann` }),
      },
      { name: `gt`, run: (index) => index.lookup(`gt`, `ann`) },
      { name: `lte`, run: (index) => index.lookup(`lte`, `ann`) },
      { name: `take`, run: (index) => index.take(3, `ann`) },
      { name: `takeReversed`, run: (index) => index.takeReversed(3, `ann`) },
      {
        name: `build`,
        run: (index, size) =>
          index.build([
            ...Array.from({ length: size }, (_, value): [string, object] => [
              String(value),
              { value },
            ]),
            [`ann`, { value: `ann` }],
          ]),
      },
    ]

    function createRecordedIndex(compare: (left: any, right: any) => unknown) {
      const recorder = { invalidResults: 0 }
      const index = new IndexType(1, new PropRef([`value`]), undefined, {
        compareFn: (left, right) => {
          const result = compare(left, right)
          if (typeof result !== `number` || Number.isNaN(result))
            recorder.invalidResults++
          return result as number
        },
      })
      // Refinement check for one operation. Returns whether the index crashed.
      const step = (run: () => unknown): boolean => {
        recorder.invalidResults = 0
        let error: unknown
        try {
          run()
        } catch (caught) {
          error = caught
        }
        if (recorder.invalidResults === 0) {
          expect(error).toBeUndefined()
          return false
        }
        expect(error).toBeInstanceOf(TypeError)
        expect((error as Error).message).toMatch(/comparator/)
        return true
      }
      return { index, step }
    }

    describe.each(comparators)(
      `$name comparator`,
      ({ compare, ordersNumbers }) => {
        describe.each(probes)(`$name`, ({ run, atomic }) => {
          test.each([0, 1, 4, 5, 32, 33, 65])(
            `throws exactly when it receives an invalid result after %s rows`,
            (size) => {
              const { index, step } = createRecordedIndex(compare)
              const rows = new Map<string, IndexValue>()
              for (let value = 0; value < size; value++) {
                if (step(() => index.add(String(value), { value }))) return
                rows.set(String(value), value)
              }
              if (step(() => run(index, size)) && atomic && ordersNumbers)
                expectIndexMatchesModel(index, rows)
            },
          )
        })
      },
    )

    test(`crashes at the second write of the reported string rows`, () => {
      const { index, step } = createRecordedIndex((left, right) => left - right)
      expect(step(() => index.add(`1`, { value: `ann` }))).toBe(false)
      expect(step(() => index.add(`2`, { value: `bob` }))).toBe(true)
    })

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

    test(`a rejected remove leaves its row indexed`, () => {
      const { index, step } = createRecordedIndex((left, right) => left - right)
      expect(step(() => index.add(`x`, { value: `x` }))).toBe(false)
      expect(step(() => index.remove(`x`, { value: `x` }))).toBe(true)
      expect(index.keyCount).toBe(1)
      expect(index.lookup(`eq`, `x`)).toEqual(new Set([`x`]))
    })

    // `A` and `a` share one comparator position. Removing the representative
    // `A` promotes `a`, whose comparison with `z` is the only invalid pair.
    test(`a rejected representative replacement leaves the index unchanged`, () => {
      const { index, step } = createRecordedIndex((left, right) => {
        if ([left, right].includes(`a`) && [left, right].includes(`z`))
          return NaN
        const l = String(left).toLowerCase()
        const r = String(right).toLowerCase()
        return l === r ? 0 : l < r ? -1 : 1
      })
      expect(step(() => index.add(`upper`, { value: `A` }))).toBe(false)
      expect(step(() => index.add(`lower`, { value: `a` }))).toBe(false)
      expect(step(() => index.add(`zed`, { value: `z` }))).toBe(false)
      // Equality lookups and key count read the index without comparing.
      if (step(() => index.remove(`upper`, { value: `A` }))) {
        expect(index.keyCount).toBe(3)
        expect(index.lookup(`eq`, `A`)).toEqual(new Set([`upper`]))
        expect(index.lookup(`eq`, `a`)).toEqual(new Set([`lower`]))
        expect(index.lookup(`eq`, `z`)).toEqual(new Set([`zed`]))
      }
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

/**
 * Collection boundary for the invalid-comparator law.
 *
 * The Collection writes its rows before it updates indexes and publishes
 * change events. An index throw in between would leave rows that subscribers
 * were never told about while the collection stays usable. That is partial
 * success, which `AGENTS.md` forbids. The collection crashes instead: after
 * the throwing write, its status is `error` and the next mutation throws
 * `CollectionInErrorStateError`.
 *
 * Model: until a write throws, the subscriber's accumulated keys equal the
 * collection's keys and the collection is ready.
 *
 * Grammar: index type x write path (optimistic insert, sync commit). Rows use
 * string names with a subtracting comparator. The first row compares nothing;
 * the second is the first invalid comparison.
 */
describe.each([
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const)(
  `%s invalid comparator at the Collection boundary`,
  (_name, IndexType) => {
    type Row = { id: number; name: string }
    const writePaths: Array<{
      name: string
      write: (
        collection: ReturnType<typeof createNamedCollection>[`collection`],
        sync: () => SyncApi,
        row: Row,
      ) => void
    }> = [
      {
        name: `optimistic insert`,
        write: (collection, _sync, row) => collection.insert(row),
      },
      {
        name: `sync commit`,
        write: (_collection, sync, row) => {
          const api = sync()
          api.begin()
          api.write({ type: `insert`, value: row })
          api.commit()
        },
      },
    ]
    type SyncApi = {
      begin: () => void
      write: (message: { type: `insert`; value: Row }) => void
      commit: () => void
    }

    function createNamedCollection() {
      let syncApi: SyncApi | undefined
      const collection = createCollection<Row, number>({
        id: `invalid-comparator-boundary-${IndexType.name}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          sync: (api) => {
            syncApi = api as unknown as SyncApi
            api.markReady()
          },
        },
        onInsert: async () => {},
      })
      collection.createIndex((row) => row.name, {
        indexType: IndexType,
        options: { compareFn: (left: any, right: any) => left - right },
      })
      return { collection, sync: () => syncApi! }
    }

    test.each(writePaths)(
      `$name crashes the collection instead of publishing partial success`,
      ({ write }) => {
        const { collection, sync } = createNamedCollection()
        const published = new Set<number>()
        collection.subscribeChanges((changes) => {
          for (const change of changes)
            if (change.type === `delete`) published.delete(change.key)
            else published.add(change.key)
        })

        write(collection, sync, { id: 1, name: `ann` })
        expect(collection.status).toBe(`ready`)
        expect(published).toEqual(new Set(collection.keys()))

        expect(() => write(collection, sync, { id: 2, name: `bob` })).toThrow(
          TypeError,
        )
        expect(collection.status).toBe(`error`)
        expect(() => collection.insert({ id: 3, name: `cy` })).toThrow(
          CollectionInErrorStateError,
        )
      },
    )
  },
)

describe.each(indexTypes)(`%s comparator groups`, (_indexName, IndexType) => {
  test(`rejects stale retired identity outputs without rejecting live reuse`, () => {
    const symbol = Symbol(`same group`)
    const retired = { key: `old`, groupId: 0, value: [symbol] }
    const live = { key: `live`, groupId: 0, value: [symbol] }
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(retired.key, retired)
    index.add(live.key, live)
    index.remove(retired.key, retired)
    const identities = [retired.value, live.value]
    expectExactIdentities(index, [live], identities)
    const lookup = index.equalityLookup.bind(index)
    const wrongOutput = vi
      .spyOn(index, `equalityLookup`)
      .mockImplementation((value) =>
        value === retired.value ? new Set([retired.key]) : lookup(value),
      )
    try {
      // The former live-only observation accepts this stale retired bucket.
      expectExactIdentities(index, [live], [live.value])
      expect(() =>
        expectExactIdentities(index, [live], identities),
      ).toThrowError(/expected/)
    } finally {
      wrongOutput.mockRestore()
    }
    const reused = { ...retired, key: `reused` }
    index.add(reused.key, reused)
    expectExactIdentities(index, [live, reused], identities)
  })

  test(`rejects append-only replacement state and accepts replacement continuation`, () => {
    const index = new IndexType(1, new PropRef([`value`]))
    index.add(`old`, { value: -1 })
    index.add(`new`, { value: 1 })
    const replacement = new Map([[`new`, 1]])
    // This is the raw state an append-only build would expose, not a source mutant.
    expect(() => expectIndexMatchesModel(index, replacement)).toThrowError(
      /expected/,
    )
    index.build([[`new`, { value: 1 }]])
    expectIndexMatchesModel(index, replacement)
    index.update(`new`, { value: 1 }, { value: 2 })
    expectIndexMatchesModel(index, new Map([[`new`, 2]]))
  })

  test(`custom facts reject mutated payload groups and insertion-order ties`, () => {
    const rows = [1, 1, 2].map((groupId, position) =>
      Object.freeze({
        key: String(position),
        groupId,
        value: { groupId, position },
      }),
    )
    const identities = rows.map((row) => row.value)
    const index = new IndexType(1, new PropRef([`value`]), undefined, {
      compareFn: (left, right) =>
        (left as { groupId: number }).groupId -
        (right as { groupId: number }).groupId,
    })
    for (const row of [...rows].reverse())
      index.add(row.key, { value: row.value })
    expectCustomGroups(index, rows, identities)
    const wrongOutput = vi
      .spyOn(index, `takeFromStart`)
      .mockReturnValue([`1`, `0`, `2`])
    try {
      expect(() => expectCustomGroups(index, rows, identities)).toThrowError(
        /expected/,
      )
    } finally {
      wrongOutput.mockRestore()
    }
    // The driver-visible objects can change without rewriting the authority.
    for (const row of rows) row.value.groupId = 0
    index.build(rows.map((row) => [row.key, { value: row.value }]))
    expect(rows.map((row) => row.groupId)).toEqual([1, 1, 2])
    // Re-reading payload fields as facts reproduces the old false green.
    const driftedAuthority = rows.map((row) => ({
      ...row,
      groupId: row.value.groupId,
    }))
    expectCustomGroups(index, driftedAuthority, identities)
    expect(() => expectCustomGroups(index, rows, identities)).toThrowError(
      /expected/,
    )
    for (const row of rows) row.value.groupId = row.groupId
    index.build(rows.map((row) => [row.key, { value: row.value }]))
    expectCustomGroups(index, rows, identities)
  })

  fcTest.prop(
    [
      fc.array(fc.integer({ min: 0, max: 4 }), {
        minLength: 2,
        maxLength: 20,
      }),
    ],
    { examples: [[[0, 1]]] },
  )(
    `preserves exact equality while ordered traversal retains every row`,
    (groupIds) => {
      const symbols = new Map<number, symbol>()
      // The first representative must retire while its group survives. Group
      // 5 is distinct from every generated group even after shrinking.
      const rows = [groupIds[0]!, groupIds[0]!, 5, ...groupIds.slice(1)].map(
        (groupId, position) => {
          const symbol = symbols.get(groupId) ?? Symbol(String(groupId))
          symbols.set(groupId, symbol)
          return {
            key: String(position),
            value: [symbol],
            groupId,
          }
        },
      )
      const identities = rows.map((row) => row.value)
      const index = new IndexType(1, new PropRef([`value`]))

      const expectMatchesModel = (
        subject: BaseIndex<string>,
        currentRows: typeof rows,
      ) => {
        const groups = new Map<number, typeof rows>()
        for (const row of currentRows) {
          const group = groups.get(row.groupId) ?? []
          group.push(row)
          groups.set(row.groupId, group)
        }
        const compare = makeComparator(DEFAULT_COMPARE_OPTIONS)
        const orderedGroups = [...groups.values()].sort((left, right) =>
          compare(left[0]!.value, right[0]!.value),
        )
        const forward = orderedGroups.flatMap((group) =>
          group.map((row) => row.key).sort(compareKeys),
        )
        const reversed = [...orderedGroups].reverse().flatMap((group) =>
          group
            .map((row) => row.key)
            .sort(compareKeys)
            .reverse(),
        )

        expect(subject.keyCount).toBe(currentRows.length)
        expectExactIdentities(subject, currentRows, identities)
        expect(subject.takeFromStart(currentRows.length + 1)).toEqual(forward)
        expect(subject.takeReversedFromEnd(currentRows.length + 1)).toEqual(
          reversed,
        )
        for (const [representative, keys] of orderedEntriesArray(subject)) {
          expect(
            currentRows.some(
              (row) => row.value === representative && keys.has(row.key),
            ),
          ).toBe(true)
        }
        for (const row of currentRows) {
          expect(subject.equalityLookup(row.value)).toEqual(new Set([row.key]))
          expect(
            subject.rangeQuery({ from: row.value, to: row.value }),
          ).toEqual(
            new Set(
              currentRows
                .filter((candidate) => candidate.groupId === row.groupId)
                .map((candidate) => candidate.key),
            ),
          )
        }
      }

      expectMatchesModel(index, [])
      for (const row of rows) index.add(row.key, { value: row.value })
      expectMatchesModel(index, rows)

      const removed = rows.shift()!
      expect(rows.some((row) => row.groupId === removed.groupId)).toBe(true)
      index.remove(removed.key, removed)
      expectMatchesModel(index, rows)

      const changed = rows[0]!
      const previous = { ...changed }
      changed.groupId = 99
      changed.value = [Symbol(`updated`)]
      identities.push(changed.value)
      index.update(changed.key, previous, changed)
      expectMatchesModel(index, rows)

      // Reuse both a removed identity and an identity retired by update.
      for (const retired of [removed, previous]) {
        const reused = { ...retired, key: `reused-${retired.key}` }
        index.add(reused.key, { value: reused.value })
        rows.push(reused)
        expectMatchesModel(index, rows)
      }

      const rebuilt = new IndexType(2, new PropRef([`value`]))
      rebuilt.build(rows.map((row) => [row.key, row]))
      expectMatchesModel(rebuilt, rows)

      const replacement = {
        key: `replacement`,
        groupId: 100,
        value: [Symbol(`replacement`)],
      }
      identities.push(replacement.value)
      index.build([[replacement.key, { value: replacement.value }]])
      expectMatchesModel(index, [replacement])
      index.update(replacement.key, replacement, removed)
      const resumed = { ...removed, key: replacement.key }
      expectMatchesModel(index, [resumed])
      index.remove(resumed.key, resumed)
      expectMatchesModel(index, [])
      index.add(removed.key, removed)
      expectMatchesModel(index, [removed])
      index.build([])
      expectMatchesModel(index, [])
      index.add(previous.key, previous)
      expectMatchesModel(index, [previous])
    },
  )

  fcTest.prop(
    [
      fc.array(fc.integer({ min: 0, max: 4 }), {
        minLength: 2,
        maxLength: 20,
      }),
    ],
    { examples: [[[0, 1]]] },
  )(`matches an independent custom-comparator model`, (generatedGroups) => {
    for (const reverseInsertion of [false, true]) {
      const groupIds = [
        generatedGroups[0]!,
        generatedGroups[0]!,
        5,
        ...generatedGroups.slice(1),
      ]
      const rows = groupIds.map((groupId, position) =>
        Object.freeze({
          key: String(position).padStart(2, `0`),
          value: { groupId, position },
          groupId,
        }),
      )
      const identities = rows.map((row) => row.value)
      const index = new IndexType(1, new PropRef([`value`]), undefined, {
        compareFn: (left, right) =>
          (left as { groupId: number }).groupId -
          (right as { groupId: number }).groupId,
      })

      expectCustomGroups(index, [], identities)
      // Preserve forward insertion and challenge it with a real permutation:
      // key 01 precedes 00 in the reverse run, but expected order stays lexical.
      for (const row of reverseInsertion ? [...rows].reverse() : rows)
        index.add(row.key, { value: row.value })
      expectCustomGroups(index, rows, identities)

      const removed = rows.shift()!
      expect(rows.some((row) => row.groupId === removed.groupId)).toBe(true)
      index.remove(removed.key, { value: removed.value })
      expectCustomGroups(index, rows, identities)

      const previous = rows[0]!
      const changed = Object.freeze({
        key: previous.key,
        groupId: 99,
        value: { groupId: 99, position: previous.value.position },
      })
      identities.push(changed.value)
      index.update(
        previous.key,
        { value: previous.value },
        { value: changed.value },
      )
      rows[0] = changed
      expectCustomGroups(index, rows, identities)

      for (const retired of [removed, previous]) {
        const reused = Object.freeze({
          ...retired,
          key: `reused-${retired.key}`,
        })
        index.add(reused.key, { value: reused.value })
        rows.push(reused)
        expectCustomGroups(index, rows, identities)
      }

      index.build([[changed.key, { value: changed.value }]])
      expectCustomGroups(index, [changed], identities)
      index.update(
        changed.key,
        { value: changed.value },
        { value: removed.value },
      )
      const resumed = Object.freeze({ ...removed, key: changed.key })
      expectCustomGroups(index, [resumed], identities)
      index.remove(resumed.key, { value: resumed.value })
      expectCustomGroups(index, [], identities)
      index.add(removed.key, { value: removed.value })
      expectCustomGroups(index, [removed], identities)
      index.build([])
      expectCustomGroups(index, [], identities)
      index.add(previous.key, { value: previous.value })
      expectCustomGroups(index, [previous], identities)
    }
  })
})

test(`retired-identity calibration shrinks and replays the same semantic failure`, () => {
  const property = fc.property(
    fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 8 }),
    (keys) => {
      const identity = {}
      expectExactIdentities(
        { equalityLookup: () => new Set(keys.map(String)) },
        [],
        [identity],
      )
    },
  )
  const failed = fc.check(property, { seed: 303108, numRuns: 1 })
  expect(failed.failed).toBe(true)
  expect(failed.error).toMatch(/expected/)
  expect(failed.counterexample).toEqual([[0]])
  expect(failed.counterexamplePath).toBe(`0:0:0`)
  if (failed.counterexamplePath === null)
    throw new Error(`Missing calibration replay path`)
  const replay = fc.check(property, {
    seed: failed.seed,
    path: failed.counterexamplePath,
    numRuns: 1,
    endOnFailure: true,
  })
  expect(replay.failed).toBe(true)
  expect(replay.error).toMatch(/expected/)
  expect(replay.counterexample).toEqual(failed.counterexample)
})

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
  collation: (typeof collationCases)[number][`collation`],
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
        for (const label of labels) {
          write({ type: `insert`, value: { id: label, label } })
        }
        commit()
        markReady()
      },
    },
  })
}

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
        await collection.cleanup()
      }
    },
  )
})

test.each(collationCases)(
  `$name ordered public reads honor Collection collation without an index`,
  async ({ collation, clause, expected }) => {
    const collection = createCollationCollection(collation, `off`)

    try {
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
    } finally {
      await collection.cleanup()
    }
  },
)

test(`ordered scan resolves inherited collation outside each comparison`, async () => {
  const collection = createCollationCollection(
    { stringSort: `lexical` },
    `off`,
    undefined,
    [`f`, `e`, `d`, `c`, `b`, `a`],
  )

  try {
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
  } finally {
    await collection.cleanup()
  }
})
