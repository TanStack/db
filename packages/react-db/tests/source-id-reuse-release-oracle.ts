// The release observation, its independent model, and its check, shared by
// the React source ID reuse oracle (source-id-reuse-oracle.test.tsx) and its
// checker calibration (source-id-reuse-release-calibration.test.tsx). Moved
// unchanged from the oracle file, so the calibration can import them without
// registering the oracle's properties a second time.
import { expect } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import type { Row } from './source-id-reuse-support'

export type ReleaseObservation = {
  starts: number
  status: string
  rows: Array<Row>
}

/** The release judgment knows authored source facts, not hook/cache machinery.
 * Independent demand starts one healthy source. A later source publication
 * replaces the row's value, and every direct reader must receive that whole row.
 * An after-hook throw/suspension can be reclaimed before or after the read; it
 * owes the same final result. No synchronous reclaim deadline is imposed.
 */
export function expectedReleaseObservation(row: Row): ReleaseObservation {
  return { starts: 1, status: `ready`, rows: [{ ...row }] }
}
export function checkReleaseObservation(
  actual: ReleaseObservation,
  expected: ReleaseObservation,
): void {
  oracleAssertion('expect(actual).toEqual(expected)', () =>
    expect(actual).toEqual(expected),
  )
}
