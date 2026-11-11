/**
 * The shared eager-source model independently judges the original status,
 * health, rows, field values, event-fold and every publication checkpoint.
 * PowerSync runs over real local SQLite through @powersync/node. Its typed
 * columns cover string, integer, float, boolean and Date. Its 15-significant-
 * digit storage exclusion remains unchanged; the diff-trigger propagation cut
 * and per-batch publication law remain. No sync-service claim is made.
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
import { constructPowerSyncEagerHistory } from './eager-live-source-history-oracle'
import { powerSyncConformanceDriver } from './conformance-driver'

const campaign = eagerLiveSourceCampaign(
  powerSyncConformanceDriver(),
  constructPowerSyncEagerHistory,
)
oracleProperty({
  id: `adapter-conformance.eager-live-source.powersync`,
  law: {
    statement: `Initial readiness, complete row and field fidelity, coherent change publications, failure identity, post-ready health, restart and exactly-once resource release follow the shared eager live-source laws.`,
    authority: `db-adapter-conformance/src/eager-live-source-oracle.ts; adapter law set READY-2/3/4/8/10, HEALTH-1/5, PUB-1/2/3/5/9, FID-1/4, LIFE-2/5/10, as supported by this receiver's declarations.`,
    limits: `Real local PowerSync SQLite, eager mode, per-batch changes, five typed field kinds, original 15-significant-digit numeric exclusion and twelve-step grammar. No remote sync-service, mutation, reload or on-demand claim.`,
  },
  owns: [`src/powersync.ts#powerSyncCollectionOptions`],
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
  timeout: 600000,
})
declareOracle({
  check: [checkEagerLiveSourceHistory, campaign.check],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [campaign.arbitrary],
})
