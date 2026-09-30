import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { MultiSet } from '../src/multiset.js'
import type { MultiSetArray } from '../src/multiset.js'

/**
 * # Which records does `MultiSet.consolidate()` merge?
 *
 * Consolidation sums the multiplicities of records with the same identity.
 * The identity rule depends on the shape of the whole multiset:
 *
 * 1. **Keyed.** Every record is a `[key, value]` pair with a string or number
 *    key. The key compares by value. A primitive value compares by value. An
 *    object value compares by reference. A value that is an array of length 2
 *    is a join tuple: each element compares by the same primitive/reference
 *    rule, so fresh tuples with the same elements merge.
 * 2. **Unkeyed, one primitive type.** Every record is a string, or every
 *    record is a number. Records compare by value.
 * 3. **Unkeyed, structural.** Any other multiset. Records compare by
 *    structure, so fresh objects or arrays with equal contents merge.
 *
 * For each identity, the result holds exactly one record: the first record in
 * input order, with the summed multiplicity. An identity whose sum is zero is
 * absent. Consolidation does not change the input multiset.
 *
 * Authority: the identity rules are the documented behavior in
 * `src/multiset.ts` (method comments on keyed and unkeyed consolidation).
 *
 * Limits:
 * - The output order is not part of this law. No contract states it.
 * - Keyed values never mix a number and a string with the same text (or a
 *   boolean and its text). Keyed consolidation merges those today, which is
 *   the open bug #1948. Remove this exclusion when that bug is fixed.
 * - Structural identity uses a 32-bit hash in production. The small value
 *   domain here makes a collision unlikely, but this is not an injectivity
 *   claim.
 * - Objects have one key, so this law does not cover key-order sensitivity.
 */

type Data = unknown
type Spec =
  | { kind: `prim`; i: number }
  | { kind: `obj`; i: number }
  | { kind: `tuple`; a: Leaf; b: Leaf }
  | { kind: `triple`; i: number }
type Leaf = { kind: `prim` | `obj`; i: number }

// Primitive texts are distinct across types: no `'1'`, `'true'`, `'null'`, or
// `'undefined'` strings. See the #1948 limit above.
const KEYED_PRIMITIVES: ReadonlyArray<Data> = [
  0,
  1,
  2,
  `x`,
  `y`,
  null,
  undefined,
  true,
]
const KEYS: ReadonlyArray<string | number> = [0, 1, 2, `a`, `b`]

// ---------------------------------------------------------------------------
// Model. It does not use production identity helpers or `hash`.

type Expected = {
  groups: Map<string, { first: Data; sum: number }>
  // The refinement check classifies production output with this same
  // independent rule.
  identity: (data: Data) => string
}

function expectedConsolidation(records: MultiSetArray<Data>): Expected {
  const refIds = new Map<object, number>()
  const refId = (value: object) => {
    if (!refIds.has(value)) refIds.set(value, refIds.size)
    return refIds.get(value)!
  }
  const leaf = (value: Data) =>
    value !== null && typeof value === `object`
      ? [`ref`, refId(value)]
      : [`value`, typeof value, value === undefined ? null : value]
  const keyedIdentity = (data: Data) => {
    const [key, value] = data as [string | number, Data]
    const valueIdentity =
      Array.isArray(value) && value.length === 2
        ? [`tuple`, leaf(value[0]), leaf(value[1])]
        : leaf(value)
    return JSON.stringify([typeof key, key, valueIdentity])
  }
  const structure = (value: Data): Data => {
    if (Array.isArray(value)) return [`array`, value.map(structure)]
    if (value !== null && typeof value === `object`)
      return [
        `object`,
        Object.keys(value)
          .sort()
          .map((key) => [key, structure((value as Record<string, Data>)[key])]),
      ]
    return [typeof value, value === undefined ? null : value]
  }

  const isKeyed =
    records.length > 0 &&
    records.every(
      ([data]) =>
        Array.isArray(data) &&
        data.length === 2 &&
        (typeof data[0] === `string` || typeof data[0] === `number`),
    )
  const onePrimitiveType = [`string`, `number`].some((type) =>
    records.every(([data]) => typeof data === type),
  )
  const identity = isKeyed
    ? keyedIdentity
    : onePrimitiveType
      ? (data: Data) => JSON.stringify([typeof data, data])
      : (data: Data) => JSON.stringify(structure(data))

  const groups = new Map<string, { first: Data; sum: number }>()
  for (const [data, multiplicity] of records) {
    const id = identity(data)
    const group = groups.get(id)
    if (group) group.sum += multiplicity
    else groups.set(id, { first: data, sum: multiplicity })
  }
  for (const [id, group] of groups) if (group.sum === 0) groups.delete(id)
  return { groups, identity }
}

// ---------------------------------------------------------------------------
// History grammar. Each run builds fresh objects, so equal contents never
// imply equal references.

const leafArb: fc.Arbitrary<Leaf> = fc.oneof(
  fc.record({
    kind: fc.constant(`prim` as const),
    i: fc.nat(KEYED_PRIMITIVES.length - 1),
  }),
  fc.record({ kind: fc.constant(`obj` as const), i: fc.nat(2) }),
)
const specArb: fc.Arbitrary<Spec> = fc.oneof(
  leafArb,
  fc.record({ kind: fc.constant(`tuple` as const), a: leafArb, b: leafArb }),
  fc.record({ kind: fc.constant(`triple` as const), i: fc.nat(2) }),
)
const multiplicityArb = fc.integer({ min: -2, max: 2 })

type StructuralStep =
  | 1
  | `1`
  | true
  | null
  | { fresh: `object`; v: number }
  | { fresh: `array`; pair: [number, number] }

type Mode = `keyed` | `numbers` | `strings` | `structural` | `fallback`
type History = { mode: Mode; steps: Array<[unknown, number]> }

const historyArb: fc.Arbitrary<History> = fc.oneof(
  fc.record({
    mode: fc.constant(`keyed` as const),
    steps: fc.array(
      fc.tuple(fc.tuple(fc.nat(KEYS.length - 1), specArb), multiplicityArb),
      { maxLength: 24 },
    ),
  }),
  fc.record({
    mode: fc.constant(`numbers` as const),
    steps: fc.array(fc.tuple(fc.nat(3), multiplicityArb), { maxLength: 24 }),
  }),
  fc.record({
    mode: fc.constant(`strings` as const),
    steps: fc.array(fc.tuple(fc.constantFrom(`p`, `q`, `r`), multiplicityArb), {
      maxLength: 24,
    }),
  }),
  fc.record({
    mode: fc.constant(`structural` as const),
    steps: fc.array(
      fc.tuple(
        fc.oneof(
          fc.constantFrom<StructuralStep>(1, `1`, true, null),
          fc.nat(2).map((v): StructuralStep => ({ fresh: `object`, v })),
          fc
            .tuple(fc.nat(1), fc.nat(1))
            .map((pair): StructuralStep => ({ fresh: `array`, pair })),
        ),
        multiplicityArb,
      ),
      { minLength: 1, maxLength: 24 },
    ),
  }),
  fc.record({
    mode: fc.constant(`fallback` as const),
    steps: fc.array(
      fc.tuple(fc.tuple(fc.nat(KEYS.length - 1), specArb), multiplicityArb),
      { minLength: 1, maxLength: 23 },
    ),
  }),
)

// Build the records of one history with fresh object references.
function buildRecords(history: History): MultiSetArray<Data> {
  const objects = [{ v: 1 }, { v: 1 }, { v: 2 }]
  const fromLeaf = (leaf: Leaf) =>
    leaf.kind === `prim` ? KEYED_PRIMITIVES[leaf.i] : objects[leaf.i]
  const fromSpec = (spec: Spec): Data =>
    spec.kind === `tuple`
      ? [fromLeaf(spec.a), fromLeaf(spec.b)]
      : spec.kind === `triple`
        ? [spec.i, spec.i, spec.i]
        : fromLeaf(spec)
  const records: MultiSetArray<Data> = history.steps.map(([step, m]) => {
    if (history.mode === `keyed` || history.mode === `fallback`) {
      const [keyIndex, spec] = step as [number, Spec]
      return [[KEYS[keyIndex], fromSpec(spec)], m]
    }
    if (history.mode === `numbers` || history.mode === `strings`)
      return [step, m]
    const value = step as StructuralStep
    if (value !== null && typeof value === `object`)
      return [value.fresh === `object` ? { v: value.v } : [...value.pair], m]
    return [value, m]
  })
  // One non-keyed record makes the whole multiset unkeyed.
  if (history.mode === `fallback`) records.push([{ v: 1 }, 1])
  return records
}

// ---------------------------------------------------------------------------
// Production driver and refinement check.

function expectConsolidation(history: History): void {
  const records = buildRecords(history)
  const inputSnapshot = records.map(([data, m]) => [data, m] as const)
  const { groups: expected, identity } = expectedConsolidation(records)

  const actual = new MultiSet(records).consolidate().getInner()

  // Consolidation does not change the input.
  expect(records.length).toBe(inputSnapshot.length)
  records.forEach(([data, m], index) => {
    expect(data).toBe(inputSnapshot[index]![0])
    expect(m).toBe(inputSnapshot[index]![1])
  })

  // Record every output entry. A duplicate identity or a zero multiplicity
  // stays visible.
  const seen = new Map<string, number>()
  for (const [data, multiplicity] of actual) {
    const id = identity(data)
    seen.set(id, (seen.get(id) ?? 0) + 1)
    const group = expected.get(id)
    expect(group, `unexpected identity ${id} x${multiplicity}`).toBeDefined()
    expect(multiplicity, `multiplicity of ${id}`).toBe(group!.sum)
    expect(data, `retained record of ${id}`).toBe(group!.first)
  }
  for (const [id, count] of seen) expect(count, `copies of ${id}`).toBe(1)
  expect(
    [...expected.keys()].filter((id) => !seen.has(id)),
    `missing identities`,
  ).toEqual([])
}

// ---------------------------------------------------------------------------
// Campaigns. The fixed and random campaigns run the same property, grammar,
// check, and budget. `TANSTACK_DB_IVM_CONSOLIDATE_SEED` and
// `TANSTACK_DB_IVM_CONSOLIDATE_PATH` select a direct replay.

const replaySeed = process.env.TANSTACK_DB_IVM_CONSOLIDATE_SEED
const replayPath = process.env.TANSTACK_DB_IVM_CONSOLIDATE_PATH
const campaigns =
  replaySeed === undefined && replayPath === undefined
    ? [
        { name: `2026929`, seed: 2026929 as number | undefined },
        { name: `random`, seed: undefined },
      ]
    : [
        {
          name: `replay`,
          seed: replaySeed === undefined ? undefined : Number(replaySeed),
        },
      ]

describe(`MultiSet consolidation oracle`, () => {
  for (const { name, seed } of campaigns) {
    it(`matches the identity model across generated multisets (${name})`, () => {
      if (replayPath !== undefined && replaySeed === undefined)
        throw new Error(`TANSTACK_DB_IVM_CONSOLIDATE_PATH requires a seed`)
      if (
        replaySeed !== undefined &&
        (replaySeed.trim() === `` ||
          typeof seed !== `number` ||
          !Number.isSafeInteger(seed))
      )
        throw new Error(`TANSTACK_DB_IVM_CONSOLIDATE_SEED must be an integer`)
      fc.assert(
        fc.property(historyArb, (history) => expectConsolidation(history)),
        {
          numRuns: 300,
          ...(seed === undefined ? {} : { seed }),
          ...(replayPath === undefined ? {} : { path: replayPath }),
        },
      )
    })
  }

  // Positive execution witness: the fixed campaign reaches every mode, and many
  // histories have fewer result identities than distinct input records. That
  // happens only when records merge or cancel.
  it(`reaches every mode and merges records in the fixed campaign`, () => {
    const sample = fc.sample(historyArb, { seed: 2026929, numRuns: 300 })
    const modes = new Set(sample.map((history) => history.mode))
    expect([...modes].sort()).toEqual(
      [`fallback`, `keyed`, `numbers`, `strings`, `structural`].sort(),
    )
    const withMerges = sample.filter((history) => {
      const records = buildRecords(history)
      return (
        expectedConsolidation(records).groups.size <
        new Set(records.map(([data]) => data)).size
      )
    })
    expect(withMerges.length).toBeGreaterThan(30)
  })

  // Pinned witnesses for each identity rule. The generated campaigns can reach
  // these, but pinning them makes each rule visible and stable.
  it.each<[string, History]>([
    [
      `keyed object values merge by reference, not by contents`,
      {
        mode: `keyed`,
        steps: [
          [[0, { kind: `obj`, i: 0 }], 1],
          [[0, { kind: `obj`, i: 1 }], -1],
          [[0, { kind: `obj`, i: 0 }], 1],
        ],
      },
    ],
    [
      `fresh join tuples with the same elements merge`,
      {
        mode: `keyed`,
        steps: [
          [
            [
              3,
              {
                kind: `tuple`,
                a: { kind: `prim`, i: 3 },
                b: { kind: `prim`, i: 5 },
              },
            ],
            1,
          ],
          [
            [
              3,
              {
                kind: `tuple`,
                a: { kind: `prim`, i: 3 },
                b: { kind: `prim`, i: 5 },
              },
            ],
            -1,
          ],
          [
            [
              3,
              {
                kind: `tuple`,
                a: { kind: `obj`, i: 2 },
                b: { kind: `prim`, i: 0 },
              },
            ],
            2,
          ],
        ],
      },
    ],
    [
      `arrays of other lengths stay reference values`,
      {
        mode: `keyed`,
        steps: [
          [[1, { kind: `triple`, i: 0 }], 1],
          [[1, { kind: `triple`, i: 0 }], 1],
        ],
      },
    ],
    [
      `one non-keyed record makes equal contents merge structurally`,
      {
        mode: `fallback`,
        steps: [
          [[0, { kind: `obj`, i: 0 }], 1],
          [[0, { kind: `obj`, i: 1 }], 1],
        ],
      },
    ],
    [
      `unkeyed structural data keeps 1 and "1" apart`,
      {
        mode: `structural`,
        steps: [
          [1, 1],
          [`1`, -1],
          [1, 1],
        ],
      },
    ],
  ])(`%s`, (_name, history) => expectConsolidation(history))
})
