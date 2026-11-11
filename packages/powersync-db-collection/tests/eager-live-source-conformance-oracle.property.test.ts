import { describe } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  checkEagerLiveSourceHistory,
  eagerLiveSourceHistoryArb,
  eagerLiveSourceModel,
} from '../../db-adapter-conformance/src'
import {
  checkEagerLiveSourceObservations,
  eagerLiveSourceHistories,
  eagerLiveSourceOracle,
} from '../../db-adapter-conformance/tests/eager-live-source-property-oracle'
import { powerSyncConformanceDriver } from './conformance-driver'

/**
 * # PowerSync on the shared eager live-source conformance oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws, the model, the history grammar, and the check;
 * this file supplies only the PowerSync production driver in
 * `conformance-driver.ts` and the campaigns. It states no expected results.
 *
 * PowerSync runs here over a real local SQLite database. It declares none of
 * the oracle's optional capabilities: it reads its table once per sync run,
 * its changes carry no txid, and it has no provider failure after ready. Its
 * propagation step is the diff-trigger watch, which the fixture's `settle`
 * awaits. The claim is limited to local SQLite writes; a claim about the
 * PowerSync sync service needs a receiving witness against it.
 */

describe(`eager live-source conformance: powersync`, () => {
  const property = `adapter-conformance.eager-live-source.powersync`
  const driver = powerSyncConformanceDriver()
  const historyArb = eagerLiveSourceHistoryArb(driver)
  const runs = 400
  const campaignTimeoutMs = 600_000

  oracleProperty({
    id: property,
    owns: [`src/powersync.ts#powerSyncCollectionOptions`],
    ...eagerLiveSourceOracle(driver),
    check: checkEagerLiveSourceObservations,
    histories: {
      ...eagerLiveSourceHistories(driver),
      runs,
      fixedSeeds: [2118],
    },
    timeout: campaignTimeoutMs,
  })

  declareOracle({
    check: [checkEagerLiveSourceHistory],
    model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
    grammar: [historyArb],
  })
})
