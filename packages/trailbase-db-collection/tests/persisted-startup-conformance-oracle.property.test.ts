/** TrailBase's complete eager initial result receives the shared persistence
 * replacement law. The shared suite crosses old/new membership, empty results,
 * changed overlap values and both restore orders on each storage host.
 */
import { describe } from 'vitest'
import {
  persistedStartupHistories,
  persistedStartupHistoryArb,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import { trailBaseStartupAdapter } from './persisted-startup-driver'

const historyArb = persistedStartupHistoryArb(`collection`)
describe(`persisted startup conformance: TrailBase`, () => {
  registerPersistedStartupConformance({
    property: `adapter.trailbase.persisted-startup`,
    adapter: trailBaseStartupAdapter,
    // The receiving path judges persisted startup through this adapter entry.
    // The shared model owns replacement; this list lets the gap CLI credit it.
    owns: [`src/trailbase.ts#trailBaseCollectionOptions`],
    histories: persistedStartupHistories,
    arbitrary: historyArb,
  })
})
