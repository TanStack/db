import { fc } from '@fast-check/vitest'
import { describe, it } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  checkEagerLiveSourceHistory,
  eagerLiveSourceHistoryArb,
  eagerLiveSourceModel,
  eagerLiveSourceProperty,
  reachStatesFor,
} from '../../db-adapter-conformance/src'
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

const property = `adapter-conformance.eager-live-source.powersync`
const driver = powerSyncConformanceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver)
// `field-removed` needs a held row with a note and a later upsert without
// one: 100 histories reached it only four times. Each history runs on a
// fresh SQLite database and waits for the change watcher after every batch,
// so 400 histories take about a minute.
const runs = 400
// Startup bursts lengthen histories, so a campaign takes several seconds.
const campaignTimeoutMs = 600_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(property, reachStatesFor(driver), {
    minimum: 5,
  })
  await fc.assert(eagerLiveSourceProperty(driver, reach), options)
  return reach
}

describe(`eager live-source conformance: PowerSync`, () => {
  oracleReplayTest(it)(
    `conforms on a fixed-seed campaign`,
    async () => {
      oracleRoute(`fixed seed`)
      const reach = await campaign({ seed: 2118, numRuns: oracleRuns(runs) })
      reach.assertReached()
    },
    campaignTimeoutMs,
  )

  oracleReplayTest(it, property)(
    `conforms on a random campaign or a replayed seed`,
    async () => {
      // oraclePropertyOptions registers this test's route: `random seed`, or
      // `fixed history` on a path replay.
      const reach = await campaign(oraclePropertyOptions(runs, property))
      reach.assertReached()
    },
    campaignTimeoutMs,
  )
})

declareOracle({
  owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  check: [checkEagerLiveSourceHistory, eagerLiveSourceProperty],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [historyArb],
})
