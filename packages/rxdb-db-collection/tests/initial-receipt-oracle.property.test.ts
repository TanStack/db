// @vitest-environment node
/** Actual RxDB storage and Node events receive the shared receipt cleanup law. */
import { registerInitialReceiptConformance } from '../../powersync-direct-collection/tests/initial-receipt-oracle-suite'
import { observeRxdbInitialReceiptNode } from './initial-receipt-node-driver'

registerInitialReceiptConformance(
  `adapter.rxdb.initial-receipt-cleanup`,
  observeRxdbInitialReceiptNode,
  {
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
    limits: `Three source keys from real RxDB memory storage, one genuine core applied receipt held by a persisting optimistic transaction, cleanup before/after application, and actual Node detached errors. No durable wrapper, server replication or arbitrary storage engine claim.`,
  },
)
