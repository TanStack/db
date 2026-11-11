/** PowerSync receives complete eager reload replacement through local SQLite. */
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { powerSyncEagerReloadAdapter } from './eager-reload-driver'

registerEagerReloadConformance(
  `adapter.powersync.eager-reload`,
  powerSyncEagerReloadAdapter,
  {
    owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  },
)
