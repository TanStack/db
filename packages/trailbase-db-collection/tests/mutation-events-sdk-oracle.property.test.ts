/** Real SDK/Node receives the shared mutation response/event judgment. */
import { observeMutationEvent } from './mutation-events-sdk-driver'
import { registerMutationEventConformance } from './mutation-events-sdk-oracle-suite'

registerMutationEventConformance(
  `trailbase.mutation-events.sdk`,
  observeMutationEvent,
  { owns: [`src/trailbase.ts#trailBaseCollectionOptions`] },
)
