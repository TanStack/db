import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  equalHashValues,
  hash,
  registerOpaqueHash,
} from '../src/hashing/hash.js'

/**
 * # Which values do structural hashing and structural equality identify?
 *
 * `hash` fingerprints a value, and `equalHashValues` compares two values
 * without a digest (`topKBatch` uses it to cancel a retraction against its
 * replacement). Both use one value identity:
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
 * - Equal identities have equal hashes. Distinct identities have distinct
 *   hashes; this is a sampled control, because a 32-bit hash can collide.
 * - For cyclic values, `equalHashValues` follows the same rules and `hash`
 *   throws a `TypeError`.
 *
 * Authority: the method comments in `src/hashing/hash.ts`, and the behavior at
 * `8283f2e8`, which this file pins before the hash dispatch refactor.
 *
 * Limits:
 * - Arrays from another realm (`node:vm`) are outside the grammar.
 * - Work and depth caps belong to `hash-work.test.ts`.
 * - Map and Set order sensitivity and ignored Map/Set properties are current
 *   behavior. No contract promises them.
 * - Getters and proxies are outside the grammar.
 */

// ---------------------------------------------------------------------------
// Value specs. A spec is plain data, so the model never reads production
// objects.

type Spec =
  | { k: `num`; v: number }
  | { k: `str`; v: string }
  | { k: `bool`; v: boolean }
  | { k: `null` }
  | { k: `undef` }
  | { k: `big`; v: bigint }
  | { k: `sym`; id: number }
  | { k: `ref`; kind: RefKind; id: number }
  | { k: `date`; t: number }
  | { k: `bin`; bytes: Array<number> }
  | { k: `temporal`; i: number }
  | { k: `regex`; source: string; flags: string; lastIndex: number; p?: Spec }
  | { k: `array`; items: Array<Spec | null>; p?: Spec }
  | { k: `twice`; child: Spec }
  | { k: `map`; entries: Array<[string, Spec]> }
  | { k: `set`; items: Array<string | number> }
  | { k: `obj`; entries: Array<[string, Spec]>; syms: Array<[number, Spec]> }
  | { k: `back`; up: number }

type RefKind = `fn` | `handle` | `file` | `bigbin`

const TEMPORALS: ReadonlyArray<[keyof typeof Temporal, string]> = [
  [`PlainDate`, `2024-01-15`],
  [`PlainDate`, `2024-01-16`],
  [`Duration`, `P1D`],
  [`Instant`, `2024-01-15T00:00:00Z`],
]
const SYMBOLS = [Symbol(`s0`), Symbol(`s1`)]
const OBJECT_KEYS = [`a`, `b`, `c`, `0`, `1`]
// No value in any pool equals this text, so a leaf that holds it makes a
// cyclic value unequal to its original.
const SENTINEL = `\u0000sentinel`

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
    }
    refs.set(name, value)
  }
  return value
}

// ---------------------------------------------------------------------------
// Model: a canonical encoding of a spec's identity.

function identity(spec: Spec): string {
  return JSON.stringify(canon(spec, []))
}

function canon(spec: Spec, path: Array<Spec>): unknown {
  const inner = (child: Spec) => canon(child, [...path, spec])
  const props = (p: Spec | undefined) => (p ? [[`p`, inner(p)]] : [])
  switch (spec.k) {
    case `num`:
      // `String` writes -0 as `0` and keeps NaN and infinities distinct.
      return [`num`, String(spec.v)]
    case `str`:
    case `bool`:
      return [spec.k, spec.v]
    case `null`:
    case `undef`:
      return [spec.k]
    case `big`:
      return [`big`, String(spec.v)]
    case `sym`:
      return [`sym`, spec.id]
    case `ref`:
      return [`ref`, spec.kind, spec.id]
    case `date`:
      return [`date`, String(spec.t)]
    case `bin`:
      return [`bin`, spec.bytes]
    case `temporal`:
      return [`temporal`, TEMPORALS[spec.i]]
    case `regex`:
      return [`regex`, spec.source, spec.flags, spec.lastIndex, props(spec.p)]
    case `array`:
      return [
        `array`,
        spec.items.length,
        spec.items.flatMap((item, index) =>
          item === null ? [] : [[index, inner(item)]],
        ),
        props(spec.p),
      ]
    case `twice`:
      // A shared child and a copied child have the same identity.
      return [`array`, 2, [0, 1].map((index) => [index, inner(spec.child)]), []]
    case `map`:
      return [`map`, spec.entries.map(([key, value]) => [key, inner(value)])]
    case `set`:
      return [`set`, spec.items.map((item) => [typeof item, item])]
    case `obj`:
      return [
        `obj`,
        [...spec.entries]
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([key, value]) => [key, inner(value)]),
        [...spec.syms]
          .sort(([left], [right]) => left - right)
          .map(([id, value]) => [id, inner(value)]),
      ]
    case `back`:
      // Only cyclic histories hold back edges, and their verdicts come from
      // construction, not from this encoding.
      return [`back`, spec.up]
  }
}

// ---------------------------------------------------------------------------
// Grammar. Near-miss mutations change one node, so equal and unequal pairs
// both occur often.

const primitiveArb: fc.Arbitrary<Spec> = fc.oneof(
  fc
    .constantFrom(0, 1, 2, 1.5, NaN, Infinity, -Infinity)
    .map((v) => ({ k: `num` as const, v })),
  fc.constantFrom(``, `a`, `1`, `true`).map((v) => ({ k: `str` as const, v })),
  fc.boolean().map((v) => ({ k: `bool` as const, v })),
  fc.constant({ k: `null` as const }),
  fc.constant({ k: `undef` as const }),
  fc.constantFrom(0n, 1n).map((v) => ({ k: `big` as const, v })),
  fc.nat(1).map((id) => ({ k: `sym` as const, id })),
)
const leafArb: fc.Arbitrary<Spec> = fc.oneof(
  { weight: 4, arbitrary: primitiveArb },
  fc.record({
    k: fc.constant(`ref` as const),
    kind: fc.constantFrom<RefKind>(`fn`, `handle`, `file`, `bigbin`),
    id: fc.nat(1),
  }),
  fc.constantFrom(0, 1, NaN).map((t) => ({ k: `date` as const, t })),
  fc
    .array(fc.nat(255), { maxLength: 4 })
    .map((bytes) => ({ k: `bin` as const, bytes })),
  fc.nat(TEMPORALS.length - 1).map((i) => ({ k: `temporal` as const, i })),
  fc.record({
    k: fc.constant(`regex` as const),
    source: fc.constantFrom(`a`, `b`),
    flags: fc.constantFrom(``, `g`),
    lastIndex: fc.nat(1),
  }),
)

const specArb = fc.letrec<{ spec: Spec }>((tie) => ({
  spec: fc.oneof(
    { depthSize: `small`, withCrossShrink: true },
    { weight: 3, arbitrary: leafArb },
    fc.record({
      k: fc.constant(`array` as const),
      items: fc.array(fc.option(tie(`spec`), { freq: 5, nil: null }), {
        maxLength: 3,
      }),
    }),
    fc.record({ k: fc.constant(`twice` as const), child: tie(`spec`) }),
    fc.record({
      k: fc.constant(`map` as const),
      entries: fc.uniqueArray(
        fc.tuple(fc.constantFrom(`a`, `b`, `c`), tie(`spec`)),
        { maxLength: 3, selector: ([key]) => key },
      ),
    }),
    fc.record({
      k: fc.constant(`set` as const),
      items: fc.uniqueArray(fc.constantFrom<string | number>(`a`, `b`, 1, 2), {
        maxLength: 3,
      }),
    }),
    fc.record({
      k: fc.constant(`obj` as const),
      entries: fc.uniqueArray(
        fc.tuple(fc.constantFrom(...OBJECT_KEYS), tie(`spec`)),
        { maxLength: 3, selector: ([key]) => key },
      ),
      syms: fc.uniqueArray(fc.tuple(fc.nat(1), tie(`spec`)), {
        maxLength: 1,
        selector: ([id]) => id,
      }),
    }),
  ),
})).spec

/** Every node of a spec in preorder, with a function that replaces it. */
function nodes(
  spec: Spec,
  replace: (next: Spec) => Spec = (next) => next,
): Array<[Spec, (next: Spec) => Spec]> {
  const out: Array<[Spec, (next: Spec) => Spec]> = [[spec, replace]]
  const child = (value: Spec, rebuild: (next: Spec) => Spec) =>
    out.push(...nodes(value, (next) => replace(rebuild(next))))
  if (spec.k === `array`)
    spec.items.forEach((item, index) => {
      if (item !== null)
        child(item, (next) => ({
          ...spec,
          items: spec.items.map((old, i) => (i === index ? next : old)),
        }))
    })
  else if (spec.k === `twice`)
    child(spec.child, (next) => ({ ...spec, child: next }))
  else if (spec.k === `map` || spec.k === `obj`)
    spec.entries.forEach(([key, value], index) =>
      child(value, (next) => ({
        ...spec,
        entries: spec.entries.map((old, i) =>
          i === index ? ([key, next] as [string, Spec]) : old,
        ),
      })),
    )
  return out
}

type Mutation =
  | `none`
  | `replace`
  | `header`
  | `order`
  | `hole`
  | `retype`
  | `property`

/** A small change to one node. Some changes keep the identity; the model
 * decides the verdict. */
function nearMiss(spec: Spec, choice: number): [Mutation, Spec] {
  switch (spec.k) {
    case `num`:
      return [`replace`, { k: `num`, v: [0, 1, NaN][choice % 3]! }]
    case `str`:
      return choice % 2
        ? [`retype`, { k: `num`, v: Number(spec.v) }]
        : [`replace`, { k: `str`, v: `${spec.v}!` }]
    case `big`:
      return [`retype`, { k: `num`, v: Number(spec.v) }]
    case `ref`:
      return [`replace`, { ...spec, id: 1 - spec.id }]
    case `date`:
      return choice % 2
        ? [`retype`, { k: `num`, v: spec.t }]
        : [`header`, { ...spec, t: Number.isNaN(spec.t) ? 0 : NaN }]
    case `bin`:
      return choice % 3 === 0
        ? [`header`, { k: `bin`, bytes: [...spec.bytes, 0] }]
        : choice % 3 === 1 && spec.bytes.length > 0
          ? [
              `header`,
              // Same length, one byte changed.
              {
                k: `bin`,
                bytes: spec.bytes.map((byte, i) => (i === 0 ? byte ^ 1 : byte)),
              },
            ]
          : [`retype`, { k: `array`, items: spec.bytes.map(num) }]
    case `temporal`:
      return [`header`, { ...spec, i: (spec.i + 1) % TEMPORALS.length }]
    case `regex`:
      return choice % 3 === 0
        ? [`header`, { ...spec, lastIndex: spec.lastIndex + 1 }]
        : choice % 3 === 1
          ? [`header`, { ...spec, flags: spec.flags ? `` : `g` }]
          : [`property`, { ...spec, p: num(1) }]
    case `array`:
      return choice % 4 === 0
        ? [`hole`, { ...spec, items: [...spec.items, null] }]
        : choice % 4 === 1 && spec.items.length > 0
          ? [
              `hole`,
              {
                ...spec,
                items: spec.items.map((item, i): Spec | null =>
                  i === 0 ? (item ? null : { k: `undef` }) : item,
                ),
              },
            ]
          : choice % 4 === 2
            ? [`property`, { ...spec, p: num(1) }]
            : [
                `retype`,
                {
                  k: `obj`,
                  entries: spec.items.flatMap((item, i) =>
                    item && i < 2 ? [[String(i), item] as [string, Spec]] : [],
                  ),
                  syms: [],
                },
              ]
    case `twice`:
      return [`replace`, { k: `array`, items: [spec.child] }]
    case `map`:
      return choice % 2 && spec.entries.length > 1
        ? [`order`, { ...spec, entries: [...spec.entries].reverse() }]
        : [
            `retype`,
            {
              k: `array`,
              items: spec.entries.map(([key, value]) => ({
                k: `array`,
                items: [{ k: `str`, v: key }, value],
              })),
            },
          ]
    case `set`:
      return choice % 2 && spec.items.length > 1
        ? [`order`, { ...spec, items: [...spec.items].reverse() }]
        : [
            `retype`,
            {
              k: `array`,
              items: spec.items.map((item) =>
                typeof item === `string` ? { k: `str`, v: item } : num(item),
              ),
            },
          ]
    case `obj`:
      return choice % 3 === 0 && spec.entries.length > 0
        ? [
            `property`,
            {
              ...spec,
              entries: spec.entries.map(([key, value], i) =>
                i === 0 ? ([`${key}!`, value] as [string, Spec]) : [key, value],
              ),
            },
          ]
        : choice % 3 === 1
          ? [
              `property`,
              {
                ...spec,
                syms: spec.syms.length
                  ? spec.syms.map(([id, value]) => [1 - id, value])
                  : [[0, num(1)]],
              },
            ]
          : [`order`, { ...spec, entries: [...spec.entries].reverse() }]
    default:
      return [`replace`, { k: `str`, v: `other` }]
  }
}

function num(v: number): Spec {
  return { k: `num`, v }
}

type Pair = { left: Spec; right: Spec; mutation: Mutation }

const pairArb: fc.Arbitrary<Pair> = specArb.chain((left) =>
  fc.tuple(fc.nat(), fc.nat(), fc.nat(9)).map(([at, choice, mode]): Pair => {
    if (mode < 3) return { left, right: left, mutation: `none` }
    const all = nodes(left)
    const [node, replace] = all[at % all.length]!
    const [mutation, next] = nearMiss(node, choice)
    return { left, right: replace(next), mutation }
  }),
)

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
        const value = new Map<string, unknown>()
        return container(value, () => {
          for (const [key, child] of node.entries) value.set(key, build(child))
          if (coin()) Object.assign(value, { extra: 1 })
        })
      }
      case `set`: {
        const value = new Set(node.items)
        if (coin()) Object.assign(value, { extra: 1 })
        return value
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
    fc.constantFrom(`array`, `map`, `obj`),
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
              entries: inner.map((child, i) => [`k${i}`, child]),
            }
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

function expectPair(pair: Pair, seeds: [number, number]): void {
  const expected = identity(pair.left) === identity(pair.right)
  const left = realize(pair.left, seeds[0])
  const right = realize(pair.right, seeds[1])
  const context = `${pair.mutation}: ${identity(pair.left)} vs ${identity(pair.right)}`
  expect(equalHashValues(left, right), `equality, ${context}`).toBe(expected)
  expect(equalHashValues(right, left), `symmetry, ${context}`).toBe(expected)
  if (expected) expect(hash(left), `hash, ${context}`).toBe(hash(right))
  // Sampled: a 32-bit collision is not a defect, but this small campaign
  // should not meet one.
  else expect(hash(left), `sampled hash, ${context}`).not.toBe(hash(right))
}

function expectCyclicPair({ spec, changed, seeds }: CyclicPair): void {
  const left = realize(spec, seeds[0])
  const same = realize(spec, seeds[1])
  const other = realize(changed, seeds[1])
  expect(equalHashValues(left, same), `cyclic equality`).toBe(true)
  expect(equalHashValues(left, other), `cyclic inequality`).toBe(false)
  expect(() => hash(left)).toThrow(
    new TypeError(`Cannot hash cyclic structural values`),
  )
}

// ---------------------------------------------------------------------------
// Campaigns. `TANSTACK_DB_IVM_HASH_IDENTITY_SEED` and
// `TANSTACK_DB_IVM_HASH_IDENTITY_PATH` select a direct replay.

const replaySeed = process.env.TANSTACK_DB_IVM_HASH_IDENTITY_SEED
const replayPath = process.env.TANSTACK_DB_IVM_HASH_IDENTITY_PATH
const FIXED_SEED = 2026930
const campaigns =
  replaySeed === undefined && replayPath === undefined
    ? [
        { name: String(FIXED_SEED), seed: FIXED_SEED as number | undefined },
        { name: `random`, seed: undefined },
      ]
    : [
        {
          name: `replay`,
          seed: replaySeed === undefined ? undefined : Number(replaySeed),
        },
      ]

function runOptions(seed: number | undefined) {
  if (replayPath !== undefined && replaySeed === undefined)
    throw new Error(`TANSTACK_DB_IVM_HASH_IDENTITY_PATH requires a seed`)
  if (
    replaySeed !== undefined &&
    (replaySeed.trim() === `` ||
      typeof seed !== `number` ||
      !Number.isSafeInteger(seed))
  )
    throw new Error(`TANSTACK_DB_IVM_HASH_IDENTITY_SEED must be an integer`)
  return {
    numRuns: 300,
    ...(seed === undefined ? {} : { seed }),
    ...(replayPath === undefined ? {} : { path: replayPath }),
  }
}

describe(`hash identity oracle`, () => {
  for (const { name, seed } of campaigns) {
    it(`matches the identity model across generated value pairs (${name})`, () => {
      fc.assert(
        fc.property(pairArb, fc.nat(), fc.nat(), (pair, left, right) =>
          expectPair(pair, [left, right]),
        ),
        runOptions(seed),
      )
    })
    it(`matches constructed verdicts across generated cyclic values (${name})`, () => {
      fc.assert(fc.property(cyclicArb, expectCyclicPair), runOptions(seed))
    })
  }

  // Positive execution witness: the fixed campaign reaches every value kind
  // and every mutation, with both verdicts.
  it(`reaches every kind, mutation, and verdict in the fixed campaign`, () => {
    const sample = fc.sample(pairArb, { seed: FIXED_SEED, numRuns: 300 })
    const kinds = new Set<string>()
    for (const { left } of sample)
      for (const [node] of nodes(left))
        kinds.add(node.k === `ref` ? `ref:${node.kind}` : node.k)
    expect([...kinds].sort()).toEqual(
      [
        `array`,
        `big`,
        `bin`,
        `bool`,
        `date`,
        `map`,
        `null`,
        `num`,
        `obj`,
        `ref:bigbin`,
        `ref:file`,
        `ref:fn`,
        `ref:handle`,
        `regex`,
        `set`,
        `str`,
        `sym`,
        `temporal`,
        `twice`,
        `undef`,
      ].sort(),
    )
    const verdicts = new Map<string, Set<boolean>>()
    for (const pair of sample) {
      const equal = identity(pair.left) === identity(pair.right)
      const seen = verdicts.get(pair.mutation) ?? new Set()
      verdicts.set(pair.mutation, seen.add(equal))
    }
    expect([...verdicts.keys()].sort()).toEqual(
      [
        `header`,
        `hole`,
        `none`,
        `order`,
        `property`,
        `replace`,
        `retype`,
      ].sort(),
    )
    for (const mutation of [`header`, `hole`, `retype`, `replace`])
      expect(verdicts.get(mutation), mutation).toContain(false)
    expect(verdicts.get(`none`)).toEqual(new Set([true]))
  })

  // Pinned witnesses for rules that a wrong design would plausibly break.
  const pinned: Array<[string, Spec, Spec]> = [
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
          [`a`, num(1)],
          [`b`, num(2)],
        ],
      },
      {
        k: `map`,
        entries: [
          [`b`, num(2)],
          [`a`, num(1)],
        ],
      },
    ],
    [
      `a Map differs from an array of its entries`,
      { k: `map`, entries: [[`a`, num(1)]] },
      {
        k: `array`,
        items: [{ k: `array`, items: [{ k: `str`, v: `a` }, num(1)] }],
      },
    ],
    [
      `a Set differs from an array of its values`,
      { k: `set`, items: [1, 2] },
      { k: `array`, items: [num(1), num(2)] },
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
  it.each(pinned)(`%s`, (_name, left, right) => {
    for (const seeds of [
      [1, 2],
      [3, 4],
    ] as Array<[number, number]>)
      expectPair({ left, right, mutation: `replace` }, seeds)
  })

  it(`treats shared and copied subtrees, prototypes, and hidden properties as equal`, () => {
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
    // Different seeds choose sharing, prototypes, carriers, and -0.
    for (let seed = 1; seed < 40; seed++)
      expectPair({ left: spec, right: spec, mutation: `none` }, [
        seed,
        seed + 101,
      ])
  })
})
