// Checker calibrations for the trace relation in
// pagination-trace-model-oracle.ts: hand-built select and publication traces
// that it must accept or reject. They run no production.
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { expectRevisionTrace } from './pagination-trace-model-oracle'

// Calibrate both recorders' shared trace relation without imposing one callback
// per revision. Repeated old/new snapshots are legal; prefixes and rollback
// after the new snapshot are not, even when a final callback repairs the result.
it.each([`select`, `Collection publication`])(
  `calibrates complete monotone snapshots at %s`,
  (boundary) => {
    const current = Array.from({ length: 3 }, (_, rank) => ({
      id: String(rank),
      rank,
      text: String(rank),
    }))
    oracleAssertion(`pagination-oracle.property.test.ts:131:toThrow`, () =>
      expect(() =>
        expectRevisionTrace(boundary, [[], [], current, current], [], current),
      ).not.toThrow(),
    )
    oracleAssertion(`pagination-oracle.property.test.ts:134:toThrow`, () =>
      expect(() =>
        expectRevisionTrace(
          boundary,
          [current.slice(0, 1), current],
          [],
          current,
        ),
      ).toThrow(),
    )
    oracleAssertion(`pagination-oracle.property.test.ts:142:toThrow`, () =>
      expect(() =>
        expectRevisionTrace(boundary, [current, [], current], [], current),
      ).toThrow(),
    )
  },
)
