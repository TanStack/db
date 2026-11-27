/** Node receives the shared wait-cancellation projection. */
import { registerMutationCancellation } from './mutation-confirmation-cancellation-registration-oracle'
import { runDirectMutationConfirmation } from './mutation-confirmation-driver'

registerMutationCancellation(
  `powersync-direct.mutation-confirmation-cancellation`,
  runDirectMutationConfirmation,
  {
    owns: [`src/index.ts#powerSyncCollectionOptions`],
  },
)
