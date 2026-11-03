import fc from 'fast-check'
import { MultiSet } from '../src/multiset.js'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import { contentsOf } from './multiset-support.js'
import type { Observation } from '../../db/tests/oracle-property.js'
import type { Data } from './multiset-support.js'
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
 * - Key order is covered only by one fixed pair of keys that tie under locale
 *   collation (a precomposed and a decomposed Å), inserted in both orders in
 *   structural histories; equal objects must merge whatever the order.
 */

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
  /** `firstIndex` is the input position of the identity's first record. */
  groups: Array<{ first: Data; firstIndex: number; sum: number }>
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
  for (const [index, [data, multiplicity]] of records.entries()) {
    const group = groups.find(({ first }) => sameIdentity(first, data))
    if (group) group.sum += multiplicity
    else
      groups.push({
        first: retained(data),
        firstIndex: index,
        sum: multiplicity,
      })
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
  // Equal objects whose two keys tie under locale collation, inserted in
  // either order. They must merge.
  | { fresh: `collationTie`; reversed: boolean }
  // A pair whose first element is no key: a multiset of only these is not
  // keyed, so equal object contents must merge structurally.
  | { fresh: `unkeyedPair`; v: number }

type Mode =
  `keyed` | `keyedCollision` | `numbers` | `strings` | `structural` | `fallback`
// `keyedCollision` selects grammar witnesses; it exercises the same keyed
// production path as `keyed`. `caseName` labels a replay, not product state.
// A `keyedCollision` history has one step: `[[name, opposed], scale]`, the
// witness's name and how its multiplicities are signed and scaled.
type History = {
  mode: Mode
  steps: Array<[unknown, number]>
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
// More keyed witnesses, which the generated `keyed` steps cannot build:
// reference-identity values that must still merge with themselves, a signed
// zero key, non-finite keys, and a delimiter key beside an object tuple.
const delimiterFirst = { v: 1 }
const delimiterSecond = { v: 2 }
collisionCases.push(
  {
    name: `a direct object and an object tuple stay apart across a delimiter key`,
    records: [
      [[`a|ref_1`, delimiterSecond], 1],
      [[`a`, [delimiterFirst, delimiterSecond]], -1],
    ],
  },
  {
    name: `the same symbol value still merges`,
    records: [
      [[`k`, firstSymbol], 1],
      [[`k`, firstSymbol], 2],
    ],
  },
  {
    name: `the same function value still merges`,
    records: [
      [[`k`, firstFunction], 1],
      [[`k`, firstFunction], 2],
    ],
  },
  {
    name: `signed zero keys still merge`,
    records: [
      [[-0, `v`], 1],
      [[0, `v`], 2],
    ],
  },
  {
    name: `non-finite numeric keys stay separate`,
    records: [
      [[NaN, `v`], 1],
      [[Infinity, `v`], 2],
      [[-Infinity, `v`], 3],
    ],
  },
  {
    name: `NaN values still merge`,
    records: [
      [[`k`, NaN], 1],
      [[`k`, NaN], 2],
    ],
  },
)
// A witness is named by its case name, and its multiplicities are scaled,
// so the history is plain data and a pinned witness is a member of the
// language. `opposed` gives the first record the scale and every later one
// its negation, so distinct identities would cancel if wrongly merged;
// otherwise each record keeps its own multiplicity times the scale.
const collisionHistoryArb: fc.Arbitrary<History> = fc.record({
  mode: fc.constant(`keyedCollision` as const),
  steps: fc.tuple(
    fc.tuple(
      fc.tuple(
        fc.constantFrom(...collisionCases.map(({ name }) => name)),
        fc.boolean(),
      ),
      fc.constantFrom(-2, -1, 1, 2),
    ),
  ),
})

const historyArb: fc.Arbitrary<History> = fc.oneof(
  collisionHistoryArb,
  fc.record({
    mode: fc.constant(`keyed` as const),
    steps: fc.array(
      fc.tuple(
        fc.tuple(fc.nat(KEYED_KEYS.length - 1), keyedSpecArb),
        multiplicityArb,
      ),
      { maxLength: 24, size: `medium` },
    ),
  }),
  fc.record({
    mode: fc.constant(`numbers` as const),
    steps: fc.array(
      fc.tuple(fc.constantFrom(0, -0, 1, 2, 3, NaN), multiplicityArb),
      { maxLength: 24, size: `medium` },
    ),
  }),
  fc.record({
    mode: fc.constant(`strings` as const),
    steps: fc.array(fc.tuple(fc.constantFrom(`p`, `q`, `r`), multiplicityArb), {
      maxLength: 24,
      size: `medium`,
    }),
  }),
  fc.record({
    mode: fc.constant(`structural` as const),
    steps: fc.array(
      fc.tuple(
        fc.oneof(
          fc.constantFrom<StructuralStep>(1, `1`, true, null),
          fc.record({ fresh: fc.constant(`object` as const), v: fc.nat(2) }),
          fc.record({
            fresh: fc.constant(`array` as const),
            pair: fc.tuple(fc.nat(1), fc.nat(1)),
          }),
          fc.record({
            fresh: fc.constant(`collationTie` as const),
            reversed: fc.boolean(),
          }),
          fc.record({
            fresh: fc.constant(`unkeyedPair` as const),
            v: fc.nat(1),
          }),
        ),
        multiplicityArb,
      ),
      { minLength: 1, maxLength: 24, size: `medium` },
    ),
  }),
  fc.record({
    mode: fc.constant(`fallback` as const),
    steps: fc.array(
      fc.tuple(
        fc.tuple(fc.nat(FALLBACK_KEYS.length - 1), fallbackSpecArb),
        multiplicityArb,
      ),
      { minLength: 1, maxLength: 23, size: `medium` },
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
    if (history.mode === `keyedCollision`) return [step, m]
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
    if (value !== null && typeof value === `object`) {
      if (value.fresh === `collationTie`) {
        const entries: Array<[string, number]> = [
          [`\u00C5`, 1],
          [`A\u030A`, 2],
        ]
        if (value.reversed) entries.reverse()
        return [Object.fromEntries(entries), m]
      }
      if (value.fresh === `unkeyedPair`) return [[true, { v: value.v }], m]
      return [value.fresh === `object` ? { v: value.v } : [...value.pair], m]
    }
    return [value, m]
  })
  // One non-keyed record makes the whole multiset unkeyed.
  if (history.mode === `fallback`) records.push([{ v: 1 }, 1])
  if (history.mode === `keyedCollision`) {
    const [[[name, opposed], scale]] = history.steps as [
      [[string, boolean], number],
    ]
    // Fresh objects per history, with each original object mapped to one
    // clone, so references a witness shares stay shared within a history.
    const clones = new Map<object, object>()
    const fresh = (value: Data): Data =>
      Array.isArray(value)
        ? value.map(fresh)
        : value !== null && typeof value === `object`
          ? (clones.get(value) ?? clones.set(value, { ...value }).get(value)!)
          : value
    return collisionCases
      .find((entry) => entry.name === name)!
      .records.map(([data, m], index) => [
        fresh(data),
        opposed ? (index === 0 ? scale : -scale) : m * scale,
      ])
  }
  return records
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------
//
// The driver consolidates the plan's records and records plain data. An
// output object, array, function, or symbol is named by the first input
// record that is the same reference (or as fresh when none is); a primitive,
// which has no identity, by its type and text, with -0 kept distinct. It also records the
// input's references, multiplicities, and contents before and after.

type Name = { input: number } | { type: string; text: string }
type Consolidated = {
  output: Array<{ data: Name; multiplicity: number }>
  inputBefore: string
  inputAfter: string
  /** Positions whose data or multiplicity changed (`Object.is`). */
  inputChanged: Array<number>
}

const isReference = (data: Data) =>
  (data !== null && typeof data === `object`) ||
  typeof data === `function` ||
  typeof data === `symbol`
const primitiveName = (data: Data): Name => ({
  type: typeof data,
  text: Object.is(data, -0) ? `-0` : String(data),
})

function nameOf(records: MultiSetArray<Data>, data: Data): Name {
  if (!isReference(data)) return primitiveName(data)
  const index = records.findIndex(([input]) => input === data)
  return index >= 0
    ? { input: index }
    : { type: `fresh ${typeof data}`, text: `` }
}

/** The records one history builds, and the mode they were built in. */
type Plan = { mode: Mode; records: MultiSetArray<Data> }

function driveConsolidation(
  { records }: Plan,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const before = records.map(([data, m]) => [data, m] as const)
  const ids = new Map<object | symbol, number>()
  const inputBefore = contentsOf(records, ids)
  const output = new MultiSet(records).consolidate().getInner()
  observe(`consolidated`, {
    output: output.map(([data, multiplicity]) => ({
      data: nameOf(records, data),
      multiplicity,
    })),
    inputBefore,
    inputAfter: contentsOf(records, ids),
    inputChanged: before.flatMap(([data, m], index) =>
      Object.is(records[index]?.[0], data) && Object.is(records[index]?.[1], m)
        ? []
        : [index],
    ),
  } satisfies Consolidated)
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------
//
// Each output record must name an owed identity once, with the identity's
// summed multiplicity (`merge`), and be the identity's first input record,
// normalized as rule 2 says (`retained`); every owed identity must appear
// (`merge`); the input must be unchanged (`input`).

function owedName(first: Data, firstIndex: number): Name {
  return isReference(first) ? { input: firstIndex } : primitiveName(first)
}

function decode(records: MultiSetArray<Data>, name: Name): Data | undefined {
  if (`input` in name) return records[name.input]?.[0]
  if (name.type === `number`) return Number(name.text)
  if (name.type === `string`) return name.text
  if (name.type === `boolean`) return name.text === `true`
  if (name.type === `bigint`) return BigInt(name.text)
  if (name.type === `undefined`) return undefined
  return name.text === `null` ? null : name.text
}

function checkConsolidation(
  { records }: Plan,
  trace: ReadonlyArray<Observation>,
  { groups, sameIdentity }: Expected,
) {
  const seen = trace.find(({ checkpoint }) => checkpoint === `consolidated`)
    ?.value as Consolidated | undefined
  if (!seen)
    return violation(`consolidated`, `the driver recorded nothing`, `trace`)
  const inputWrong =
    differs(
      `consolidated`,
      `input`,
      seen.inputChanged,
      [],
      `input records changed`,
    ) ??
    differs(
      `consolidated`,
      `input`,
      seen.inputAfter,
      seen.inputBefore,
      `input record contents changed`,
    )
  if (inputWrong) return inputWrong
  const matched = new Set<number>()
  for (const [position, { data, multiplicity }] of seen.output.entries()) {
    const value = decode(records, data)
    const index = groups.findIndex(({ first }) => sameIdentity(first, value))
    if (index < 0)
      return violation(
        `consolidated`,
        `output entry ${position} ${JSON.stringify(data)} is no owed identity`,
        `merge`,
      )
    if (matched.has(index))
      return violation(
        `consolidated`,
        `output entry ${position} repeats identity ${index}`,
        `merge`,
      )
    matched.add(index)
    const group = groups[index]!
    const wrong =
      differs(
        `consolidated`,
        `merge`,
        multiplicity,
        group.sum,
        `identity ${index} has another multiplicity`,
      ) ??
      differs(
        `consolidated`,
        `retained`,
        data,
        owedName(group.first, group.firstIndex),
        `identity ${index} kept another record`,
      )
    if (wrong) return wrong
  }
  const missing = groups.flatMap((_, index) =>
    matched.has(index) ? [] : [index],
  )
  return (
    differs(
      `consolidated`,
      `merge`,
      missing,
      [],
      `owed identities are missing`,
    ) ?? pass
  )
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

const modes = [
  `keyed`,
  `keyedCollision`,
  `numbers`,
  `strings`,
  `structural`,
  `fallback`,
] as const
const witness = (name: string): History => ({
  mode: `keyedCollision`,
  steps: [[[name, false], 1]],
})

oracleProperty({
  id: `ivm.multiset-consolidate`,
  law: {
    statement: `MultiSet.consolidate() keeps one record per identity, the first in input order (with -0 written as 0 for unkeyed numbers), with the summed multiplicity; an identity whose sum is zero is absent; identity is keyed, single-primitive, or structural by the shape of the whole multiset; the input is unchanged.`,
    authority: `the contract comment on MultiSet.consolidate() in packages/db-ivm/src/multiset.ts (b5d92ceb)`,
    limits: `Output order is not part of the law. The keyed grammar includes the type, reference, and delimiter collisions of #1948 and non-finite numeric keys; MultiSet directly, not the query shapes that produce these records. Structural identity uses a 32-bit hash; the small domain makes a collision unlikely, not impossible. Key order only for one collation tie.`,
    owner: `Structural values and ordered primitives`,
  },
  histories: {
    arbitrary: historyArb,
    states: [],
    measured: [
      ...modes,
      `records merged`,
      `join tuples merged`,
      `only pairs without a key`,
    ],
    runs: 300,
    fixedSeeds: [2026929],
    // Pinned witnesses for each identity rule. Generated histories can reach
    // many of these, but pinning them makes each rule visible and stable.
    pins: [
      ...collisionCases.map(({ name }) => ({
        name,
        enters: [`keyedCollision`],
        history: witness(name),
      })),
      {
        name: `keyed object values merge by reference, not by contents`,
        enters: [`keyed`],
        history: {
          mode: `keyed`,
          steps: [
            [[0, { kind: `obj`, i: 0 }], 1],
            [[0, { kind: `obj`, i: 1 }], -1],
            [[0, { kind: `obj`, i: 0 }], 1],
          ],
        },
      },
      {
        name: `fresh join tuples with the same elements merge`,
        enters: [`keyed`, `records merged`],
        history: {
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
      },
      {
        name: `arrays of other lengths stay reference values`,
        enters: [`keyed`],
        history: {
          mode: `keyed`,
          steps: [
            [[1, { kind: `triple`, i: 0 }], 1],
            [[1, { kind: `triple`, i: 0 }], 1],
          ],
        },
      },
      {
        name: `one non-keyed record makes equal contents merge structurally`,
        enters: [`fallback`, `records merged`],
        history: {
          mode: `fallback`,
          steps: [
            [[0, { kind: `obj`, i: 0 }], 1],
            [[0, { kind: `obj`, i: 1 }], 1],
          ],
        },
      },
      {
        name: `single-number data merges -0 with 0 and returns 0`,
        // A Set already treats -0 and 0, and NaN and NaN, as one record, so
        // this merge does not count as `records merged`.
        enters: [`numbers`],
        history: {
          mode: `numbers`,
          steps: [
            [-0, 1],
            [0, 1],
            [NaN, 1],
            [NaN, 1],
          ],
        },
      },
      {
        name: `single-string data merges equal strings`,
        enters: [`strings`, `records merged`],
        history: {
          mode: `strings`,
          steps: [
            [`p`, 1],
            [`q`, 2],
            [`p`, -1],
          ],
        },
      },
      {
        name: `pairs without a key merge equal object contents structurally`,
        enters: [`structural`, `only pairs without a key`, `records merged`],
        history: {
          mode: `structural`,
          steps: [
            [{ fresh: `unkeyedPair`, v: 0 }, 1],
            [{ fresh: `unkeyedPair`, v: 0 }, 1],
            [{ fresh: `unkeyedPair`, v: 1 }, -1],
          ],
        },
      },
      {
        name: `unkeyed structural data keeps 1 and "1" apart`,
        enters: [`structural`],
        history: {
          mode: `structural`,
          steps: [
            [1, 1],
            [`1`, -1],
            [1, 1],
          ],
        },
      },
    ],
  },
  resolve: (history): Plan => ({
    mode: history.mode,
    records: buildRecords(history),
  }),
  model: ({ records }) => expectedConsolidation(records),
  // A history's mode, and whether consolidation merged or cancelled records
  // (fewer owed identities than distinct input records).
  reached: ({ mode, records }, _trace, expected) => [
    mode,
    ...(expected.groups.length < new Set(records.map(([data]) => data)).size
      ? [`records merged`]
      : []),
    // Two fresh join tuples of one key with the same elements.
    ...(mode === `keyed` &&
    expected.groups.some(
      ({ first }) =>
        Array.isArray((first as [unknown, unknown])[1]) &&
        records.filter(([data]) => expected.sameIdentity(first, data)).length >
          1,
    )
      ? [`join tuples merged`]
      : []),
    ...(records.length > 0 &&
    records.every(
      ([data]) =>
        Array.isArray(data) &&
        data.length === 2 &&
        typeof data[0] !== `string` &&
        typeof data[0] !== `number`,
    )
      ? [`only pairs without a key`]
      : []),
  ],
  driver: driveConsolidation,
  check: checkConsolidation,
  calibrations: [
    {
      name: `one identity appears twice`,
      law: `merge`,
      corrupt: (trace) =>
        trace.map((entry) => {
          const value = entry.value as Consolidated
          return entry.checkpoint === `consolidated` && value.output.length > 0
            ? {
                ...entry,
                value: {
                  ...value,
                  output: [...value.output, value.output[0]!],
                },
              }
            : entry
        }),
    },
    {
      name: `a multiplicity is not summed`,
      law: `merge`,
      corrupt: (trace) =>
        trace.map((entry) => {
          const value = entry.value as Consolidated
          return entry.checkpoint === `consolidated` && value.output.length > 0
            ? {
                ...entry,
                value: {
                  ...value,
                  output: value.output.map((record, index) =>
                    index === 0
                      ? { ...record, multiplicity: record.multiplicity + 1 }
                      : record,
                  ),
                },
              }
            : entry
        }),
    },
    {
      // A later record of the same identity, under another reference, named
      // in place of the first.
      name: `a later record of an identity is retained`,
      law: `retained`,
      corrupt: (trace, { records }) => {
        const value = trace.find(
          ({ checkpoint }) => checkpoint === `consolidated`,
        )?.value as Consolidated | undefined
        if (!value) return undefined
        const { sameIdentity } = expectedConsolidation(records)
        for (const [position, { data }] of value.output.entries()) {
          if (!(`input` in data)) continue
          const first = records[data.input]![0]
          const later = records.findIndex(
            ([candidate], index) =>
              index > data.input &&
              candidate !== first &&
              sameIdentity(first, candidate),
          )
          if (later < 0) continue
          return trace.map((entry) =>
            entry.checkpoint === `consolidated`
              ? {
                  ...entry,
                  value: {
                    ...value,
                    output: value.output.map((record, index) =>
                      index === position
                        ? { ...record, data: { input: later } }
                        : record,
                    ),
                  },
                }
              : entry,
          )
        }
        return undefined
      },
    },
    {
      name: `consolidation changes the input`,
      law: `input`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `consolidated`
            ? {
                ...entry,
                value: { ...(entry.value as Consolidated), inputChanged: [0] },
              }
            : entry,
        ),
    },
  ],
})
