// Shared helpers for the oracle file and the ordinary tests moved from it.
import { expect } from 'vitest'
import type { LoadSubsetOptions } from '../src/types.js'

export type ReplayRow = {
  id: `one` | `two`
  value: number
}
export type ReplayChange = {
  type: `insert` | `update` | `delete`
  key: string | number
  value: ReplayRow
  previousValue?: ReplayRow
}
export function sortedRows(
  rows: ReadonlyMap<string | number, ReplayRow>,
): Array<ReplayRow> {
  return [...rows.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}
export function sortedChanges(
  changes: ReadonlyArray<ReplayChange>,
): Array<ReplayChange> {
  return [...changes].sort((left, right) =>
    String(left.key).localeCompare(String(right.key)),
  )
}
export function recordPublishedChanges(
  visible: Map<string | number, ReplayRow>,
  changes: ReadonlyArray<ReplayChange>,
): Array<ReplayChange> {
  const recorded = changes.map((change) => ({
    type: change.type,
    key: change.key,
    value: { id: change.value.id, value: change.value.value },
    ...(change.previousValue === undefined
      ? {}
      : {
          previousValue: {
            id: change.previousValue.id,
            value: change.previousValue.value,
          },
        }),
  }))
  for (const change of recorded) {
    if (change.type === `delete`) visible.delete(change.key)
    else visible.set(change.key, { ...change.value })
  }
  return recorded
}
export function expectSameSubsetRequest(
  actual: LoadSubsetOptions,
  expected: LoadSubsetOptions,
): void {
  expect(actual.where).toBe(expected.where)
  expect(actual.orderBy).toBe(expected.orderBy)
  expect(actual.limit).toBe(expected.limit)
  expect(actual.cursor).toEqual(expected.cursor)
  expect(actual.offset).toBe(expected.offset)
}
