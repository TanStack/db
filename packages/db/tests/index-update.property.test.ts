import { describe, expect } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import type { BaseIndex } from '../src/indexes/base-index.js'

type IndexValue = number

type IndexConstructor = new (
  id: number,
  expression: PropRef,
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
  }
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
})
