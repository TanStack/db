/**
 * Direct PowerSync receives the shared on-demand ownership/settlement law.
 * The model, legal grammar, public composition, comparison and constructions
 * live in db-adapter-conformance/tests/on-demand-streams-*. This file supplies
 * only the receiver and its judged production functions. Protocol events pass
 * through the installed SDK; no deployed-service or browser result is claimed.
 */
import { registerOnDemandStreamsConformance } from '../../db-adapter-conformance/tests/on-demand-streams-oracle-suite'
import { directOnDemandStreamsAdapter } from './on-demand-streams-driver'

registerOnDemandStreamsConformance(
  `adapter.powersync-direct.on-demand-streams`,
  directOnDemandStreamsAdapter(),
  {
    owns: [
      `src/index.ts#powerSyncCollectionOptions`,
      `src/subsets.ts#createSubsetHandlers`,
    ],
  },
)
