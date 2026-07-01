import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import {
  ascComparator,
  compareValues,
  defaultComparator,
} from '../src/utils/comparison'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils'

describe(`ascComparator - PostgreSQL float semantics for NaN`, () => {
  const opts = DEFAULT_COMPARE_OPTIONS // nulls: `first`

  it(`orders NaN greater than every number`, () => {
    expect(ascComparator(NaN, 5, opts)).toBeGreaterThan(0)
    expect(ascComparator(5, NaN, opts)).toBeLessThan(0)
  })

  it(`treats NaN as equal to NaN`, () => {
    expect(ascComparator(NaN, NaN, opts)).toBe(0)
  })

  it(`produces a stable total order with NaN sorting last`, () => {
    const sorted = [3, NaN, 1, 5, NaN].sort((a, b) => defaultComparator(a, b))

    expect(sorted.slice(0, 3)).toEqual([1, 3, 5])
    expect(sorted.slice(3).every((v) => Number.isNaN(v))).toBe(true)
  })

  it(`keeps null before non-null values regardless of NaN`, () => {
    // nulls still sort first by default; NaN sorts last (greatest non-null)
    const sorted = [5, NaN, null, 1].sort((a, b) => defaultComparator(a, b))

    expect(sorted[0]).toBe(null)
    expect(sorted[1]).toBe(1)
    expect(sorted[2]).toBe(5)
    expect(Number.isNaN(sorted[3])).toBe(true)
  })

  it(`orders an invalid Date greater than valid Dates`, () => {
    const invalid = new Date(`not a date`)
    const valid = new Date(`2023-01-01`)

    expect(ascComparator(invalid, valid, opts)).toBeGreaterThan(0)
    expect(ascComparator(valid, invalid, opts)).toBeLessThan(0)
  })
})

describe(`ascComparator - Temporal values`, () => {
  const opts = DEFAULT_COMPARE_OPTIONS

  it(`orders PlainDate values by calendar date`, () => {
    const earlier = new Temporal.PlainDate(2024, 1, 1)
    const later = new Temporal.PlainDate(2024, 6, 1)
    expect(ascComparator(earlier, later, opts)).toBeLessThan(0)
    expect(ascComparator(later, earlier, opts)).toBeGreaterThan(0)
    expect(ascComparator(earlier, new Temporal.PlainDate(2024, 1, 1), opts)).toBe(0)
  })

  it(`treats ZonedDateTime values at the same instant as equal regardless of zone`, () => {
    // 2024-01-15T06:30Z and 2024-01-15T12:00+05:30 are the same instant;
    // lexicographic toString comparison would order them differently.
    const utc = Temporal.ZonedDateTime.from(`2024-01-15T06:30:00+00:00[+00:00]`)
    const ist = Temporal.ZonedDateTime.from(`2024-01-15T12:00:00+05:30[+05:30]`)
    expect(ascComparator(utc, ist, opts)).toBe(0)
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
