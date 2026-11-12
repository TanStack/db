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

describe(`eager live-source conformance: convex`, () => {
  const property = `adapter-conformance.eager-live-source.convex`
  const driver = convexConformanceDriver()
  const historyArb = eagerLiveSourceHistoryArb(driver)
  const runs = 400
  const campaignTimeoutMs = 120_000

  oracleProperty({
    id: property,
    owns: [`src/index.ts#convexCollectionOptions`],
    ...eagerLiveSourceOracle(driver),
    check: checkEagerLiveSourceObservations,
    histories: {
      ...eagerLiveSourceHistories(driver),
      runs,
      fixedSeeds: [2118],
    },
    timeout: campaignTimeoutMs,
  })

  // The React client's watchQuery path and an app wrapper's onUpdate-only path
  // receive the same histories and judgment as the JavaScript client.
  for (const client of [`react`, `wrapped`] as const) {
    const receiving = convexConformanceDriver({ client })
    oracleProperty({
      id: `${property}.${client}`,
      owns: [`src/index.ts#convexCollectionOptions`],
      ...eagerLiveSourceOracle(receiving),
      check: checkEagerLiveSourceObservations,
      histories: {
        ...eagerLiveSourceHistories(receiving),
        runs,
        fixedSeeds: [2118],
      },
      timeout: campaignTimeoutMs,
    })
  }

  declareOracle({
    check: [checkEagerLiveSourceHistory],
    model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
    grammar: [historyArb],
  })
})
