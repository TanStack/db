/** Node receives the RxDB shared-provider law through installed memory storage. */
import { registerRxdbSharedClient } from './shared-client-oracle'
import { observeRxdbSharedClient } from './shared-client-driver'

registerRxdbSharedClient(
  `adapter.rxdb.shared-client`,
  observeRxdbSharedClient,
  {
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
  },
)
