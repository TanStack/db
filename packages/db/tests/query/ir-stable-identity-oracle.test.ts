// Stable query identity law: two query IRs, expression values, or demand keys
// share an identity only when they are equivalent under the relation that the
// checks below state. The output model, interpretOutputProgram, is a direct
// denotation of a finite literal and wrapper grammar. assertOutputProgram
// compares each observation's compiled output and projected identity with that
// denotation, so the generated programs and their calibrations run through it.
// The generated properties check canonical boolean forms, IN candidates as a
// set, alias renaming, and reference-valued captures against inputs they read.
// Fixed scenarios and literal identities live in ir-stable-identity.test.ts.
import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { compileExpression } from '../../src/query/compiler/evaluators.js'
import {
  getLoadSubsetDemandKey,
  getQueryIdentity,
} from '../../src/query/ir-stable-identity.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { declareOracle, oracleRuns } from '../oracle-config.js'
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
} from './ir-stable-identity-support.js'
import type { BasicExpression } from '../../src/query/ir.js'

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
  check: [assertOutputProgram],
  model: [interpretOutputProgram],
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

  fcTest.prop([
    equivalentExpressionPairArbitrary,
    fc.record({ age: fc.integer(), active: fc.boolean() }),
  ])(`canonical expression grammar preserves semantics`, (pair, sample) => {
    const row = { user: sample }

    expect(compileExpression(pair.original)(row)).toBe(
      compileExpression(pair.equivalent)(row),
    )
    expect(getProjectedExpressionIdentity(pair.original)).toBe(
      getProjectedExpressionIdentity(pair.equivalent),
    )
  })

  fcTest.prop([referenceSemanticPairArbitrary])(
    `keeps reference-semantic values distinct across expression and demand identity`,
    ([first, second]) => {
      const value = new PropRef<unknown>([`row`, `value`])
      const firstPredicate = new Func<boolean>(`eq`, [value, new Value(first)])
      const secondPredicate = new Func<boolean>(`eq`, [
        value,
        new Value(second),
      ])
      const row = { row: { value: first } }

      expect(compileExpression(firstPredicate)(row)).toBe(true)
      expect(compileExpression(secondPredicate)(row)).toBe(false)
      expect(getProjectedExpressionIdentity(firstPredicate)).not.toBe(
        getProjectedExpressionIdentity(secondPredicate),
      )
      expect(
        getLoadSubsetDemandKey({ where: firstPredicate, limit: 1 }),
      ).not.toBe(getLoadSubsetDemandKey({ where: secondPredicate, limit: 1 }))
    },
  )

  fcTest.prop([
    fc.uniqueArray(fc.oneof(fc.integer(), fc.string(), fc.boolean()), {
      minLength: 1,
      maxLength: 8,
    }),
  ])(`treats IN candidates as a set`, (candidates) => {
    const value = new PropRef<unknown>([`row`, `value`])
    const ordered = new Func<boolean>(`in`, [value, new Value(candidates)])
    const reordered = new Func<boolean>(`in`, [
      value,
      new Value([...candidates].reverse().concat(candidates[0]!)),
    ])

    let nonmember = `not a candidate`
    while (candidates.includes(nonmember)) nonmember += `!`

    // Mutual agreement alone would also accept two always-true evaluators.
    // These finite, non-null candidates give us independent literal answers.
    const cases: Array<readonly [unknown, boolean | null]> = [
      ...candidates.map((candidate) => [candidate, true] as const),
      [nonmember, false],
      [null, null],
      [undefined, null],
    ]
    for (const [candidate, expected] of cases) {
      const row = { row: { value: candidate } }
      expect(compileExpression(ordered)(row)).toBe(expected)
      expect(compileExpression(reordered)(row)).toBe(expected)
    }
    expect(getProjectedExpressionIdentity(ordered)).toBe(
      getProjectedExpressionIdentity(reordered),
    )
    expect(getLoadSubsetDemandKey({ where: ordered })).toBe(
      getLoadSubsetDemandKey({ where: reordered }),
    )
  })
})

describe(`stable QueryIR identity smoke test`, () => {
  fcTest.prop([
    fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/), {
      minLength: 4,
      maxLength: 4,
    }),
  ])(`does not depend on lexical source aliases`, (aliases) => {
    const [firstUser, firstPost, secondUser, secondPost] = aliases

    expect(
      getQueryIdentity(createAlphaRenamedJoinQuery(firstUser!, firstPost!)),
    ).toBe(
      getQueryIdentity(createAlphaRenamedJoinQuery(secondUser!, secondPost!)),
    )
    expect(
      getQueryIdentity(createAlphaRenamedNestedQuery(firstUser!, firstPost!)),
    ).toBe(
      getQueryIdentity(createAlphaRenamedNestedQuery(secondUser!, secondPost!)),
    )
    expect(
      getQueryIdentity(createAlphaRenamedIncludesQuery(firstUser!, firstPost!)),
    ).toBe(
      getQueryIdentity(
        createAlphaRenamedIncludesQuery(secondUser!, secondPost!),
      ),
    )
  })

  fcTest.prop([outputExpressionPairArbitrary])(
    `equal query identities imply equal projected expression results`,
    ({ first, second }) => {
      const firstIdentity = getQueryIdentity(
        createProjectedExpressionQuery(first),
      )
      const secondIdentity = getQueryIdentity(
        createProjectedExpressionQuery(second),
      )

      if (firstIdentity === secondIdentity) {
        expect(
          Object.is(
            compileExpression(first)({}),
            compileExpression(second)({}),
          ),
        ).toBe(true)
      }
    },
  )

  it(`preserves signed zero through coalesce and binary conversion through conditional output`, () => {
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

  fcTest.prop([outputProgramArbitrary], { numRuns: 200, seed: 715031 })(
    `matches output denotation through composed contexts with a fixed seed`,
    (program) => assertOutputProgram(observeOutputProgram(program)),
  )
  fcTest.prop([outputProgramArbitrary], { numRuns: oracleRuns(200) })(
    `matches output denotation through random composed contexts`,
    (program) => assertOutputProgram(observeOutputProgram(program)),
  )

  it.each([`shared-wrong-output`, `constant-identity`] as const)(
    `rejects ${`%s`} despite mutual agreement`,
    (fault) => {
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

  fcTest.prop([
    fc
      .stringMatching(/^[a-z][a-z0-9]{0,8}$/)
      .filter(
        (alias) =>
          alias !== `kind` && alias !== `profile` && alias !== `userId`,
      ),
  ])(`does not bind union-derived output fields to outer aliases`, (alias) => {
    expect(getQueryIdentity(createUnionDerivedNestedQuery(`kind`))).toBe(
      getQueryIdentity(createUnionDerivedNestedQuery(alias)),
    )
    expect(
      getQueryIdentity(createUnionDerivedNestedOutputQuery(`profile`)),
    ).toBe(getQueryIdentity(createUnionDerivedNestedOutputQuery(alias)))
    expect(getQueryIdentity(createUnionDerivedIncludesQuery(`userId`))).toBe(
      getQueryIdentity(createUnionDerivedIncludesQuery(alias)),
    )
    expect(
      getQueryIdentity(createCorrelatedUnionIncludesQuery(`profile`)),
    ).toBe(getQueryIdentity(createCorrelatedUnionIncludesQuery(alias)))
  })

  fcTest.prop([referenceSemanticPairArbitrary])(
    `keeps queries distinct when captured values compare by reference`,
    ([first, second]) => {
      const firstQuery = createProfileValueQuery(first)
      const secondQuery = createProfileValueQuery(second)
      const firstPredicate = firstQuery.where![0] as BasicExpression<boolean>
      const secondPredicate = secondQuery.where![0] as BasicExpression<boolean>
      const row = { user: { profile: first } }

      expect(compileExpression(firstPredicate)(row)).toBe(true)
      expect(compileExpression(secondPredicate)(row)).toBe(false)
      expect(getQueryIdentity(firstQuery)).not.toBe(
        getQueryIdentity(secondQuery),
      )
    },
  )
})
