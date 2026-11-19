// Model and grammar checks for load-subset-oracle.property.test.ts. They run
// no production: the first checks the independent SQL expression evaluator's
// nullish rule, and the second checks that the fixed-seed exact-demand
// grammar generates repeated, cursor, empty, and unbounded demands. The law
// and the production comparisons are in that oracle file; the grammar is in
// load-subset-grammar-oracle.ts.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { oracleFixedSeed } from '../oracle-config.js'
import {
  exactDemandFingerprint,
  exactDemandTraceArbitrary,
} from './load-subset-grammar-oracle.js'

describe(`exact loadSubset demand oracle`, () => {
  it(`uses SQL unknown for nullish comparisons in the independent model`, () => {
    const missing = new PropRef<number | null>([`missing`])

    expect(
      evaluateReferenceExpression(
        new Func(`lte`, [missing, new Value(null)]),
        {},
      ),
    ).toBeNull()
    expect(
      evaluateReferenceExpression(new Func(`lt`, [missing, new Value(0)]), {}),
    ).toBeNull()
  })

  it(`generates repeated, cursor, empty, and unbounded exact demands`, () => {
    const traces = fc.sample(
      exactDemandTraceArbitrary,
      oracleFixedSeed(1656, { numRuns: 200 }),
    )
    const demands = traces.flat()

    expect(
      traces.some(
        (trace) =>
          new Set(trace.map(exactDemandFingerprint)).size < trace.length,
      ),
    ).toBe(true)
    expect(
      demands.some(({ cursorBoundary }) => cursorBoundary !== undefined),
    ).toBe(true)
    expect(demands.some(({ limit }) => limit === 0)).toBe(true)
    expect(demands.some(({ limit }) => limit === undefined)).toBe(true)
    expect(new Set(demands.map(({ offset }) => offset)).size).toBeGreaterThan(1)
  })
})
