import { describe, expect, test } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { compareKeys } from '@tanstack/db-ivm'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils.js'
import { makeComparator } from '../src/utils/comparison.js'
import type { BaseIndex } from '../src/indexes/base-index.js'

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
  expect(index.indexedKeysSet).toEqual(new Set(rows.keys()))
  expect(index.valueMapData).toEqual(groups)
  expect(index.orderedEntriesArray).toEqual(
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
  expect(index.rangeQueryReversed()).toEqual(new Set(rows.keys()))
}

describe.each(indexTypes)(`%s update properties`, (_indexName, IndexType) => {
  fcTest.prop([
    fc.array(arbitraryAction, {
      minLength: 1,
      maxLength: 100,
    }),
  ])(
    `matches a reference model across valid operation sequences`,
    (actions) => {
      const index = new IndexType(1, new PropRef([`value`]))
      const rows = new Map<string, IndexValue>()

      for (const action of actions) {
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
        } else if (rows.has(action.key)) {
          index.remove(action.key, { value: rows.get(action.key) })
          rows.delete(action.key)
        }

        expectIndexMatchesModel(index, rows)
      }

      const rebuilt = new IndexType(2, new PropRef([`value`]))
      rebuilt.build([...rows].map(([key, value]) => [key, { value }] as const))
      expectIndexMatchesModel(rebuilt, rows)
    },
  )

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
  fcTest.prop([
    fc.array(fc.integer({ min: 0, max: 4 }), {
      minLength: 2,
      maxLength: 20,
    }),
  ])(
    `preserves exact equality while ordered traversal retains every row`,
    (groupIds) => {
      const symbols = new Map<number, symbol>()
      const rows = groupIds.map((groupId, position) => {
        const symbol = symbols.get(groupId) ?? Symbol(String(groupId))
        symbols.set(groupId, symbol)
        return {
          key: String(position),
          value: [symbol],
          groupId,
        }
      })
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

        expect(subject.takeFromStart(currentRows.length)).toEqual(forward)
        expect(subject.takeReversedFromEnd(currentRows.length)).toEqual(
          reversed,
        )
        for (const [representative, keys] of subject.orderedEntriesArray) {
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

      for (const row of rows) index.add(row.key, row)
      expectMatchesModel(index, rows)

      const removed = rows.shift()!
      index.remove(removed.key, removed)
      expectMatchesModel(index, rows)

      const changed = rows[0]!
      const previous = { ...changed }
      changed.groupId = 99
      changed.value = [Symbol(`updated`)]
      index.update(changed.key, previous, changed)
      expectMatchesModel(index, rows)

      const rebuilt = new IndexType(2, new PropRef([`value`]))
      rebuilt.build(rows.map((row) => [row.key, row]))
      expectMatchesModel(rebuilt, rows)
    },
  )

  fcTest.prop([
    fc.array(fc.integer({ min: 0, max: 4 }), {
      minLength: 2,
      maxLength: 20,
    }),
  ])(
    `matches an independent custom-comparator model`,
    (generatedGroups) => {
      const groupIds = [...generatedGroups, generatedGroups[0]!]
      const rows = groupIds.map((groupId, position) => ({
        key: String(position).padStart(2, `0`),
        value: { groupId, position },
      }))
      const index = new IndexType(1, new PropRef([`value`]), undefined, {
        compareFn: (left, right) =>
          (left as { groupId: number }).groupId -
          (right as { groupId: number }).groupId,
      })

      const expectMatchesModel = (currentRows: typeof rows) => {
        const ordered = [...currentRows].sort(
          (left, right) =>
            left.value.groupId - right.value.groupId ||
            (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
        )
        const forward = ordered.map(({ key }) => key)
        expect(index.takeFromStart(currentRows.length)).toEqual(forward)
        expect(index.takeReversedFromEnd(currentRows.length)).toEqual(
          [...forward].reverse(),
        )

        for (const row of currentRows) {
          expect(index.equalityLookup(row.value)).toEqual(new Set([row.key]))
          expect(
            index.rangeQuery({ from: row.value, to: row.value }),
          ).toEqual(
            new Set(
              currentRows
                .filter(
                  (candidate) =>
                    candidate.value.groupId === row.value.groupId,
                )
                .map(({ key }) => key),
            ),
          )
        }
      }

      for (const row of rows) index.add(row.key, row)
      expectMatchesModel(rows)

      const removed = rows[0]!
      index.remove(removed.key, removed)
      expectMatchesModel(rows.slice(1))
    },
  )
})
