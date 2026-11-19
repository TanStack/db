/** Real standalone SDK receives the shared same-table composition judgment. */
import { registerSharedClientConformance } from '../../db-adapter-conformance/tests/shared-client-oracle-suite'
import { observeDirectSharedClient } from './shared-client-driver'

registerSharedClientConformance(
  `adapter.powersync-direct.shared-client`,
  observeDirectSharedClient,
  {
    owns: [`src/index.ts#powerSyncCollectionOptions`],
  },
)
