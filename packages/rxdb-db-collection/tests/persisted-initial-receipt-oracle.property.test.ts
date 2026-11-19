// @vitest-environment node
/**
 * Real RxDB initial queries and actual persistence deferred receipts receive
 * the shared cleanup grammar and judgment on controlled and Node SQLite hosts.
 * The baseline read stays held until the actual source receipt exists. A child
 * process records native detached rejections after cleanup settles.
 */
import { registerInitialReceiptConformance } from '../../powersync-direct-collection/tests/initial-receipt-oracle-suite'
import { observeNodeRxdbPersistedInitialReceipt } from './persisted-initial-receipt-node-driver'

for (const { host, property } of [
  {
    host: `controlled`,
    property: `adapter.rxdb.persisted-initial-receipt.controlled`,
  },
  {
    host: `node-sqlite`,
    property: `adapter.rxdb.persisted-initial-receipt.node-sqlite`,
  },
] as const)
  registerInitialReceiptConformance(
    property,
    (history) => observeNodeRxdbPersistedInitialReceipt(history, host),
    {
      owns: [`src/rxdb.ts#rxdbCollectionOptions`],
      limits: `Three source keys including an empty result, actual RxDB memory-storage queries, a genuine persisted deferred receipt, ${host} persistence, and native Node detached-rejection events. No saved-demand completeness, remote replication, browser events, or accepted receipt held after admission.`,
      receiveFault: (history, mode) =>
        observeNodeRxdbPersistedInitialReceipt(
          history,
          host,
          mode === `mismatch-and-cleanup`,
          true,
        ),
    },
  )
