import { fc } from '@fast-check/vitest'
import { describe, it } from 'vitest'
import {
  oracleFixedSeed,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRouteOf,
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
} from '../src'
import { neonRealtimeDriver } from './neon/neon-realtime-driver'

/**
 * # The eager live-source oracle on the Neon Realtime adapter
 *
 * A receiving driver for the shared oracle in
 * `src/eager-live-source-oracle.ts`. It runs Neon's adapter source, vendored
 * at a fixed commit, on this workspace's TanStack DB, with a controlled raw
 * live-query subscription as its provider (see `neon/neon-realtime-driver.ts`).
 * The law, model, grammar, and check are the shared ones; this file states no
 * expected results.
 *
 * This adapter targets the 0.9 sync API, so it is expected to fail laws that
 * depend on the current failure channel (READY-4, HEALTH-1) until it is
 * updated. That is why the file has its own Vitest config and stays out of
 * the default run. The claim is limited to the controlled provider; a claim
 * about Neon's real client needs a receiving witness against it.
 */

const property = `adapter-conformance.eager-live-source.neon-realtime`
const driver = neonRealtimeDriver()
const historyArb = eagerLiveSourceHistoryArb(driver)
// `field-removed` needs a held row with a note and a later upsert without
// one; at 400 histories every seed tried reached it at least 11 times.
const runs = 400
// Timed waits sleep past their timeout, so a passing campaign takes seconds.
const campaignTimeoutMs = 120_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(property, reachStatesFor(driver), {
    minimum: 5,
  })
  oracleRoute(oracleRouteOf(options))
  await fc.assert(eagerLiveSourceProperty(driver, reach), options)
  return reach
}

describe(`eager live-source conformance: Neon Realtime adapter`, () => {
  oracleReplayTest(it)(
    `conforms on a fixed-seed campaign`,
    async () => {
      const reach = await campaign(
        oracleFixedSeed(2118, { numRuns: oracleRuns(runs) }),
      )
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

// Owns nothing: the Neon adapter under test is vendored in tests/neon, and
// this package's src is the shared oracle itself.
declareOracle({
  check: [checkEagerLiveSourceHistory, eagerLiveSourceProperty],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [historyArb],
})
