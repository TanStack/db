/** Node receives the shared mutation law through the actual direct adapter. */
import { registerMutationConfirmation } from './mutation-confirmation-registration-oracle'
import { runDirectMutationConfirmation } from './mutation-confirmation-driver'

registerMutationConfirmation(
  `powersync-direct.mutation-confirmation`,
  runDirectMutationConfirmation,
  {
    owns: [`src/index.ts#powerSyncCollectionOptions`],
  },
)
