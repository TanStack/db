// Stable query identity law: two query IRs, expression values, or demand keys
// share an identity only when they are equivalent under the relation that the
// checks below state. The output model, interpretOutputProgram, is a direct
// denotation of a finite literal and wrapper grammar. The generated checker
// and retained fixed/calibration judgments compare compiled outputs and their
// projected identities with that same denotation.
// The generated properties check canonical boolean forms, IN candidates as a
// set, alias renaming, and reference-valued captures against inputs they read.
// Fixed scenarios and literal identities live in ir-stable-identity.test.ts.
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  BaseQueryBuilder,
  createLiveQueryCollection,
  groupKeys,
  include,
  pooledLiveQueries,
} from '../../src/query/index.js'
import {
  GroupingOperatorRequiredError,
  IncludeOperatorRequiredError,
} from '../../src/errors.js'
import { getPreparedLiveQueryIdentity } from '../../src/live-query-options.js'
import { Query, getQueryIR } from '../../src/query/builder/index.js'
import { caseWhen, count, eq } from '../../src/query/builder/functions.js'
import { compileExpression } from '../../src/query/compiler/evaluators.js'
import {
  getLoadSubsetDemandKey,
  getQueryIdentity,
} from '../../src/query/ir-stable-identity.js'
import { Func, IncludesSubquery, PropRef, Value } from '../../src/query/ir.js'
import {
  oracleProperty,
  oracleReplayTest,
  oracleRoute,
  pass,
  violation,
} from '../oracle-config.js'
import { declareOracle } from '../oracle-declaration.js'
import {
  createAlphaRenamedIncludesQuery,
  createAlphaRenamedJoinQuery,
  createAlphaRenamedNestedQuery,
  createCorrelatedUnionIncludesQuery,
  createProfileValueQuery,
  createProjectedExpressionQuery,
  createUnionDerivedIncludesQuery,
  createUnionDerivedNestedOutputQuery,
  createUnionDerivedNestedQuery,
  getProjectedExpressionIdentity,
  postsCollection,
  usersCollection,
} from './ir-stable-identity-support.js'
import type { Observation, Verdict } from '../oracle-config.js'
import type { BasicExpression, QueryIR } from '../../src/query/ir.js'

const test = oracleReplayTest(it)

// These metamorphic laws specify relations, rather than one literal identity.
// Production identity strings can contain process-local reference handles, so
// the production driver records equality of those strings. The reference
// states which relations each authored transformation promises; the checker
// consumes every relation at its original key-construction/evaluation cut.
function checkIdentityRelations<TPlan>(
  _plan: TPlan,
  trace: ReadonlyArray<Observation>,
  expected: Readonly<Record<string, boolean | null>>,
): Verdict {
  for (const [checkpoint, relation] of Object.entries(expected)) {
    const observation = trace.find((entry) => entry.checkpoint === checkpoint)
    if (observation === undefined)
      return violation(
        `relations`,
        `the ${checkpoint} comparison is missing`,
        `identity relations`,
      )
    try {
      expect(observation.value, checkpoint).toBe(relation)
    } catch (error) {
      return {
        kind: `violation`,
        checkpoint,
        law: `identity relations`,
        difference: String(error),
        cause: error,
      }
    }
  }
  return pass
}

const referenceSemanticPairArbitrary = fc.oneof(
  fc
    .array(fc.integer())
    .map((values): [unknown, unknown] => [[...values], [...values]]),
  fc
    .dictionary(fc.string(), fc.integer())
    .map((value): [unknown, unknown] => [{ ...value }, { ...value }]),
  fc
    .array(fc.tuple(fc.string(), fc.integer()))
    .map((entries): [unknown, unknown] => [new Map(entries), new Map(entries)]),
  fc
    .array(fc.integer())
    .map((values): [unknown, unknown] => [new Set(values), new Set(values)]),
  fc
    .int16Array()
    .map((value): [unknown, unknown] => [
      new Int16Array(value),
      new Int16Array(value),
    ]),
)

const outputExpressionPairArbitrary: fc.Arbitrary<{
  first: BasicExpression
  second: BasicExpression
}> = fc.oneof(
  fc.integer().map((value) => ({
    first: new Value(value),
    second: new Value(value),
  })),
  fc.string().map((value) => ({
    first: new Func(`concat`, [new Value(value)]),
    second: new Func(`concat`, [new Value(value)]),
  })),
  fc.uint8Array({ minLength: 1, maxLength: 8 }).map((value) => ({
    first: new Func(`concat`, [new Value(Buffer.from(value))]),
    second: new Func(`concat`, [new Value(new Uint8Array(value))]),
  })),
  fc.constant({
    first: new Value(-0),
    second: new Value(0),
  }),
)

type OutputLiteralPair =
  | { kind: `integer`; value: number; same: boolean }
  | { kind: `string`; value: string; same: boolean }
  | { kind: `signed-zero` }
  | { kind: `binary`; bytes: Array<number>; same: boolean }
type OutputWrapper =
  | { kind: `concat`; suffix: string }
  | { kind: `coalesce` }
  | { kind: `caseWhen`; condition: boolean }
type OutputProgram = {
  literals: OutputLiteralPair
  wrappers: Array<OutputWrapper>
}

function outputLiterals(pair: OutputLiteralPair): [unknown, unknown] {
  switch (pair.kind) {
    case `integer`:
      return [pair.value, pair.value + (pair.same ? 0 : 1)]
    case `string`:
      return [pair.value, pair.same ? pair.value : `${pair.value}!`]
    case `signed-zero`:
      return [-0, 0]
    case `binary`: {
      const value = Buffer.from(pair.bytes)
      // Shared reference is intentional: literal projection preserves it.
      return [value, pair.same ? value : new Uint8Array(pair.bytes)]
    }
  }
}

function buildOutputProgram(
  value: unknown,
  wrappers: Array<OutputWrapper>,
): BasicExpression {
  let expression: BasicExpression = new Value(value)
  for (const wrapper of wrappers) {
    if (wrapper.kind === `concat`)
      expression = new Func(`concat`, [expression, new Value(wrapper.suffix)])
    else if (wrapper.kind === `coalesce`)
      expression = new Func(`coalesce`, [
        new Value(null),
        expression,
        new Value(`fallback`),
      ])
    else
      expression = new Func(`caseWhen`, [
        new Value(wrapper.condition),
        expression,
        new Value(`fallback`),
      ])
  }
  return expression
}

// Direct denotation of this finite grammar, independent of IR/evaluator/hash
// code. These literals never need concat's exceptional-object fallback.
function interpretOutputProgram(
  value: unknown,
  wrappers: Array<OutputWrapper>,
): unknown {
  return wrappers.reduce((current, wrapper) => {
    switch (wrapper.kind) {
      case `concat`:
        return String(current ?? ``) + wrapper.suffix
      case `coalesce`:
        return current ?? `fallback`
      case `caseWhen`:
        return wrapper.condition ? current : `fallback`
    }
  }, value)
}

function observeOutputProgram(program: OutputProgram) {
  return outputLiterals(program.literals).map((literal) => {
    const expression = buildOutputProgram(literal, program.wrappers)
    return {
      expected: interpretOutputProgram(literal, program.wrappers),
      actual: compileExpression(expression)({}),
      identity: getProjectedExpressionIdentity(expression),
    }
  })
}

function assertOutputProgram(
  observations: ReturnType<typeof observeOutputProgram>,
) {
  for (const { actual, expected } of observations) {
    expect(
      Object.is(actual, expected),
      `compiled output must match its own denotation`,
    ).toBe(true)
  }
  const [first, second] = observations
  expect(observations).toHaveLength(2)
  if (first!.identity === second!.identity) {
    expect(
      Object.is(first!.expected, second!.expected),
      `equal identities must preserve output`,
    ).toBe(true)
  }
  if (!Object.is(first!.expected, second!.expected)) {
    expect(first!.identity).not.toBe(second!.identity)
  }
}

type OutputPlan = { program: OutputProgram; literals: [unknown, unknown] }
// Object.is determines the literal reference slot. This grammar can return
// only a retained literal or a primitive; an unknown reference must mismatch.
// Encoding those relations keeps exact Buffer identity and signed zero visible
// without publishing opaque values as framework observation data.
function encodeOutputValue(value: unknown, literals: [unknown, unknown]) {
  const reference = literals.findIndex((literal) => Object.is(literal, value))
  if (reference >= 0) return { kind: `literal`, reference }
  if (
    value !== null &&
    (typeof value === `object` ||
      typeof value === `function` ||
      typeof value === `symbol`)
  )
    return { kind: `other reference` }
  return { kind: `value`, value }
}
function modelOutputProgram(plan: OutputPlan) {
  const values = plan.literals.map((literal) =>
    interpretOutputProgram(literal, plan.program.wrappers),
  )
  return {
    values: values.map((value) => encodeOutputValue(value, plan.literals)),
    sameOutput: Object.is(values[0], values[1]),
  }
}
function checkOutputProgram(
  _plan: OutputPlan,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelOutputProgram>,
): Verdict {
  const observation = trace.find(
    ({ checkpoint }) => checkpoint === `output denotation`,
  )
  if (observation === undefined)
    return violation(
      `output denotation`,
      `the composed-output comparison is missing`,
      `output denotation`,
    )
  const actual = observation.value as {
    values: Array<unknown>
    sameIdentity: boolean
  }
  try {
    expect(actual.values).toHaveLength(2)
    for (const [index, value] of actual.values.entries())
      expect(value, `compiled output must match its own denotation`).toEqual(
        expected.values[index],
      )
    if (actual.sameIdentity)
      expect(expected.sameOutput, `equal identities must preserve output`).toBe(
        true,
      )
    if (!expected.sameOutput) expect(actual.sameIdentity).toBe(false)
  } catch (error) {
    return {
      kind: `violation`,
      checkpoint: `output denotation`,
      law: `output denotation`,
      difference: String(error),
      cause: error,
    }
  }
  return pass
}

const outputProgramArbitrary: fc.Arbitrary<OutputProgram> = fc.record({
  literals: fc.oneof(
    fc.record({
      kind: fc.constant(`integer` as const),
      value: fc.integer({ min: -100, max: 100 }),
      same: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant(`string` as const),
      value: fc.string({ maxLength: 8 }),
      same: fc.boolean(),
    }),
    fc.constant({ kind: `signed-zero` as const }),
    fc.record({
      kind: fc.constant(`binary` as const),
      bytes: fc.array(fc.integer({ min: 0, max: 255 }), {
        minLength: 1,
        maxLength: 6,
      }),
      same: fc.boolean(),
    }),
  ),
  wrappers: fc.array(
    fc.oneof(
      fc.record({
        kind: fc.constant(`concat` as const),
        suffix: fc.string({ maxLength: 4 }),
      }),
      fc.constant({ kind: `coalesce` as const }),
      fc.record({
        kind: fc.constant(`caseWhen` as const),
        condition: fc.boolean(),
      }),
    ),
    { minLength: 1, maxLength: 3 },
  ),
})

declareOracle({
  check: [
    expectIdentitySharingMatchesOutcome,
    checkIdentityRelations,
    checkOutputProgram,
  ],
  model: [interpretOutputProgram, modelOutcome, modelOutputProgram],
})

describe(`semantic expression identity`, () => {
  const age = new PropRef<number>([`user`, `age`])
  const active = new PropRef<boolean>([`user`, `active`])
  type EquivalentExpressionPair = {
    original: BasicExpression<boolean>
    equivalent: BasicExpression<boolean>
  }

  const comparisonPairArbitrary: fc.Arbitrary<EquivalentExpressionPair> = fc
    .record({
      operator: fc.constantFrom<`gt` | `gte` | `lt` | `lte`>(
        `gt`,
        `gte`,
        `lt`,
        `lte`,
      ),
      threshold: fc.integer(),
    })
    .map(({ operator, threshold }) => {
      const inverse: Record<`gt` | `gte` | `lt` | `lte`, string> = {
        gt: `lt`,
        gte: `lte`,
        lt: `gt`,
        lte: `gte`,
      }
      return {
        original: new Func<boolean>(operator, [age, new Value(threshold)]),
        equivalent: new Func<boolean>(inverse[operator], [
          new Value(threshold),
          age,
        ]),
      }
    })
  const equalityPairArbitrary: fc.Arbitrary<EquivalentExpressionPair> = fc
    .boolean()
    .map((value) => ({
      original: new Func<boolean>(`eq`, [active, new Value(value)]),
      equivalent: new Func<boolean>(`eq`, [new Value(value), active]),
    }))
  const membershipPairArbitrary: fc.Arbitrary<EquivalentExpressionPair> = fc
    .uniqueArray(fc.integer(), { minLength: 1, maxLength: 8 })
    .map((values) => ({
      original: new Func<boolean>(`in`, [age, new Value(values)]),
      equivalent: new Func<boolean>(`in`, [
        age,
        new Value([...values].reverse().concat(values[0]!)),
      ]),
    }))
  const atomicExpressionPairArbitrary = fc.oneof(
    comparisonPairArbitrary,
    equalityPairArbitrary,
    membershipPairArbitrary,
  )
  const equivalentExpressionPairArbitrary = fc.oneof(
    { weight: 3, arbitrary: atomicExpressionPairArbitrary },
    {
      weight: 2,
      arbitrary: fc
        .tuple(
          fc.constantFrom(`and`, `or`),
          atomicExpressionPairArbitrary,
          atomicExpressionPairArbitrary,
        )
        .map(([operator, left, right]) => ({
          original: new Func<boolean>(operator, [
            left.original,
            new Func<boolean>(operator, [right.original, left.original]),
          ]),
          equivalent: new Func<boolean>(operator, [
            right.equivalent,
            left.equivalent,
          ]),
        })),
    },
  )

  oracleProperty({
    id: `ir-identity.canonical-expressions`,
    law: {
      statement: `The canonical expression transformations preserve both evaluation and projected identity.`,
      authority: `The semantic expression identity law stated at the start of this owner: inverse comparisons, commutative equality/membership and associative/idempotent boolean forms.`,
      limits: `The unchanged finite expression constructors and integer/boolean sample rows; no arbitrary expression language or SQL-null grammar.`,
    },
    owns: [
      'src/collection/index.ts',
      'src/live-query-options.ts#getPreparedLiveQueryIdentity',
      'src/query/compiler/evaluators.ts#compileExpression',
      'src/query/ir-stable-identity.ts#getLoadSubsetDemandKey',
      'src/query/ir-stable-identity.ts#getQueryIdentity',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/includes-runtime.ts',
      'src/query/pooled-live-query.ts',
    ],
    histories: {
      arbitrary: fc.tuple(
        equivalentExpressionPairArbitrary,
        fc.record({ age: fc.integer(), active: fc.boolean() }),
      ),
      runs: 100,
      fixedSeeds: [],
      states: [],
      constructed: [],
    },
    model: () => ({ semantics: true, identity: true }),
    driver: ([pair, sample], observe) => {
      const row = { user: sample }
      observe(
        `semantics`,
        Object.is(
          compileExpression(pair.original)(row),
          compileExpression(pair.equivalent)(row),
        ),
      )
      observe(
        `identity`,
        getProjectedExpressionIdentity(pair.original) ===
          getProjectedExpressionIdentity(pair.equivalent),
      )
    },
    check: checkIdentityRelations,
  })

  oracleProperty({
    id: `ir-identity.reference-expressions`,
    law: {
      statement: `Distinct reference-semantic captures stay distinct in expression evaluation, projected identity and demand identity.`,
      authority: `The reference-value identity contract stated above; separately allocated arrays, records, Maps, Sets and binary values are distinct captures.`,
      limits: `The unchanged five reference-pair constructors; no arbitrary object graph or cross-runtime identity claim.`,
    },
    owns: [
      'src/collection/index.ts',
      'src/live-query-options.ts#getPreparedLiveQueryIdentity',
      'src/query/compiler/evaluators.ts#compileExpression',
      'src/query/ir-stable-identity.ts#getLoadSubsetDemandKey',
      'src/query/ir-stable-identity.ts#getQueryIdentity',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/includes-runtime.ts',
      'src/query/pooled-live-query.ts',
    ],
    histories: {
      arbitrary: referenceSemanticPairArbitrary,
      runs: 100,
      fixedSeeds: [],
      states: [],
      constructed: [],
    },
    model: () => ({
      firstMatches: true,
      secondMatches: false,
      sameExpressionIdentity: false,
      sameDemandIdentity: false,
    }),
    driver: ([first, second], observe) => {
      const value = new PropRef<unknown>([`row`, `value`])
      const firstPredicate = new Func<boolean>(`eq`, [value, new Value(first)])
      const secondPredicate = new Func<boolean>(`eq`, [
        value,
        new Value(second),
      ])
      const row = { row: { value: first } }
      observe(`firstMatches`, compileExpression(firstPredicate)(row))
      observe(`secondMatches`, compileExpression(secondPredicate)(row))
      observe(
        `sameExpressionIdentity`,
        getProjectedExpressionIdentity(firstPredicate) ===
          getProjectedExpressionIdentity(secondPredicate),
      )
      observe(
        `sameDemandIdentity`,
        getLoadSubsetDemandKey({ where: firstPredicate, limit: 1 }) ===
          getLoadSubsetDemandKey({ where: secondPredicate, limit: 1 }),
      )
    },
    check: checkIdentityRelations,
  })

  const membershipHistories = fc.uniqueArray(
    fc.oneof(fc.integer(), fc.string(), fc.boolean()),
    { minLength: 1, maxLength: 8 },
  )
  oracleProperty({
    id: `ir-identity.membership-set`,
    law: {
      statement: `Reversing and repeating IN candidates preserves membership results, projected identity and demand identity.`,
      authority: `The existing IN-set identity law; each candidate matches, an independently fresh string does not, and nullish operands stay UNKNOWN.`,
      limits: `The unchanged one-to-eight unique finite primitive candidate grammar; no object or non-array membership claim.`,
    },
    owns: [
      'src/collection/index.ts',
      'src/live-query-options.ts#getPreparedLiveQueryIdentity',
      'src/query/compiler/evaluators.ts#compileExpression',
      'src/query/ir-stable-identity.ts#getLoadSubsetDemandKey',
      'src/query/ir-stable-identity.ts#getQueryIdentity',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/includes-runtime.ts',
      'src/query/pooled-live-query.ts',
    ],
    histories: {
      arbitrary: membershipHistories,
      runs: 100,
      fixedSeeds: [],
      states: [],
      constructed: [],
    },
    resolve: (candidates) => {
      let nonmember = `not a candidate`
      while (candidates.includes(nonmember)) nonmember += `!`
      return {
        candidates,
        operands: [...candidates, nonmember, null, undefined],
      }
    },
    model: ({ candidates }) => {
      const expected: Record<string, boolean | null> = {}
      for (let index = 0; index < candidates.length + 3; index++) {
        const result =
          index < candidates.length
            ? true
            : index === candidates.length
              ? false
              : null
        expected[`ordered ${index}`] = result
        expected[`reordered ${index}`] = result
      }
      expected.sameExpressionIdentity = true
      expected.sameDemandIdentity = true
      return expected
    },
    driver: ({ candidates, operands }, observe) => {
      const value = new PropRef<unknown>([`row`, `value`])
      const ordered = new Func<boolean>(`in`, [value, new Value(candidates)])
      const reordered = new Func<boolean>(`in`, [
        value,
        new Value([...candidates].reverse().concat(candidates[0]!)),
      ])
      for (const [index, candidate] of operands.entries()) {
        const row = { row: { value: candidate } }
        observe(`ordered ${index}`, compileExpression(ordered)(row))
        observe(`reordered ${index}`, compileExpression(reordered)(row))
      }
      observe(
        `sameExpressionIdentity`,
        getProjectedExpressionIdentity(ordered) ===
          getProjectedExpressionIdentity(reordered),
      )
      observe(
        `sameDemandIdentity`,
        getLoadSubsetDemandKey({ where: ordered }) ===
          getLoadSubsetDemandKey({ where: reordered }),
      )
    },
    check: checkIdentityRelations,
  })
})

describe(`stable QueryIR identity smoke test`, () => {
  oracleProperty({
    id: `ir-identity.lexical-aliases`,
    law: {
      statement: `Alpha-renaming source aliases preserves explicit join, nested-query and include identity.`,
      authority: `ARCHITECTURE.md's alpha-renaming law and the existing lexical-alias identity contract.`,
      limits: `The unchanged four-unique-alias grammar and three query constructors; no implicit output-shape or captured-shadowing claim.`,
    },
    owns: [
      'src/collection/index.ts',
      'src/live-query-options.ts#getPreparedLiveQueryIdentity',
      'src/query/compiler/evaluators.ts#compileExpression',
      'src/query/ir-stable-identity.ts#getLoadSubsetDemandKey',
      'src/query/ir-stable-identity.ts#getQueryIdentity',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/includes-runtime.ts',
      'src/query/pooled-live-query.ts',
    ],
    histories: {
      arbitrary: fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), {
        minLength: 4,
        maxLength: 4,
      }),
      runs: 100,
      fixedSeeds: [],
      states: [],
      constructed: [],
    },
    model: () => ({ join: true, nested: true, includes: true }),
    driver: ([firstUser, firstPost, secondUser, secondPost], observe) => {
      observe(
        `join`,
        getQueryIdentity(
          createAlphaRenamedJoinQuery(firstUser!, firstPost!),
        ) ===
          getQueryIdentity(
            createAlphaRenamedJoinQuery(secondUser!, secondPost!),
          ),
      )
      observe(
        `nested`,
        getQueryIdentity(
          createAlphaRenamedNestedQuery(firstUser!, firstPost!),
        ) ===
          getQueryIdentity(
            createAlphaRenamedNestedQuery(secondUser!, secondPost!),
          ),
      )
      observe(
        `includes`,
        getQueryIdentity(
          createAlphaRenamedIncludesQuery(firstUser!, firstPost!),
        ) ===
          getQueryIdentity(
            createAlphaRenamedIncludesQuery(secondUser!, secondPost!),
          ),
      )
    },
    check: checkIdentityRelations,
  })

  oracleProperty({
    id: `ir-identity.projected-results`,
    law: {
      statement: `Equal query identities imply Object.is-equal projected expression results.`,
      authority: `The output-preservation identity law stated above.`,
      limits: `The unchanged integer, string-concat, binary-concat and signed-zero expression-pair grammar; no converse identity promise.`,
    },
    owns: [
      'src/collection/index.ts',
      'src/live-query-options.ts#getPreparedLiveQueryIdentity',
      'src/query/compiler/evaluators.ts#compileExpression',
      'src/query/ir-stable-identity.ts#getLoadSubsetDemandKey',
      'src/query/ir-stable-identity.ts#getQueryIdentity',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/includes-runtime.ts',
      'src/query/pooled-live-query.ts',
    ],
    histories: {
      arbitrary: outputExpressionPairArbitrary,
      runs: 100,
      fixedSeeds: [],
      states: [],
      constructed: [],
    },
    model: () => ({ equalIdentityPreservesOutput: true }),
    driver: ({ first, second }, observe) => {
      const firstIdentity = getQueryIdentity(
        createProjectedExpressionQuery(first),
      )
      const secondIdentity = getQueryIdentity(
        createProjectedExpressionQuery(second),
      )
      observe(
        `equalIdentityPreservesOutput`,
        firstIdentity !== secondIdentity ||
          Object.is(
            compileExpression(first)({}),
            compileExpression(second)({}),
          ),
      )
    },
    check: checkIdentityRelations,
  })

  test(`preserves signed zero through coalesce and binary conversion through conditional output`, () => {
    oracleRoute(`fixed history`)
    assertOutputProgram(
      observeOutputProgram({
        literals: { kind: `signed-zero` },
        wrappers: [{ kind: `coalesce` }],
      }),
    )
    for (const condition of [false, true]) {
      assertOutputProgram(
        observeOutputProgram({
          literals: { kind: `binary`, bytes: [65], same: false },
          wrappers: [
            { kind: `concat`, suffix: `` },
            { kind: `caseWhen`, condition },
          ],
        }),
      )
    }
  })

  oracleProperty({
    id: `ir-identity.output-denotation`,
    law: {
      statement: `Each compiled literal/wrapper program matches its independent denotation, and equal projected identities preserve its exact output.`,
      authority: `The existing interpretOutputProgram denotation and output-sensitive identity law stated above.`,
      limits: `The unchanged literal-pair and one-to-three wrapper grammar; reference leaves are compared by Object.is and no arbitrary JavaScript evaluator claim follows.`,
    },
    owns: [
      'src/collection/index.ts',
      'src/live-query-options.ts#getPreparedLiveQueryIdentity',
      'src/query/compiler/evaluators.ts#compileExpression',
      'src/query/ir-stable-identity.ts#getLoadSubsetDemandKey',
      'src/query/ir-stable-identity.ts#getQueryIdentity',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/includes-runtime.ts',
      'src/query/pooled-live-query.ts',
    ],
    histories: {
      arbitrary: outputProgramArbitrary,
      runs: 200,
      fixedSeeds: [715031],
      states: [],
      constructed: [],
    },
    resolve: (program) => ({
      program,
      literals: outputLiterals(program.literals),
    }),
    model: modelOutputProgram,
    driver: (plan, observe) => {
      const observations = plan.literals.map((literal) => {
        const expression = buildOutputProgram(literal, plan.program.wrappers)
        return {
          actual: encodeOutputValue(
            compileExpression(expression)({}),
            plan.literals,
          ),
          identity: getProjectedExpressionIdentity(expression),
        }
      })
      observe(`output denotation`, {
        values: observations.map(({ actual }) => actual),
        sameIdentity: observations[0]!.identity === observations[1]!.identity,
      })
    },
    check: checkOutputProgram,
  })

  test.each([`shared-wrong-output`, `constant-identity`] as const)(
    `rejects ${`%s`} despite mutual agreement`,
    (fault) => {
      oracleRoute(`calibration`)
      const observations = observeOutputProgram({
        literals: { kind: `signed-zero` },
        wrappers: [{ kind: `coalesce` }],
      })
      assertOutputProgram(observations)
      if (fault === `shared-wrong-output`) {
        for (const observation of observations) observation.actual = 99
      } else {
        for (const observation of observations)
          observation.identity = `constant`
      }
      expect(() => assertOutputProgram(observations)).toThrowError(/expected/)
    },
  )

  oracleProperty({
    id: `ir-identity.union-output-aliases`,
    law: {
      statement: `Renaming an outer alias does not bind union-derived output fields as source references.`,
      authority: `The existing union-output identity law stated above and ARCHITECTURE.md's union result scope.`,
      limits: `The unchanged filtered alias grammar and four union-derived query constructors.`,
    },
    owns: [
      'src/collection/index.ts',
      'src/live-query-options.ts#getPreparedLiveQueryIdentity',
      'src/query/compiler/evaluators.ts#compileExpression',
      'src/query/ir-stable-identity.ts#getLoadSubsetDemandKey',
      'src/query/ir-stable-identity.ts#getQueryIdentity',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/includes-runtime.ts',
      'src/query/pooled-live-query.ts',
    ],
    histories: {
      arbitrary: fc
        .stringMatching(/^[a-z][a-z0-9]{0,8}$/)
        .filter(
          (alias) =>
            alias !== `kind` && alias !== `profile` && alias !== `userId`,
        ),
      runs: 100,
      fixedSeeds: [],
      states: [],
      constructed: [],
    },
    model: () => ({
      nested: true,
      nestedOutput: true,
      includes: true,
      correlated: true,
    }),
    driver: (alias, observe) => {
      observe(
        `nested`,
        getQueryIdentity(createUnionDerivedNestedQuery(`kind`)) ===
          getQueryIdentity(createUnionDerivedNestedQuery(alias)),
      )
      observe(
        `nestedOutput`,
        getQueryIdentity(createUnionDerivedNestedOutputQuery(`profile`)) ===
          getQueryIdentity(createUnionDerivedNestedOutputQuery(alias)),
      )
      observe(
        `includes`,
        getQueryIdentity(createUnionDerivedIncludesQuery(`userId`)) ===
          getQueryIdentity(createUnionDerivedIncludesQuery(alias)),
      )
      observe(
        `correlated`,
        getQueryIdentity(createCorrelatedUnionIncludesQuery(`profile`)) ===
          getQueryIdentity(createCorrelatedUnionIncludesQuery(alias)),
      )
    },
    check: checkIdentityRelations,
  })

  oracleProperty({
    id: `ir-identity.reference-queries`,
    law: {
      statement: `Queries with distinct reference-semantic captured values have distinct identity and match only their own capture.`,
      authority: `The existing captured-reference query identity law stated above.`,
      limits: `The unchanged reference-pair grammar and profile-equality query constructor.`,
    },
    owns: [
      'src/collection/index.ts',
      'src/live-query-options.ts#getPreparedLiveQueryIdentity',
      'src/query/compiler/evaluators.ts#compileExpression',
      'src/query/ir-stable-identity.ts#getLoadSubsetDemandKey',
      'src/query/ir-stable-identity.ts#getQueryIdentity',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/includes-runtime.ts',
      'src/query/pooled-live-query.ts',
    ],
    histories: {
      arbitrary: referenceSemanticPairArbitrary,
      runs: 100,
      fixedSeeds: [],
      states: [],
      constructed: [],
    },
    model: () => ({
      firstMatches: true,
      secondMatches: false,
      sameIdentity: false,
    }),
    driver: ([first, second], observe) => {
      const firstQuery = createProfileValueQuery(first)
      const secondQuery = createProfileValueQuery(second)
      const firstPredicate = firstQuery.where![0] as BasicExpression<boolean>
      const secondPredicate = secondQuery.where![0] as BasicExpression<boolean>
      const row = { user: { profile: first } }
      observe(`firstMatches`, compileExpression(firstPredicate)(row))
      observe(`secondMatches`, compileExpression(secondPredicate)(row))
      observe(
        `sameIdentity`,
        getQueryIdentity(firstQuery) === getQueryIdentity(secondQuery),
      )
    },
    check: checkIdentityRelations,
  })
})

type GroupBy = `none` | `bare` | `groupKeys`
type Agg = `none` | `built` | `stripped`
type Inc = `none` | `built` | `stripped`
type Outcome = `compiles` | `groupingRequired` | `includeRequired`

function modelOutcome(groupBy: GroupBy, agg: Agg, inc: Inc): Outcome {
  const grouping = groupBy === `groupKeys` || agg === `built`
  if ((groupBy !== `none` || agg !== `none`) && !grouping)
    return `groupingRequired`
  if (inc === `stripped`) return `includeRequired`
  return `compiles`
}

// The wide-product law: two identity functions may give one identity to two
// queries only when production compiles them to the same outcome. A shared
// identity lets a hook reuse the compiled query and hide the other's error.
// Each `identityOf` is a production identity function, and the outcomes are
// production's compile results, so this compares two production observations
// over every generated combination.
function expectIdentitySharingMatchesOutcome(
  built: ReadonlyArray<{ label: string; ir: QueryIR; outcome: string }>,
  identities: Record<string, (ir: QueryIR) => string>,
): void {
  for (const [name, identityOf] of Object.entries(identities)) {
    const byIdentity = new Map<string, { label: string; outcome: string }>()
    for (const { label, ir, outcome } of built) {
      const identity = identityOf(ir)
      const seen = byIdentity.get(identity)
      if (seen)
        expect(
          outcome,
          `${name} identity shared by ${seen.label} and ${label}`,
        ).toBe(seen.outcome)
      else byIdentity.set(identity, { label, outcome })
    }
  }
}

/**
 * Operator code is part of what a query means. Two queries with one identity
 * may share one compiled live query, so a query that compiles must never share
 * an identity with one that throws for missing operator code: a hook that
 * reuses the compiled query would hide the error. Authority: the opt-in
 * operator contract (a missing operator throws its coded error) and the
 * identity contract above, that equal identities imply equal results.
 *
 * The model predicts the compile outcome from the operator code alone. A
 * groupBy, or an aggregate, needs the grouping compiler, which `groupKeys()`
 * or any aggregate the query builds with `count()` brings. An include needs
 * its runtime. Hand-built IR may lack either. The check runs every
 * combination, compares each outcome with production, and then requires
 * distinct identities for each pair of combinations with different outcomes.
 * Combinations with equal outcomes may share an identity or not.
 */
describe(`operator-code identity`, () => {
  // A copy of an IR node without one field of operator code.
  const without = <T extends object>(node: T, field: string): T =>
    Object.assign(Object.create(Object.getPrototypeOf(node)), node, {
      [field]: undefined,
    })

  function buildIR(groupBy: GroupBy, agg: Agg, inc: Inc): QueryIR {
    const keys = ({ user }: any) => user.teamId
    let query: any = new Query().from({ user: usersCollection })
    if (groupBy === `bare`) query = query.groupBy(keys)
    if (groupBy === `groupKeys`) query = query.groupBy(groupKeys(keys))
    query = query.select(({ user }: any) => ({
      // A grouped select reads its key; one implicit group reads none.
      ...(groupBy === `none` ? {} : { teamId: user.teamId }),
      ...(agg === `none` ? {} : { n: count(user.id) }),
      ...(groupBy === `none` && agg === `none` ? { id: user.id } : {}),
      ...(inc === `none`
        ? {}
        : {
            posts: include(
              new Query()
                .from({ post: postsCollection })
                .where(({ post }) => eq(post.userId, user.id)),
            ),
          }),
    }))
    const ir = getQueryIR(query)
    const select = { ...ir.select! } as Record<string, any>
    if (agg === `stripped`) select.n = without(select.n, `grouping`)
    if (inc === `stripped`) select.posts = without(select.posts, `runtime`)
    return { ...ir, select }
  }

  function productionOutcome(ir: QueryIR): Outcome | `other` {
    try {
      createLiveQueryCollection({ query: new BaseQueryBuilder(ir) as any })
      return `compiles`
    } catch (error) {
      if (error instanceof GroupingOperatorRequiredError)
        return `groupingRequired`
      if (error instanceof IncludeOperatorRequiredError)
        return `includeRequired`
      return `other`
    }
  }

  // Includes beside a grouped select are outside this law; an include joins
  // only the ungrouped, aggregate-free shape.
  const cases = ([`none`, `bare`, `groupKeys`] as const).flatMap((groupBy) =>
    ([`none`, `built`, `stripped`] as const).flatMap((agg) =>
      (groupBy === `none` && agg === `none`
        ? ([`none`, `built`, `stripped`] as const)
        : ([`none`] as const)
      ).map((inc) => ({ groupBy, agg, inc })),
    ),
  )

  test(`keeps queries whose operator code changes the compile outcome distinct`, () => {
    oracleRoute(`fixed history`)
    const results = cases.map(({ groupBy, agg, inc }) => {
      const ir = buildIR(groupBy, agg, inc)
      const label = `${groupBy} groupBy, ${agg} aggregate, ${inc} include`
      const outcome = modelOutcome(groupBy, agg, inc)
      expect(productionOutcome(ir), `${label}: compile outcome`).toBe(outcome)
      return { label, outcome, identity: getQueryIdentity(ir) }
    })
    for (const a of results)
      for (const b of results)
        if (a.outcome !== b.outcome)
          expect(a.identity, `${a.label} vs ${b.label}`).not.toBe(b.identity)
  })

  /**
   * The wide product: every way the query can hold operator code, each
   * present or missing. The compile outcome here is production's own: the
   * law relates two separate functions, identity and compilation, and the
   * aggregate-select oracle owns which error each shape throws. Several
   * errors may apply to one shape, so a hand model would have to pick one.
   * Each identity function a hook uses must satisfy the law: the IR
   * identity, and the prepared identity with a pool, which takes a shortcut
   * for a query that a pool can serve.
   */
  type Slot = `none` | `built` | `stripped`
  type Include =
    | `none`
    | `field`
    | `field-stripped`
    | `case`
    | `case-stripped`
    | `child-aggregate`
    | `child-aggregate-stripped`
  type Wide = {
    groupBy: GroupBy
    select: Slot
    having: Slot
    orderBy: Slot
    include: Include
    // An `eq` filter and no select make a query that a pool can serve.
    poolable: boolean
  }

  // A deep copy that leaves out operator code: aggregates lose their
  // grouping compiler, includes their runtime. Neither enters an include's
  // child query.
  function strip(node: any, field: `grouping` | `runtime`): any {
    if (Array.isArray(node)) return node.map((item) => strip(item, field))
    if (node === null || typeof node !== `object`) return node
    if (node instanceof IncludesSubquery)
      return field === `runtime` ? without(node, `runtime`) : node
    // A ref's binding is not an own enumerable field, so refs and values
    // stay as they are.
    if (node instanceof PropRef || node instanceof Value) return node
    const copy = Object.create(Object.getPrototypeOf(node))
    for (const [key, value] of Object.entries(node))
      copy[key] =
        key === `collection` || key === `query` ? value : strip(value, field)
    if (field === `grouping` && `grouping` in node && `args` in node)
      copy.grouping = undefined
    return copy
  }

  function buildWide(w: Wide): QueryIR {
    const keys = ({ user }: any) => user.teamId
    const child = (user: any, aggregate: boolean) =>
      include(
        new Query()
          .from({ post: postsCollection })
          .where(({ post }) => eq(post.userId, user.id))
          .select(({ post }) =>
            aggregate ? { n: count(post.id) } : { id: post.id },
          ),
      )
    let query: any = new Query().from({ user: usersCollection })
    if (w.poolable) query = query.where(({ user }: any) => eq(user.teamId, `a`))
    if (w.groupBy === `bare`) query = query.groupBy(keys)
    if (w.groupBy === `groupKeys`) query = query.groupBy(groupKeys(keys))
    if (!w.poolable)
      query = query.select(({ user }: any) => ({
        // One implicit group selects only its aggregate.
        ...(w.groupBy !== `none`
          ? { teamId: user.teamId }
          : w.select === `none`
            ? { id: user.id }
            : {}),
        ...(w.select === `none` ? {} : { n: count(user.id) }),
        ...(w.include === `none`
          ? {}
          : {
              posts: w.include.startsWith(`case`)
                ? caseWhen(
                    eq(user.id, 1),
                    child(user, false),
                    child(user, false),
                  )
                : child(user, w.include.startsWith(`child-aggregate`)),
            }),
      }))
    if (w.having !== `none`)
      query = query.having(({ user }: any) => eq(count(user.id), 2))
    if (w.orderBy !== `none`)
      query = query.orderBy(({ user }: any) => count(user.id))
    const ir = getQueryIR(query)
    const select = ir.select && ({ ...ir.select } as Record<string, any>)
    if (select && w.select === `stripped`)
      select.n = strip(select.n, `grouping`)
    if (
      select &&
      (w.include === `field-stripped` || w.include === `case-stripped`)
    )
      select.posts = strip(select.posts, `runtime`)
    if (select && w.include === `child-aggregate-stripped`)
      select.posts = Object.assign(without(select.posts, `query`), {
        query: {
          ...select.posts.query,
          select: strip(select.posts.query.select, `grouping`),
        },
      })
    return {
      ...ir,
      ...(select ? { select } : {}),
      ...(w.having === `stripped`
        ? { having: strip(ir.having, `grouping`) }
        : {}),
      ...(w.orderBy === `stripped`
        ? { orderBy: strip(ir.orderBy, `grouping`) }
        : {}),
    }
  }

  function wideOutcome(ir: QueryIR): string {
    try {
      createLiveQueryCollection({ query: new BaseQueryBuilder(ir) as any })
      return `compiles`
    } catch (error) {
      return error instanceof Error ? error.constructor.name : `unknown`
    }
  }

  const slots = [`none`, `built`, `stripped`] as const
  const wideCases: Array<Wide> = []
  for (const groupBy of [`none`, `bare`, `groupKeys`] as const)
    for (const select of slots)
      for (const having of slots)
        for (const orderBy of slots)
          for (const inc of [
            `none`,
            `field`,
            `field-stripped`,
            `case`,
            `case-stripped`,
            `child-aggregate`,
            `child-aggregate-stripped`,
          ] as const)
            for (const poolable of [false, true])
              // A query without a select holds no select aggregate or include;
              // an include sits beside no aggregate or grouping, where it
              // could not compile anyway.
              if (
                (!poolable || (select === `none` && inc === `none`)) &&
                (inc === `none` || (groupBy === `none` && select === `none`))
              )
                wideCases.push({
                  groupBy,
                  select,
                  having,
                  orderBy,
                  include: inc,
                  poolable,
                })

  test(`keeps every operator-code variant with a different compile outcome distinct`, () => {
    oracleRoute(`case`)
    const identities = {
      ir: (ir: QueryIR) => getQueryIdentity(ir),
      pooled: (ir: QueryIR) =>
        JSON.stringify(
          getPreparedLiveQueryIdentity(
            new BaseQueryBuilder(ir),
            pooledLiveQueries,
          ),
        ),
    }
    const built = wideCases.map((w) => {
      const ir = buildWide(w)
      return { label: JSON.stringify(w), ir, outcome: wideOutcome(ir) }
    })
    // The product must reach each outcome the law separates.
    const outcomes = new Set(built.map(({ outcome }) => outcome))
    for (const expected of [
      `compiles`,
      `GroupingOperatorRequiredError`,
      `IncludeOperatorRequiredError`,
    ])
      expect(outcomes, `reaches ${expected}`).toContain(expected)
    expectIdentitySharingMatchesOutcome(built, identities)
  })
})
