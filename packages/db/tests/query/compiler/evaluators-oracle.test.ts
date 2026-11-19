import fc from 'fast-check'
import { compileExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, Value } from '../../../src/query/ir.js'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../oracle-config.js'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
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
 * newlines, and non-ASCII code units. Every generated string is legal. Fixed
 * histories reconstruct the reported `%` collision; removing `%` removes that
 * distinction, while empty and literal-only cases exercise its boundaries.
 *
 * Production driver: compile a public `like` or `ilike` expression and invoke
 * it at the synchronous evaluator boundary.
 *
 * Refinement check: production and the model must return the same boolean for
 * every fixed, random, or replayed case. The shared runner retains seed/path
 * coordinates and the first named mismatch. A deliberate wrong-result control proves that the
 * comparison rejects the literal-before-wildcard regression. Nullish SQL
 * three-valued logic and broader Unicode folding remain in focused unit tests
 * in evaluators.test.ts.
 */
type LikeCase = { value: string; pattern: string; caseInsensitive: boolean }

const likeCalibrationCases: Array<LikeCase> = [
  { value: ``, pattern: ``, caseInsensitive: false },
  { value: `A`, pattern: `a`, caseInsensitive: true },
  { value: `anything`, pattern: `%`, caseInsensitive: false },
  { value: `a`, pattern: `_`, caseInsensitive: true },
  { value: `100% done`, pattern: `100%done`, caseInsensitive: false },
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

// The original random language has strings of zero to seven code units.
// The five pre-existing fixed histories supply the additional literal strings.
// Separate string choices let those histories share this grammar without
// turning a whole fixed history into generated reach.
const alphabet = [`a`, `b`, `A`, `B`, `%`, `%`, `%`, `_`, `_`, `.`, `\n`, `é`]
const boundedString = fc.string({
  unit: fc.constantFrom(...alphabet),
  maxLength: 7,
})
const likeCase: fc.Arbitrary<LikeCase> = fc.record({
  value: fc.oneof(
    boundedString,
    fc.constantFrom(...likeCalibrationCases.map(({ value }) => value)),
  ),
  pattern: fc.oneof(
    boundedString,
    fc.constantFrom(...likeCalibrationCases.map(({ pattern }) => pattern)),
  ),
  caseInsensitive: fc.boolean(),
})

// These obligations belong only to the test construction. Every fresh build,
// including a shrunk build, must enter its states during the real evaluation.
const constructionRequirements = new WeakMap<LikeCase, ReadonlyArray<string>>()
function constructed(
  builders: ReadonlyArray<ConstructedHistory<LikeCase>>,
): ReadonlyArray<ConstructedHistory<LikeCase>> {
  return builders.map((builder) => ({
    ...builder,
    build: (history) => {
      const result = { ...builder.build(history) }
      constructionRequirements.set(result, [...builder.enters])
      return result
    },
  }))
}

function bounded(history: LikeCase): LikeCase {
  const retain = (text: string) =>
    [...text]
      .filter((unit) => alphabet.includes(unit))
      .slice(0, 7)
      .join(``)
  return {
    ...history,
    value: retain(history.value),
    pattern: retain(history.pattern),
  }
}

function isPercentCollision({ value, pattern }: LikeCase): boolean {
  return (
    value.startsWith(`%%`) &&
    pattern.startsWith(`%`) &&
    pattern.length > 1 &&
    value.slice(2) === pattern.slice(1)
  )
}

function modelLike(history: LikeCase) {
  return {
    result: referenceLike(
      history.value,
      history.pattern,
      history.caseInsensitive,
    ),
    requiredStates: constructionRequirements.get(history) ?? [],
  }
}

// Record the uncoerced result. A malformed mutant result reaches the same
// boolean judgment rather than throwing during observation or becoming false.
function driveLike(
  history: LikeCase,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  const name = history.caseInsensitive ? `ilike` : `like`
  const actual = compileExpression(
    new Func(name, [new Value(history.value), new Value(history.pattern)]),
  )({})
  observe(`evaluation returned`, actual)
  observe(
    `reach`,
    history.caseInsensitive ? `case insensitive` : `case sensitive`,
  )
  if (history.pattern.includes(`%`)) observe(`reach`, `percent pattern`)
  if (history.pattern.includes(`_`)) observe(`reach`, `underscore pattern`)
  if (/[^%_]/u.test(history.pattern)) observe(`reach`, `literal pattern`)
  if (isPercentCollision(history)) observe(`reach`, `percent literal collision`)
}

// Product judgment precedes construction completeness. The virtual checkpoint
// cannot replace a driver error after an observed evaluation return.
function checkLike(
  _history: LikeCase,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelLike>,
): Verdict {
  const returned = trace.find(
    ({ checkpoint }) => checkpoint === `evaluation returned`,
  )
  if (returned === undefined)
    return violation(
      `evaluation returned`,
      `the evaluator did not return`,
      `LIKE result`,
    )
  const mismatch = differs(
    `evaluation returned`,
    `LIKE result`,
    returned.value,
    expected.result,
  )
  if (mismatch !== undefined) return mismatch
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  const missing = expected.requiredStates.filter((state) => !reached.has(state))
  return missing.length === 0
    ? pass
    : violation(
        `constructed states`,
        `constructed history did not enter ${missing.join(`, `)}`,
        `constructed reach`,
      )
}

oracleProperty({
  id: `evaluators.like`,
  law: {
    statement: `LIKE and ILIKE match the complete string, with percent consuming zero or more UTF-16 code units and underscore consuming one.`,
    authority: `The LIKE/ILIKE contract in evaluators.ts and the Structural values and ordered primitives coverage owner.`,
    limits: `The existing bounded alphabet and fixed string witnesses; boolean matching only. No nullish three-valued logic, general Unicode collation, or work-bound claim.`,
  },
  owns: [`src/query/compiler/evaluators.ts#compileExpression`],
  histories: {
    arbitrary: likeCase,
    runs: 10_000,
    fixedSeeds: [0x1745],
    fixed: likeCalibrationCases.map((history, index) => ({
      name: `original wildcard boundary ${index}`,
      history,
    })),
    states: [
      `case sensitive`,
      `case insensitive`,
      `percent pattern`,
      `underscore pattern`,
      `literal pattern`,
      `percent literal collision`,
    ],
    constructed: constructed([
      ...([false, true] as const).map((caseInsensitive) => ({
        name: caseInsensitive ? `case insensitive` : `case sensitive`,
        enters: [caseInsensitive ? `case insensitive` : `case sensitive`],
        build: (history: LikeCase) => ({ ...history, caseInsensitive }),
      })),
      ...([`%`, `_`, `a`] as const).map((unit) => ({
        name: `pattern contains ${unit}`,
        enters: [
          unit === `%`
            ? `percent pattern`
            : unit === `_`
              ? `underscore pattern`
              : `literal pattern`,
        ],
        build: (history: LikeCase) => {
          const result = bounded(history)
          return { ...result, pattern: unit + result.pattern.slice(0, 6) }
        },
      })),
      {
        name: `percent collision with a generated literal suffix`,
        enters: [
          `percent pattern`,
          `literal pattern`,
          `percent literal collision`,
        ],
        build: (history) => {
          const result = bounded(history)
          const suffix = result.pattern.replace(/[%_]/gu, ``).slice(0, 3) + `a`
          return { ...result, value: `%%${suffix}`, pattern: `%${suffix}` }
        },
      },
    ]),
  },
  model: modelLike,
  driver: driveLike,
  check: checkLike,
  calibrations: [
    {
      name: `literal-before-wildcard wrong result`,
      law: `LIKE result`,
      corrupt: (trace, history) =>
        history.value === `100% done` &&
        history.pattern === `100%done` &&
        !history.caseInsensitive
          ? trace.map((entry) =>
              entry.checkpoint === `evaluation returned`
                ? { ...entry, value: false }
                : entry,
            )
          : undefined,
    },
    {
      name: `misses a generated percent collision`,
      law: `LIKE result`,
      corrupt: (trace, history) =>
        isPercentCollision(history)
          ? trace.map((entry) =>
              entry.checkpoint === `evaluation returned`
                ? { ...entry, value: false }
                : entry,
            )
          : undefined,
    },
    {
      name: `omits a constructed state`,
      law: `constructed reach`,
      corrupt: (trace, history) => {
        const state = modelLike(history).requiredStates[0]
        return state === undefined
          ? undefined
          : trace.filter(
              (entry) => entry.checkpoint !== `reach` || entry.value !== state,
            )
      },
    },
  ],
})
