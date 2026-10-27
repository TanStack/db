import { describe, expect, it } from 'vitest'
import { compileExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, Value } from '../../../src/query/ir.js'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../oracle-config.js'

/**
 * # Does the LIKE evaluator preserve wildcard meaning without regex work?
 *
 * Contract: `like` and `ilike` match the complete string. `%` consumes zero or
 * more UTF-16 code units, `_` consumes exactly one, and every other code unit
 * is literal. `ilike` applies the evaluator's established lowercase fold.
 *
 * Model: `referenceLike` uses a dynamic program, not production's two-pointer
 * walk. It predicts only the boolean result for non-null strings.
 *
 * History grammar: each case contains a value, a pattern, and a case-fold flag.
 * The small alphabet concentrates on literal/wildcard precedence, `_`, case,
 * newlines, and non-ASCII code units. Every generated string is legal. Pinned
 * witnesses reconstruct the reported `%` collision; removing `%` removes that
 * distinction, while empty and literal-only cases exercise its boundaries.
 *
 * Production driver: compile a public `like` or `ilike` expression and invoke
 * it at the synchronous evaluator boundary.
 *
 * Refinement check: production and the model must return the same boolean for
 * every fixed, random, or replayed case. The recorder retains the seed and the
 * first five mismatches. A deliberate wrong-result control proves that the
 * comparison rejects the literal-before-wildcard regression. Nullish SQL
 * three-valued logic and broader Unicode folding remain in focused unit tests
 * in evaluators.test.ts.
 */
type LikeCase = {
  value: string
  pattern: string
  caseInsensitive: boolean
}

type LikeMismatch = LikeCase & {
  expected: boolean
  actual: boolean
}

const FIXED_LIKE_ORACLE_SEED = 0x1745
const likeProperty = `evaluators.like`
const LIKE_ORACLE_RUNS = oracleRuns(10_000)
const likeCalibrationCases: Array<LikeCase> = [
  { value: ``, pattern: ``, caseInsensitive: false },
  { value: `A`, pattern: `a`, caseInsensitive: true },
  { value: `anything`, pattern: `%`, caseInsensitive: false },
  { value: `a`, pattern: `_`, caseInsensitive: true },
  { value: `100% done`, pattern: `100%done`, caseInsensitive: false },
]

// The fixed campaign stands aside during a path replay. The random campaign uses
// the seed of a replay of this property, when TANSTACK_DB_ORACLE_SEED supplies
// one. This generator has no shrink path, so a path replay only reseeds it.
const likeOracleCampaigns = [
  {
    name: `fixed`,
    test: oracleReplayTest(it),
    seed: FIXED_LIKE_ORACLE_SEED,
  },
  {
    name: `random`,
    test: oracleReplayTest(it, likeProperty),
    seed:
      oraclePropertyOptions(10_000, likeProperty).seed ??
      Math.floor(Math.random() * 0x1_0000_0000),
  },
]

function referenceLike(
  value: string,
  pattern: string,
  caseInsensitive: boolean,
): boolean {
  const searchValue = caseInsensitive ? value.toLowerCase() : value
  const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern
  let previous = new Array<boolean>(searchPattern.length + 1).fill(false)
  previous[0] = true

  for (
    let patternIndex = 1;
    patternIndex <= searchPattern.length;
    patternIndex++
  ) {
    previous[patternIndex] =
      searchPattern[patternIndex - 1] === `%` && previous[patternIndex - 1]!
  }

  for (let valueIndex = 1; valueIndex <= searchValue.length; valueIndex++) {
    const current = new Array<boolean>(searchPattern.length + 1).fill(false)
    for (
      let patternIndex = 1;
      patternIndex <= searchPattern.length;
      patternIndex++
    ) {
      const patternCharacter = searchPattern[patternIndex - 1]
      current[patternIndex] =
        patternCharacter === `%`
          ? current[patternIndex - 1]! || previous[patternIndex]!
          : (patternCharacter === `_` ||
              patternCharacter === searchValue[valueIndex - 1]) &&
            previous[patternIndex - 1]!
    }
    previous = current
  }

  return previous[searchPattern.length]!
}

function* seededLikeCases(count: number, seed: number): Generator<LikeCase> {
  // Repeated wildcard entries keep the bounded campaign concentrated on the
  // precedence boundary while retaining literals, case folds, and newlines.
  const alphabet = [`a`, `b`, `A`, `B`, `%`, `%`, `%`, `_`, `_`, `.`, `\n`, `é`]
  let state = seed
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  const pick = (exclusiveUpperBound: number) =>
    Math.floor((next() / 0x1_0000_0000) * exclusiveUpperBound)
  const build = (length: number) => {
    let result = ``
    for (let index = 0; index < length; index++) {
      result += alphabet[pick(alphabet.length)]
    }
    return result
  }

  yield* likeCalibrationCases
  for (let index = likeCalibrationCases.length; index < count; index++) {
    const value = build(pick(8))
    const pattern = build(pick(8))
    yield { value, pattern, caseInsensitive: pick(2) === 1 }
  }
}

function evaluateLikeWithProduction(testCase: LikeCase): boolean {
  const functionName = testCase.caseInsensitive ? `ilike` : `like`
  return compileExpression(
    new Func(functionName, [
      new Value(testCase.value),
      new Value(testCase.pattern),
    ]),
  )({})
}

function findLikeMismatch(
  testCase: LikeCase,
  actual: boolean,
): LikeMismatch | undefined {
  const expected = referenceLike(
    testCase.value,
    testCase.pattern,
    testCase.caseInsensitive,
  )
  return actual === expected ? undefined : { ...testCase, expected, actual }
}

declareOracle({
  check: [findLikeMismatch],
  model: [referenceLike],
  grammar: [seededLikeCases],
})

describe(`evaluators`, () => {
  describe(`compileExpression`, () => {
    describe(`function compilation`, () => {
      describe(`like/ilike functions`, () => {
        it(`rejects the literal-before-wildcard wrong result`, () => {
          const witness: LikeCase = {
            value: `100% done`,
            pattern: `100%done`,
            caseInsensitive: false,
          }

          expect(
            findLikeMismatch(witness, evaluateLikeWithProduction(witness)),
          ).toBeUndefined()
          expect(findLikeMismatch(witness, false)).toEqual({
            ...witness,
            expected: true,
            actual: false,
          })
        })

        for (const campaign of likeOracleCampaigns)
          campaign.test(
            `matches the LIKE law in the ${campaign.name} campaign`,
            () => {
              const { seed } = campaign
              let mismatchCount = 0
              const mismatchSamples: Array<LikeMismatch> = []
              const reach = {
                caseSensitive: 0,
                caseInsensitive: 0,
                percentPattern: 0,
                underscorePattern: 0,
                literalPattern: 0,
              }

              for (const testCase of seededLikeCases(LIKE_ORACLE_RUNS, seed)) {
                reach[
                  testCase.caseInsensitive ? `caseInsensitive` : `caseSensitive`
                ]++
                if (testCase.pattern.includes(`%`)) reach.percentPattern++
                if (testCase.pattern.includes(`_`)) reach.underscorePattern++
                if (/[^%_]/u.test(testCase.pattern)) reach.literalPattern++

                const mismatch = findLikeMismatch(
                  testCase,
                  evaluateLikeWithProduction(testCase),
                )
                if (mismatch !== undefined) {
                  mismatchCount++
                  if (mismatchSamples.length < 5) {
                    mismatchSamples.push(mismatch)
                  }
                }
              }

              expect({ seed, mismatchCount, mismatchSamples }).toEqual({
                seed,
                mismatchCount: 0,
                mismatchSamples: [],
              })
              expect(
                Object.entries(reach).filter(([, count]) => count === 0),
              ).toEqual([])
            },
          )
      })
    })
  })
})
