import { describe, expect, it } from 'vitest'
import {
  areValuesEqual,
  ascComparator,
  compareValues,
  makeComparator,
  normalizeValue,
} from '../src/utils/comparison'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils'
import { defaultOpts, lexicalOpts } from './comparison-options.js'
import type { CompareOptions } from '../src/query/builder/types'

describe(`ascComparator - symbols`, () => {
  const opts = DEFAULT_COMPARE_OPTIONS

  it(`gives symbols a stable total order`, () => {
    const first = Symbol(`group`)
    const second = Symbol(`group`)

    expect(ascComparator(first, first, opts)).toBe(0)
    expect(ascComparator(first, second, opts)).toBeLessThan(0)
    expect(ascComparator(second, first, opts)).toBeGreaterThan(0)
    expect(ascComparator(first, 1, opts)).toBeGreaterThan(0)
    expect(ascComparator(1, first, opts)).toBeLessThan(0)
  })
})

describe(`compareValues - NaN behavior`, () => {
  // NaN satisfies neither < nor >, so the fallback returns 0. In practice
  // gt/gte/lt/lte catch NaN via isUnorderable before reaching compareValues.
  it(`treats NaN as equal to NaN`, () => {
    expect(compareValues(NaN, NaN)).toBe(0)
  })

  it(`returns 0 for NaN vs a finite number — neither < nor > holds for NaN`, () => {
    expect(compareValues(NaN, 5)).toBe(0)
    expect(compareValues(5, NaN)).toBe(0)
  })
})

describe(`ascComparator property-based tests`, () => {
  describe(`string comparison`, () => {
    it(`lexical and en-US locale order distinguish the string-mode axis`, () => {
      const localeOpts: CompareOptions = { ...defaultOpts, locale: `en-US` }
      expect(ascComparator(`a`, `B`, lexicalOpts)).toBeGreaterThan(0)
      expect(ascComparator(`a`, `B`, localeOpts)).toBeLessThan(0)
    })
  })
})

describe(`makeComparator property-based tests`, () => {
  it(`delegates only string pairs to a custom string comparator`, () => {
    const calls: Array<[string, string]> = []
    const compare = (a: string, b: string) => {
      calls.push([a, b])
      return a.replaceAll(` `, ``).localeCompare(b.replaceAll(` `, ``))
    }
    const custom: CompareOptions = {
      direction: `asc`,
      nulls: `first`,
      stringSort: `custom`,
      compare,
    }

    expect(makeComparator(custom)(`pillowfort`, `pillow fort`)).toBe(0)
    expect(calls).toEqual([[`pillowfort`, `pillow fort`]])

    calls.length = 0
    expect(makeComparator(custom)(2, 1)).toBeGreaterThan(0)
    expect(makeComparator(custom)(null, `value`)).toBeLessThan(0)
    expect(calls).toEqual([])

    expect(
      makeComparator({ ...custom, direction: `desc` })(`a`, `b`),
    ).toBeGreaterThan(0)
  })
})

describe(`normalizeValue property-based tests`, () => {
  it(`binary key size and content laws reach the bounded length margins`, () => {
    for (const length of [0, 1, 128, 129, 200]) {
      const bytes = Uint8Array.from({ length }, (_, index) => index % 256)
      const normalized = normalizeValue(bytes)
      expect(typeof normalized).toBe(`string`)
      expect((normalized as string).length - length).toBeLessThan(32)
      expect(normalizeValue(new Uint8Array(bytes))).toBe(normalized)
      if (length > 0) {
        const changed = new Uint8Array(bytes)
        changed[length - 1] = (changed[length - 1]! + 1) % 256
        expect(normalizeValue(changed)).not.toBe(normalized)
      }
    }
  })
})

describe(`areValuesEqual property-based tests`, () => {
  it(`different integer law reaches an unequal pair`, () => {
    expect(areValuesEqual(1, 2)).toBe(false)
    expect(areValuesEqual(2, 1)).toBe(false)
  })
})
