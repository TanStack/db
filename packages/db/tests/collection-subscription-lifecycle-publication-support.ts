/**
 * Helpers shared by the row-publication oracle and its ordinary publication
 * tests: the publication types, batch cloning and order normalization, and the
 * terminal-snapshot assertion. The law lives in
 * collection-subscription-lifecycle-publication-oracle.property.test.ts.
 */
import { expect } from 'vitest'
import type { SyncConfig } from '../src/types.js'
import type { DemandName } from './collection-subscription-lifecycle-grammar-oracle.js'

export type RowKey = DemandName | `c` | `d`

export type Row = { id: RowKey; value: number }

export type PublicationChange = {
  type: `insert` | `update` | `delete`
  key: RowKey
  value: Row
  previousValue?: Row
}

export type PublicationPhase =
  `public` | `private-pending` | `private-settling` | `private-failed`

export function cloneRow(row: Row): Row {
  return { id: row.id, value: row.value }
}

export function clonePublicationBatches(
  batches: ReadonlyArray<ReadonlyArray<PublicationChange>>,
): Array<Array<PublicationChange>> {
  return batches.map((batch) =>
    batch.map((change) => ({
      ...change,
      value: cloneRow(change.value),
      ...(change.previousValue
        ? { previousValue: cloneRow(change.previousValue) }
        : {}),
    })),
  )
}

export function normalizePublicationOrder(
  batches: ReadonlyArray<ReadonlyArray<PublicationChange>>,
): Array<Array<PublicationChange>> {
  // Distinct keys have no canonical delivery order within one callback.
  // Keep callback boundaries and stable order among changes to the same key.
  return clonePublicationBatches(batches).map((batch) =>
    batch.sort((left, right) => left.key.localeCompare(right.key)),
  )
}

export type SyncOperations = Parameters<SyncConfig<Row, RowKey>[`sync`]>[0]

export type TerminalPublicationSnapshot = {
  batches: Array<Array<PublicationChange>>
  visible: Array<Row>
  statusEvents: Array<{ previousStatus: string; status: string }>
  errors: Array<unknown>
  status: string
  subscriberCount: number
  attempts: number
  unloads: Array<number>
  syncRuns: number
}

export function assertTerminalPublication(
  actual: TerminalPublicationSnapshot,
  retired: TerminalPublicationSnapshot,
): void {
  expect(actual).toEqual(retired)
  expect(actual.subscriberCount).toBe(0)
  actual.errors.forEach((error, index) =>
    expect(error).toBe(retired.errors[index]),
  )
}
