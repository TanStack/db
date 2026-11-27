// @vitest-environment node
/**
 * Actual persisted receipts receive the shared pending-receipt cleanup law.
 * The wrapper queues Electric's complete source transaction behind a held
 * durable write. Native child processes record detached rejection events.
 * Rejected histories inject a storage-method rejection after cleanup starts;
 * applied histories allow that admitted write to finish after cleanup instead.
 * This checks receipt handling, not a real Electric server or saved durability.
 */
import { registerInitialReceiptConformance } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle-suite'
import { observeNodePersistedInitialReceipt } from './cross-adapter-receipt-node-driver'

for (const { host, property, heldReceiptOutcome } of [
  {
    host: `controlled`,
    property: `adapter.electric.initial-receipt.controlled`,
    heldReceiptOutcome: `rejected`,
  },
  {
    host: `node-sqlite`,
    property: `adapter.electric.initial-receipt.node-sqlite`,
    heldReceiptOutcome: `rejected`,
  },
  {
    host: `controlled`,
    property: `adapter.electric.initial-receipt.applied.controlled`,
    heldReceiptOutcome: `applied`,
  },
  {
    host: `node-sqlite`,
    property: `adapter.electric.initial-receipt.applied.node-sqlite`,
    heldReceiptOutcome: `applied`,
  },
] as const)
  registerInitialReceiptConformance(
    property,
    (history) =>
      observeNodePersistedInitialReceipt(
        history,
        host,
        undefined,
        heldReceiptOutcome,
      ),
    {
      owns: [`src/electric.ts#electricCollectionOptions`],
      heldReceiptOutcome,
      limits: `Three source keys, complete initial transaction, actual persistence applied receipt and cleanup, ${host} storage and native Node detached-rejection events. Held receipt outcome ${heldReceiptOutcome}; rejection is an explicit public storage-method fault after cleanup, not cancellation of an admitted obligation. No real Electric server, saved durability, or browser claim.`,
    },
  )
