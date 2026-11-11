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
 * With `prefixIdentity`, the producer promises that a value's prefix
 * determines it, so values under one key with the same prefix are one value
 * whatever their payloads. Unprefixed values keep their structural identity;
 * merging them would join values that differ. Each history runs in both
 * modes.
 *
 * Model: `expectedIndex` sums multiplicities in plain `Map`s under a string
 * identity built from each value's type and printed value, or from its
 * prefix alone under `prefixIdentity`. It does not call the Index, `hash`, or
 * the prefix helper.
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
 * the model, and `get` returns what `getIterator` yields, in its order. Under
 * `prefixIdentity` a merged value keeps one of its instances, so `get` is
 * compared through the same prefix identity.
 *
 * Calibration: comparing prefixes with `===` kept a cancelled `NaN`-prefixed
 * value, or threw `Mismatching prefixes`, and fails the fixed histories and
 * both campaigns.
 *
 * Known omissions: `Index` joins, compaction, presence tracking, and structural
 * payloads other than numbers and strings are outside this owner; the join
 * operator tests and the incrementalization law own the operators.
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { Index } from '../src/indexes.js'
import {
  oracleFixedSeed,
  oracleReplayTest,
  oracleRoute,
} from '../../db/tests/oracle-config.js'
import {
  differs,
  oracleProperty,
  pass,
} from '../../db/tests/oracle-property.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'

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

type Mode = `structural` | `prefixIdentity`

function identity(value: Value, mode: Mode = `structural`): string {
  if (!Array.isArray(value)) return scalarIdentity(value)
  return mode === `prefixIdentity`
    ? `[${scalarIdentity(value[0])}]`
    : `[${scalarIdentity(value[0])},${scalarIdentity(value[1])}]`
}

function expectedIndex(
  additions: ReadonlyArray<Addition>,
  mode: Mode,
): Map<string, Map<string, number>> {
  const keys = new Map<string, Map<string, number>>()
  for (const { key, value, multiplicity } of additions) {
    const values = keys.get(key) ?? new Map<string, number>()
    const id = identity(value, mode)
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
const fixedHistories: ReadonlyArray<{
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

function observedMultiplicities(
  index: Index<string, Value>,
  key: string,
  mode: Mode,
): Map<string, number> {
  const values = new Map<string, number>()
  for (const [value, multiplicity] of index.get(key)) {
    const id = identity(value, mode)
    values.set(id, (values.get(id) ?? 0) + multiplicity)
  }
  return values
}

type IndexSnapshot = {
  values: Map<string, number>
  has: boolean
  get: Array<[Value, number]>
  iterator: Array<[Value, number]>
}

function indexExpectations(
  additions: ReadonlyArray<Addition>,
  modes: ReadonlyArray<Mode>,
) {
  const expected = new Map<
    string,
    { values: Map<string, number>; has: boolean }
  >()
  for (const mode of modes)
    for (const step of additions.keys()) {
      const model = expectedIndex(additions.slice(0, step + 1), mode)
      for (const key of [`k1`, `k2`])
        expected.set(`${mode}: after addition ${step} for ${key}`, {
          values: model.get(key) ?? new Map(),
          has: model.has(key),
        })
    }
  return expected
}

// Copy every public observation at its original per-addition cut, so later
// index changes cannot rewrite a prior get/iterator result.
function driveIndex(
  additions: ReadonlyArray<Addition>,
  modes: ReadonlyArray<Mode>,
  observe: (checkpoint: string, value: IndexSnapshot) => void,
) {
  for (const mode of modes) {
    const index = new Index<string, Value>({
      prefixIdentity: mode === `prefixIdentity`,
    })
    for (const [step, addition] of additions.entries()) {
      index.addValue(addition.key, [addition.value, addition.multiplicity])
      for (const key of [`k1`, `k2`])
        observe(`${mode}: after addition ${step} for ${key}`, {
          values: observedMultiplicities(index, key, mode),
          has: index.has(key),
          get: structuredClone(index.get(key)),
          iterator: structuredClone([...index.getIterator(key)]),
        })
    }
  }
}

function checkIndex(
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof indexExpectations>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    const actual = value as IndexSnapshot
    const model = expected.get(checkpoint)!
    const mismatch =
      differs(
        checkpoint,
        `summed multiplicities`,
        actual.values,
        model.values,
      ) ??
      differs(checkpoint, `key presence`, actual.has, model.has) ??
      differs(checkpoint, `iterator agreement`, actual.get, actual.iterator)
    if (mismatch) return mismatch
  }
  return pass
}

// Fixed regressions use the same production driver, model and comparison as
// the generated native campaign, with no hand-written expected answer.
function expectRefinement(
  additions: ReadonlyArray<Addition>,
  mode: Mode = `structural`,
): void {
  const trace: Array<Observation> = []
  driveIndex(additions, [mode], (checkpoint, value) =>
    trace.push({ checkpoint, value }),
  )
  const verdict = checkIndex(trace, indexExpectations(additions, [mode]))
  if (verdict.kind === `violation`)
    expect(verdict.values?.actual, verdict.difference).toEqual(
      verdict.values?.expected,
    )
}

// The refinement law is declared with its model, the multiset of values per
// key, and its grammar, the generated addition histories.
// What this oracle owns: the gap report judges these entries, and their
// reference trees within the package, by this file's tests.

// ---------------------------------------------------------------------------
// Campaigns. The fixed and random campaigns run the same property, grammar,
// check, and budget. A seed alone reseeds the random campaign. A path replay
// of INDEX_REFINEMENT_PROPERTY runs its recorded history, and every other
// test in this file stands aside.

describe(`Index refinement oracle`, () => {
  for (const { name, additions } of fixedHistories) {
    oracleReplayTest(it)(`matches the multiset model when ${name}`, () => {
      oracleRoute(`fixed history`)
      expectRefinement(additions)
      expectRefinement(additions, `prefixIdentity`)
    })
  }

  // Preserve both storage modes and every get/has/iterator cut. The model
  // recomputes each prefix without reading the production Index.
  oracleProperty({
    id: `ivm.index-refinement`,
    law: {
      statement: `After each addition the Index get/has observations equal independently summed multiplicities, and get agrees with getIterator in order, in both structural and prefixIdentity modes.`,
      authority: `Existing Index multiset and prefixIdentity contract documented above.`,
      limits: `At most twelve signed additions to two keys over the original primitive/prefixed domain; joins, compaction and richer structural payloads remain outside this owner.`,
    },
    owns: [
      `src/indexes.ts#Index.addValue`,
      `src/indexes.ts#Index.get`,
      `src/indexes.ts#Index.has`,
      `src/indexes.ts#Index.getIterator`,
    ],
    histories: {
      arbitrary: historyArbitrary,
      runs: 300,
      fixedSeeds: [20260930],
    },
    model: (additions) =>
      indexExpectations(additions, [`structural`, `prefixIdentity`]),
    driver: (additions, observe) =>
      driveIndex(additions, [`structural`, `prefixIdentity`], observe),
    check: (_additions, trace, expected) => checkIndex(trace, expected),
  })

  // Positive execution witness: generated histories reach a NaN prefix that
  // cancels after another value joined its key.
  it(`reaches cancelled NaN-prefixed values beside other values`, () => {
    oracleRoute(`fixed seed`)
    const sample = fc.sample(
      historyArbitrary,
      oracleFixedSeed(20260930, { numRuns: 300 }),
    )
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
