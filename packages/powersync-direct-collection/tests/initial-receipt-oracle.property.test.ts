/** Native Node receives the cleanup law with actual detached-error events. */
import { observeInitialReceipt } from './initial-receipt-driver'
import { registerInitialReceiptConformance } from './initial-receipt-oracle-suite'

registerInitialReceiptConformance(
  `adapter.powersync-direct.initial-receipt-cleanup`,
  observeInitialReceipt,
  {
    owns: [`src/index.ts#powerSyncCollectionOptions`],
    limits: `Three numeric source keys, one complete initial transaction, one cleanup, and actual Node detached-rejection events at a controlled asynchronous commit boundary. This does not establish SQLite durability, native browser cancellation, or a real PowerSync network service.`,
  },
)
