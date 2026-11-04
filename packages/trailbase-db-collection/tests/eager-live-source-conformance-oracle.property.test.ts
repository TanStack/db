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
import { trailBaseConformanceDriver } from './conformance-driver'

/**
 * # TrailBase on the shared eager live-source conformance oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws (READY-2/3/4, HEALTH-1, PUB-1/2/3, FID-4,
 * LIFE-2/5/10, HEALTH-5), the model, the history grammar, and the check. This file supplies only the
 * TrailBase production driver in `conformance-driver.ts` and the campaigns;
 * it states no expected results.
 *
 * TrailBase declares two of the oracle's optional capabilities:
 * `duplicate-key-delivery`, because a paged list can return one record twice
 * (PUB-3 under `duplicateInsert: replace`), and `source-failure-after-ready`,
 * because the change stream can error after ready (HEALTH-1). It declares no
 * other: it lists once per sync run, carries no txid, and does not
 * resubscribe. Those laws stay with `lifecycle-oracle.property.test.ts`, which also owns on-demand
 * loading, page and event fencing, cancellation, and timers. The claim is
 * limited to the controlled RecordApi.
 */

const property = `adapter-conformance.eager-live-source.trailbase`
const driver = trailBaseConformanceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver)
// `field-removed` needs a held row with a note and a later upsert without
// one. With value kinds, 400 histories reached it as few as 7 times across
// eight seeds, so TrailBase runs 600.
const runs = 600
const campaignTimeoutMs = 120_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(property, reachStatesFor(driver), {
    minimum: 5,
  })
  await fc.assert(eagerLiveSourceProperty(driver, reach), options)
  return reach
}

describe(`eager live-source conformance: TrailBase`, () => {
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
