import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { ascComparator, compareValues } from '../src/utils/comparison'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils'

describe(`ascComparator - Temporal values`, () => {
  const opts = DEFAULT_COMPARE_OPTIONS

  it(`orders PlainDate values by calendar date`, () => {
    const earlier = new Temporal.PlainDate(2024, 1, 1)
    const later = new Temporal.PlainDate(2024, 6, 1)
    expect(ascComparator(earlier, later, opts)).toBeLessThan(0)
    expect(ascComparator(later, earlier, opts)).toBeGreaterThan(0)
    expect(
      ascComparator(earlier, new Temporal.PlainDate(2024, 1, 1), opts),
    ).toBe(0)
  })

  it(`treats ZonedDateTime values at the same instant as equal regardless of zone`, () => {
    // 2024-01-15T06:30Z and 2024-01-15T12:00+05:30 are the same instant;
    // lexicographic toString comparison would order them differently.
    const utc = Temporal.ZonedDateTime.from(`2024-01-15T06:30:00+00:00[+00:00]`)
    const ist = Temporal.ZonedDateTime.from(`2024-01-15T12:00:00+05:30[+05:30]`)
    expect(ascComparator(utc, ist, opts)).toBe(0)
  })
})

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
