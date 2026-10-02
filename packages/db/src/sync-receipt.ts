import type { SyncAppliedReceipt } from './types'

const ACCEPTED = Symbol(`tanstack-db.sync-receipt.accepted`)

type AcceptedReceipt = Promise<void> & { [ACCEPTED]?: SyncAppliedReceipt }

/**
 * Attaches the moment a sync transaction was accepted to the receipt that
 * resolves when it is visible. A wrapping sync, such as persistence, accepts
 * after its durable step.
 *
 * @internal Adapter infrastructure, not an application API.
 */
export function withAcceptedReceipt(
  visible: Promise<void>,
  accepted: SyncAppliedReceipt,
): Promise<void> {
  ;(visible as AcceptedReceipt)[ACCEPTED] = accepted
  return visible
}

/**
 * The moment a receipt's sync transaction was accepted. Handler-facing writes
 * wait for this, not for visibility: a transaction held by a persisting
 * optimistic transaction becomes visible only when that transaction settles,
 * so a handler awaiting visibility would wait for itself. Core accepts at
 * `commit()`. A receipt that carries no acceptance moment is treated as
 * accepted only when it resolves.
 *
 * @internal Adapter infrastructure, not an application API.
 */
export function whenSyncAccepted(
  receipt: SyncAppliedReceipt,
): SyncAppliedReceipt {
  return receipt === true
    ? true
    : ((receipt as AcceptedReceipt)[ACCEPTED] ?? receipt)
}
