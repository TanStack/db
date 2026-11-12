/**
 * The shared eager-source model independently judges the original status,
 * health, rows, field values, event-fold and every publication checkpoint.
 * RxDB uses the controlled RxCollection with real RxSchema/query matcher
 * and sort comparator. It declares listen-before-fetch and terminal failure
 * after ready, with per-change publications and all seven JSON value kinds.
 * This receiver has no real RxDB storage claim; rxdb.test.ts separately
 * receives the reflected buffered insert on memory storage.
 * Five generated constructions enforce the original minimum-five reach. Each
 * builder returns fresh identities and preserves generated input variation.
 */
import { oracleProperty } from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  checkEagerLiveSourceHistory,
  eagerLiveSourceModel,
} from '../../db-adapter-conformance/src'
import { eagerLiveSourceCampaign } from '../../db-adapter-conformance/tests/eager-live-source-oracle-suite'
import { constructRxdbEagerHistory } from './eager-live-source-history-oracle'
import { rxdbConformanceDriver } from './conformance-driver'

const campaign = eagerLiveSourceCampaign(
  rxdbConformanceDriver(),
  constructRxdbEagerHistory,
)
oracleProperty({
  id: `adapter-conformance.eager-live-source.rxdb`,
  law: {
    statement: `Initial readiness, complete row and field fidelity, coherent change publications, failure identity, post-ready health, restart and exactly-once resource release follow the shared eager live-source laws.`,
    authority: `db-adapter-conformance/src/eager-live-source-oracle.ts; adapter law set READY-2/3/4/8/10, HEALTH-1/5, PUB-1/2/3/5/9, FID-1/4, LIFE-2/5/10, as supported by this receiver's declarations.`,
    limits: `Controlled RxCollection with real query semantics, seven JSON value kinds, three startup batches plus twelve steps, eager mode and per-change commits. No remote replication, persisted storage, mutation, reload or on-demand claim.`,
  },
  owns: [`src/rxdb.ts#rxdbCollectionOptions`],
  histories: {
    arbitrary: campaign.arbitrary,
    states: campaign.states,
    runs: 400,
    fixedSeeds: [2118],
    constructed: campaign.constructed,
  },
  model: campaign.model,
  driver: campaign.driver,
  check: campaign.check,
  calibrations: campaign.calibrations,
  timeout: 120000,
})
declareOracle({
  check: [checkEagerLiveSourceHistory, campaign.check],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [campaign.arbitrary],
})
