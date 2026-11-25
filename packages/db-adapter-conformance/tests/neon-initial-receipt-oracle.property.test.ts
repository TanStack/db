/** Actual SDK and native Node errors receive the shared receipt cleanup law. */
import { registerInitialReceiptConformance } from '../../powersync-direct-collection/tests/initial-receipt-oracle-suite'
import { observeNeonInitialReceiptNode } from './neon/neon-initial-receipt-node-driver'

registerInitialReceiptConformance(
  `adapter.neon.initial-receipt-cleanup.sdk`,
  observeNeonInitialReceiptNode,
  {
    owns: [`tests/neon/vendor/collection-options.ts`],
    receiveFault: observeNeonInitialReceiptNode,
    limits: `Installed Neon SDK over controlled v2 WebSocket, real persisted wrapper and controlled memory storage; a genuine deferred source receipt held before admission by persisted restore, cleanup held/after application and native Node rejection events. No SQLite durability, process restart or deployed service claim.`,
  },
)
