/** Native SQLite receives the independently specified per-page decode law. */
import { observeNativeBatchDecode } from './batch-decode-driver'
import { registerNativeBatchDecode } from './batch-decode-oracle-suite'
import { openNativeReceivingDatabase } from './native-receiving-host'

registerNativeBatchDecode(
  `adapter.powersync.batch-decode`,
  (h, id) => observeNativeBatchDecode(openNativeReceivingDatabase, h, id),
  {
    owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  },
)
