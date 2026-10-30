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
import { electricConformanceDriver } from './conformance-driver'

/**
 * # Electric on the shared eager live-source conformance oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws, the model, the history grammar, and the check;
 * this file supplies only the Electric production driver in
 * `conformance-driver.ts` and the campaigns. It states no expected results.
 *
 * Electric runs here in eager mode over the installed `@electric-sql/client`
 * through a controlled `fetchClient`. It declares `complete-snapshot`
 * (must-refetch), `await-evidence` (txids), `retry-policy` (an HTTP 503 the
 * client retries, or an HTTP 400 the shape's `onError` retries), and
 * `source-failure-after-ready` (a give-up through `onError`), and typed
 * Postgres columns. The claim is limited to the controlled HTTP provider; a
 * claim about an Electric server needs a receiving witness against it.
 */

const property = `adapter-conformance.eager-live-source.electric`
const driver = electricConformanceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver)
// The rarest state is `field-removed`: at 400 histories, six seeds reached
// it 19 to 31 times.
const runs = 400
// A campaign takes about 20 seconds.
const campaignTimeoutMs = 120_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(property, reachStatesFor(driver), {
    minimum: 5,
  })
  await fc.assert(eagerLiveSourceProperty(driver, reach), options)
  return reach
}

describe(`eager live-source conformance: Electric`, () => {
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
