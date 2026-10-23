import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { equalHashValues, structuralIdentity } from '../src/hashing/hash.js'
import {
  oraclePropertyOptions,
  readOracleRunConfig,
} from '../../db/tests/oracle-config.js'

/**
 * # Does a structural identity agree with D2 value identity?
 *
 * groupBy merges two contributions without hashing them when their
 * structural identities are equal, and compares them by hash when either has
 * none. That is sound only if the identity agrees with D2 value identity:
 *
 * 1. Equal values get the same result: both undefined, or one string.
 *    Otherwise an insert and its retraction fall under different keys and
 *    never cancel.
 * 2. Values that share a defined identity are equal. Otherwise different
 *    contributions merge.
 *
 * Model: values are built from generated specs, and two values are equal
 * exactly when their specs denote equal values after normalization: -0 as 0,
 * every NaN as one value, object entries in key order, and holes kept.
 * `deep` and explicit one-element `array` nodes denote the same nested arrays.
 * Symbol leaf indices denote stable symbol instances, not their descriptions.
 * Distinct RegExp objects whose lastIndex is NaN compare unequal because D2
 * compares headers with ===. The model shares no code with the hashing module;
 * a sanity check also compares it with `equalHashValues`.
 *
 * Histories: equal pairs use one comparable spec or two spellings of the same
 * nested arrays. Their builds vary array subclasses, object prototypes, key order,
 * and non-enumerable symbols; D2 identity ignores those differences.
 * Independent pairs use two specs. Strings and keys include every separator
 * the identity uses and digits, so an encoding that loses where one part
 * ends fails law 2. Values include distinct symbols with the same description,
 * enumerable symbol keys, Dates (also invalid), RegExps with numeric
 * `lastIndex`, Maps and Sets with zero to two entries, arrays with an
 * enumerable non-index field, small binary values, holes, and nesting deeper
 * than the identity's depth cap.
 * Pinned pairs cover joins a random short string cannot build, distinct
 * symbols with the same description, and different object kinds with the same
 * body. Fixed representation witnesses verify that the driver reaches each
 * prototype, key-order, and hidden-symbol variant it claims. The depth cap
 * bounds work and recursion, including on a cyclic value;
 * it does not decide equality, so raising it changes no law here.
 * Both generated pair grammars run fixed and fresh-seed campaigns. A replay
 * seed and path select the requested property without running the fixed one.
 */

type Spec =
  | { k: `leaf`; i: number }
  | { k: `text`; s: string }
  | { k: `array`; items: Array<Spec | null>; extra?: Spec }
  | { k: `object`; entries: Array<[string, Spec]>; symbol?: Spec }
  | { k: `date`; t: number }
  | { k: `regexp`; flags: string; lastIndex: number }
  | { k: `map`; values: Array<Spec> }
  | { k: `set`; values: Array<Spec> }
  | { k: `binary`; bytes: Array<number> }
  | { k: `deep`; depth: number; v: Spec }

const SYMBOL = Symbol(`s`)
const ENUMERABLE_SYMBOL = Symbol(`enumerable`)
const { replayProperty } = readOracleRunConfig()
const LEAVES: ReadonlyArray<unknown> = [
  0,
  -0,
  Number.NaN,
  1,
  1n,
  ``,
  true,
  false,
  null,
  undefined,
  SYMBOL,
  Symbol(`s`),
]
// Every separator and tag the identity uses, plus digits.
const textArbitrary = fc.string({
  unit: fc.constantFrom(`a`, `|`, `=`, `:`, `"`, `#`, `[`, `{`, `0`, `1`, `2`),
  maxLength: 4,
})

class Sub extends Array<unknown> {}
class Instance {}

const specArbitrary = fc.letrec<{ spec: Spec }>((tie) => ({
  spec: fc.oneof(
    { depthSize: `small`, withCrossShrink: true },
    {
      weight: 3,
      arbitrary: fc.record({
        k: fc.constant(`leaf` as const),
        i: fc.nat(LEAVES.length - 1),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        k: fc.constant(`text` as const),
        s: textArbitrary,
      }),
    },
    fc.record(
      {
        k: fc.constant(`array` as const),
        // null marks a hole.
        items: fc.array(fc.option(tie(`spec`), { nil: null, freq: 5 }), {
          maxLength: 3,
        }),
        extra: tie(`spec`),
      },
      { requiredKeys: [`k`, `items`] },
    ),
    fc.record(
      {
        k: fc.constant(`object` as const),
        entries: fc.uniqueArray(fc.tuple(textArbitrary, tie(`spec`)), {
          maxLength: 3,
          selector: ([key]) => key,
        }),
        symbol: tie(`spec`),
      },
      { requiredKeys: [`k`, `entries`] },
    ),
    fc.record({
      k: fc.constant(`date` as const),
      t: fc.constantFrom(0, 1, Number.NaN),
    }),
    fc.record({
      k: fc.constant(`regexp` as const),
      flags: fc.constantFrom(``, `g`),
      lastIndex: fc.constantFrom(0, 1, Number.NaN),
    }),
    fc.record({
      k: fc.constant(`map` as const),
      values: fc.array(tie(`spec`), { maxLength: 2 }),
    }),
    fc.record({
      k: fc.constant(`set` as const),
      values: fc.array(tie(`spec`), { maxLength: 2 }),
    }),
    fc.record({
      k: fc.constant(`binary` as const),
      bytes: fc.array(fc.nat(2), { maxLength: 3 }),
    }),
    fc.record({
      k: fc.constant(`deep` as const),
      depth: fc.integer({ min: 3, max: 6 }),
      v: tie(`spec`),
    }),
  ),
})).spec

// Distinct RegExp instances with a NaN lastIndex are not equal, even when
// built from one spec. This grammar check does not consult the normal-form
// model; the independent-pair grammar still generates those RegExps.
function containsNaNRegExp(spec: Spec): boolean {
  switch (spec.k) {
    case `regexp`:
      return Number.isNaN(spec.lastIndex)
    case `array`:
      return (
        spec.items.some((item) => item !== null && containsNaNRegExp(item)) ||
        (spec.extra !== undefined && containsNaNRegExp(spec.extra))
      )
    case `object`:
      return (
        spec.entries.some(([, value]) => containsNaNRegExp(value)) ||
        (spec.symbol !== undefined && containsNaNRegExp(spec.symbol))
      )
    case `map`:
    case `set`:
      return spec.values.some(containsNaNRegExp)
    case `deep`:
      return containsNaNRegExp(spec.v)
    default:
      return false
  }
}
const comparableSpecArbitrary = specArbitrary.filter(
  (spec) => !containsNaNRegExp(spec),
)

const equalSpecPairArbitrary = fc.oneof(
  comparableSpecArbitrary.map((spec): [Spec, Spec] => [spec, spec]),
  fc
    .tuple(comparableSpecArbitrary, fc.integer({ min: 3, max: 5 }))
    .map(([spec, depth]): [Spec, Spec] => [
      { k: `array`, items: [{ k: `deep`, depth, v: spec }] },
      { k: `deep`, depth: depth + 1, v: spec },
    ]),
)

/** Build a value; `vary` picks representations that D2 identity ignores. */
function build(spec: Spec, vary: () => boolean): unknown {
  switch (spec.k) {
    case `leaf`:
      return LEAVES[spec.i]
    case `text`:
      return spec.s
    case `array`: {
      const array: Array<unknown> = vary() ? new Sub() : []
      array.length = spec.items.length
      spec.items.forEach((item, index) => {
        if (item !== null) array[index] = build(item, vary)
      })
      if (spec.extra !== undefined) {
        Object.assign(array, { note: build(spec.extra, vary) })
      }
      if (vary()) Object.defineProperty(array, Symbol(`hidden`), { value: 1 })
      return array
    }
    case `object`: {
      const choice = vary()
        ? vary()
          ? `classObject`
          : `nullPrototype`
        : `plain`
      const object: Record<PropertyKey, unknown> =
        choice === `classObject`
          ? new Instance()
          : choice === `nullPrototype`
            ? Object.create(null)
            : {}
      const entries = vary() ? [...spec.entries].reverse() : spec.entries
      for (const [key, value] of entries) object[key] = build(value, vary)
      if (spec.symbol) object[ENUMERABLE_SYMBOL] = build(spec.symbol, vary)
      if (vary()) Object.defineProperty(object, Symbol(`hidden`), { value: 1 })
      return object
    }
    case `date`:
      return new Date(spec.t)
    case `regexp`: {
      const regexp = new RegExp(`a`, spec.flags)
      regexp.lastIndex = spec.lastIndex
      return regexp
    }
    case `map`:
      return new Map<string, unknown>(
        spec.values.map((value, index): [string, unknown] => [
          index === 0 ? `k` : `x`,
          build(value, vary),
        ]),
      )
    case `set`:
      // Wrap the second value so JS Set never deduplicates two primitive values
      // before D2 can compare their ordered entries.
      return new Set<unknown>(
        spec.values.map((value, index) =>
          index === 0 ? build(value, vary) : [index, build(value, vary)],
        ),
      )
    case `binary`:
      return new Uint8Array(spec.bytes)
    case `deep`: {
      let value = build(spec.v, vary)
      for (let level = 0; level < spec.depth; level++) value = [value]
      return value
    }
  }
}

/** The model: a spec's normal form, or undefined when it equals nothing. */
function normal(spec: Spec): string | undefined {
  const parts = (specs: Array<Spec | null>) => {
    const out: Array<string> = []
    for (const item of specs) {
      if (item === null) {
        out.push(`hole`)
        continue
      }
      const part = normal(item)
      if (part === undefined) return undefined
      out.push(part)
    }
    return out
  }
  switch (spec.k) {
    case `leaf`: {
      const value = LEAVES[spec.i]
      if (typeof value === `number`)
        return Number.isNaN(value)
          ? `number:NaN`
          : `number:${value === 0 ? 0 : value}`
      if (typeof value === `symbol`) return `symbol:${spec.i}`
      if (typeof value === `string`) return `string:${JSON.stringify(value)}`
      return `${typeof value}:${String(value)}`
    }
    case `text`:
      return `string:${JSON.stringify(spec.s)}`
    case `array`: {
      const items = parts(spec.items)
      if (items === undefined) return undefined
      const base = `array:${JSON.stringify(items)}`
      if (spec.extra === undefined) return base
      const extra = normal(spec.extra)
      return extra === undefined
        ? undefined
        : `${base}:note:${JSON.stringify(extra)}`
    }
    case `object`: {
      const entries: Array<[string, string]> = []
      for (const [key, value] of [...spec.entries].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )) {
        const part = normal(value)
        if (part === undefined) return undefined
        entries.push([key, part])
      }
      const symbol = spec.symbol === undefined ? `` : normal(spec.symbol)
      if (symbol === undefined) return undefined
      return `object:${JSON.stringify([entries, symbol])}`
    }
    case `date`:
      return `date:${Number.isNaN(spec.t) ? `invalid` : spec.t}`
    case `regexp`:
      return Number.isNaN(spec.lastIndex)
        ? undefined
        : `regexp:${spec.flags}:${spec.lastIndex}`
    case `map`: {
      const values = parts(spec.values)
      return values && `map:${JSON.stringify(values)}`
    }
    case `set`: {
      const values = parts(spec.values)
      if (values === undefined) return undefined
      // The second Set member is a fresh [index, value] array in build().
      if (values.length === 2) {
        values[1] = `array:${JSON.stringify([`number:1`, values[1]])}`
      }
      return `set:${JSON.stringify(values)}`
    }
    case `binary`:
      return `binary:${spec.bytes.join(`,`)}`
    case `deep`: {
      // `deep` is model shorthand for repeated single-element arrays.
      let value = normal(spec.v)
      if (value === undefined) return undefined
      for (let level = 0; level < spec.depth; level++) {
        value = `array:${JSON.stringify([value])}`
      }
      return value
    }
  }
}

function expectAgreement(
  leftSpec: Spec,
  rightSpec: Spec,
  left: unknown,
  right: unknown,
): void {
  const leftNormal = normal(leftSpec)
  const equal =
    left === right ||
    (leftNormal !== undefined && leftNormal === normal(rightSpec))
  // Sanity: the independent model agrees with D2's own equality.
  expect(equalHashValues(left, right), `model vs equalHashValues`).toBe(equal)
  const leftIdentity = structuralIdentity(left)
  const rightIdentity = structuralIdentity(right)
  if (equal) expect(leftIdentity, `equal values`).toBe(rightIdentity)
  if (leftIdentity !== undefined && leftIdentity === rightIdentity)
    expect(equal, `a shared identity: ${leftIdentity}`).toBe(true)
}

// Different values whose parts, read without lengths, join to the same text.
// A random four-character string never embeds a whole later part, so these
// pairs pin the cases that a missing length prefix would merge.
const collisionPairs: Array<[string, unknown, unknown]> = [
  [`string spans a later key`, { a: `x|1:b="y` }, { a: `x`, b: `y` }],
  [`key spans a later key`, { [`a="1:x|b`]: `y` }, { a: `x`, b: `y` }],
  [`string spans a later element`, [`x|1:1="y`, ``], [`x`, `y`]],
  [`header spans the body`, [`#1`], [1]],
]

function decisions(...values: Array<boolean>): () => boolean {
  let index = 0
  return () => values[index++] ?? false
}

describe(`structuralIdentity`, () => {
  it(`ignores array subclass and hidden symbol representations`, () => {
    const spec: Spec = { k: `array`, items: [{ k: `leaf`, i: 3 }] }
    const plain = build(spec, () => false)
    const variant = build(spec, decisions(true, true)) as Sub
    expect(variant).toBeInstanceOf(Sub)
    const [hidden] = Object.getOwnPropertySymbols(variant)
    expect(hidden).toBeDefined()
    expect(Object.getOwnPropertyDescriptor(variant, hidden!)?.enumerable).toBe(
      false,
    )
    expectAgreement(spec, spec, plain, variant)
  })

  it(`ignores object prototype, key order, and hidden symbol representations`, () => {
    const spec: Spec = {
      k: `object`,
      entries: [
        [`a`, { k: `leaf`, i: 0 }],
        [`b`, { k: `leaf`, i: 3 }],
      ],
    }
    const plain = build(spec, () => false)
    const classVariant = build(spec, decisions(true, true, true, true))
    const nullPrototype = build(spec, decisions(true, false, false, false))
    expect(classVariant).toBeInstanceOf(Instance)
    expect(Object.keys(classVariant as object)).toEqual([`b`, `a`])
    const [hidden] = Object.getOwnPropertySymbols(classVariant as object)
    expect(hidden).toBeDefined()
    expect(
      Object.getOwnPropertyDescriptor(classVariant, hidden!)?.enumerable,
    ).toBe(false)
    expect(Object.getPrototypeOf(nullPrototype)).toBeNull()
    expectAgreement(spec, spec, plain, classVariant)
    expectAgreement(spec, spec, plain, nullPrototype)
  })

  it.each(collisionPairs)(
    `gives different values different identities: %s`,
    (_, left, right) => {
      expect(equalHashValues(left, right)).toBe(false)
      const leftIdentity = structuralIdentity(left)
      expect(leftIdentity).toBeDefined()
      expect(leftIdentity).not.toBe(structuralIdentity(right))
    },
  )

  it(`returns no identity for a cyclic value`, () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(structuralIdentity(cyclic)).toBeUndefined()
  })

  it(`agrees with D2 value identity for equal representations`, async () => {
    if (
      replayProperty !== undefined &&
      replayProperty !== `structural-identity.equal-representations`
    )
      return
    // The guarded replay records completed runs through an async reporter.
    const property = fc.asyncProperty(
      equalSpecPairArbitrary,
      fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
      ([leftSpec, rightSpec], coins) => {
        let index = 0
        const vary = () => coins[index++ % coins.length]!
        expectAgreement(
          leftSpec,
          rightSpec,
          build(leftSpec, () => false),
          build(rightSpec, vary),
        )
        return Promise.resolve()
      },
    )
    const options = oraclePropertyOptions(
      2000,
      `structural-identity.equal-representations`,
    )
    if (options.seed === undefined)
      await fc.assert(property, { numRuns: options.numRuns, seed: 20261014 })
    await fc.assert(property, options)
  })

  // Named replays of counterexamples the random campaign found. Nested `deep`
  // nodes compose, so these specs build equal values; an empty text leaf and the
  // leaf it shares a value with must also normalize alike.
  it.each([
    [
      `nested deep nodes`,
      { k: `deep`, depth: 6, v: { k: `leaf`, i: 3 } },
      {
        k: `deep`,
        depth: 3,
        v: { k: `deep`, depth: 3, v: { k: `leaf`, i: 3 } },
      },
    ],
    [
      `an empty string in a set`,
      { k: `set`, values: [{ k: `text`, s: `` }] },
      { k: `set`, values: [{ k: `leaf`, i: 5 }] },
    ],
    [
      `a deep node and an explicit array`,
      { k: `array`, items: [{ k: `deep`, depth: 5, v: { k: `leaf`, i: 3 } }] },
      { k: `deep`, depth: 6, v: { k: `leaf`, i: 3 } },
    ],
    [
      `adjacent nesting depths`,
      { k: `array`, items: [{ k: `deep`, depth: 5, v: { k: `leaf`, i: 3 } }] },
      { k: `deep`, depth: 5, v: { k: `leaf`, i: 3 } },
    ],
    [
      `distinct symbols with the same description`,
      { k: `leaf`, i: 10 },
      { k: `leaf`, i: 11 },
    ],
    [
      `a Map and Set with the same entry body`,
      { k: `map`, values: [{ k: `leaf`, i: 0 }] },
      {
        k: `set`,
        values: [
          {
            k: `array`,
            items: [
              { k: `text`, s: `k` },
              { k: `leaf`, i: 0 },
            ],
          },
        ],
      },
    ],
    [
      `a Map and object with the same entry body`,
      { k: `map`, values: [{ k: `leaf`, i: 0 }] },
      {
        k: `object`,
        entries: [
          [
            `0`,
            {
              k: `array`,
              items: [
                { k: `text`, s: `k` },
                { k: `leaf`, i: 0 },
              ],
            },
          ],
        ],
      },
    ],
    [
      `a Set and object with the same entry body`,
      { k: `set`, values: [{ k: `leaf`, i: 0 }] },
      { k: `object`, entries: [[`0`, { k: `leaf`, i: 0 }]] },
    ],
    [
      `Maps that differ at the second entry`,
      {
        k: `map`,
        values: [
          { k: `leaf`, i: 0 },
          { k: `leaf`, i: 0 },
        ],
      },
      {
        k: `map`,
        values: [
          { k: `leaf`, i: 0 },
          { k: `leaf`, i: 3 },
        ],
      },
    ],
    [
      `Sets that differ at the second entry`,
      {
        k: `set`,
        values: [
          { k: `leaf`, i: 0 },
          { k: `leaf`, i: 0 },
        ],
      },
      {
        k: `set`,
        values: [
          { k: `leaf`, i: 0 },
          { k: `leaf`, i: 3 },
        ],
      },
    ],
    [
      `arrays that differ at an enumerable non-index field`,
      {
        k: `array`,
        items: [{ k: `leaf`, i: 0 }],
        extra: { k: `leaf`, i: 0 },
      },
      {
        k: `array`,
        items: [{ k: `leaf`, i: 0 }],
        extra: { k: `leaf`, i: 3 },
      },
    ],
  ] as Array<[string, Spec, Spec]>)(
    `agrees with D2 value identity for %s`,
    (_name, left, right) => {
      expectAgreement(
        left,
        right,
        build(left, () => false),
        build(right, () => false),
      )
    },
  )

  it(`agrees with D2 value identity for independent values`, async () => {
    if (
      replayProperty !== undefined &&
      replayProperty !== `structural-identity.independent-values`
    )
      return
    const property = fc.asyncProperty(
      specArbitrary,
      specArbitrary,
      (left, right) => {
        expectAgreement(
          left,
          right,
          build(left, () => false),
          build(right, () => false),
        )
        return Promise.resolve()
      },
    )
    const options = oraclePropertyOptions(
      2000,
      `structural-identity.independent-values`,
    )
    if (options.seed === undefined)
      await fc.assert(property, { numRuns: options.numRuns, seed: 1158727847 })
    await fc.assert(property, options)
  })
})
