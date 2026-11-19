import { fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { PropRef, Value } from '../src/query/ir.js'
import { buildCursor } from '../src/utils/cursor.js'
import { oracleProperty } from './oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
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
    oracleAssertion('expectCursorDenotation', () =>
      expect(() => build(orderBy(terms), [...boundary])).toThrow(
        `Only leading-column cursors are supported`,
      ),
    )
    return
  }
  const cursor = build(orderBy(terms), [...boundary])
  oracleAssertion('expectCursorDenotation', () => expect(cursor).toBeDefined())
  oracleAssertion('expectCursorDenotation', () =>
    expect(Boolean(evaluateReferenceExpression(cursor!, row(candidate)))).toBe(
      compareValue(candidate[0], boundary[0], terms[0]!) > 0,
    ),
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
        oracleAssertion('expectLocalTupleOrder', () =>
          expect(
            fault === `reverse-observed-order` && limit === 2
              ? actual?.slice().reverse()
              : actual,
          ).toEqual(expected.slice(0, limit)),
        )
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
      oracleAssertion(`unsupported repeated cursor width`, () =>
        expect(() => build(orderBy(terms), [...boundary])).toThrow(
          `Only leading-column cursors are supported`,
        ),
      )
    }
    return
  }
  oracleAssertion(`repeated cursor construction`, () =>
    expect(build(orderBy(terms), [...boundary])).toEqual(
      build(orderBy(terms), [...boundary]),
    ),
  )
}

// A calibration's wrong builder or observation must make the shared check
// throw. Each old calibration accepted any thrown Error, so exactly those
// rejections count as the check rejecting the wrong answer.
function acceptRejection(name: string, error: unknown): never {
  if (error instanceof Error) rejectAt(`calibration ${name}`, error)
  throw new Error(
    `${name}: the check threw a non-Error value, which the old calibration did not accept: ${String(error)}`,
  )
}

const cursorAuthority = `CursorExpressions.whereFrom API contract and ordered continuation in query/live/ARCHITECTURE.md`

// The two width-two boundary values that a composite-width builder must reject.
const compositeTerm: Term = { direction: `asc`, nulls: `last` }

// The fixed public-snapshot history: a leading tie ordered by a nullable
// trailing term.
const localOrderFixed: CursorCase = [
  [
    { direction: `asc`, nulls: `last` },
    { direction: `desc`, nulls: `first` },
  ],
  [0, 1],
  [0, null],
]

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
  oracleProperty({
    id: `cursor.scalar-matrix`,
    law: {
      statement: `A leading-column cursor denotes exactly the strict ordered suffix, including direction and null placement.`,
      authority: cursorAuthority,
      limits: `Every small scalar/null boundary and candidate pair under each of the four direction and null-placement cells.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: scalarTerms,
    label: ({ direction, nulls }) =>
      `checks every small scalar/null boundary for ${direction} / nulls ${nulls}`,
    resolve: (term) => ({ term }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`cursor.scalar-matrix`, plan, observe, () => {
        // All 49 pairs run under every option cell. Null and undefined remain
        // distinct driver inputs even though their ordering positions coincide.
        for (const boundary of scalarValues) {
          for (const candidate of scalarValues) {
            expectCursorDenotation([plan.term], [boundary], [candidate])
          }
        }
      }),
    check: forwardAssertionJudgment,
    // A constant predicate is a wrong builder: true admits the equal boundary
    // value, false drops the following one. The check must reject each.
    calibrations: scalarTerms.flatMap((term) => {
      const following = term.direction === `asc` ? 1 : -1
      const name = `rejects constant cursor predicates for ${term.direction} / nulls ${term.nulls}`
      return [
        {
          name: `${name}: constant true`,
          law: `cursor.scalar-matrix`,
          driver: (
            plan: { term: Term },
            observe: (checkpoint: string, value: unknown) => void,
          ) =>
            recordAssertionJudgment(
              `cursor.scalar-matrix`,
              plan,
              observe,
              () => {
                try {
                  expectCursorDenotation(
                    [term],
                    [0],
                    [0],
                    () => new Value(true),
                  )
                } catch (error) {
                  acceptRejection(name, error)
                }
              },
            ),
        },
        {
          name: `${name}: constant false`,
          law: `cursor.scalar-matrix`,
          driver: (
            plan: { term: Term },
            observe: (checkpoint: string, value: unknown) => void,
          ) =>
            recordAssertionJudgment(
              `cursor.scalar-matrix`,
              plan,
              observe,
              () => {
                try {
                  expectCursorDenotation(
                    [term],
                    [0],
                    [following],
                    () => new Value(false),
                  )
                } catch (error) {
                  acceptRejection(name, error)
                }
              },
            ),
        },
      ]
    }),
  })

  oracleProperty({
    id: `cursor.scalar-continuation`,
    law: {
      statement: `A leading-column cursor denotes exactly the strict ordered suffix, including direction and null placement.`,
      authority: `CursorExpressions.whereFrom API contract and ordered continuation in query/live/ARCHITECTURE.md`,
      limits: `The existing bounded nullable integer and order-term grammar; no provider ordering or paginated acquisition claim.`,
    },
    // What this oracle owns: the gap report judges buildCursor and its static
    // reference tree by this file's tests.
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: {
      arbitrary: scalarCursorArbitrary,
      runs: 400,
      fixedSeeds: [fixedSeed],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`cursor.scalar-continuation`, plan, observe, () =>
        assertScalarCursor(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `cursor.composite-width-matrix`,
    law: {
      statement: `One boundary value is supported; composite cursor values reject.`,
      authority: cursorAuthority,
      limits: `Composite widths 2, 3 and 4 with every term equal, under each of the four option cells.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: [2, 3, 4],
    label: (width) => `rejects composite width ${width} in every option cell`,
    resolve: (width) => ({ width }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `cursor.composite-width-matrix`,
        plan,
        observe,
        () => {
          for (const term of scalarTerms) {
            expectCursorDenotation(
              Array.from({ length: plan.width }, () => term),
              Array(plan.width).fill(0),
              Array(plan.width).fill(1),
            )
          }
        },
      ),
    check: forwardAssertionJudgment,
    calibrations: [
      {
        name: `rejects a builder that accepts two boundary values`,
        law: `cursor.composite-width-matrix`,
        driver: (plan, observe) =>
          recordAssertionJudgment(
            `cursor.composite-width-matrix`,
            plan,
            observe,
            () => {
              try {
                expectCursorDenotation(
                  [compositeTerm, compositeTerm],
                  [0, 0],
                  [1, 1],
                  () => new Value(true),
                )
              } catch (error) {
                acceptRejection(
                  `rejects a builder that accepts two boundary values`,
                  error,
                )
              }
            },
          ),
      },
    ],
  })

  oracleProperty({
    id: `cursor.leading-boundary-matrix`,
    law: {
      statement: `One leading boundary value remains legal with several order terms.`,
      authority: cursorAuthority,
      limits: `Two, three and four ascending nulls-last terms with one boundary value and candidates above and below it.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: [2, 3, 4],
    label: (width) =>
      `accepts one leading boundary value for ${width} ordered terms`,
    resolve: (width) => ({ width }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `cursor.leading-boundary-matrix`,
        plan,
        observe,
        () => {
          const terms = Array.from({ length: plan.width }, () => ({
            direction: `asc` as const,
            nulls: `last` as const,
          }))
          expectCursorDenotation(terms, [0], Array(plan.width).fill(1))
          expectCursorDenotation(terms, [0], Array(plan.width).fill(-1))
        },
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `cursor.local-order-fixed`,
    law: {
      statement: `The public snapshot orders nullable tuples by all authored terms after preload fulfills.`,
      authority: cursorAuthority,
      limits: `One fixed leading-tie history with a nullable descending trailing term, which the generated width grammars cannot take back.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: [localOrderFixed],
    label: () =>
      `orders a leading tie by a nullable trailing term in the public snapshot after preload fulfills`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`cursor.local-order-fixed`, plan, observe, () =>
        assertLocalTupleOrder(plan.history),
      ),
    check: forwardAssertionJudgment,
    // A leading-only order would place boundary first by the id tie-breaker.
    calibrations: [
      {
        name: `rejects a reversed observed order`,
        law: `cursor.local-order-fixed`,
        driver: (plan, observe) =>
          recordAssertionJudgment(
            `cursor.local-order-fixed`,
            plan,
            observe,
            async () => {
              const [terms, boundary, candidate] = localOrderFixed
              try {
                await expectLocalTupleOrder(
                  terms,
                  boundary,
                  candidate,
                  `reverse-observed-order`,
                )
              } catch (error) {
                acceptRejection(`rejects a reversed observed order`, error)
              }
            },
          ),
      },
    ],
  })

  oracleProperty({
    id: `cursor.exact-width`,
    law: {
      statement: `One boundary value is supported; composite cursor values reject.`,
      authority: `CursorExpressions.whereFrom API contract and ordered continuation in query/live/ARCHITECTURE.md`,
      limits: `The existing bounded nullable integer and order-term grammar; no provider ordering or paginated acquisition claim.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: {
      arbitrary: exactCursorArbitrary,
      runs: 300,
      fixedSeeds: [fixedSeed],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`cursor.exact-width`, plan, observe, () =>
        assertCursorWidth(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `cursor.exact-local-order`,
    law: {
      statement: `The public snapshot orders nullable tuples by all authored terms after preload fulfills.`,
      authority: `CursorExpressions.whereFrom API contract and ordered continuation in query/live/ARCHITECTURE.md`,
      limits: `The existing bounded nullable integer and order-term grammar; no provider ordering or paginated acquisition claim.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: {
      arbitrary: exactCursorArbitrary,
      runs: 300,
      fixedSeeds: [fixedSeed],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`cursor.exact-local-order`, plan, observe, () =>
        assertLocalTupleOrder(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `cursor.partial-width`,
    law: {
      statement: `One leading boundary value remains legal with several order terms; other mismatched widths reject.`,
      authority: `CursorExpressions.whereFrom API contract and ordered continuation in query/live/ARCHITECTURE.md`,
      limits: `The existing bounded nullable integer and order-term grammar; no provider ordering or paginated acquisition claim.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: {
      arbitrary: partialCursorArbitrary,
      runs: 200,
      fixedSeeds: [fixedSeed],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`cursor.partial-width`, plan, observe, () =>
        assertCursorWidth(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `cursor.partial-local-order`,
    law: {
      statement: `The public snapshot uses every authored order term even when boundary width differs.`,
      authority: `CursorExpressions.whereFrom API contract and ordered continuation in query/live/ARCHITECTURE.md`,
      limits: `The existing bounded nullable integer and order-term grammar; no provider ordering or paginated acquisition claim.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: {
      arbitrary: partialCursorArbitrary,
      runs: 200,
      fixedSeeds: [fixedSeed],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`cursor.partial-local-order`, plan, observe, () =>
        assertLocalTupleOrder(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `cursor.repeat-construction`,
    law: {
      statement: `Repeated cursor construction returns the same expression or the same unsupported-width rejection.`,
      authority: `CursorExpressions.whereFrom API contract and ordered continuation in query/live/ARCHITECTURE.md`,
      limits: `The existing bounded nullable integer and order-term grammar; no provider ordering or paginated acquisition claim.`,
    },
    owns: [`src/utils/cursor.ts#buildCursor`],
    histories: {
      arbitrary: exactCursorArbitrary,
      runs: 100,
      fixedSeeds: [fixedSeed],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`cursor.repeat-construction`, plan, observe, () =>
        assertRepeatedCursor(plan.history),
      ),
    check: forwardAssertionJudgment,
    calibrations: [
      {
        name: `rejects an unstable cursor expression on repeated construction`,
        law: `cursor.repeat-construction`,
        driver: (plan, observe) =>
          recordAssertionJudgment(
            `cursor.repeat-construction`,
            plan,
            observe,
            () => {
              let calls = 0
              try {
                assertRepeatedCursor(
                  [[{ direction: `asc`, nulls: `first` }], [0], [0]],
                  () => new Value(++calls === 1),
                )
              } catch (error) {
                acceptRejection(
                  `rejects an unstable cursor expression on repeated construction`,
                  error,
                )
              }
            },
          ),
      },
    ],
  })
})
