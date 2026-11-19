/**
 * # Does cleanup own a suspended initial receipt continuation?
 *
 * A sync run may receive an asynchronous applied receipt for its first complete
 * source transaction. Cleanup invalidates that run. A held receipt may still
 * apply when its transaction was admitted, or reject through abandonment or a
 * supplied storage failure. Its asynchronous continuation handles either: no detached
 * rejection may escape after public cleanup settles. Authority: glossary
 * cleanup/applied receipt and the Collection commit/cleanup contract.
 *
 * This law is host-independent. A persisted wrapper can independently publish
 * restored rows and mark ready, so the model makes no claim about status or
 * rows while the source receipt is held. It compares the source-receipt
 * premise and the final cleaned-up public snapshot. Each receiver declares its
 * held receipt outcome independently of production: rejected (the original
 * cancellation witness) or applied (an admitted obligation). The neighboring
 * history applies the receipt before cleanup. Hosts supply actual detached
 * error events; a controlled receipt provides no durable-storage evidence.
 */
import fc from 'fast-check'
import { startupRows } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { StartupRow } from '../../db-adapter-conformance/tests/persisted-startup-oracle'

export type InitialReceiptHistory = {
  rows: number
  cleanupAt: `held-receipt` | `after-application`
  reason: number
}
// Source masks include a complete empty answer. Both cleanup schedules keep
// randomized membership and cancellation labels, so constructions generalize
// the original single-row cancellation witness.
export const initialReceiptHistoryArb = fc.record({
  rows: fc.integer({ min: 0, max: 7 }),
  cleanupAt: fc.constantFrom(
    `held-receipt` as const,
    `after-application` as const,
  ),
  reason: fc.integer({ min: 0, max: 9 }),
})
export const initialReceiptStates = [
  `held-receipt`,
  `after-application`,
  `empty-source`,
  `nonempty-source`,
] as const
export type InitialReceiptObservation = {
  // Receiving hosts keep teardown failures beside a completed observation so
  // they cannot replace the product law and checkpoint already reached.
  cleanupErrors?: ReadonlyArray<string>
  receiptCreated: boolean
  receiptPendingAtCleanup: boolean
  receiptAppliedBeforeCleanup: boolean
  receiptRejected: boolean
  receiptSettled?: boolean
  finalStatus: string
  finalRows: Array<StartupRow>
  detachedErrors: Array<string>
}
// The authored schedule and receipt outcome supply the boundary premise.
// Cleanup does not imply that an admitted transaction must reject.
// Source masks choose values, rather than a second expected lifecycle
// implementation. No provider callback or production status enters this model.
export function initialReceiptModel(
  h: InitialReceiptHistory,
  heldReceiptOutcome: `rejected` | `applied` = `rejected`,
) {
  return {
    source: startupRows(h.rows, 2),
    receiptCreated: true,
    receiptPendingAtCleanup: h.cleanupAt === `held-receipt`,
    receiptAppliedBeforeCleanup: h.cleanupAt === `after-application`,
    receiptRejected:
      h.cleanupAt === `held-receipt` && heldReceiptOutcome === `rejected`,
    requiresSettledReceipt:
      h.cleanupAt === `held-receipt` && heldReceiptOutcome === `applied`,
    finalStatus: `cleaned-up`,
    finalRows: [] as Array<StartupRow>,
    detachedErrors: [] as Array<string>,
  }
}
export function initialReceiptViolations(
  h: InitialReceiptHistory,
  actual: InitialReceiptObservation,
  expected = initialReceiptModel(h),
): Array<string> {
  const errors: Array<string> = []
  for (const key of [
    `receiptCreated`,
    `receiptPendingAtCleanup`,
    `receiptAppliedBeforeCleanup`,
    `receiptRejected`,
    `finalStatus`,
    `finalRows`,
    `detachedErrors`,
  ] as const) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
      errors.push(key)
  }
  if (expected.requiresSettledReceipt && actual.receiptSettled !== true)
    errors.push(`receiptSettled`)
  return errors
}
export function initialReceiptReached(
  h: InitialReceiptHistory,
  actual: InitialReceiptObservation,
) {
  const reached: Array<(typeof initialReceiptStates)[number]> = []
  if (actual.receiptCreated) {
    if (actual.receiptPendingAtCleanup) reached.push(`held-receipt`)
    if (actual.receiptAppliedBeforeCleanup) reached.push(`after-application`)
    reached.push(h.rows ? `nonempty-source` : `empty-source`)
  }
  return reached
}
