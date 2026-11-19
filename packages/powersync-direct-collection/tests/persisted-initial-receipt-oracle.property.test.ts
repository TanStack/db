/**
 * Actual persisted receipts receive the same initial-cleanup law as the direct
 * controlled receipt owner. Each host holds its first persisted row read; the
 * wrapper itself creates, applies or rejects the receipt. Child processes keep
 * native detached-rejection observations separate from Vitest's own handlers.
 */
import { registerInitialReceiptConformance } from './initial-receipt-oracle-suite'
import { observeNodePersistedInitialReceipt } from './persisted-initial-receipt-node-driver'

for (const { host, property } of [
  {
    host: `controlled`,
    property: `adapter.powersync-direct.initial-receipt-cleanup.persisted-controlled`,
  },
  {
    host: `node-sqlite`,
    property: `adapter.powersync-direct.initial-receipt-cleanup.persisted-node-sqlite`,
  },
] as const)
  registerInitialReceiptConformance(
    property,
    (history) => observeNodePersistedInitialReceipt(history, host),
    {
      owns: [`src/index.ts#powerSyncCollectionOptions`],
      limits: `Three source keys, one complete initial transaction, actual persistence applied receipt and cleanup, ${host} storage, and native Node detached-rejection events. This checks receiving cancellation through persistence; it does not establish saved-row durability, browser events or a deployed PowerSync service.`,
    },
  )
