/** Actual installed SDK receives the shared persisted startup law unchanged. */
import {
  persistedStartupHistories,
  persistedStartupHistoryArb,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import { trailBaseSdkStartupAdapter } from './sdk-persisted-startup-driver'

registerPersistedStartupConformance({
  property: `adapter.trailbase.persisted-startup.sdk`,
  adapter: trailBaseSdkStartupAdapter,
  owns: [`src/trailbase.ts#trailBaseCollectionOptions`],
  histories: persistedStartupHistories,
  arbitrary: persistedStartupHistoryArb(`collection`),
})
