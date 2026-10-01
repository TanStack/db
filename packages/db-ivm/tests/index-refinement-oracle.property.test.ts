/**
 * # Does an Index hold exactly the summed multiplicity of each value?
 *
 * Law and source: an `Index` maps each key to a multiset of values. Adding
 * `[value, m]` changes that value's multiplicity by `m`, and `get(key)` returns
 * each value whose summed multiplicity is not zero. Two values are the same
 * when they have the same structural identity, the identity that `hash` and
 * `MultiSet.consolidate` use: `NaN` equals `NaN`, `-0` equals `0`, and values
 * of different types differ. Join, reduce, orderBy, and top-K store their
 * state in an `Index`, so this law carries every operator that keys rows by
 * source key.
 *
 * Why an example can miss the failure: the Index stores an array value whose
 * first element is a string, number, or bigint under that element, the
 * prefix, and compares prefixes before hashing. Integer and string prefixes
 * behave, so a prefix comparison that disagrees with the `Map` holding the
 * prefixes shows only for `NaN`, which a `Map` treats as one key and `===`
 * does not.
 *
 * Model: `expectedIndex` sums multiplicities in plain `Map`s under a string
 * identity built from each value's type and printed value. It does not call
 * the Index, `hash`, or the prefix helper.
 *
 * History grammar: up to twelve additions to two keys. Values are prefixed
 * arrays `[prefix, payload]` with prefixes `NaN`, `0`, `-0`, `1`, `'1'`,
 * `1n`, and `'a'`, or unprefixed numbers and strings. Multiplicities are
 * -2, -1, 1, or 2, so values appear, grow, cancel, and reappear, and one key
 * can hold several values under one prefix, several prefixes, or prefixed and
 * unprefixed values together.
 *
 * Production driver: a fresh `Index` receives each addition through
 * `addValue`.
 *
 * Refinement check: after each addition, `get` and `has` for both keys equal
 * the model.
 *
 * Calibration: comparing prefixes with `===` kept a cancelled `NaN`-prefixed
 * value, or threw `Mismatching prefixes`, and fails the pinned histories and
 * both campaigns.
 *
 * Known omissions: `Index` joins, compaction, presence tracking, and structural
 * payloads other than numbers and strings are outside this owner; the join
 * operator tests and the incrementalization law own the operators.
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { Index } from '../src/indexes.js'

type Prefix = number | string | bigint
type Value = [Prefix, number | string] | number | string
type Addition = { key: `k1` | `k2`; value: Value; multiplicity: number }

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// `NaN` equals `NaN` and `-0` equals `0`; the type keeps 1, '1', and 1n apart.
function scalarIdentity(value: Prefix): string {
  if (typeof value === `number`) {
    return `number:${Number.isNaN(value) ? `NaN` : String(value === 0 ? 0 : value)}`
  }
  return `${typeof value}:${String(value)}`
}

function identity(value: Value): string {
  return Array.isArray(value)
    ? `[${scalarIdentity(value[0])},${scalarIdentity(value[1])}]`
    : scalarIdentity(value)
}

function expectedIndex(
  additions: ReadonlyArray<Addition>,
): Map<string, Map<string, number>> {
  const keys = new Map<string, Map<string, number>>()
  for (const { key, value, multiplicity } of additions) {
    const values = keys.get(key) ?? new Map<string, number>()
    const id = identity(value)
    const sum = (values.get(id) ?? 0) + multiplicity
    if (sum === 0) values.delete(id)
    else values.set(id, sum)
    if (values.size === 0) keys.delete(key)
    else keys.set(key, values)
  }
  return keys
}

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
const historyArbitrary: fc.Arbitrary<Array<Addition>> = fc
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

const add = (value: Value, multiplicity: number): Addition => ({
  key: `k1`,
  value,
  multiplicity,
})

// Each history cancels or merges `NaN`-prefixed values in a different layout.
const pinnedHistories: ReadonlyArray<{
  name: string
  additions: Array<Addition>
}> = [
  {
    name: `a single NaN-prefixed value cancels`,
    additions: [add([Number.NaN, 0], 1), add([Number.NaN, 0], -1)],
  },
  {
    name: `two NaN-prefixed values share one prefix`,
    additions: [
      add([Number.NaN, 0], 1),
      add([Number.NaN, 1], 1),
      add([Number.NaN, 0], -1),
    ],
  },
  {
    name: `a NaN-prefixed value beside an unprefixed value`,
    additions: [add(5, 1), add([Number.NaN, 0], 1), add([Number.NaN, 0], -1)],
  },
  {
    name: `negative zero and zero share a prefix`,
    additions: [add([-0, 0], 1), add([0, 0], -1)],
  },
]

// ---------------------------------------------------------------------------
// Production driver and refinement check
// ---------------------------------------------------------------------------

function published(
  index: Index<string, Value>,
  key: string,
): Map<string, number> {
  const values = new Map<string, number>()
  for (const [value, multiplicity] of index.get(key)) {
    const id = identity(value)
    values.set(id, (values.get(id) ?? 0) + multiplicity)
  }
  return values
}

function expectRefinement(additions: ReadonlyArray<Addition>): void {
  const index = new Index<string, Value>()
  for (const [step, addition] of additions.entries()) {
    index.addValue(addition.key, [addition.value, addition.multiplicity])
    const model = expectedIndex(additions.slice(0, step + 1))
    for (const key of [`k1`, `k2`]) {
      const checkpoint = `after addition ${step} for ${key}`
      expect(published(index, key), checkpoint).toEqual(
        model.get(key) ?? new Map(),
      )
      expect(index.has(key), `${checkpoint} has`).toBe(model.has(key))
    }
  }
}

// ---------------------------------------------------------------------------
// Campaigns. The fixed and random campaigns run the same property, grammar,
// check, and budget. `TANSTACK_DB_IVM_INDEX_SEED` and
// `TANSTACK_DB_IVM_INDEX_PATH` select a direct replay.

const replaySeed = process.env.TANSTACK_DB_IVM_INDEX_SEED
const replayPath = process.env.TANSTACK_DB_IVM_INDEX_PATH
const campaigns =
  replaySeed === undefined && replayPath === undefined
    ? [
        { name: `20260930`, seed: 20260930 as number | undefined },
        { name: `random`, seed: undefined },
      ]
    : [
        {
          name: `replay`,
          seed: replaySeed === undefined ? undefined : Number(replaySeed),
        },
      ]

describe(`Index refinement oracle`, () => {
  if (replaySeed === undefined && replayPath === undefined) {
    for (const { name, additions } of pinnedHistories) {
      it(`matches the multiset model when ${name}`, () =>
        expectRefinement(additions))
    }
  }

  for (const { name, seed } of campaigns) {
    it(`matches the multiset model across generated additions (${name})`, () => {
      if (replayPath !== undefined && replaySeed === undefined)
        throw new Error(`TANSTACK_DB_IVM_INDEX_PATH requires a seed`)
      if (
        replaySeed !== undefined &&
        (replaySeed.trim() === `` ||
          typeof seed !== `number` ||
          !Number.isSafeInteger(seed))
      )
        throw new Error(`TANSTACK_DB_IVM_INDEX_SEED must be an integer`)
      fc.assert(
        fc.property(historyArbitrary, (additions) =>
          expectRefinement(additions),
        ),
        {
          numRuns: 300,
          ...(seed === undefined ? {} : { seed }),
          ...(replayPath === undefined ? {} : { path: replayPath }),
        },
      )
    })
  }

  // Positive execution witness: generated histories reach a NaN prefix that
  // cancels after another value joined its key.
  it(`reaches cancelled NaN-prefixed values beside other values`, () => {
    const sample = fc.sample(historyArbitrary, { seed: 20260930, numRuns: 300 })
    const reached = sample.filter((additions) =>
      additions.some(
        (addition, step) =>
          Array.isArray(addition.value) &&
          Number.isNaN(addition.value[0]) &&
          addition.multiplicity < 0 &&
          additions
            .slice(0, step)
            .some((earlier) => earlier.value !== addition.value),
      ),
    )
    expect(reached.length).toBeGreaterThan(10)
  })
})
