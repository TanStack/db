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
import { rxdbConformanceDriver } from './conformance-driver'

/**
 * # RxDB on the shared eager live-source conformance oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws (READY-2/3/4/8/10, HEALTH-1, PUB-1/2/3/5/9, FID-4,
 * LIFE-2/5/10, HEALTH-5), the model, the history grammar, and the check. This
 * file supplies only the RxDB production driver in `conformance-driver.ts`
 * and the campaigns; it states no expected results.
 *
 * RxDB declares `listen-before-fetch`: it subscribes to `$` before its
 * initial fetch and buffers the events that arrive during it. It declares no
 * other optional capability: it reads storage once per sync run, its change
 * events carry no txid, and it has no transport or capability to renew. The claim is limited to the controlled
 * RxCollection; a claim about a real RxDB storage needs a receiving witness
 * against it; `rxdb.test.ts` holds one on memory storage for a buffered
 * insert that the initial read already reflects.
 */

const property = `adapter-conformance.eager-live-source.rxdb`
const driver = rxdbConformanceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver.capabilities)
const runs = 200
// Startup bursts lengthen histories, so a campaign takes several seconds.
const campaignTimeoutMs = 120_000

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

describe(`eager live-source conformance: RxDB`, () => {
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
