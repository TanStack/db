import { describe, expect, it } from 'vitest'
import { PropRef } from '../../src/query/ir.js'
import { WindowState } from '../../src/query/live/window-state.js'
import type { CollectionImpl } from '../../src/collection/index.js'
import type { ChangeMessage } from '../../src/types.js'

type Row = { id: number; rank: number | null }

function mockCollection(rows: ReadonlyArray<Row>): CollectionImpl<Row, number> {
  const changes = rows.map(
    (value): ChangeMessage<Row, number> => ({
      type: `insert`,
      key: value.id,
      value,
    }),
  )
  return {
    compareOptions: { stringSort: `lexical` },
    currentStateAsChanges: () => changes,
    entries: () => rows.map((row) => [row.id, row] as const)[Symbol.iterator](),
  } as unknown as CollectionImpl<Row, number>
}

describe(`WindowState`, () => {
  it.each([
    { direction: `asc`, nulls: `first`, expected: { key: 3, values: [2] } },
    { direction: `asc`, nulls: `last`, expected: { key: 1, values: [null] } },
    { direction: `desc`, nulls: `first`, expected: { key: 2, values: [1] } },
    { direction: `desc`, nulls: `last`, expected: { key: 1, values: [null] } },
  ] as const)(
    `keeps a failed replay boundary on the last complete publication ($direction, nulls $nulls)`,
    ({ direction, nulls, expected }) => {
      const window = new WindowState<Row, number>(
        mockCollection([{ id: 2, rank: 100 }]),
        [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction, nulls },
          },
        ],
        undefined,
        1,
      )
      const lastCompletePublication = new Map<number, Row>([
        [1, { id: 1, rank: null }],
        [2, { id: 2, rank: 1 }],
        [3, { id: 3, rank: 2 }],
      ])

      expect(window.boundary(lastCompletePublication)).toEqual(expected)
    },
  )
})
