/** Node receives the shared eager judgment through the real standalone SDK. */
import { registerDirectEagerSource } from './eager-live-source-oracle'

registerDirectEagerSource(
  `adapter-conformance.eager-live-source.powersync-direct`,
  {
    owns: [`src/index.ts#powerSyncCollectionOptions`],
  },
)
