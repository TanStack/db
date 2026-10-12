import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { equalHashValues, structuralIdentity } from '../src/hashing/hash.js'

/**
 * # Does a structural identity agree with D2 value identity?
 *
 * groupBy merges two contributions without hashing them when their
 * structural identities are equal, and compares them by hash when either has
 * none. That is sound only if the identity agrees with D2 value identity,
 * which `equalHashValues` decides without a 32-bit digest:
 *
 * 1. Equal values get the same result: both undefined, or one string.
 *    Otherwise an insert and its retraction fall under different keys and
 *    never cancel.
 * 2. Values that share a defined identity are equal. Otherwise different
 *    contributions merge.
 *
 * Model: `equalHashValues`. Histories: pairs built from one generated spec,
 * once directly and once with variations that D2 identity ignores: an array
 * subclass for an array, a class instance or a null-prototype object for a
 * plain object, reversed key order, and a non-enumerable symbol. Independent
 * pairs come from two specs. Leaves include -0, NaN, strings that differ by
 * one character, bigints next to equal numbers, symbols, null and undefined,
 * holes, Dates and Maps.
 */

type Spec =
  | { k: `leaf`; i: number }
  | { k: `array`; items: Array<Spec | null> }
  | { k: `object`; entries: Array<[string, Spec]> }
  | { k: `date`; t: number }
  | { k: `map`; v: Spec }

const SYMBOL = Symbol(`s`)
const LEAVES: ReadonlyArray<unknown> = [
  0,
  -0,
  Number.NaN,
  1,
  1n,
  `1`,
  ``,
  `a`,
  `a|`,
  true,
  false,
  null,
  undefined,
  SYMBOL,
]

class Sub extends Array<unknown> {}
class Instance {}

const specArbitrary = fc.letrec<{ spec: Spec }>((tie) => ({
  spec: fc.oneof(
    { depthSize: `small`, withCrossShrink: true },
    {
      weight: 4,
      arbitrary: fc.record({
        k: fc.constant(`leaf` as const),
        i: fc.nat(LEAVES.length - 1),
      }),
    },
    fc.record({
      k: fc.constant(`array` as const),
      // null marks a hole.
      items: fc.array(fc.option(tie(`spec`), { nil: null, freq: 5 }), {
        maxLength: 3,
      }),
    }),
    fc.record({
      k: fc.constant(`object` as const),
      entries: fc.uniqueArray(
        fc.tuple(fc.constantFrom(`a`, `b`, `c`), tie(`spec`)),
        {
          maxLength: 3,
          selector: ([key]) => key,
        },
      ),
    }),
    fc.record({ k: fc.constant(`date` as const), t: fc.nat(1) }),
    fc.record({ k: fc.constant(`map` as const), v: tie(`spec`) }),
  ),
})).spec

/** Build a value; `vary` picks representations that D2 identity ignores. */
function build(spec: Spec, vary: () => boolean): unknown {
  switch (spec.k) {
    case `leaf`:
      return LEAVES[spec.i]
    case `array`: {
      const array: Array<unknown> = vary() ? new Sub() : []
      array.length = spec.items.length
      spec.items.forEach((item, index) => {
        if (item !== null) array[index] = build(item, vary)
      })
      if (vary()) Object.defineProperty(array, Symbol(`hidden`), { value: 1 })
      return array
    }
    case `object`: {
      const choice = vary()
        ? vary()
          ? `classObject`
          : `nullPrototype`
        : `plain`
      const object: Record<string, unknown> =
        choice === `classObject`
          ? new Instance()
          : choice === `nullPrototype`
            ? Object.create(null)
            : {}
      const entries = vary() ? [...spec.entries].reverse() : spec.entries
      for (const [key, value] of entries) object[key] = build(value, vary)
      if (vary()) Object.defineProperty(object, Symbol(`hidden`), { value: 1 })
      return object
    }
    case `date`:
      return new Date(spec.t)
    case `map`:
      return new Map([[`k`, build(spec.v, vary)]])
  }
}

function expectAgreement(left: unknown, right: unknown): void {
  const equal = equalHashValues(left, right)
  const leftIdentity = structuralIdentity(left)
  const rightIdentity = structuralIdentity(right)
  if (equal) expect(leftIdentity, `equal values`).toBe(rightIdentity)
  if (leftIdentity !== undefined && leftIdentity === rightIdentity)
    expect(equal, `a shared identity: ${leftIdentity}`).toBe(true)
}

describe(`structuralIdentity`, () => {
  it(`agrees with D2 value identity for equal representations`, () => {
    fc.assert(
      fc.property(
        specArbitrary,
        fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
        (spec, coins) => {
          let index = 0
          const vary = () => coins[index++ % coins.length]!
          expectAgreement(
            build(spec, () => false),
            build(spec, vary),
          )
        },
      ),
      { numRuns: 1000 },
    )
  })

  it(`agrees with D2 value identity for independent values`, () => {
    fc.assert(
      fc.property(specArbitrary, specArbitrary, (left, right) => {
        expectAgreement(
          build(left, () => false),
          build(right, () => false),
        )
      }),
      { numRuns: 1000 },
    )
  })
})
