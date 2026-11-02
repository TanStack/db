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
 * (must-refetch), `await-evidence` (txids), `retry-policy` (an HTTP 503 or
 * 429 or a network failure the client retries, or an HTTP 400 the shape's
 * `onError` retries), and `source-failure-after-ready` (a give-up through
 * `onError`, after an HTTP 400 or after the client's `maxRetries`), and
 * typed Postgres columns. A second campaign runs Electric's default
 * configuration, with no app `onError`. The claim is limited to the controlled HTTP provider; a
 * claim about an Electric server needs a receiving witness against it.
 */

const property = `adapter-conformance.eager-live-source.electric`
const driver = electricConformanceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver)
// At 400 histories, four seeds reached every declared state at least 15
// times; the rarest is a reported outage in a later sync run.
const runs = 400
// A campaign takes about 35 seconds.
const campaignTimeoutMs = 120_000

async function campaign(
  options: fc.Parameters<[unknown]>,
  checked = driver,
  name = property,
) {
  const reach = createOracleReach(name, reachStatesFor(checked), {
    minimum: 5,
  })
  await fc.assert(eagerLiveSourceProperty(checked, reach), options)
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

  // Electric's default configuration: no app `onError`, so the adapter
  // gives up on every failure the client does not retry and logs it.
  oracleReplayTest(it)(
    `conforms without an app onError on a fixed-seed campaign`,
    async () => {
      const reach = await campaign(
        { seed: 2118, numRuns: oracleRuns(runs) },
        electricConformanceDriver({ appOnError: false }),
        `${property}.no-on-error`,
      )
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
