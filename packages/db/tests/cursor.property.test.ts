import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { PropRef } from '../src/query/ir.js'
import { buildCursor } from '../src/utils/cursor.js'
import { evaluateReferenceExpression } from './reference-expression.js'
import type { OrderBy } from '../src/query/ir.js'

type Term = {
  direction: `asc` | `desc`
  nulls: `first` | `last`
}

const termArbitrary = fc.record<Term>({
  direction: fc.constantFrom(`asc`, `desc`),
  nulls: fc.constantFrom(`first`, `last`),
})
const valueArbitrary = fc.oneof(
  fc.integer({ min: -2, max: 2 }),
  fc.constant(null),
  fc.constant(undefined),
)
const cursorCaseArbitrary = fc
  .integer({ min: 1, max: 4 })
  .chain((length) =>
    fc.tuple(
      fc.array(termArbitrary, { minLength: length, maxLength: length }),
      fc.array(valueArbitrary, { minLength: length, maxLength: length }),
      fc.array(valueArbitrary, { minLength: length, maxLength: length }),
    ),
  )

function compareValue(left: unknown, right: unknown, term: Term): number {
  if (left == null && right == null) return 0
  if (left == null) return term.nulls === `first` ? -1 : 1
  if (right == null) return term.nulls === `first` ? 1 : -1
  const compared = left === right ? 0 : left < right ? -1 : 1
  return term.direction === `asc` ? compared : -compared
}

function compareTuple(
  left: ReadonlyArray<unknown>,
  right: ReadonlyArray<unknown>,
  terms: ReadonlyArray<Term>,
): number {
  for (let index = 0; index < terms.length; index++) {
    const compared = compareValue(left[index], right[index], terms[index]!)
    if (compared !== 0) return compared
  }
  return 0
}

function row(values: ReadonlyArray<unknown>): Record<string, unknown> {
  return Object.fromEntries(
    values.map((value, index) => [`column${index}`, value]),
  )
}

function orderBy(terms: ReadonlyArray<Term>): OrderBy {
  return terms.map((compareOptions, index) => ({
    expression: new PropRef([`column${index}`]),
    compareOptions,
  }))
}

describe(`buildCursor properties`, () => {
  it(`returns no cursor without terms or boundary values`, () => {
    expect(buildCursor([], [1])).toBeUndefined()
    expect(
      buildCursor(orderBy([{ direction: `asc`, nulls: `first` }]), []),
    ).toBeUndefined()
  })

  fcTest.prop([cursorCaseArbitrary], { numRuns: 300 })(
    `selects exactly the tuples after a nullable mixed-direction boundary`,
    ([terms, boundary, candidate]) => {
      const cursor = buildCursor(orderBy(terms), [...boundary])
      expect(cursor).toBeDefined()

      const actual = Boolean(
        evaluateReferenceExpression(cursor!, row(candidate)),
      )
      const expected = compareTuple(candidate, boundary, terms) > 0
      expect(actual).toBe(expected)
    },
  )

  fcTest.prop([cursorCaseArbitrary], { numRuns: 100 })(
    `is deterministic`,
    ([terms, boundary]) => {
      expect(buildCursor(orderBy(terms), [...boundary])).toEqual(
        buildCursor(orderBy(terms), [...boundary]),
      )
    },
  )
})
