import { fc } from '@fast-check/vitest'
import { describe, it } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayTest,
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

const property = `adapter-conformance.eager-live-source.powersync-direct`
const driver = directConformanceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver)
// `field-removed` needs a held row with a note and a later upsert without
// one: 200 histories reached it as few as two times.
const runs = 400
const campaignTimeoutMs = 600_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(property, reachStatesFor(driver), {
    minimum: 5,
  })
  await fc.assert(eagerLiveSourceProperty(driver, reach), options)
  return reach
}

describe(`eager live-source conformance: direct PowerSync`, () => {
  oracleReplayTest(it)(
    `conforms on a fixed-seed campaign`,
    async () => {
      const reach = await campaign({ seed: 2118, numRuns: oracleRuns(runs) })
      reach.assertReached()
    },
    campaignTimeoutMs,
  )

  oracleReplayTest(it, property)(
    `conforms on a random campaign or a replayed seed`,
    async () => {
      const reach = await campaign(oraclePropertyOptions(runs, property))
      reach.assertReached()
    },
    campaignTimeoutMs,
  )
})

declareOracle({
  check: [checkEagerLiveSourceHistory, eagerLiveSourceProperty],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [historyArb],
})
