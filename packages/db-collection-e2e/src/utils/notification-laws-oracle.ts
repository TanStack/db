import { expect } from 'vitest'
import { declareOracle } from '../../../db/tests/oracle-declaration.js'

export type Notification<Row> = {
  events: Array<{
    type: string
    key: string | number
    value: Row
    previousValue?: Row
  }>
  rows: Array<Row>
}

/** Deltas from a subscription with an initial snapshot must reconstruct every
 * callback's rows. Callers including the initial-state callback start from [].
 */
export function expectNotificationHistory<Row extends { id: string }>(
  initial: ReadonlyArray<Row>,
  callbacks: ReadonlyArray<Notification<Row>>,
  final: ReadonlyArray<Row>,
): void {
  const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const state = new Map(initial.map((row) => [row.id, row]))
  expect(state.size).toBe(initial.length)
  for (const callback of callbacks) {
    for (const event of callback.events) {
      expect(event.key).toBe(event.value.id)
      if (event.type === 'insert') {
        expect(state.has(event.value.id)).toBe(false)
        state.set(event.value.id, event.value)
      } else if (event.type === 'update') {
        expect(state.has(event.value.id)).toBe(true)
        expect(event.previousValue).toStrictEqual(state.get(event.value.id))
        state.set(event.value.id, event.value)
      } else if (event.type === 'delete') {
        expect(state.has(event.value.id)).toBe(true)
        expect(event.value).toStrictEqual(state.get(event.value.id))
        state.delete(event.value.id)
      } else {
        throw new Error(`Unknown change type: ${event.type}`)
      }
    }
    expect([...state.values()].sort(byId)).toStrictEqual(
      [...callback.rows].sort(byId),
    )
  }
  expect([...state.values()].sort(byId)).toStrictEqual([...final].sort(byId))
}

export function expectNotificationsStopped<Row>(
  callbacks: ReadonlyArray<Notification<Row>>,
  archived: ReadonlyArray<Notification<Row>>,
): void {
  expect(callbacks).toStrictEqual(archived)
}

// Owns no production entry. These checks are shared: the db oracle
// tests/notification-laws-oracle.test.ts owns the change-message path it
// judges with them, but the shared e2e suites that also use them, and the
// packages that run those suites, declare no `owns`, so the gap report counts
// none of their kills. The coverage map records this as a follow-up under
// "Shared e2e suites".
declareOracle({
  check: [expectNotificationHistory, expectNotificationsStopped],
})
