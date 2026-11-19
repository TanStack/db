/** Real native PowerSync SQLite receives the hook lifecycle judgment. */
import { observePowerSyncHooks } from './hook-lifecycle-driver'
import { registerPowerSyncHooks } from './hook-lifecycle-oracle-suite'
import { openNativeReceivingDatabase } from './native-receiving-host'

registerPowerSyncHooks(
  `adapter.powersync.hook-lifecycle`,
  (h, id) => observePowerSyncHooks(openNativeReceivingDatabase, h, id),
  {
    owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  },
)
