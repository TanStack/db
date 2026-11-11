import { Temporal } from 'temporal-polyfill'
import { describe, expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  equalHashValues,
  hash,
  registerOpaqueHash,
} from '../src/hashing/hash.js'
import {
  differs,
  oracleProperty,
  pass,
} from '../../db/tests/oracle-property.js'
import { colliding } from './hash-collision-support.js'
import {
  SENTINEL,
  SYMBOLS,
  TEMPORALS,
  identity,
  nodes,
  num,
  pairArb,
  primitiveArb,
} from './hash-identity-grammar-oracle.js'
import type { Pair, RefKind, Spec } from './hash-identity-grammar-oracle.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'

/**
 * # Which values share D2 value identity?
 *
 * `hash` fingerprints a value, and `equalHashValues` compares two values
 * without a digest (`topKBatch` uses it to cancel a retraction against its
 * replacement). Both use D2 value identity:
 *
 * 1. **Primitives** compare by value. `-0` equals `0`, `NaN` equals `NaN`,
 *    and a bigint differs from the number with the same text. Symbols compare
 *    by identity.
 * 2. **Reference leaves** compare by identity: functions, handles registered
 *    with `registerOpaqueHash`, `File` values, and binary values of more than
 *    128 bytes.
 * 3. **Dates** compare by timestamp. All invalid dates are equal.
 * 4. **Binary values** of at most 128 bytes compare by their bytes. A `Buffer`
 *    equals a `Uint8Array` with the same bytes.
 * 5. **Temporal values** compare by type tag and string form.
 * 6. **Regular expressions** compare by source, flags, `lastIndex`, and their
 *    enumerable own properties.
 * 7. **Arrays** compare by length and enumerable own properties. A hole
 *    differs from `undefined`.
 * 8. **Maps and Sets** compare by their entries or values in insertion order.
 *    Other properties on a Map or Set do not count.
 * 9. **Other objects** compare by their enumerable own string and symbol
 *    properties, in any order. The prototype and non-enumerable properties do
 *    not count.
 *
 * Laws checked for each generated pair:
 *
 * - `equalHashValues(a, b)` is true exactly when the model identities of the
 *   two value specs are equal.
 * - Equal identities have equal hashes. Distinct identities may have the same
 *   32-bit digest; `equalHashValues` must still distinguish them.
 * - For cyclic values, `equalHashValues` follows the same rules and `hash`
 *   throws a `TypeError`.
 * - Type identity does not depend on random hash values. Every law above also
 *   runs in a second copy of the module whose initialization draws are all
 *   equal, so every type marker has the same hash number.
 *
 * Authority: the method comments in `src/hashing/hash.ts`, and the behavior at
 * `8283f2e8`, which this file fixes before the hash dispatch refactor.
 *
 * Limits:
 * - Arrays from another realm (`node:vm`) are outside the grammar. An ordinary
 *   test in hash-identity.test.ts keeps equality's length check for them.
 * - Work and depth caps belong to `hash-work.test.ts`.
 * - Map and Set order sensitivity and ignored Map/Set properties are current
 *   behavior. No contract promises them.
 * - Getters and proxies are outside the grammar.
 * - A RegExp with a `NaN` `lastIndex` is outside the grammar: equality
 *   compares RegExp fields with `===`, but hashing normalizes `NaN`. An
 *   ordinary test in hash-identity.test.ts holds the equality side.
 * - Cycles run through arrays, Map values, Sets, and plain objects. Cycles
 *   through other carriers, and pairs that differ only in a back-edge target,
 *   would need a bisimulation model.
 */

// ---------------------------------------------------------------------------
// Value specs, the identity model (`identity`, `canon`), and the grammar
// (`pairArb`, with its near-miss mutations) live in
// hash-identity-grammar-oracle.ts. Their fixed-seed census is in
// hash-identity-grammar.test.ts. The driver and checks below stay here.

// Reference leaves are shared by both sides of a pair: equal ids are the same
// object, and different ids are different objects with the same contents.
const refs = new Map<string, object>()
function refObject(kind: RefKind, id: number): object {
  const name = `${kind}:${id}`
  let value = refs.get(name)
  if (value === undefined) {
    if (kind === `fn`) value = () => 0
    else if (kind === `file`) value = new File([`x`], `f.txt`)
    else if (kind === `bigbin`) value = new Uint8Array(200)
    else {
      value = { state: 1 }
      registerOpaqueHash(value)
      colliding.registerOpaqueHash(value)
    }
    refs.set(name, value)
  }
  return value
}

// ---------------------------------------------------------------------------
// Realization. Each side is built as fresh objects. `seed` varies property
// order, prototypes, hidden properties, carriers, and signed zero; none of
// them changes the identity.

function realize(spec: Spec, seed: number): unknown {
  let state = seed >>> 0 || 1
  const coin = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) % 2 === 1
  }
  const ancestors: Array<object> = []

  function build(node: Spec): unknown {
    switch (node.k) {
      case `num`:
        return node.v === 0 && coin() ? -0 : node.v
      case `str`:
      case `bool`:
      case `big`:
        return node.v
      case `null`:
        return null
      case `undef`:
        return undefined
      case `sym`:
        return SYMBOLS[node.id]
      case `ref`:
        return refObject(node.kind, node.id)
      case `date`:
        return new Date(node.t)
      case `bin`:
        return coin() ? Buffer.from(node.bytes) : new Uint8Array(node.bytes)
      case `temporal`: {
        const [type, text] = TEMPORALS[node.i]!
        return (Temporal[type] as { from: (text: string) => unknown }).from(
          text,
        )
      }
      case `regex`: {
        const value = new RegExp(node.source, node.flags)
        value.lastIndex = node.lastIndex
        return container(value, () => {
          if (node.p) Object.assign(value, { p: build(node.p) })
        })
      }
      case `array`: {
        const value: Array<unknown> = []
        value.length = node.items.length
        return container(value, () => {
          node.items.forEach((item, index) => {
            if (item !== null) value[index] = build(item)
          })
          if (node.p) Object.assign(value, { p: build(node.p) })
        })
      }
      case `twice`: {
        const first = build(node.child)
        return [first, coin() ? first : build(node.child)]
      }
      case `map`: {
        const value = new Map<unknown, unknown>()
        return container(value, () => {
          for (const [key, child] of node.entries)
            value.set(build(key), build(child))
          if (coin()) Object.assign(value, { extra: 1 })
        })
      }
      case `set`: {
        const value = new Set<unknown>()
        return container(value, () => {
          for (const item of node.items) value.add(build(item))
          if (coin()) Object.assign(value, { extra: 1 })
        })
      }
      case `obj`: {
        const value: Record<PropertyKey, unknown> = coin()
          ? Object.create(coin() ? null : Carrier.prototype)
          : {}
        return container(value, () => {
          const entries = coin() ? [...node.entries].reverse() : node.entries
          for (const [key, child] of entries) value[key] = build(child)
          for (const [id, child] of node.syms)
            value[SYMBOLS[id]!] = build(child)
          if (coin()) Object.defineProperty(value, `hidden`, { value: coin() })
        })
      }
      case `back`:
        return ancestors[ancestors.length - node.up]
    }
  }
  function container<T extends object>(value: T, fill: () => void): T {
    ancestors.push(value)
    fill()
    ancestors.pop()
    return value
  }
  return build(spec)
}

class Carrier {}

// ---------------------------------------------------------------------------
// Cyclic histories. A back edge points at a container ancestor. The unequal
// side replaces one primitive leaf with SENTINEL, which no pool value equals.

type CyclicPair = { spec: Spec; changed: Spec; seeds: [number, number] }

const cyclicArb: fc.Arbitrary<CyclicPair> = fc
  .tuple(
    fc.constantFrom(`array`, `map`, `set`, `obj`),
    fc.array(fc.oneof(primitiveArb, fc.constant(null)), {
      minLength: 1,
      maxLength: 3,
    }),
    fc.nat(2),
    fc.nat(),
    fc.nat(),
  )
  .map(([kind, leaves, depth, left, right]) => {
    // A chain of containers `depth + 1` deep, with a back edge from the
    // innermost container to one of its ancestors.
    const up = (left % (depth + 1)) + 1
    const children = (inner: Array<Spec>): Spec =>
      kind === `array`
        ? { k: `array`, items: inner }
        : kind === `map`
          ? {
              k: `map`,
              entries: inner.map((child, i) => [
                { k: `str`, v: `k${i}` },
                child,
              ]),
            }
          : kind === `set`
            ? { k: `set`, items: inner }
            : {
                k: `obj`,
                entries: inner.map((child, i) => [`k${i}`, child]),
                syms: [],
              }
    const leafSpecs = leaves.map((leaf) => leaf ?? num(1))
    let spec = children([...leafSpecs, { k: `back`, up }])
    for (let level = 0; level < depth; level++) spec = children([spec])
    const [, replace] = nodes(spec).find(
      ([node]) =>
        node.k !== `back` &&
        node.k !== `array` &&
        node.k !== `set` &&
        node.k !== `map` &&
        node.k !== `obj`,
    )!
    return {
      spec,
      changed: replace({ k: `str`, v: SENTINEL }),
      seeds: [left, right] as [number, number],
    }
  })

// ---------------------------------------------------------------------------
// Production driver and refinement checks.

type Module = {
  name: string
  hash: (value: unknown) => number
  equalHashValues: (left: unknown, right: unknown) => boolean
}
const MODULES: ReadonlyArray<Module> = [
  { name: `native`, hash, equalHashValues },
  {
    name: `colliding markers`,
    hash: colliding.hash,
    equalHashValues: colliding.equalHashValues,
  },
]

type PairPlan = { pair: Pair; seeds: [number, number] }
type Observe = (checkpoint: string, value: unknown) => void

function expectedPair({ pair }: PairPlan): boolean {
  return identity(pair.left) === identity(pair.right)
}

function drivePair(
  { pair, seeds }: PairPlan,
  observe: Observe,
  modules: ReadonlyArray<Module> = MODULES,
): void {
  const expected = identity(pair.left) === identity(pair.right)
  const left = realize(pair.left, seeds[0])
  const right = realize(pair.right, seeds[1])
  for (const module of modules) {
    const context = `${module.name}, ${pair.mutation}: ${identity(pair.left)} vs ${identity(pair.right)}`
    observe(`equality, ${context}`, {
      kind: `equality`,
      actual: module.equalHashValues(left, right),
    })
    observe(`symmetry, ${context}`, {
      kind: `equality`,
      actual: module.equalHashValues(right, left),
    })
    if (expected)
      observe(`hash, ${context}`, {
        kind: `hash consequence`,
        actual: Object.is(module.hash(left), module.hash(right)),
      })
  }
}

function checkPair(
  _plan: PairPlan,
  trace: ReadonlyArray<Observation>,
  expected: boolean,
): Verdict {
  for (const { checkpoint, value } of trace) {
    const actual = value as { kind: string; actual: unknown }
    const mismatch = differs(
      checkpoint,
      actual.kind,
      actual.actual,
      actual.kind === `equality` ? expected : true,
    )
    if (mismatch) return mismatch
  }
  return pass
}

function driveCyclicPair(
  { spec, changed, seeds }: CyclicPair,
  observe: Observe,
): void {
  const left = realize(spec, seeds[0])
  const same = realize(spec, seeds[1])
  const other = realize(changed, seeds[1])
  for (const module of MODULES) {
    observe(`${module.name} equality`, {
      kind: `equality`,
      actual: module.equalHashValues(left, same),
    })
    observe(`${module.name} inequality`, {
      kind: `inequality`,
      actual: module.equalHashValues(left, other),
    })
    // A thrown TypeError is an observation promised by this cyclic-value law.
    // Only this hash call is captured; realization and equality errors escape.
    let rejection = false
    try {
      module.hash(left)
    } catch (error) {
      rejection =
        error instanceof TypeError &&
        error.message === `Cannot hash cyclic structural values`
    }
    observe(`${module.name} cycle rejection`, {
      kind: `cycle rejection`,
      actual: rejection,
    })
  }
}

function expectedCyclicPair() {
  return { equality: true, inequality: false, [`cycle rejection`]: true }
}
function checkCyclicPair(
  _plan: CyclicPair,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedCyclicPair>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    const actual = value as { kind: keyof typeof expected; actual: unknown }
    const mismatch = differs(
      checkpoint,
      actual.kind,
      actual.actual,
      expected[actual.kind],
    )
    if (mismatch) return mismatch
  }
  return pass
}

// The model is `identity` (and its encoding `canon`): equal identities must
// share a verdict and hash. The grammar `pairArb` is calibrated below.
// What this oracle owns: the gap report judges these entries, and their
// reference trees within the package, by this file's tests.

// ---------------------------------------------------------------------------
// Campaigns. Each generated property has a fixed campaign and a random
// campaign over the same grammar and check. A path replay of one property
// runs its recorded history once and every other test stands aside. A seed
// alone reseeds the random campaigns.

describe(`hash identity oracle`, () => {
  oracleProperty({
    id: `ivm.hash-identity`,
    law: {
      statement: `D2 equality is symmetric and agrees with independent value identity; equal identities have equal hashes under native and colliding-marker modules.`,
      authority: `The existing nine value-identity rules documented above.`,
      limits: `The original bounded recursive value-spec grammar, mutations and realization seeds; collision freedom is not promised.`,
    },
    owns: [
      `src/hashing/hash.ts#hash`,
      `src/hashing/hash.ts#equalHashValues`,
      `src/hashing/hash.ts#registerOpaqueHash`,
    ],
    histories: {
      arbitrary: fc.tuple(pairArb, fc.nat(), fc.nat()),
      runs: 300,
      fixedSeeds: [2026930],
    },
    resolve: ([pair, left, right]) => ({
      pair,
      seeds: [left, right] as [number, number],
    }),
    model: expectedPair,
    driver: drivePair,
    check: checkPair,
  })
  oracleProperty({
    id: `ivm.hash-identity-cycles`,
    law: {
      statement: `Constructed equal cyclic values compare equal, the changed cyclic value differs, and hashing rejects with the existing cyclic-structural-value TypeError.`,
      authority: `The existing cyclic value-identity contract documented above.`,
      limits: `The original array/Map/Set/object cyclic spec and leaf-replacement grammar; no arbitrary graph-shape claim is added.`,
    },
    owns: [
      `src/hashing/hash.ts#hash`,
      `src/hashing/hash.ts#equalHashValues`,
      `src/hashing/hash.ts#registerOpaqueHash`,
    ],
    histories: { arbitrary: cyclicArb, runs: 300, fixedSeeds: [2026930] },
    model: expectedCyclicPair,
    driver: driveCyclicPair,
    check: checkCyclicPair,
  })

  // Fixed witnesses for rules that a wrong design would plausibly break.
  const fixedWitnesses: Array<[string, Spec, Spec]> = [
    [
      `a hole differs from undefined`,
      { k: `array`, items: [null, num(1)] },
      { k: `array`, items: [{ k: `undef` }, num(1)] },
    ],
    [
      `a trailing hole changes the length`,
      { k: `array`, items: [num(1)] },
      { k: `array`, items: [num(1), null] },
    ],
    [
      `lastIndex distinguishes regular expressions`,
      { k: `regex`, source: `a`, flags: `g`, lastIndex: 0 },
      { k: `regex`, source: `a`, flags: `g`, lastIndex: 1 },
    ],
    [
      `Map entry order counts`,
      {
        k: `map`,
        entries: [
          [{ k: `str`, v: `a` }, num(1)],
          [{ k: `str`, v: `b` }, num(2)],
        ],
      },
      {
        k: `map`,
        entries: [
          [{ k: `str`, v: `b` }, num(2)],
          [{ k: `str`, v: `a` }, num(1)],
        ],
      },
    ],
    [
      `a Map differs from an array of its entries`,
      { k: `map`, entries: [[{ k: `str`, v: `a` }, num(1)]] },
      {
        k: `array`,
        items: [{ k: `array`, items: [{ k: `str`, v: `a` }, num(1)] }],
      },
    ],
    [
      `a Set differs from an array of its values`,
      { k: `set`, items: [num(1), num(2)] },
      { k: `array`, items: [num(1), num(2)] },
    ],
    [
      `an empty Map differs from an empty Set`,
      { k: `map`, entries: [] },
      { k: `set`, items: [] },
    ],
    [
      `an empty Map differs from an empty array and an empty object`,
      { k: `map`, entries: [] },
      { k: `array`, items: [] },
    ],
    [
      `an empty Set differs from an empty object`,
      { k: `set`, items: [] },
      { k: `obj`, entries: [], syms: [] },
    ],
    [
      `a Set differs from a Map with the same entry pairs`,
      {
        k: `set`,
        items: [{ k: `array`, items: [{ k: `str`, v: `a` }, num(1)] }],
      },
      { k: `map`, entries: [[{ k: `str`, v: `a` }, num(1)]] },
    ],
    [
      `an object Map key compares by structure`,
      {
        k: `map`,
        entries: [[{ k: `obj`, entries: [[`a`, num(1)]], syms: [] }, num(1)]],
      },
      {
        k: `map`,
        entries: [[{ k: `obj`, entries: [[`a`, num(2)]], syms: [] }, num(1)]],
      },
    ],
    [
      `a number Map key differs from its text`,
      { k: `map`, entries: [[num(1), num(1)]] },
      { k: `map`, entries: [[{ k: `str`, v: `1` }, num(1)]] },
    ],
    [
      `a Map key counts`,
      { k: `map`, entries: [[{ k: `str`, v: `a` }, num(1)]] },
      { k: `map`, entries: [[{ k: `str`, v: `b` }, num(1)]] },
    ],
    [
      `binary values differ from arrays of their bytes`,
      { k: `bin`, bytes: [1, 2] },
      { k: `array`, items: [num(1), num(2)] },
    ],
    [
      `registered handles with equal contents differ`,
      { k: `ref`, kind: `handle`, id: 0 },
      { k: `ref`, kind: `handle`, id: 1 },
    ],
    [
      `large binary values compare by reference`,
      { k: `ref`, kind: `bigbin`, id: 0 },
      { k: `ref`, kind: `bigbin`, id: 1 },
    ],
    [
      `binary values with one changed byte differ`,
      { k: `bin`, bytes: [1, 2] },
      { k: `bin`, bytes: [1, 3] },
    ],
    [`invalid dates are equal`, { k: `date`, t: NaN }, { k: `date`, t: NaN }],
    [`a date differs from its timestamp`, { k: `date`, t: 1 }, num(1)],
    [`a bigint differs from the equal number`, { k: `big`, v: 1n }, num(1)],
    [
      `Temporal values compare by type and text`,
      { k: `temporal`, i: 0 },
      { k: `temporal`, i: 1 },
    ],
    [
      `symbol keys compare by identity`,
      { k: `obj`, entries: [], syms: [[0, num(1)]] },
      { k: `obj`, entries: [], syms: [[1, num(1)]] },
    ],
  ]
  // The fixed witnesses run through the same driver, model, and check as the
  // generated campaign. pairArb is a chained arbitrary, so it cannot take
  // these pairs back; they form one enumerated property. Each former test ran
  // its pair under several realization seeds; each seed pair is a history.
  const fixedPairHistories: Array<PairPlan & { name: string }> = [
    ...fixedWitnesses.flatMap(([name, left, right]) =>
      (
        [
          [1, 2],
          [3, 4],
        ] as Array<[number, number]>
      ).map((seeds) => ({
        name,
        pair: { left, right, mutation: `replace` as const },
        seeds,
      })),
    ),
    // Some seeds share the child on the left side.
    ...Array.from({ length: 19 }, (_, index) => index + 1).map((seed) => ({
      name: `does not accept a second copy because the first copy matched`,
      pair: {
        left: {
          k: `twice`,
          child: { k: `obj`, entries: [[`a`, num(1)]], syms: [] },
        } satisfies Spec,
        right: {
          k: `array`,
          items: [
            { k: `obj`, entries: [[`a`, num(1)]], syms: [] },
            { k: `obj`, entries: [[`a`, num(2)]], syms: [] },
          ],
        } satisfies Spec,
        mutation: `split` as const,
      },
      seeds: [seed, seed] as [number, number],
    })),
    // Different seeds choose sharing, prototypes, carriers, and -0.
    ...Array.from({ length: 39 }, (_, index) => index + 1).map((seed) => {
      const spec: Spec = {
        k: `twice`,
        child: {
          k: `obj`,
          entries: [
            [`a`, num(0)],
            [`b`, { k: `bin`, bytes: [1] }],
          ],
          syms: [],
        },
      }
      return {
        name: `treats shared and copied subtrees, prototypes, and hidden properties as equal`,
        pair: { left: spec, right: spec, mutation: `none` as const },
        seeds: [seed, seed + 101] as [number, number],
      }
    }),
  ]
  oracleProperty({
    id: `ivm.hash-identity-fixed`,
    law: {
      statement: `D2 equality is symmetric and agrees with independent value identity; equal identities have equal hashes under native and colliding-marker modules.`,
      authority: `The existing nine value-identity rules documented above.`,
      limits: `Named witnesses for rules that a wrong design would plausibly break, which the chained pair grammar cannot take back; each is replayed under its former realization seeds through the same driver, model, and check.`,
    },
    owns: [
      `src/hashing/hash.ts#hash`,
      `src/hashing/hash.ts#equalHashValues`,
      `src/hashing/hash.ts#registerOpaqueHash`,
    ],
    histories: fixedPairHistories,
    label: ({ name, seeds }) => `${name} (seeds ${seeds[0]}, ${seeds[1]})`,
    model: expectedPair,
    driver: drivePair,
    check: checkPair,
  })

  // A map and a set whose colliding-marker digests are equal. The driver
  // first confirms the collision, so the witness tests identity and not the
  // digest. A digest-only equality must be rejected on it.
  const digestOnly: Module = {
    name: `digest-only mutant`,
    hash: colliding.hash,
    equalHashValues: (a, b) => colliding.hash(a) === colliding.hash(b),
  }
  function driveDigestCollision(
    plan: PairPlan,
    observe: Observe,
    modules: ReadonlyArray<Module> = MODULES,
  ): void {
    const left = realize(plan.pair.left, plan.seeds[0])
    const right = realize(plan.pair.right, plan.seeds[1])
    expect(colliding.hash(left)).toBe(colliding.hash(right))
    drivePair(plan, observe, modules)
  }
  oracleProperty({
    id: `ivm.hash-identity-digest-collision`,
    law: {
      statement: `D2 equality is symmetric and agrees with independent value identity; equal identities have equal hashes under native and colliding-marker modules.`,
      authority: `The existing nine value-identity rules documented above.`,
      limits: `One map and set pair whose colliding-marker digests are equal; a digest-only equality calibrates the comparison.`,
    },
    owns: [
      `src/hashing/hash.ts#hash`,
      `src/hashing/hash.ts#equalHashValues`,
      `src/hashing/hash.ts#registerOpaqueHash`,
    ],
    histories: [
      {
        pair: {
          left: { k: `map`, entries: [] },
          right: { k: `set`, items: [] },
          mutation: `retype`,
        },
        seeds: [1, 2],
      },
    ] satisfies Array<PairPlan>,
    label: () =>
      `keeps distinct identities separate when their digests collide`,
    model: expectedPair,
    driver: driveDigestCollision,
    check: checkPair,
    calibrations: [
      {
        name: `rejects a digest-only equality on colliding digests`,
        law: `equality`,
        driver: (plan, observe) =>
          driveDigestCollision(plan, observe, [digestOnly]),
      },
    ],
  })
})
