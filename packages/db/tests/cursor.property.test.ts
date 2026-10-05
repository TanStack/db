import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it as vitestIt } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { PropRef, Value } from '../src/query/ir.js'
import { buildCursor } from '../src/utils/cursor.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from './oracle-config.js'
import { withHistoryCleanup } from './optimistic-history-oracle.js'
import { evaluateReferenceExpression } from './reference-expression.js'
import type { OrderBy } from '../src/query/ir.js'

/**
 * A cursor denotes the strict suffix after one ordered boundary. The
 * `CursorExpressions.whereFrom` API contract and the ordered-continuation
 * section of `query/live/ARCHITECTURE.md` authorize the leading-column
 * boundary and rejection of composite cursor values.
 *
 * The reference compares candidate and boundary tuples directly, with explicit
 * direction and null placement. Production builds an expression; the driver
 * evaluates that expression against candidate rows and requires the same
 * Boolean answer. Unsupported composite cursor construction must reject rather
 * than silently approximate it. A retained local-snapshot path still checks
 * multi-term nullable ordering without claiming composite cursor support.
 * The grammar covers finite integers, null, undefined, one to four order
 * terms, and two public Collection rows at the settled local-snapshot cut.
 * It does not establish provider ordering, other value types, or a whole
 * paginated query's acquisition and publication behavior.
 */

const replay = readOracleRunConfig()
const it = replay.replayPath === undefined ? vitestIt : vitestIt.skip
const fixedCampaign = replay.replayPath === undefined ? fcTest : fcTest.skip
const randomCampaign = (property: string) =>
  replay.replayPath === undefined || replay.replayProperty === property
    ? fcTest
    : fcTest.skip

const fixedSeed = 20260930

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
  if (terms.length === 0 || boundary.length !== 1) {
    expect(() => build(orderBy(terms), [...boundary])).toThrow(
      `Only leading-column cursors are supported`,
    )
    return
  }
  const cursor = build(orderBy(terms), [...boundary])
  expect(cursor).toBeDefined()
  expect(Boolean(evaluateReferenceExpression(cursor!, row(candidate)))).toBe(
    compareValue(candidate[0], boundary[0], terms[0]!) > 0,
  )
}

// Keep the nullable mixed-direction ordering law at the retained production
// snapshot boundary even though direct composite cursor construction is removed.
async function expectLocalTupleOrder(
  terms: ReadonlyArray<Term>,
  boundary: ReadonlyArray<unknown>,
  candidate: ReadonlyArray<unknown>,
  fault?: `reverse-observed-order`,
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
  return withHistoryCleanup(
    async () => {
      await collection.preload()
      const expected =
        compareTuple(candidate, boundary, terms) >= 0
          ? [`boundary`, `candidate`]
          : [`candidate`, `boundary`]
      for (const limit of [1, 2]) {
        const actual = collection
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
          ?.map(({ key }) => key)
        expect(
          fault === `reverse-observed-order` && limit === 2
            ? actual?.slice().reverse()
            : actual,
        ).toEqual(expected.slice(0, limit))
      }
    },
    () => [() => collection.cleanup()],
  )
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

const scalarCursorArbitrary = fc.tuple(
  termArbitrary,
  broadScalarValue,
  broadScalarValue,
)

type CursorCase = [
  Array<Term>,
  Array<number | null | undefined>,
  Array<number | null | undefined>,
]

const assertScalarCursor = ([term, boundary, candidate]: [
  Term,
  number | null | undefined,
  number | null | undefined,
]) => expectCursorDenotation([term], [boundary], [candidate])

const assertCursorWidth = ([terms, boundary, candidate]: CursorCase) => {
  expectCursorDenotation(terms, boundary, candidate)
}

const assertLocalTupleOrder = ([terms, boundary, candidate]: CursorCase) =>
  expectLocalTupleOrder(terms, boundary, candidate)

const assertRepeatedCursor = (
  [terms, boundary]: CursorCase,
  build: typeof buildCursor = buildCursor,
) => {
  if (terms.length !== 1) {
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => build(orderBy(terms), [...boundary])).toThrow(
        `Only leading-column cursors are supported`,
      )
    }
    return
  }
  expect(build(orderBy(terms), [...boundary])).toEqual(
    build(orderBy(terms), [...boundary]),
  )
}

// Boundary width distinguishes one-value continuation from rejected composite
// values; one value remains legal with several order terms. Direction reverses
// numeric order, null placement reverses null-versus-number order, and equal
// values distinguish a strict suffix from an inclusive one. A leading tie lets
// trailing terms determine local order. Null and undefined share a comparator
// position but remain distinct driver inputs. Fixed matrices reconstruct every
// option cell and small scalar pair; random campaigns extend the integer range.
// Width zero is pinned below as the no-cursor result, outside this generator.
// A boundary with no order is the nearby invalid state.

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

  fixedCampaign.prop([scalarCursorArbitrary], {
    numRuns: oracleRuns(400),
    seed: fixedSeed,
  })(
    `scalar continuation agrees with order for a fixed seed`,
    assertScalarCursor,
  )

  randomCampaign(`cursor.scalar-continuation`).prop(
    [scalarCursorArbitrary],
    oraclePropertyOptions(400, `cursor.scalar-continuation`),
  )(
    `scalar continuation agrees with order for a random or replayed seed`,
    assertScalarCursor,
  )

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

  it.each([2, 3, 4])(
    `accepts one leading boundary value for %i ordered terms`,
    (width) => {
      const terms = Array.from({ length: width }, () => ({
        direction: `asc` as const,
        nulls: `last` as const,
      }))
      expectCursorDenotation(terms, [0], Array(width).fill(1))
      expectCursorDenotation(terms, [0], Array(width).fill(-1))
    },
  )

  it(`rejects a builder that accepts two boundary values`, () => {
    const term: Term = { direction: `asc`, nulls: `last` }
    expect(() =>
      expectCursorDenotation(
        [term, term],
        [0, 0],
        [1, 1],
        () => new Value(true),
      ),
    ).toThrow()
    expectCursorDenotation([term, term], [0, 0], [1, 1])
  })

  it(`orders a leading tie by a nullable trailing term at the local snapshot`, async () => {
    const terms: Array<Term> = [
      { direction: `asc`, nulls: `last` },
      { direction: `desc`, nulls: `first` },
    ]
    const boundary = [0, 1]
    const candidate = [0, null]
    await expectLocalTupleOrder(terms, boundary, candidate)
    // A leading-only order would place boundary first by the id tie-breaker.
    await expect(
      expectLocalTupleOrder(
        terms,
        boundary,
        candidate,
        `reverse-observed-order`,
      ),
    ).rejects.toThrow()
  })

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

  it(`rejects an unstable cursor expression on repeated construction`, () => {
    let calls = 0
    expect(() =>
      assertRepeatedCursor(
        [[{ direction: `asc`, nulls: `first` }], [0], [0]],
        () => new Value(++calls === 1),
      ),
    ).toThrow()
  })

  it(`returns no cursor without boundary values and rejects a boundary without an order`, () => {
    expect(() => buildCursor([], [1])).toThrow(
      `Only leading-column cursors are supported`,
    )
    expect(buildCursor([], [])).toBeUndefined()
    expect(
      buildCursor(orderBy([{ direction: `asc`, nulls: `first` }]), []),
    ).toBeUndefined()
  })

  fixedCampaign.prop([exactCursorArbitrary], {
    numRuns: oracleRuns(300),
    seed: fixedSeed,
  })(`restricts exact cursor width for a fixed seed`, assertCursorWidth)

  randomCampaign(`cursor.exact-width`).prop(
    [exactCursorArbitrary],
    oraclePropertyOptions(300, `cursor.exact-width`),
  )(
    `restricts exact cursor width for a random or replayed seed`,
    assertCursorWidth,
  )

  fixedCampaign.prop([exactCursorArbitrary], {
    numRuns: oracleRuns(300),
    seed: fixedSeed,
  })(
    `preserves exact-width nullable local tuple order for a fixed seed`,
    assertLocalTupleOrder,
  )

  randomCampaign(`cursor.exact-local-order`).prop(
    [exactCursorArbitrary],
    oraclePropertyOptions(300, `cursor.exact-local-order`),
  )(
    `preserves exact-width nullable local tuple order for a random or replayed seed`,
    assertLocalTupleOrder,
  )

  fixedCampaign.prop([partialCursorArbitrary], {
    numRuns: oracleRuns(200),
    seed: fixedSeed,
  })(
    `uses one leading boundary value and rejects other mismatched widths for a fixed seed`,
    assertCursorWidth,
  )

  randomCampaign(`cursor.partial-width`).prop(
    [partialCursorArbitrary],
    oraclePropertyOptions(200, `cursor.partial-width`),
  )(
    `uses one leading boundary value and rejects other mismatched widths for a random or replayed seed`,
    assertCursorWidth,
  )

  fixedCampaign.prop([partialCursorArbitrary], {
    numRuns: oracleRuns(200),
    seed: fixedSeed,
  })(
    `preserves partial-width nullable local tuple order for a fixed seed`,
    assertLocalTupleOrder,
  )

  randomCampaign(`cursor.partial-local-order`).prop(
    [partialCursorArbitrary],
    oraclePropertyOptions(200, `cursor.partial-local-order`),
  )(
    `preserves partial-width nullable local tuple order for a random or replayed seed`,
    assertLocalTupleOrder,
  )

  fixedCampaign.prop([exactCursorArbitrary], {
    numRuns: oracleRuns(100),
    seed: fixedSeed,
  })(
    `repeats the same cursor or unsupported-width error for a fixed seed`,
    assertRepeatedCursor,
  )

  randomCampaign(`cursor.repeat-construction`).prop(
    [exactCursorArbitrary],
    oraclePropertyOptions(100, `cursor.repeat-construction`),
  )(
    `repeats the same cursor or unsupported-width error for a random or replayed seed`,
    assertRepeatedCursor,
  )
})
