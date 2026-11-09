import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it as vitestIt } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { PropRef, Value } from '../src/query/ir.js'
import { buildCursor } from '../src/utils/cursor.js'
import {
  oracleFixedSeed,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRouteOf,
  oracleRuns,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import { withHistoryCleanup } from './optimistic-history-oracle.js'
import { orderBy } from './cursor-order-terms.js'
import { evaluateReferenceExpression } from './reference-expression-oracle.js'
import type { Term } from './cursor-order-terms.js'

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
 * than silently approximate it. A read of the public snapshot still checks
 * multi-term nullable ordering without claiming composite cursor support.
 * The grammar covers finite integers, null, undefined, one to four order
 * terms, and two public Collection rows read after collection.preload() fulfills.
 * The comparison cut is the return from collection.currentStateAsChanges().
 * It does not establish provider ordering, other value types, or a whole
 * paginated query's acquisition and publication behavior.
 */

const it = oracleReplayTest(vitestIt)
const fixedCampaign = oracleReplayTest(fcTest)
const randomCampaign = (property: string) => oracleReplayTest(fcTest, property)

const fixedSeed = 20260930

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

// Keep nullable mixed-direction ordering in the public snapshot read after
// preload fulfills, even though direct composite cursor construction is removed.
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

// What this oracle owns: the gap report judges buildCursor and its static
// reference tree by this file's tests.
declareOracle({
  owns: [`src/utils/cursor.ts#buildCursor`],
  check: [expectCursorDenotation, expectLocalTupleOrder, assertRepeatedCursor],
  model: [compareValue, compareTuple],
})

// Boundary width distinguishes one-value continuation from rejected composite
// values; one value remains legal with several order terms. Direction reverses
// numeric order, null placement reverses null-versus-number order, and equal
// values distinguish a strict suffix from an inclusive one. A leading tie lets
// trailing terms determine local order. Null and undefined share a comparator
// position but remain distinct driver inputs. Fixed matrices reconstruct every
// option cell and small scalar pair; random campaigns extend the integer range.
// Width zero is fixed below as the no-cursor result, outside this generator.
// A boundary with no order is the nearby invalid state.

describe(`buildCursor properties`, () => {
  it.each(scalarTerms)(
    `checks every small scalar/null boundary for $direction / nulls $nulls`,
    (term) => {
      oracleRoute(`case`)
      // All 49 pairs run under every option cell. Null and undefined remain
      // distinct driver inputs even though their ordering positions coincide.
      for (const boundary of scalarValues) {
        for (const candidate of scalarValues) {
          expectCursorDenotation([term], [boundary], [candidate])
        }
      }
    },
  )

  const scalarCursorFixedSeed = oracleFixedSeed(fixedSeed, {
    numRuns: oracleRuns(400),
  })
  fixedCampaign.prop([scalarCursorArbitrary], scalarCursorFixedSeed)(
    `scalar continuation agrees with order for a fixed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(scalarCursorFixedSeed))
      return assertScalarCursor(...args)
    },
  )

  const scalarCursorCampaign = oraclePropertyOptions(
    400,
    `cursor.scalar-continuation`,
  )
  randomCampaign(`cursor.scalar-continuation`).prop(
    [scalarCursorArbitrary],
    scalarCursorCampaign,
  )(
    `scalar continuation agrees with order for a random or replayed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(scalarCursorCampaign))
      return assertScalarCursor(...args)
    },
  )

  it.each([2, 3, 4])(
    `rejects composite width %i in every option cell`,
    (width) => {
      oracleRoute(`case`)
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
      oracleRoute(`case`)
      const terms = Array.from({ length: width }, () => ({
        direction: `asc` as const,
        nulls: `last` as const,
      }))
      expectCursorDenotation(terms, [0], Array(width).fill(1))
      expectCursorDenotation(terms, [0], Array(width).fill(-1))
    },
  )

  it(`rejects a builder that accepts two boundary values`, () => {
    oracleRoute(`calibration`)
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

  it(`orders a leading tie by a nullable trailing term in the public snapshot after preload fulfills`, async () => {
    oracleRoute(`fixed history`)
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
      oracleRoute(`calibration`)
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
    oracleRoute(`calibration`)
    let calls = 0
    expect(() =>
      assertRepeatedCursor(
        [[{ direction: `asc`, nulls: `first` }], [0], [0]],
        () => new Value(++calls === 1),
      ),
    ).toThrow()
  })

  const exactCursorFixedSeed = oracleFixedSeed(fixedSeed, {
    numRuns: oracleRuns(300),
  })
  fixedCampaign.prop([exactCursorArbitrary], exactCursorFixedSeed)(
    `restricts exact cursor width for a fixed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(exactCursorFixedSeed))
      return assertCursorWidth(...args)
    },
  )

  const exactCursorCampaign = oraclePropertyOptions(300, `cursor.exact-width`)
  randomCampaign(`cursor.exact-width`).prop(
    [exactCursorArbitrary],
    exactCursorCampaign,
  )(`restricts exact cursor width for a random or replayed seed`, (...args) => {
    oracleRoute(oracleRouteOf(exactCursorCampaign))
    return assertCursorWidth(...args)
  })

  const exactCursorFixedSeed2 = oracleFixedSeed(fixedSeed, {
    numRuns: oracleRuns(300),
  })
  fixedCampaign.prop([exactCursorArbitrary], exactCursorFixedSeed2)(
    `preserves exact-width nullable local tuple order for a fixed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(exactCursorFixedSeed2))
      return assertLocalTupleOrder(...args)
    },
  )

  const exactCursorCampaign2 = oraclePropertyOptions(
    300,
    `cursor.exact-local-order`,
  )
  randomCampaign(`cursor.exact-local-order`).prop(
    [exactCursorArbitrary],
    exactCursorCampaign2,
  )(
    `preserves exact-width nullable local tuple order for a random or replayed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(exactCursorCampaign2))
      return assertLocalTupleOrder(...args)
    },
  )

  const partialCursorFixedSeed = oracleFixedSeed(fixedSeed, {
    numRuns: oracleRuns(200),
  })
  fixedCampaign.prop([partialCursorArbitrary], partialCursorFixedSeed)(
    `uses one leading boundary value and rejects other mismatched widths for a fixed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(partialCursorFixedSeed))
      return assertCursorWidth(...args)
    },
  )

  const partialCursorCampaign = oraclePropertyOptions(
    200,
    `cursor.partial-width`,
  )
  randomCampaign(`cursor.partial-width`).prop(
    [partialCursorArbitrary],
    partialCursorCampaign,
  )(
    `uses one leading boundary value and rejects other mismatched widths for a random or replayed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(partialCursorCampaign))
      return assertCursorWidth(...args)
    },
  )

  const partialCursorFixedSeed2 = oracleFixedSeed(fixedSeed, {
    numRuns: oracleRuns(200),
  })
  fixedCampaign.prop([partialCursorArbitrary], partialCursorFixedSeed2)(
    `preserves partial-width nullable local tuple order for a fixed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(partialCursorFixedSeed2))
      return assertLocalTupleOrder(...args)
    },
  )

  const partialCursorCampaign2 = oraclePropertyOptions(
    200,
    `cursor.partial-local-order`,
  )
  randomCampaign(`cursor.partial-local-order`).prop(
    [partialCursorArbitrary],
    partialCursorCampaign2,
  )(
    `preserves partial-width nullable local tuple order for a random or replayed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(partialCursorCampaign2))
      return assertLocalTupleOrder(...args)
    },
  )

  const exactCursorFixedSeed3 = oracleFixedSeed(fixedSeed, {
    numRuns: oracleRuns(100),
  })
  fixedCampaign.prop([exactCursorArbitrary], exactCursorFixedSeed3)(
    `repeats the same cursor or unsupported-width error for a fixed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(exactCursorFixedSeed3))
      return assertRepeatedCursor(...args)
    },
  )

  const exactCursorCampaign3 = oraclePropertyOptions(
    100,
    `cursor.repeat-construction`,
  )
  randomCampaign(`cursor.repeat-construction`).prop(
    [exactCursorArbitrary],
    exactCursorCampaign3,
  )(
    `repeats the same cursor or unsupported-width error for a random or replayed seed`,
    (...args) => {
      oracleRoute(oracleRouteOf(exactCursorCampaign3))
      return assertRepeatedCursor(...args)
    },
  )
})
