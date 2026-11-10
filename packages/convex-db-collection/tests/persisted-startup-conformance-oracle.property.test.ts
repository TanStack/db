/** Convex receives the shared persistence law through complete push snapshots.
 * Its Collection-wide scope has no peer ownership. Nonempty durable rows,
 * omissions, overlapping updates and empty results cross both restore orders.
 */
import { describe } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  persistedStartupHistories,
  persistedStartupHistoryArb,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import { registerPersistedStartupConformance } from '../../db-adapter-conformance/tests/persisted-startup-oracle-suite'
import { convexStartupAdapter } from './persisted-startup-driver'

const historyArb = persistedStartupHistoryArb(`collection`)
// The receiving path judges persisted startup through this adapter entry.
// The shared model owns replacement; this list lets the gap CLI credit it.
declareOracle({
  owns: [`src/options.ts#convexCollectionOptions`],
  grammar: [historyArb],
})
// Keep registration visible to Vitest's static typecheck collector as well
// as its runtime collector; the shared suite registers the actual law checks.
describe(`persisted startup conformance: Convex`, () => {
  registerPersistedStartupConformance({
    property: `adapter.convex.persisted-startup`,
    adapter: convexStartupAdapter,
    histories: persistedStartupHistories,
    arbitrary: historyArb,
  })
})
