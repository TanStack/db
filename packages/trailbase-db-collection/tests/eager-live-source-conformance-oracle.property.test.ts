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
import { trailBaseConformanceDriver } from './conformance-driver'

/**
 * # TrailBase on the shared eager live-source conformance oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws (READY-2/3/4, HEALTH-1, PUB-2/3, FID-4, LIFE-2/5),
 * the model, the history grammar, and the check. This file supplies only the
 * TrailBase production driver in `conformance-driver.ts` and the campaigns;
 * it states no expected results.
 *
 * TrailBase declares none of the oracle's optional capabilities: it lists
 * once per sync run, carries no txid, and does not resubscribe. Those laws
 * stay with `lifecycle-oracle.property.test.ts`, which also owns on-demand
 * loading, page and event fencing, cancellation, and timers. The claim is
 * limited to the controlled RecordApi.
 */

const property = `adapter-conformance.eager-live-source.trailbase`
const driver = trailBaseConformanceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver.capabilities)
const runs = 200

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(
    property,
    reachStatesFor(driver.capabilities),
    {
      minimum: 5,
    },
  )
  await fc.assert(eagerLiveSourceProperty(driver, reach), options)
  return reach
}

describe(`eager live-source conformance: TrailBase`, () => {
  oracleReplayTest(it)(`conforms on a fixed-seed campaign`, async () => {
    const reach = await campaign({ seed: 2118, numRuns: oracleRuns(runs) })
    reach.assertReached()
  })

  oracleReplayTest(it, property)(
    `conforms on a random campaign or a replayed seed`,
    async () => {
      const reach = await campaign(oraclePropertyOptions(runs, property))
      reach.assertReached()
    },
  )
})

declareOracle({
  check: [checkEagerLiveSourceHistory, eagerLiveSourceProperty],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [historyArb],
})
