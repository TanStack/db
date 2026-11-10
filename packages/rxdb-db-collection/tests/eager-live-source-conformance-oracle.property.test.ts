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

describe(`eager live-source conformance: rxdb`, () => {
  const property = `adapter-conformance.eager-live-source.rxdb`
  const driver = rxdbConformanceDriver()
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

  declareOracle({
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
    check: [checkEagerLiveSourceHistory],
    model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
    grammar: [historyArb],
  })
})
