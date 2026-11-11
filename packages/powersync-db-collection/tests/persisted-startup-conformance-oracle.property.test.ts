/** PowerSync's complete eager initial result receives the shared persistence
 * replacement law. The shared suite crosses old/new membership, empty results,
 * changed overlap values and both restore orders on each storage host.
 */
import { describe } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  persistedStartupBatchHistories,
  persistedStartupHistoryArb,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import { powerSyncStartupAdapter } from './persisted-startup-driver'

const historyArb = persistedStartupHistoryArb(`collection`, true, false, true)
// The receiving path judges persisted startup through this adapter entry.
// The shared model owns replacement; this list lets the gap CLI credit it.
declareOracle({
  owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  grammar: [historyArb],
})
describe(`persisted startup conformance: PowerSync`, () => {
  registerPersistedStartupConformance({
    property: `adapter.powersync.persisted-startup`,
    adapter: powerSyncStartupAdapter,
    histories: persistedStartupBatchHistories,
    arbitrary: historyArb,
    scopedStartupCommit: true,
    // Each history opens a real PowerSync database. CI needs more than 60s
    // for 80 histories plus constructed reach, and for their determinism replay.
    // Keep every history, calibration and comparison in the shared suite.
    timeout: 180_000,
  })
})
