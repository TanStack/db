/** PowerSync receives complete eager reload replacement through local SQLite. */
import { declareOracle } from '../../db/tests/oracle-declaration'
import { eagerReloadHistoryArb } from '../../db-adapter-conformance/tests/eager-reload-oracle'
import { registerEagerReloadConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import { powerSyncEagerReloadAdapter } from './eager-reload-driver'

declareOracle({
  owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  grammar: [eagerReloadHistoryArb],
})
registerEagerReloadConformance(
  `adapter.powersync.eager-reload`,
  powerSyncEagerReloadAdapter,
)
