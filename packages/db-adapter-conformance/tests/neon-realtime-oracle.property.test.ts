import { describe } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import {} from '../src'
import {
  checkEagerLiveSourceObservations,
  eagerLiveSourceHistories,
  eagerLiveSourceOracle,
} from './eager-live-source-property-oracle'
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

describe(`eager live-source conformance: Neon Realtime adapter`, () => {
  const property = `adapter-conformance.eager-live-source.neon-realtime`
  const driver = neonRealtimeDriver()
  // Preserve the old 400-history fixed/fresh budgets and minimum five
  // declared-state entries through the shared constructed-history recipes.
  const runs = 400
  const campaignTimeoutMs = 120_000
  oracleProperty({
    id: property,
    ...eagerLiveSourceOracle(driver),
    check: checkEagerLiveSourceObservations,
    histories: {
      ...eagerLiveSourceHistories(driver),
      runs,
      fixedSeeds: [2118],
    },
    timeout: campaignTimeoutMs,
  })
})
