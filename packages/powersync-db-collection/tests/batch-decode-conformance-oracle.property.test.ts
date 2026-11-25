/** Native SQLite receives the independently specified per-page decode law. */
import { observeNativeBatchDecode } from './batch-decode-driver'
import {
  registerNativeBatchDecode,
  registerNativeMutationRefusal,
} from './batch-decode-oracle-suite'
import { observeNativeMutationRefusal } from './batch-decode-mutation-driver'
import { openNativeReceivingDatabase } from './native-receiving-host'

registerNativeBatchDecode(
  `adapter.powersync.batch-decode`,
  (h, id) => observeNativeBatchDecode(openNativeReceivingDatabase, h, id),
  {
    owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  },
)

registerNativeMutationRefusal(
  `adapter.powersync.batch-decode.mutations`,
  (history, id) =>
    observeNativeMutationRefusal(openNativeReceivingDatabase, history, id),
  {
    owns: [
      `src/powersync.ts#powerSyncCollectionOptions`,
      `src/PowerSyncTransactor.ts#PowerSyncTransactor.applyTransaction`,
      `src/PendingOperationStore.ts`,
    ],
  },
)
