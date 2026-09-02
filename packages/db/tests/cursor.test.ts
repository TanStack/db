import { describe, expect, it } from 'vitest'
import { PropRef } from '../src/query/ir.js'
import { buildCursor, canExpressCursorOrder } from '../src/utils/cursor.js'
import { evaluateReferenceExpression } from './reference-expression.js'
import type { OrderBy } from '../src/query/ir.js'

function orderBy(
  ...terms: ReadonlyArray<readonly [string, `asc` | `desc`, `first` | `last`]>
): OrderBy {
  return terms.map(([path, direction, nulls]) => ({
    expression: new PropRef([path]),
    compareOptions: { direction, nulls },
  }))
}

function matches(
  order: OrderBy,
  boundary: Array<unknown>,
  row: object,
): boolean {
  const cursor = buildCursor(order, boundary)
  if (!cursor) throw new Error(`expected a cursor`)
  return Boolean(evaluateReferenceExpression(cursor, row))
}

describe(`buildCursor`, () => {
  it(`uses direction for one non-null term`, () => {
    expect(matches(orderBy([`rank`, `asc`, `first`]), [10], { rank: 11 })).toBe(
      true,
    )
    expect(matches(orderBy([`rank`, `asc`, `first`]), [10], { rank: 9 })).toBe(
      false,
    )
    expect(matches(orderBy([`rank`, `desc`, `first`]), [10], { rank: 9 })).toBe(
      true,
    )
    expect(
      matches(orderBy([`rank`, `desc`, `first`]), [10], { rank: 11 }),
    ).toBe(false)
  })

  it(`places nullish values according to the term`, () => {
    const nullsFirst = orderBy([`rank`, `asc`, `first`])
    expect(matches(nullsFirst, [null], { rank: 0 })).toBe(true)
    expect(matches(nullsFirst, [null], { rank: undefined })).toBe(false)

    const nullsLast = orderBy([`rank`, `asc`, `last`])
    expect(matches(nullsLast, [0], { rank: null })).toBe(true)
    expect(matches(nullsLast, [null], { rank: 0 })).toBe(false)
  })

  it(`uses lexicographic equality before later mixed-direction terms`, () => {
    const order = orderBy([`group`, `asc`, `first`], [`rank`, `desc`, `last`])

    expect(matches(order, [1, 10], { group: 2, rank: 99 })).toBe(true)
    expect(matches(order, [1, 10], { group: 1, rank: 9 })).toBe(true)
    expect(matches(order, [1, 10], { group: 1, rank: 11 })).toBe(false)
    expect(matches(order, [1, 10], { group: 0, rank: 0 })).toBe(false)
  })

  it(`uses only the terms with supplied boundary values`, () => {
    const order = orderBy([`first`, `asc`, `first`], [`second`, `asc`, `first`])
    expect(matches(order, [1], { first: 2, second: -100 })).toBe(true)
    expect(matches(order, [1], { first: 1, second: 100 })).toBe(false)
  })

  it(`rejects cursor pushdown when predicate comparison cannot express the total order`, () => {
    const localeOrder: OrderBy = [
      {
        expression: new PropRef([`label`]),
        compareOptions: {
          direction: `asc`,
          nulls: `first`,
          stringSort: `locale`,
          localeOptions: { numeric: true },
        },
      },
    ]

    expect(canExpressCursorOrder(localeOrder, [`item2`])).toBe(false)
    expect(
      canExpressCursorOrder(
        [
          {
            ...localeOrder[0]!,
            compareOptions: {
              ...localeOrder[0]!.compareOptions,
              stringSort: `lexical`,
            },
          },
        ],
        [`item2`],
      ),
    ).toBe(true)
    expect(canExpressCursorOrder(localeOrder, [{ rank: 1 }])).toBe(false)
  })
})
