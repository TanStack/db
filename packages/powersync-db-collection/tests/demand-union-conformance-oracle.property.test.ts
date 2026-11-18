/** The installed Node PowerSync SDK receives the union judgment. */
import { observeDemandUnion } from './demand-union-driver'
import { registerDemandUnion } from './demand-union-oracle-suite'
import { openNativeReceivingDatabase } from './native-receiving-host'

registerDemandUnion(
  `adapter.powersync.demand-union`,
  (h, id) => observeDemandUnion(openNativeReceivingDatabase, h, id),
  {
    owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  },
)
