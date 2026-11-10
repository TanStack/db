import { describe } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  checkEagerLiveSourceHistory,
  eagerLiveSourceHistoryArb,
  eagerLiveSourceModel,
} from '../../db-adapter-conformance/src'
import {
  checkEagerLiveSourceObservations,
  eagerLiveSourceHistories,
  eagerLiveSourceOracle,
} from '../../db-adapter-conformance/tests/eager-live-source-property-oracle'
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

describe(`eager live-source conformance: electric`, () => {
  const property = `adapter-conformance.eager-live-source.electric`
  const driver = electricConformanceDriver()
  const historyArb = eagerLiveSourceHistoryArb(driver)
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

  // Exercise the adapter's default configuration without an app onError too.
  const noOnError = electricConformanceDriver({ appOnError: false })
  oracleProperty({
    id: `${property}.no-on-error`,
    ...eagerLiveSourceOracle(noOnError),
    check: checkEagerLiveSourceObservations,
    histories: {
      ...eagerLiveSourceHistories(noOnError),
      runs,
      fixedSeeds: [2118],
    },
    timeout: campaignTimeoutMs,
  })

  declareOracle({
    owns: [`src/electric.ts#electricCollectionOptions`],
    check: [checkEagerLiveSourceHistory],
    model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
    grammar: [historyArb],
  })
})
