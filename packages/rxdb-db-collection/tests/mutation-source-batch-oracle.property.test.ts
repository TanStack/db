/** Real RxDB handlers receive the existing optimistic-history judgment. */
import { observeRxdbMutation } from './mutation-driver'
import { registerRxdbMutationSourceBatch } from './mutation-source-batch-oracle'

registerRxdbMutationSourceBatch(
  `adapter.rxdb.mutation-source-batch`,
  observeRxdbMutation,
  {
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
  },
)
