// The restored-snapshot model and its comparison: a stateless prefix fold over
// authored keys, whole rows and provider results. The oracle in
// transaction-settlement-oracle.property.test.ts judges production with it,
// and transaction-settlement-restored-model.test.ts calibrates the comparison.
// This module registers no tests.
import { expect } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import type { Transaction } from '@tanstack/db'
import type { TestItem } from './harness'

export const localRows = (rows: Iterable<TestItem>) =>
  [...rows]
    .map(({ id, value, completed, updatedAt }) => ({
      id,
      value,
      completed,
      updatedAt,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

export function expectLocalRows(
  actual: Iterable<TestItem>,
  expected: Iterable<TestItem>,
) {
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(localRows(actual)).toEqual(localRows(expected)),
  )
}

/** Restored snapshots have a different lifetime from durable outbox work.
 * A core rollback cancels conflicting pending snapshots, but their independently
 * admitted outbox entries still execute and settle from their own providers.
 * A cancelled snapshot stays failed even if its outbox entry later succeeds.
 * Authority: core rollback/admission and the README's per-ID durable settlement.
 * This stateless prefix fold uses authored keys, whole rows and provider results;
 * it does not consult executor queues, restoration maps or actual Collection rows.
 */
export type RestoredHistory = {
  layout: `shared` | `disjoint` | `chain`
  width: number
  succeeds: ReadonlyArray<boolean>
}
export function restoredRows(history: RestoredHistory): Array<Array<TestItem>> {
  // Alternating field edits preserve the old insert/value-edit/flag-edit
  // history. In particular, the flag-only snapshot carries the prior value.
  // Its later success must still send that whole snapshot after sibling failure.
  const authored = new Map<string, TestItem>()
  return history.succeeds.map((_success, index) =>
    Array.from({ length: history.width }, (_unused, slot) => {
      const id =
        history.layout === `shared`
          ? `key-${slot}`
          : history.layout === `chain`
            ? `key-${index + slot}`
            : `key-${index}-${slot}`
      const before = authored.get(id)
      const row = {
        id,
        value: before
          ? index % 2 === 1
            ? `edited-${index}-${id}`
            : before.value
          : `initial-${id}`,
        completed: before ? (index % 2 === 0 ? true : before.completed) : false,
        updatedAt: new Date(1700000000000),
      }
      authored.set(id, row)
      return row
    }),
  )
}

export type RestoredSnapshot = { rows: Array<TestItem>; pending: Array<string> }
function restoredSnapshot(
  rows: ReadonlyArray<ReadonlyArray<TestItem>>,
  server: ReadonlyMap<string, TestItem>,
  cancelled: ReadonlySet<number>,
  completed: number,
): RestoredSnapshot {
  const local = new Map(server)
  const pending = new Set<string>()
  for (let index = completed + 1; index < rows.length; index++)
    if (!cancelled.has(index))
      for (const row of rows[index]!) {
        local.set(row.id, row)
        pending.add(row.id)
      }
  return { rows: [...local.values()], pending: [...pending].sort() }
}
export type RestoredObservation = RestoredSnapshot & {
  waiters: Array<RestoredSnapshot | undefined>
  server: Map<string, TestItem>
  outcomes: Array<unknown>
  states: Array<Transaction[`state`]>
  calls: Array<{ id: string; rows: Array<object> }>
  outbox: Array<string>
  errors: Array<ReadonlyArray<unknown>>
  warnings: Array<ReadonlyArray<unknown>>
  unhandled: Array<unknown>
}
export function expectedRestoredState(
  history: RestoredHistory,
  failures: ReadonlyArray<Error>,
  completed: number,
): RestoredObservation {
  const rows = restoredRows(history)
  const server = new Map<string, TestItem>()
  const cancelled = new Set<number>()
  const waiters: RestoredObservation[`waiters`] = rows.map(() => undefined)
  for (let index = 0; index <= completed; index++) {
    if (history.succeeds[index]) {
      for (const row of rows[index]!) server.set(row.id, row)
    } else if (!cancelled.has(index)) {
      cancelled.add(index)
      const keys = new Set(rows[index]!.map((row) => row.id))
      for (let peer = index + 1; peer < rows.length; peer++)
        if (rows[peer]!.some((row) => keys.has(row.id))) cancelled.add(peer)
    }
    waiters[index] = restoredSnapshot(rows, server, cancelled, index)
  }
  return {
    ...restoredSnapshot(rows, server, cancelled, completed),
    waiters,
    server,
    outcomes: history.succeeds.map((success, index) =>
      index > completed ? `pending` : success ? `fulfilled` : failures[index],
    ),
    states: history.succeeds.map((_success, index) =>
      cancelled.has(index)
        ? `failed`
        : index <= completed
          ? `completed`
          : `pending`,
    ),
    calls: rows
      .slice(0, Math.min(completed + 2, rows.length))
      .map((batch, index) => ({ id: `restored-${index}`, rows: batch })),
    outbox: rows
      .slice(completed + 1)
      .map((_row, offset) => `restored-${completed + 1 + offset}`),
    errors: [],
    warnings: [],
    unhandled: [],
  }
}
export function checkRestoredState(
  actual: RestoredObservation,
  expected: RestoredObservation,
): void {
  expectLocalRows(actual.rows, expected.rows)
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(
      actual.pending,
      `restored snapshot pending-write contribution`,
    ).toEqual(expected.pending),
  )
  for (const [index, snapshot] of expected.waiters.entries()) {
    oracleAssertion(`independent settlement checkpoint`, () =>
      expect(
        Boolean(actual.waiters[index]),
        `waiter snapshot presence ${index}`,
      ).toBe(Boolean(snapshot)),
    )
    if (snapshot) {
      expectLocalRows(actual.waiters[index]!.rows, snapshot.rows)
      oracleAssertion(`independent settlement checkpoint`, () =>
        expect(
          actual.waiters[index]!.pending,
          `pending writes at waiter ${index}`,
        ).toEqual(snapshot.pending),
      )
    }
  }
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(actual.server).toEqual(expected.server),
  )
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(actual.outcomes).toEqual(expected.outcomes),
  )
  for (const [index, outcome] of expected.outcomes.entries())
    if (outcome instanceof Error)
      oracleAssertion(`independent settlement checkpoint`, () =>
        expect(actual.outcomes[index]).toBe(outcome),
      )
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(actual.states).toEqual(expected.states),
  )
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(actual.calls).toEqual(expected.calls),
  )
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(actual.outbox).toEqual(expected.outbox),
  )
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(
      actual.errors,
      `restoration must not log an executor/cleanup failure`,
    ).toEqual(expected.errors),
  )
  // An intentional permanent provider rejection may be reported as a warning.
  // Its exact authored Error is allowed; a new cleanup/executor exception is
  // not. Check reasons, without prescribing log text or duplicate-report policy.
  const allowed = expected.outcomes.filter(
    (outcome) => outcome instanceof Error,
  )
  for (const warning of actual.warnings) {
    const reasons = warning.filter((value) => value instanceof Error)
    oracleAssertion(`independent settlement checkpoint`, () =>
      expect(
        reasons.length,
        `warning must identify a known provider failure`,
      ).toBeGreaterThan(0),
    )
    for (const reason of reasons)
      oracleAssertion(`independent settlement checkpoint`, () =>
        expect(
          allowed.some((failure) => failure === reason),
          `unexpected restoration warning: ${String(reason)}`,
        ).toBe(true),
      )
  }
  oracleAssertion(`independent settlement checkpoint`, () =>
    expect(actual.unhandled, `restoration unhandled rejections`).toEqual(
      expected.unhandled,
    ),
  )
}
