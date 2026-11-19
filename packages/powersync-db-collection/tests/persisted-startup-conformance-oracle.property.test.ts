/** PowerSync's complete eager initial result receives the shared persistence
 * replacement law. The shared suite crosses old/new membership, empty results,
 * changed overlap values and both restore orders on each storage host.
 */
import { describe } from 'vitest'
import {
  persistedStartupBatchHistories,
  persistedStartupHistoryArb,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import { powerSyncStartupAdapter } from './persisted-startup-driver'

const historyArb = persistedStartupHistoryArb(`collection`, true, false, true)
describe(`persisted startup conformance: PowerSync`, () => {
  registerPersistedStartupConformance({
    property: `adapter.powersync.persisted-startup`,
    adapter: powerSyncStartupAdapter,
    // The receiving path judges persisted startup through this adapter entry.
    // The shared model owns replacement; this list lets the gap CLI credit it.
    owns: [`src/powersync.ts#powerSyncCollectionOptions`],
    histories: persistedStartupBatchHistories,
    arbitrary: historyArb,
    scopedStartupCommit: true,
    // Each history opens a real PowerSync database. CI needs more than 60s
    // for 80 histories plus constructed reach, and for their determinism replay.
    // Keep every history, calibration and comparison in the shared suite.
    timeout: 180_000,
    // Each base opens real PowerSync databases, so 5 fixed bases per
    // constructed history cost about 195 s of CI time on this file alone.
    // Two fixed bases keep the file inside its CI job (P12). Each PR run's
    // random-seed units still build their bases from a fresh seed, so the
    // bases vary from run to run (register M, 2026-11-17, "2 fixed bases for
    // three oracles" and "Random bases at today's cost for expensive
    // oracles"); no bases are drawn on top of the fixed ones.
    bases: 2,
  })
})
