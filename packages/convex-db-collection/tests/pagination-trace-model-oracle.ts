// The source-revision trace relation that pagination-oracle.property.test.ts
// compares the select and Collection publication recorders with, and that
// pagination-trace.test.ts calibrates. This module registers no tests.
import { expect } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import type { Row } from './pagination-support'

export function sameRows(
  left: ReadonlyArray<Row>,
  right: ReadonlyArray<Row>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.id === right[index]!.id &&
        row.rank === right[index]!.rank &&
        row.text === right[index]!.text,
    )
  )
}

// During one coherent source revision, observations may retain the prior
// complete snapshot and then expose the new complete snapshot. Repeated
// observations are permitted. Once the new snapshot appears, stale prior rows
// cannot reappear without another source revision. Keep every observation:
// overwriting one variable would hide a prefix immediately repaired in-turn.
export function expectRevisionTrace(
  boundary: string,
  observations: ReadonlyArray<ReadonlyArray<Row>>,
  prior: ReadonlyArray<Row>,
  current: ReadonlyArray<Row>,
): void {
  let currentSeen = false
  for (const observation of observations) {
    if (sameRows(observation, current)) currentSeen = true
    else
      oracleAssertion(`pagination-oracle.property.test.ts:104:toEqual`, () =>
        expect(
          observation,
          `${boundary}: complete monotone source snapshots`,
        ).toEqual(currentSeen ? current : prior),
      )
  }
}
