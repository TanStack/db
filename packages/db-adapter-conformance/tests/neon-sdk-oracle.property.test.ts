/**
 * The installed Neon SDK receives the eager law at the WebSocket boundary.
 * Shared models, generated histories, reach checks and comparison own the
 * expected result. This receiver adds protocol validation and decoding to the
 * controlled raw-subscription owner; it makes no deployed-service claim.
 */
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  checkEagerLiveSourceObservations,
  eagerLiveSourceHistories,
  eagerLiveSourceOracle,
} from './eager-live-source-property-oracle'
import { neonSDKDriver } from './neon/neon-sdk-driver'

for (const ordered of [false, true]) {
  const driver = neonSDKDriver(ordered)
  oracleProperty({
    id: ordered
      ? `adapter-conformance.eager-live-source.neon-sdk.ordered`
      : `adapter-conformance.eager-live-source.neon-sdk`,
    owns: [`tests/neon/vendor/collection-options.ts`],
    ...eagerLiveSourceOracle(driver),
    check: checkEagerLiveSourceObservations,
    histories: {
      ...eagerLiveSourceHistories(driver),
      runs: 80,
      fixedSeeds: [2118],
    },
    timeout: 120_000,
  })
}
