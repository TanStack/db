/**
 * The exact-demand history grammar of `load-subset-oracle.property.test.ts`,
 * moved unchanged so that its grammar check in `load-subset-model.test.ts`
 * can read it. That oracle file states the law and its authority. This module
 * registers no tests.
 */
import fc from 'fast-check'
import type { ExactDemand } from './load-subset-support.js'

export const exactDemandArbitrary: fc.Arbitrary<ExactDemand> = fc
  .record({
    values: fc.uniqueArray(fc.integer({ min: -3, max: 3 }), {
      minLength: 1,
      maxLength: 5,
    }),
    orderField: fc.constantFrom(`rank` as const, `score` as const),
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    nulls: fc.constantFrom(`first` as const, `last` as const),
    stringSort: fc.constantFrom(`lexical` as const, `locale` as const),
    offset: fc.integer({ min: 0, max: 4 }),
    limit: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
    cursorBoundary: fc.option(fc.integer({ min: -3, max: 3 }), {
      nil: undefined,
    }),
  })
  .map((demand) => ({
    ...demand,
    values: [...demand.values].sort((left, right) => left - right),
  }))

export function exactDemandFingerprint(demand: ExactDemand): string {
  return JSON.stringify(demand)
}

export const exactDemandTraceArbitrary = fc
  .uniqueArray(exactDemandArbitrary, {
    minLength: 1,
    maxLength: 6,
    selector: exactDemandFingerprint,
  })
  .chain((pool) =>
    fc
      .array(fc.integer({ min: 0, max: pool.length - 1 }), {
        minLength: 1,
        maxLength: 20,
      })
      .map((indices) => indices.map((index) => pool[index]!)),
  )
