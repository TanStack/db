import { describe, expect, it } from 'vitest'
import { ascComparator, defaultComparator } from '../src/utils/comparison'
import { DEFAULT_COMPARE_OPTIONS } from '../src/utils'

describe(`ascComparator with values that have no natural order`, () => {
  const opts = DEFAULT_COMPARE_OPTIONS // nulls: `first`

  it(`should order NaN consistently relative to numbers`, () => {
    // NaN has no natural order, but the comparator must still place it
    // consistently (alongside nulls, which sort first by default) so the
    // overall ordering stays well-defined.
    expect(ascComparator(NaN, 5, opts)).toBeLessThan(0)
    expect(ascComparator(5, NaN, opts)).toBeGreaterThan(0)
    expect(ascComparator(NaN, NaN, opts)).toBe(0)
  })

  it(`should produce a stable total order when sorting numbers that include NaN`, () => {
    const sorted = [3, NaN, 1, 5, NaN].sort((a, b) => defaultComparator(a, b))

    // NaN values sort to the front (same end as nulls), the rest ascending
    expect(sorted.slice(0, 2).every((v) => Number.isNaN(v))).toBe(true)
    expect(sorted.slice(2)).toEqual([1, 3, 5])
  })

  it(`should order an invalid Date consistently relative to valid Dates`, () => {
    const invalid = new Date(`not a date`)
    const valid = new Date(`2023-01-01`)

    expect(ascComparator(invalid, valid, opts)).toBeLessThan(0)
    expect(ascComparator(valid, invalid, opts)).toBeGreaterThan(0)
  })
})
