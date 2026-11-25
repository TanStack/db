/** Installed standalone SDK receives the shared construction ownership law. */
import { registerSharedConstructionConformance } from '../../db-adapter-conformance/tests/shared-client-oracle-suite'
import { observeDirectConstruction } from './sync-run-boundary-driver'

registerSharedConstructionConformance(
  `adapter.powersync-direct.construction`,
  observeDirectConstruction,
  { owns: [`src/index.ts#powerSyncCollectionOptions`] },
)
