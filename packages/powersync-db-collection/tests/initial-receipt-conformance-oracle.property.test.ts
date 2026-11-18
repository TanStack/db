/**
 * Native PowerSync's real SQLite startup receives the shared initial-receipt
 * cleanup law through actual persisted acceptance on each Node storage host.
 * The imported grammar, model and comparison judge both cleanup schedules.
 */
import { registerInitialReceiptConformance } from '../../powersync-direct-collection/tests/initial-receipt-oracle-suite'
import { observeNodePowerSyncInitialReceipt } from './initial-receipt-driver'

for (const { host, property } of [
  {
    host: `controlled`,
    property: `adapter.powersync.initial-receipt-cleanup.persisted-controlled`,
  },
  {
    host: `node-sqlite`,
    property: `adapter.powersync.initial-receipt-cleanup.persisted-node-sqlite`,
  },
] as const)
  registerInitialReceiptConformance(
    property,
    (history) => observeNodePowerSyncInitialReceipt(history, host),
    {
      owns: [`src/powersync.ts#powerSyncCollectionOptions`],
      receiveFault: (history, mode) =>
        observeNodePowerSyncInitialReceipt(history, host, mode),
      limits: `Three source keys including an empty result, real native PowerSync SQLite reads, actual persisted deferred receipt and cleanup, ${host} wrapper storage, and native Node detached-rejection events. This does not cover remote PowerSync replication, saved-row durability, browser events, or accepted core receipts held by optimistic transactions.`,
    },
  )
