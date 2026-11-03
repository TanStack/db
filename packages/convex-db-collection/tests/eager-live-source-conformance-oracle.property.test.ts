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
import { convexConformanceDriver } from './conformance-driver'

/**
 * # Convex on the shared eager live-source conformance oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws, the model, the history grammar, and the check;
 * this file supplies only the Convex production driver in
 * `conformance-driver.ts` and the campaigns. It states no expected results.
 *
 * Convex runs here in eager mode over the real Convex JavaScript client, and
 * in a fixed-seed campaign over the React client, whose WebSocket the driver
 * answers with the sync protocol. Every delivery
 * is a complete query result. It declares `complete-snapshot`,
 * `delivery-error` (a `QueryFailed` after ready, cleared by the next
 * result), and `duplicate-key-delivery` with rejected deliveries reported
 * after ready, and Convex value kinds as values and typed fields. The claim
 * is limited to the controlled socket; a claim about a Convex deployment
 * needs a receiving witness against it.
 */

const property = `adapter-conformance.eager-live-source.convex`
const driver = convexConformanceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver)
const runs = 400
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

describe(`eager live-source conformance: Convex`, () => {
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

  // The React client reaches the adapter through `watchQuery`.
  oracleReplayTest(it)(
    `conforms over the React client on a fixed-seed campaign`,
    async () => {
      const reach = await campaign(
        { seed: 2118, numRuns: oracleRuns(runs) },
        convexConformanceDriver({ client: `react` }),
        `${property}.react`,
      )
      reach.assertReached()
    },
    campaignTimeoutMs,
  )

  // An app's wrapper that exposes only `onUpdate` hides the client's log
  // accessor, so the adapter falls back to skipping one replayed error.
  oracleReplayTest(it)(
    `conforms over a wrapped JavaScript client on a fixed-seed campaign`,
    async () => {
      const reach = await campaign(
        { seed: 2118, numRuns: oracleRuns(runs) },
        convexConformanceDriver({ client: `wrapped` }),
        `${property}.wrapped`,
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
