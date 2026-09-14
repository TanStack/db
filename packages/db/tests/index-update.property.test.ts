import { describe, expect, expectTypeOf, test, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { compareKeys } from '@tanstack/db-ivm'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils.js'
import { makeComparator } from '../src/utils/comparison.js'
import { indexedKeysSet, orderedEntriesArray, valueMapData } from './utils'
import type { BaseIndex, IndexInterface } from '../src/indexes/base-index.js'

type IndexValue = number

type IndexConstructor = new (
  id: number,
  expression: PropRef,
  name?: string,
  options?: {
    compareFn?: (left: unknown, right: unknown) => number
    compareOptions?: typeof DEFAULT_COMPARE_OPTIONS
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
