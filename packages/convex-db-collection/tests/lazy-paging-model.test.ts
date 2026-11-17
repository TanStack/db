// Checker and model calibrations for lazy-paging-oracle.property.test.ts:
// hand-built wrong windows that the shared coverage and publication checks
// must reject. They run no production.
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import {
  assertLazyCoverage,
  assertLazyPublications,
  deliveredScopeComplete,
  expectedLazyRows,
} from './lazy-paging-model-oracle'

// Wrong-answer controls distinguish missing same-rank coverage, skipped
// overshoot, transient publication and hidden-suffix knowledge independently
// of the production driver. Legal batch/cached and reacquisition behavior
// carries no mandatory second-receipt or retained-tail assertion.
it(`rejects wrong coverage and transient windows while preserving discovery freedom`, () => {
  const rows = [
    { id: `a`, rank: 1, text: `` },
    { id: `b`, rank: 1, text: `` },
    { id: `c`, rank: 2, text: `` },
  ]
  oracleAssertion(`lazy-paging-oracle.property.test.ts:942:toThrow`, () =>
    expect(() => assertLazyCoverage([rows[0]!], rows, { limit: 1 })).toThrow(
      `lazy coverage`,
    ),
  )
  oracleAssertion(`lazy-paging-oracle.property.test.ts:945:toThrow`, () =>
    expect(() => assertLazyPublications([[rows[0]!]], [], rows)).toThrow(
      `lazy publication`,
    ),
  )
  for (const suffix of [
    [{ id: `c`, rank: 3, text: `` }],
    [{ id: `d`, rank: 2, text: `` }],
  ]) {
    const delivered = [
      { id: `a`, rank: 1, text: `` },
      { id: `b`, rank: 2, text: `` },
    ]
    oracleAssertion(`lazy-paging-oracle.property.test.ts:956:toBe`, () =>
      expect(deliveredScopeComplete(delivered, false, { limit: 2 })).toBe(
        false,
      ),
    )
    oracleAssertion(`lazy-paging-oracle.property.test.ts:957:toEqual`, () =>
      expect(expectedLazyRows([...delivered, ...suffix], { limit: 2 })).toEqual(
        delivered,
      ),
    )
  }
})
