/** RxDB's complete eager initial result receives the shared persistence
 * replacement law. The shared suite crosses old/new membership, empty results,
 * changed overlap values and both restore orders on each storage host.
 */
import { describe } from 'vitest'
import {
  persistedStartupHistoryArb,
  persistedStartupSingleCommitHistories,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import { rxdbStartupAdapter } from './persisted-startup-driver'

const historyArb = persistedStartupHistoryArb(`collection`, false, true)
describe(`persisted startup conformance: RxDB`, () => {
  registerPersistedStartupConformance({
    property: `adapter.rxdb.persisted-startup`,
    adapter: rxdbStartupAdapter,
    // The receiving path judges persisted startup through this adapter entry.
    // The shared model owns replacement; this list lets the gap CLI credit it.
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
    histories: persistedStartupSingleCommitHistories,
    arbitrary: historyArb,
    scopedStartupCommit: true,
  })
})
