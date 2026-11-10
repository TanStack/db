/** TrailBase's complete eager initial result receives the shared persistence
 * replacement law. The shared suite crosses old/new membership, empty results,
 * changed overlap values and both restore orders on each storage host.
 */
import { describe } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  persistedStartupHistories,
  persistedStartupHistoryArb,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import { trailBaseStartupAdapter } from './persisted-startup-driver'

const historyArb = persistedStartupHistoryArb(`collection`)
declareOracle({ grammar: [historyArb] })
describe(`persisted startup conformance: TrailBase`, () => {
  registerPersistedStartupConformance({
    property: `adapter.trailbase.persisted-startup`,
    adapter: trailBaseStartupAdapter,
    histories: persistedStartupHistories,
    arbitrary: historyArb,
  })
})
