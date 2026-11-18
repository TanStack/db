// The value-spec grammar and identity model of the D2 value-identity oracle.
// hash-identity-oracle.property.test.ts owns the law, the production driver,
// and the comparisons; hash-identity-grammar.test.ts checks this grammar's
// fixed-seed census. This module registers no tests and has no side effects.
import { fc } from '@fast-check/vitest'
import type { Temporal } from 'temporal-polyfill'

// ---------------------------------------------------------------------------
// Value specs. A spec is plain data, so the model never reads production
// objects. Kinds name contract rules, not production's marker/header/body
// split. `ref` is production's reference leaf. Two kinds exist only in this
// model: `twice` is one child that the driver shares or copies, and `back` is
// a back edge to an ancestor container.

export type Spec =
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
  | { k: `map`; entries: Array<[Spec, Spec]> }
  | { k: `set`; items: Array<Spec> }
  | { k: `obj`; entries: Array<[string, Spec]>; syms: Array<[number, Spec]> }
  | { k: `back`; up: number }

export type RefKind = `fn` | `handle` | `file` | `bigbin`

export const TEMPORALS: ReadonlyArray<[keyof typeof Temporal, string]> = [
  [`PlainDate`, `2024-01-15`],
  [`PlainDate`, `2024-01-16`],
  [`Duration`, `P1D`],
  [`Instant`, `2024-01-15T00:00:00Z`],
]
export const SYMBOLS = [Symbol(`s0`), Symbol(`s1`)]
// The last two are distinct keys that locale collation ranks as equal (a
// precomposed and a decomposed Å), so key order must not come from collation.
const OBJECT_KEYS = [`a`, `b`, `c`, `0`, `1`, `\u00C5`, `A\u030A`]
// No value in any pool equals this text, so a leaf that holds it makes a
// cyclic value unequal to its original.
export const SENTINEL = `\u0000sentinel`

// ---------------------------------------------------------------------------
// Model: a canonical encoding of a spec's identity.

export function identity(spec: Spec): string {
  return JSON.stringify(canon(spec))
}

// Maps and Sets merge primitive keys and shared references that are equal
// under SameValueZero: the first position stays and the last value wins.
// Every other generated key is a fresh object and never merges.
const MERGING_KINDS = new Set<Spec[`k`]>([
  `num`,
  `str`,
  `bool`,
  `null`,
  `undef`,
  `big`,
  `sym`,
  `ref`,
])
const CONTAINER_KINDS = new Set<Spec[`k`]>([
  `array`,
  `twice`,
  `map`,
  `set`,
  `obj`,
  `regex`,
])
function mapEntries(
  entries: Array<[Spec, Spec | undefined]>,
): Array<[unknown, unknown]> {
  const out: Array<[unknown, unknown]> = []
  const positions = new Map<string, number>()
  for (const [key, value] of entries) {
    const encoded = canon(key)
    const valueCode = value === undefined ? null : canon(value)
    if (MERGING_KINDS.has(key.k)) {
      const id = JSON.stringify(encoded)
      const at = positions.get(id)
      if (at !== undefined) {
        out[at]![1] = valueCode
        continue
      }
      positions.set(id, out.length)
    }
    out.push([encoded, valueCode])
  }
  return out
}

export function canon(spec: Spec): unknown {
  const inner = canon
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
      return [
        `map`,
        mapEntries(spec.entries.map(([key, value]) => [key, value])),
      ]
    case `set`:
      return [
        `set`,
        mapEntries(spec.items.map((item) => [item, undefined])).map(
          ([item]) => item,
        ),
      ]
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

export const primitiveArb: fc.Arbitrary<Spec> = fc.oneof(
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
      // Keys are any generated value, unique by identity; mutations may still
      // merge two keys, and the model merges them the same way.
      entries: fc.uniqueArray(
        fc.tuple(
          fc.oneof({ weight: 2, arbitrary: primitiveArb }, tie(`spec`)),
          tie(`spec`),
        ),
        { maxLength: 3, selector: ([key]) => identity(key) },
      ),
    }),
    fc.record({
      k: fc.constant(`set` as const),
      // Unique identities, so a Set never merges two generated values.
      items: fc.uniqueArray(tie(`spec`), { maxLength: 3, selector: identity }),
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
export function nodes(
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
  else if (spec.k === `set`)
    spec.items.forEach((item, index) =>
      child(item, (next) => ({
        ...spec,
        items: spec.items.map((old, i) => (i === index ? next : old)),
      })),
    )
  else if (spec.k === `twice`)
    child(spec.child, (next) => ({ ...spec, child: next }))
  else if (spec.k === `map`)
    spec.entries.forEach(([key, value], index) => {
      child(key, (next) => ({
        ...spec,
        entries: spec.entries.map((old, i) =>
          i === index ? ([next, value] as [Spec, Spec]) : old,
        ),
      }))
      child(value, (next) => ({
        ...spec,
        entries: spec.entries.map((old, i) =>
          i === index ? ([key, next] as [Spec, Spec]) : old,
        ),
      }))
    })
  else if (spec.k === `obj`)
    spec.entries.forEach(([key, value], index) =>
      child(value, (next) => ({
        ...spec,
        entries: spec.entries.map((old, i) =>
          i === index ? ([key, next] as [string, Spec]) : old,
        ),
      })),
    )
  if (spec.k === `obj`)
    spec.syms.forEach(([id, value], index) =>
      child(value, (next) => ({
        ...spec,
        syms: spec.syms.map((old, i) =>
          i === index ? ([id, next] as [number, Spec]) : old,
        ),
      })),
    )
  return out
}

export type Mutation =
  | `none`
  | `replace`
  | `split`
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
      // A shared child on one side against two different copies on the other
      // tests that equality's revisit check keys on both objects.
      return choice % 2
        ? [`replace`, { k: `array`, items: [spec.child] }]
        : [
            `split`,
            {
              k: `array`,
              items: [spec.child, nearMiss(spec.child, choice >> 1)[1]],
            },
          ]
    case `map`: {
      const pairs = spec.entries.map(([key, value]): Spec => ({
        k: `array`,
        items: [key, value],
      }))
      const [first, second] = spec.entries
      // Repeating a primitive key makes the Map merge the two entries.
      if (choice % 2 === 0 && first && second && MERGING_KINDS.has(first[0].k))
        return [
          `property`,
          {
            ...spec,
            entries: spec.entries.map(([key, value], i) =>
              i === 1 ? ([first[0], value] as [Spec, Spec]) : [key, value],
            ),
          },
        ]
      return choice % 4 === 0 && spec.entries.length > 1
        ? [`order`, { ...spec, entries: [...spec.entries].reverse() }]
        : choice % 4 === 1 && spec.entries.length > 0
          ? [
              `property`,
              {
                ...spec,
                entries: spec.entries.map(([key, value], i) =>
                  i === 0
                    ? ([{ k: `str`, v: `\u0000key` }, value] as [Spec, Spec])
                    : [key, value],
                ),
              },
            ]
          : choice % 4 === 2
            ? [`retype`, { k: `array`, items: pairs }]
            : [`retype`, { k: `set`, items: pairs }]
    }
    case `set`:
      return choice % 2 && spec.items.length > 1
        ? [`order`, { ...spec, items: [...spec.items].reverse() }]
        : [`retype`, { k: `array`, items: spec.items }]
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

export function num(v: number): Spec {
  return { k: `num`, v }
}

export type Pair = { left: Spec; right: Spec; mutation: Mutation }

export const pairArb: fc.Arbitrary<Pair> = specArb.chain((left) =>
  fc.tuple(fc.nat(), fc.nat(), fc.nat(9)).map(([at, choice, mode]): Pair => {
    if (mode < 3) return { left, right: left, mutation: `none` }
    // Leaves outnumber containers, so half of the mutations target a
    // container node when the spec has one.
    const all = nodes(left)
    const containers = all.filter(([node]) => CONTAINER_KINDS.has(node.k))
    const pool = mode % 2 && containers.length > 0 ? containers : all
    const [node, replace] = pool[at % pool.length]!
    const [mutation, next] = nearMiss(node, choice)
    return { left, right: replace(next), mutation }
  }),
)
