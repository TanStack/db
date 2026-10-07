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
 *    record is a number. Records compare by value, as `Map` keys do: `-0`
 *    equals `0`, and `NaN` equals `NaN`. The retained record is that value
 *    with `-0` written as `0`.
 * 3. **Unkeyed, structural.** Any other multiset. Records compare by
 *    structure, so fresh objects or arrays with equal contents merge.
 *
 * For each identity, the result holds exactly one record: the first record in
 * input order (normalized as in rule 2), with the summed multiplicity. An identity whose sum is zero is
 * absent. Consolidation does not change the input multiset.
 *
 * Authority: the contract comment on `MultiSet.consolidate()` in
 * `src/multiset.ts`. It restates the behavior and the keyed and unkeyed method
 * comments of the implementation before the shared consolidation loop
 * (`b5d92ceb`).
 *
 * Limits:
 * - The output order is not part of this law. No contract states it.
 * - The keyed grammar includes the reported type, reference, and delimiter
 *   collisions in #1948, plus non-finite numeric keys. This checks `MultiSet`
 *   directly. It does not prove
 *   which `@tanstack/db` query shapes produce these records.
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

const firstSymbol = Symbol(`s`)
const secondSymbol = Symbol(`s`)
const firstFunction = () => 1
const secondFunction = () => 1

const KEYED_PRIMITIVES: ReadonlyArray<Data> = [
  0,
  1,
  2,
  `x`,
  `y`,
  null,
  undefined,
  true,
  -0,
  NaN,
  `1`,
  `true`,
  `null`,
  `undefined`,
  1n,
  `x|str_y`,
  firstSymbol,
  secondSymbol,
  firstFunction,
  secondFunction,
]
// The structural fallback retains its original key domain. Non-finite keys
// challenge only the keyed path, whose contract defines their identity.
const FALLBACK_KEYS: ReadonlyArray<string | number> = [
  0,
  1,
  2,
  `a`,
  `b`,
  `1`,
  `a|str_x`,
]
const KEYED_KEYS: ReadonlyArray<string | number> = [
  ...FALLBACK_KEYS,
  NaN,
  Infinity,
  -Infinity,
]

// ---------------------------------------------------------------------------
// Model. It does not use production identity helpers or `hash`.

type Expected = {
  groups: Array<{ first: Data; sum: number }>
  sameIdentity: (left: Data, right: Data) => boolean
}

function expectedConsolidation(records: MultiSetArray<Data>): Expected {
  // SameValueZero compares primitive values; strict equality also preserves
  // reference identity for objects, functions, and symbols.
  const sameLeaf = (left: Data, right: Data): boolean =>
    left === right ||
    (typeof left === `number` &&
      typeof right === `number` &&
      Number.isNaN(left) &&
      Number.isNaN(right))
  const sameKeyed = (left: Data, right: Data): boolean => {
    const [leftKey, leftValue] = left as [string | number, Data]
    const [rightKey, rightValue] = right as [string | number, Data]
    if (!sameLeaf(leftKey, rightKey)) return false
    if (Array.isArray(leftValue) && leftValue.length === 2)
      return (
        Array.isArray(rightValue) &&
        rightValue.length === 2 &&
        sameLeaf(leftValue[0], rightValue[0]) &&
        sameLeaf(leftValue[1], rightValue[1])
      )
    return (
      !(Array.isArray(rightValue) && rightValue.length === 2) &&
      sameLeaf(leftValue, rightValue)
    )
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
  const sameIdentity: Expected['sameIdentity'] = isKeyed
    ? sameKeyed
    : onePrimitiveType
      ? sameLeaf
      : (left, right) =>
          JSON.stringify(structure(left)) === JSON.stringify(structure(right))
  const retained = (data: Data) =>
    onePrimitiveType && Object.is(data, -0) ? 0 : data

  const groups: Expected['groups'] = []
  for (const [data, multiplicity] of records) {
    const group = groups.find(({ first }) => sameIdentity(first, data))
    if (group) group.sum += multiplicity
    else groups.push({ first: retained(data), sum: multiplicity })
  }
  return { groups: groups.filter(({ sum }) => sum !== 0), sameIdentity }
}

// ---------------------------------------------------------------------------
// History grammar. Each run builds fresh objects, so equal contents never
// imply equal references.

function specArbFor(maxPrimitiveIndex: number): fc.Arbitrary<Spec> {
  const leafArb: fc.Arbitrary<Leaf> = fc.oneof(
    fc.record({
      kind: fc.constant(`prim` as const),
      i: fc.nat(maxPrimitiveIndex),
    }),
    fc.record({ kind: fc.constant(`obj` as const), i: fc.nat(2) }),
  )
  return fc.oneof(
    leafArb,
    fc.record({ kind: fc.constant(`tuple` as const), a: leafArb, b: leafArb }),
    fc.record({ kind: fc.constant(`triple` as const), i: fc.nat(2) }),
  )
}

const keyedSpecArb = specArbFor(KEYED_PRIMITIVES.length - 1)
// The unkeyed fallback checks structural hashing on its original value domain.
const fallbackSpecArb = specArbFor(9)
const multiplicityArb = fc.integer({ min: -2, max: 2 })

type StructuralStep =
  | 1
  | `1`
  | true
  | null
  | { fresh: `object`; v: number }
  | { fresh: `array`; pair: [number, number] }

type Mode =
  `keyed` | `keyedCollision` | `numbers` | `strings` | `structural` | `fallback`
// `keyedCollision` selects grammar witnesses; it exercises the same keyed
// production path as `keyed`. `caseName` labels a replay, not product state.
type History = {
  mode: Mode
  steps: Array<[unknown, number]>
  caseName?: string
}

// Each pair has distinct keyed identities under the documented rule. They
// were RED on the pre-fix text encoding in #1948.
const collisionCases: Array<{ name: string; records: MultiSetArray<Data> }> = [
  {
    name: `numeric and string keys stay separate`,
    records: [
      [[1, `v`], 1],
      [[`1`, `v`], 1],
    ],
  },
  {
    name: `numeric and string values do not cancel`,
    records: [
      [[`k`, 1], 1],
      [[`k`, `1`], -1],
    ],
  },
  {
    name: `join tuple elements keep their primitive type`,
    records: [
      [[`k`, [1, null]], 1],
      [[`k`, [`1`, null]], -1],
    ],
  },
  {
    name: `the key and value boundary stays distinct when text contains a pipe`,
    records: [
      [[`a|str_x`, `y`], 1],
      [[`a`, `x|str_y`], -1],
    ],
  },
  {
    name: `boolean and string values do not cancel`,
    records: [
      [[`k`, true], 1],
      [[`k`, `true`], -1],
    ],
  },
  {
    name: `bigint and number values do not cancel`,
    records: [
      [[`k`, 1n], 1],
      [[`k`, 1], -1],
    ],
  },
  {
    name: `symbols with the same description keep reference identity`,
    records: [
      [[`k`, firstSymbol], 1],
      [[`k`, secondSymbol], -1],
    ],
  },
  {
    name: `functions with the same source text keep reference identity`,
    records: [
      [[`k`, firstFunction], 1],
      [[`k`, secondFunction], -1],
    ],
  },
]
const collisionHistoryArb: fc.Arbitrary<History> = fc
  .tuple(fc.constantFrom(...collisionCases), fc.constantFrom(-2, -1, 1, 2))
  .map(([collision, multiplicity]) => ({
    mode: `keyedCollision`,
    caseName: collision.name,
    steps: collision.records.map(([data], index) => [
      data,
      index === 0 ? multiplicity : -multiplicity,
    ]),
  }))

const historyArb: fc.Arbitrary<History> = fc.oneof(
  collisionHistoryArb,
  fc.record({
    mode: fc.constant(`keyed` as const),
    steps: fc.array(
      fc.tuple(
        fc.tuple(fc.nat(KEYED_KEYS.length - 1), keyedSpecArb),
        multiplicityArb,
      ),
      { maxLength: 24 },
    ),
  }),
  fc.record({
    mode: fc.constant(`numbers` as const),
    steps: fc.array(
      fc.tuple(fc.constantFrom(0, -0, 1, 2, 3, NaN), multiplicityArb),
      { maxLength: 24 },
    ),
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
      fc.tuple(
        fc.tuple(fc.nat(FALLBACK_KEYS.length - 1), fallbackSpecArb),
        multiplicityArb,
      ),
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
    if (history.mode === `keyedCollision`) {
      const [key, value] = step as [string | number, Data]
      return [[key, Array.isArray(value) ? [...value] : value], m]
    }
    if (history.mode === `keyed` || history.mode === `fallback`) {
      const [keyIndex, spec] = step as [number, Spec]
      return [
        [
          (history.mode === `fallback` ? FALLBACK_KEYS : KEYED_KEYS)[keyIndex],
          fromSpec(spec),
        ],
        m,
      ]
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

// A tagged encoding of every record's contents. Reusing identities across
// snapshots exposes replacement by a distinct reference with equal contents.
// Symbol and function identities remain distinct; tags keep `-0`, `NaN`, and
// `undefined` distinct.
function contentsOf(
  records: MultiSetArray<Data>,
  ids: Map<object | symbol, number>,
): string {
  const encode = (value: Data): Data => {
    if (typeof value === `symbol` || typeof value === `function`) {
      if (!ids.has(value)) ids.set(value, ids.size)
      return [typeof value, ids.get(value)]
    }
    if (value === null || typeof value !== `object`)
      return [typeof value, Object.is(value, -0) ? `-0` : String(value)]
    if (!ids.has(value)) ids.set(value, ids.size)
    return [
      ids.get(value),
      Object.entries(value).map(([key, item]) => [key, encode(item)]),
    ]
  }
  return JSON.stringify(records.map(([data, m]) => [encode(data), m]))
}

function expectRecordsConsolidated(records: MultiSetArray<Data>): void {
  const inputSnapshot = records.map(([data, m]) => [data, m] as const)
  const contentIds = new Map<object | symbol, number>()
  const inputContents = contentsOf(records, contentIds)
  const { groups: expected, sameIdentity } = expectedConsolidation(records)

  const actual = new MultiSet(records).consolidate().getInner()

  // Consolidation does not change the input.
  expect(records.length).toBe(inputSnapshot.length)
  records.forEach(([data, m], index) => {
    expect(data).toBe(inputSnapshot[index]![0])
    expect(m).toBe(inputSnapshot[index]![1])
  })
  expect(contentsOf(records, contentIds), `input record contents`).toBe(
    inputContents,
  )

  // Record every output entry. A duplicate identity or a zero multiplicity
  // stays visible.
  const seen = new Set<number>()
  for (const [data, multiplicity] of actual) {
    const index = expected.findIndex(({ first }) => sameIdentity(first, data))
    expect(
      index,
      `unexpected output entry ${seen.size}`,
    ).toBeGreaterThanOrEqual(0)
    expect(seen.has(index), `duplicate identity ${index}`).toBe(false)
    seen.add(index)
    const group = expected[index]!
    expect(multiplicity, `multiplicity of group ${index}`).toBe(group.sum)
    expect(data, `retained record of group ${index}`).toBe(group.first)
  }
  expect(
    expected.flatMap((_, index) => (seen.has(index) ? [] : [index])),
    `missing identities`,
  ).toEqual([])
}

function expectConsolidation(history: History): void {
  expectRecordsConsolidated(buildRecords(history))
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
  it(`detects replacement of an input value with equal contents`, () => {
    const records: MultiSetArray<Data> = [[[0, { v: 1 }], 1]]
    const ids = new Map<object | symbol, number>()
    const inputContents = contentsOf(records, ids)
    ;(records[0]![0] as [number, Data])[1] = { v: 1 }
    expect(contentsOf(records, ids)).not.toBe(inputContents)
  })

  it.each(collisionCases)(`$name`, ({ records }) =>
    expectRecordsConsolidated(records),
  )

  it(`keeps a direct object and an object tuple apart across a delimiter key`, () => {
    const first = { v: 1 }
    const second = { v: 2 }
    expectRecordsConsolidated([
      [[`a|ref_1`, second], 1],
      [[`a`, [first, second]], -1],
    ])
  })

  it.each<[string, MultiSetArray<Data>]>([
    [
      `the same symbol value still merges`,
      [
        [[`k`, firstSymbol], 1],
        [[`k`, firstSymbol], 2],
      ],
    ],
    [
      `the same function value still merges`,
      [
        [[`k`, firstFunction], 1],
        [[`k`, firstFunction], 2],
      ],
    ],
    [
      `signed zero keys still merge`,
      [
        [[-0, `v`], 1],
        [[0, `v`], 2],
      ],
    ],
    [
      `non-finite numeric keys stay separate`,
      [
        [[NaN, `v`], 1],
        [[Infinity, `v`], 2],
        [[-Infinity, `v`], 3],
      ],
    ],
    [
      `NaN values still merge`,
      [
        [[`k`, NaN], 1],
        [[`k`, NaN], 2],
      ],
    ],
  ])(`%s`, (_name, records) => expectRecordsConsolidated(records))

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
      [
        `fallback`,
        `keyed`,
        `keyedCollision`,
        `numbers`,
        `strings`,
        `structural`,
      ].sort(),
    )
    const withMerges = sample.filter((history) => {
      const records = buildRecords(history)
      return (
        expectedConsolidation(records).groups.length <
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
      `single-number data merges -0 with 0 and returns 0`,
      {
        mode: `numbers`,
        steps: [
          [-0, 1],
          [0, 1],
          [NaN, 1],
          [NaN, 1],
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
