/**
 * Controlled storage and real Node SQLite receive the same on-demand stream
 * grammar and public judgment through persistedCollectionOptions. Applied
 * receipts now include the wrapper's actual durable handoff. This adds a
 * receiving path, without substituting cached rows or a second error model.
 * No durability across restart is inferred from public-row comparisons.
 */
import { registerOnDemandStreamsConformance } from '../../db-adapter-conformance/tests/on-demand-streams-oracle-suite'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { persistedDirectOnDemandStreamsAdapter } from './on-demand-streams-persisted-driver'

registerOnDemandStreamsConformance(
  `adapter.powersync-direct.on-demand-streams.persisted-controlled`,
  persistedDirectOnDemandStreamsAdapter(() => createStartupHost(`controlled`)),
  {
    owns: [
      `src/index.ts#powerSyncCollectionOptions`,
      `src/subsets.ts#createSubsetHandlers`,
    ],
    receivingPath: `Real installed SDK through persistedCollectionOptions with controlled storage and HTTP. No saved-row durability, restart, browser, or deployed-service claim.`,
  },
)
registerOnDemandStreamsConformance(
  `adapter.powersync-direct.on-demand-streams.persisted-node-sqlite`,
  persistedDirectOnDemandStreamsAdapter(() => createStartupHost(`node-sqlite`)),
  {
    owns: [
      `src/index.ts#powerSyncCollectionOptions`,
      `src/subsets.ts#createSubsetHandlers`,
    ],
    receivingPath: `Real installed SDK through persistedCollectionOptions with actual Node SQLite and controlled HTTP. No restart durability, browser or deployed-service claim.`,
  },
)
