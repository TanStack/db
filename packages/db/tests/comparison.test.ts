import { describe, expect, it } from 'vitest'
import { ascComparator, compareValues } from '../src/utils/comparison'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils'

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
