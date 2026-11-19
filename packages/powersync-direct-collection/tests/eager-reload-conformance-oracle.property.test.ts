/**
 * The direct adapter receives the unchanged complete-result reload judgment
 * through its real SDK and controlled PowerSync protocol. The additional
 * shared failure grammar checks initial-gate rejection, shared-provider joins,
 * and failure of reload before a complete replacement can be published.
 */
import {
  registerEagerGateFailureConformance,
  registerEagerReloadConformance,
} from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import {
  directEagerGateAdapter,
  directEagerReloadAdapter,
} from './eager-reload-driver'

registerEagerReloadConformance(
  `adapter.powersync-direct.eager-reload`,
  directEagerReloadAdapter,
  {
    owns: [`src/index.ts#powerSyncCollectionOptions`],
    replacement: `truncate`,
  },
)
registerEagerGateFailureConformance(
  `adapter.powersync-direct.eager-gate-failure`,
  directEagerGateAdapter,
  {
    owns: [`src/index.ts#powerSyncCollectionOptions`],
  },
)
