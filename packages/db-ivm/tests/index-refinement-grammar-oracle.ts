// The history grammar of the Index refinement oracle. The law, model,
// production driver, and check are in index-refinement-oracle.property.test.ts;
// index-refinement-grammar.test.ts checks this grammar's fixed-seed census.
// This module registers no tests and has no side effects.
import { fc } from '@fast-check/vitest'

export type Prefix = number | string | bigint
export type Value = [Prefix, number | string] | number | string
export type Addition = { key: `k1` | `k2`; value: Value; multiplicity: number }

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const prefixes: ReadonlyArray<Prefix> = [
  Number.NaN,
  0,
  -0,
  1,
  `1`,
  BigInt(1),
  `a`,
]

const valueArbitrary: fc.Arbitrary<Value> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .tuple(fc.constantFrom(...prefixes), fc.constantFrom(0, 1, `x`))
      .map(([prefix, payload]): Value => [prefix, payload]),
  },
  fc.constantFrom<Value>(5, 6, `u`),
)

// Reusing earlier values lets histories cancel what they added.
export const historyArbitrary: fc.Arbitrary<Array<Addition>> = fc
  .array(
    fc.record({
      key: fc.constantFrom(`k1` as const, `k2` as const),
      value: valueArbitrary,
      multiplicity: fc.constantFrom(-2, -1, 1, 2),
      repeat: fc.option(fc.nat({ max: 11 }), { nil: undefined }),
    }),
    { maxLength: 12 },
  )
  .map((steps) => {
    const additions: Array<Addition> = []
    for (const { key, value, multiplicity, repeat } of steps) {
      const earlier =
        repeat === undefined
          ? undefined
          : additions[repeat % (additions.length || 1)]
      additions.push(
        earlier === undefined
          ? { key, value, multiplicity }
          : {
              key: earlier.key,
              value: earlier.value,
              multiplicity: -earlier.multiplicity,
            },
      )
    }
    return additions
  })
