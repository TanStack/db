import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { PropRef, Value } from '../src/query/ir.js'
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

const scalarTerms: Array<Term> = ([`asc`, `desc`] as const).flatMap(
  (direction) =>
    ([`first`, `last`] as const).map((nulls) => ({ direction, nulls })),
)
const scalarValues = [-2, -1, 0, 1, 2, null, undefined]
const broadScalarValue = fc.oneof(
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
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

function orderBy(terms: ReadonlyArray<Term>): OrderBy {
  return terms.map((compareOptions, index) => ({
    expression: new PropRef([`column${index}`]),
    compareOptions,
  }))
}

function row(values: ReadonlyArray<unknown>): Record<string, unknown> {
  return Object.fromEntries(
    values.map((value, index) => [`column${index}`, value]),
  )
}

function expectCursorDenotation(
  terms: ReadonlyArray<Term>,
  boundary: ReadonlyArray<unknown>,
  candidate: ReadonlyArray<unknown>,
  build: typeof buildCursor = buildCursor,
): void {
  if (terms.length !== 1 || boundary.length !== 1) {
    expect(() => build(orderBy(terms), [...boundary])).toThrow(
      `Only single-column cursors are supported`,
    )
    return
  }
  const length = Math.min(terms.length, boundary.length)
  const usedTerms = terms.slice(0, length)
  const usedBoundary = boundary.slice(0, length)
  const cursor = build(orderBy(terms), [...boundary])
  expect(cursor).toBeDefined()
  expect(Boolean(evaluateReferenceExpression(cursor!, row(candidate)))).toBe(
    compareTuple(candidate, usedBoundary, usedTerms) > 0,
  )
}

// Keep the nullable mixed-direction ordering law at the retained production
// snapshot boundary even though direct composite cursor construction is removed.
async function expectLocalTupleOrder(
  terms: ReadonlyArray<Term>,
  boundary: ReadonlyArray<unknown>,
  candidate: ReadonlyArray<unknown>,
): Promise<void> {
  const collection = createCollection<{ id: string; [key: string]: unknown }>({
    getKey: (value) => value.id,
    autoIndex: `off`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { ...row(candidate), id: `candidate` } })
        write({ type: `insert`, value: { ...row(boundary), id: `boundary` } })
        commit()
        markReady()
      },
    },
  })
  try {
    await collection.preload()
    const expected =
      compareTuple(candidate, boundary, terms) >= 0
        ? [`boundary`, `candidate`]
        : [`candidate`, `boundary`]
    for (const limit of [1, 2]) {
      expect(
        collection
          .currentStateAsChanges({
            orderBy: [
              ...orderBy(terms),
              {
                expression: new PropRef([`id`]),
                compareOptions: {
                  direction: `asc`,
                  nulls: `first`,
                  stringSort: `lexical`,
                },
              },
            ],
            limit,
          })
          ?.map(({ key }) => key),
      ).toEqual(expected.slice(0, limit))
    }
  } finally {
    await collection.cleanup()
  }
}

const exactCursorArbitrary = fc
  .integer({ min: 1, max: 4 })
  .chain((length) =>
    fc.tuple(
      fc.array(termArbitrary, { minLength: length, maxLength: length }),
      fc.array(valueArbitrary, { minLength: length, maxLength: length }),
      fc.array(valueArbitrary, { minLength: length, maxLength: length }),
    ),
  )

const partialCursorArbitrary = fc
  .tuple(
    fc.array(termArbitrary, { minLength: 1, maxLength: 4 }),
    fc.array(valueArbitrary, { minLength: 1, maxLength: 4 }),
    fc.array(valueArbitrary, { minLength: 4, maxLength: 4 }),
  )
  .filter(([terms, boundary]) => terms.length !== boundary.length)

describe(`buildCursor properties`, () => {
  it.each(scalarTerms)(
    `checks every small scalar/null boundary for $direction / nulls $nulls`,
    (term) => {
      // All 49 pairs run under every option cell. Null and undefined remain
      // distinct driver inputs even though their ordering positions coincide.
      for (const boundary of scalarValues) {
        for (const candidate of scalarValues) {
          expectCursorDenotation([term], [boundary], [candidate])
        }
      }
    },
  )

  for (const term of scalarTerms) {
    fcTest.prop([broadScalarValue, broadScalarValue], { numRuns: 100 })(
      `scalar continuation agrees with order: ${term.direction} / nulls ${term.nulls}`,
      (boundary, candidate) => {
        expectCursorDenotation([term], [boundary], [candidate])
      },
    )
  }

  it.each([2, 3, 4])(
    `rejects composite width %i in every option cell`,
    (width) => {
      for (const term of scalarTerms) {
        expectCursorDenotation(
          Array.from({ length: width }, () => term),
          Array(width).fill(0),
          Array(width).fill(1),
        )
      }
    },
  )

  it.each(scalarTerms)(
    `rejects constant cursor predicates for $direction / nulls $nulls`,
    (term) => {
      expect(() =>
        expectCursorDenotation([term], [0], [0], () => new Value(true)),
      ).toThrow()
      const following = term.direction === `asc` ? 1 : -1
      expect(() =>
        expectCursorDenotation(
          [term],
          [0],
          [following],
          () => new Value(false),
        ),
      ).toThrow()
      expectCursorDenotation([term], [0], [0])
      expectCursorDenotation([term], [0], [following])
    },
  )

  it(`returns no cursor without boundary values and rejects a boundary without an order`, () => {
    expect(() => buildCursor([], [1])).toThrow(
      `Only single-column cursors are supported`,
    )
    expect(buildCursor([], [])).toBeUndefined()
    expect(
      buildCursor(orderBy([{ direction: `asc`, nulls: `first` }]), []),
    ).toBeUndefined()
  })

  fcTest.prop([exactCursorArbitrary], { numRuns: 300 })(
    `preserves nullable mixed-direction ordering while restricting cursor width`,
    async ([terms, boundary, candidate]) => {
      expectCursorDenotation(terms, boundary, candidate)
      await expectLocalTupleOrder(terms, boundary, candidate)
    },
  )

  fcTest.prop([partialCursorArbitrary], { numRuns: 200 })(
    `rejects mismatched cursor widths without restricting local tuple ordering`,
    async ([terms, boundary, candidate]) => {
      expectCursorDenotation(terms, boundary, candidate)
      await expectLocalTupleOrder(terms, boundary, candidate)
    },
  )

  fcTest.prop([exactCursorArbitrary], { numRuns: 100 })(
    `repeats the same cursor or unsupported-width error`,
    ([terms, boundary]) => {
      if (terms.length !== 1) {
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(() => buildCursor(orderBy(terms), [...boundary])).toThrow(
            `Only single-column cursors are supported`,
          )
        }
        return
      }
      expect(buildCursor(orderBy(terms), [...boundary])).toEqual(
        buildCursor(orderBy(terms), [...boundary]),
      )
    },
  )
})
