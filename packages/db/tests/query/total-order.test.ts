import { describe, expect, it } from 'vitest'
import { PropRef } from '../../src/query/ir.js'
import { TotalOrder } from '../../src/query/total-order.js'
import type { CollectionLike } from '../../src/types.js'

type Row = {
  rank: number | null
  label: string
}

const collection = {
  compareOptions: { stringSort: `lexical` as const },
} as CollectionLike<Row, number>

describe(`TotalOrder`, () => {
  it(`orders every term before the public-key tie-breaker`, () => {
    const order = new TotalOrder<Row, number>(
      [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `last` },
        },
        {
          expression: new PropRef([`label`]),
          compareOptions: {
            direction: `asc`,
            nulls: `first`,
            stringSort: `locale`,
            locale: `en-US`,
            localeOptions: { numeric: true },
          },
        },
      ],
      collection,
    )
    const rows: Array<readonly [number, Row]> = [
      [9, { rank: 0, label: `item10` }],
      [4, { rank: 0, label: `item2` }],
      [2, { rank: 0, label: `item2` }],
      [1, { rank: null, label: `item1` }],
    ]

    expect(
      rows.sort(order.compareEntries.bind(order)).map(([key]) => key),
    ).toEqual([2, 4, 9, 1])
  })

  it(`uses the same comparison for rows and stored boundaries`, () => {
    const order = new TotalOrder<Row, number>(
      [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `desc`, nulls: `first` },
        },
      ],
      collection,
    )
    const left: readonly [number, Row] = [2, { rank: 3, label: `a` }]
    const right: readonly [number, Row] = [1, { rank: 3, label: `b` }]

    expect(order.compareEntries(left, right)).toBe(
      order.compareBoundary(
        order.boundary(left[1], left[0]),
        order.boundary(right[1], right[0]),
      ),
    )
  })

  it(`orders NaN public keys apart from finite numeric keys`, () => {
    const order = new TotalOrder<Row, number>(
      [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ],
      collection,
    )
    const finite: readonly [number, Row] = [1, { rank: 0, label: `finite` }]
    const notANumber: readonly [number, Row] = [
      Number.NaN,
      { rank: 0, label: `nan` },
    ]

    expect(order.compareEntries(finite, notANumber)).not.toBe(0)
    expect(order.compareEntries(notANumber, finite)).toBe(
      -order.compareEntries(finite, notANumber),
    )
  })
})
