import { expect } from 'vitest'

/** The caller supplies a literal history, independent of the driver's queue. */
export function expectAdmissionHistory(
  rows: ReadonlyArray<{ value: number }>,
  expected: ReadonlyArray<number>,
): void {
  expect(rows.map((row) => row.value)).toEqual(expected)
}
