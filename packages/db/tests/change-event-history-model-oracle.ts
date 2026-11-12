// The model and checker helpers of the change-event history oracle, shared
// with the ordinary calibration tests in change-event-history.test.ts. The
// oracle that uses them is change-event-history-oracle.test.ts, whose opening
// comment states the law; these helpers moved here unchanged.
import { expect } from 'vitest'
import { oracleAssertion } from './oracle-assertion-adapter'
import { fileIdForKey } from './change-event-history-fixture.js'
import type {
  Key,
  Op,
  OpKind,
  TestItem,
} from './change-event-history-fixture.js'
import type { BaseIndex } from '../src/indexes/base-index'
import type { ChangeMessage } from '../src/types'

export type EventProjection = {
  type: OpKind
  value: TestItem
  previousValue?: TestItem
}

export function applyModelOp(rows: Map<number, TestItem>, op: Op): void {
  if (op.kind === `delete`) rows.delete(op.key)
  else
    rows.set(op.key, {
      id: op.key,
      name: `v${op.step}`,
      fileId: fileIdForKey(op.key),
    })
}

export function expectedRowsAfter(
  initialKeys: ReadonlyArray<Key>,
  sequence: ReadonlyArray<Op>,
): Map<number, TestItem> {
  const rows = new Map<number, TestItem>(
    initialKeys.map((key) => [
      key,
      { id: key, name: `initial-${key}`, fileId: fileIdForKey(key) },
    ]),
  )
  for (const op of sequence) applyModelOp(rows, op)
  return rows
}

// A batch permits any interleaving of distinct keys. Each key's trace keeps
// message order and multiplicity, which the Collection mirror depends on.
export function eventRow(row: TestItem): TestItem {
  return { id: row.id, name: row.name, fileId: row.fileId }
}

export function perKeyEventTrace(
  changes: ReadonlyArray<ChangeMessage<TestItem, number>>,
): Array<readonly [number, Array<EventProjection>]> {
  const byKey = new Map<number, Array<EventProjection>>()
  for (const change of changes) {
    const trace = byKey.get(change.key) ?? []
    trace.push({
      type: change.type,
      value: eventRow(change.value),
      ...(change.previousValue === undefined
        ? {}
        : { previousValue: eventRow(change.previousValue) }),
    })
    byKey.set(change.key, trace)
  }
  return [...byKey].sort(([left], [right]) => left - right)
}

export function expectedEventTrace(
  sequence: ReadonlyArray<Op>,
): Array<readonly [number, Array<EventProjection>]> {
  const rows = new Map<number, TestItem>()
  const byKey = new Map<number, Array<EventProjection>>()
  for (const op of sequence) {
    const before = rows.get(op.key)
    applyModelOp(rows, op)
    const after = rows.get(op.key)
    let event: EventProjection
    if (op.kind === `delete`) {
      if (!before || after) throw new Error(`model delete requires a row`)
      event = { type: `delete`, value: before }
    } else if (op.kind === `insert`) {
      if (before || !after)
        throw new Error(`model insert requires an absent key`)
      event = { type: `insert`, value: after }
    } else {
      if (!before || !after) throw new Error(`model update requires a row`)
      event = {
        type: `update`,
        value: after,
        previousValue: before,
      }
    }
    const trace = byKey.get(op.key) ?? []
    trace.push(event)
    byKey.set(op.key, trace)
  }
  return [...byKey].sort(([left], [right]) => left - right)
}

export function assertIndexAgreement(
  index: BaseIndex<number>,
  expected: ReadonlyMap<number, TestItem>,
): void {
  oracleAssertion('assertIndexAgreement', () =>
    expect(index.keyCount).toBe(expected.size),
  )
  for (const fileId of [`f1`, `f2`] as const) {
    const expectedKeys = new Set(
      [...expected]
        .filter(([, row]) => row.fileId === fileId)
        .map(([key]) => key),
    )
    oracleAssertion('assertIndexAgreement', () =>
      expect(index.lookup(`eq`, fileId)).toEqual(expectedKeys),
    )
  }
}
