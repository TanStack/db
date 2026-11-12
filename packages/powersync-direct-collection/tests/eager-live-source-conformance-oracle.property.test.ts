import { oracleProperty } from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  checkEagerLiveSourceHistory,
  eagerLiveSourceModel,
} from '../../db-adapter-conformance/src'
import {
  checkEagerLiveSourceObservations,
  eagerLiveSourceHistories,
  eagerLiveSourceOracle,
} from '../../db-adapter-conformance/tests/eager-live-source-property-oracle'
import { directConformanceDriver } from './conformance-driver'

/**
 * # The direct PowerSync adapter on the shared eager live-source conformance oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws, the model, the history grammar, and the check;
 * this file supplies only the production driver in `conformance-driver.ts`
 * and the campaigns. It states no expected results.
 *
 * The adapter runs over the real `@powersync/standalone-client` against a
 * fake sync service. It declares `retry-policy`, because the client retries
 * a failed connection. Its propagation step is the client
 * reading the service's lines, which the fixture's `settle` awaits. The
 * claim is limited to the protocol lines the fake service writes; a claim
 * about the PowerSync service needs a receiving witness against it.
 */

const driver = directConformanceDriver()
const histories = eagerLiveSourceHistories(driver)

oracleProperty({
  id: `adapter-conformance.eager-live-source.powersync-direct`,
  owns: [`src/index.ts#powerSyncCollectionOptions`],
  ...eagerLiveSourceOracle(driver),
  check: checkEagerLiveSourceObservations,
  histories: {
    ...histories,
    runs: 400,
    fixedSeeds: [2118],
  },
  timeout: 600_000,
})

declareOracle({
  check: [checkEagerLiveSourceHistory],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [histories.arbitrary],
})
