/**
 * # The direct PowerSync adapter on the shared eager live-source conformance oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws, the model, the history grammar, and the check;
 * this file supplies only the production driver in `conformance-driver.ts`
 * and the constructed histories in `eager-live-source-history-oracle.ts`. It
 * states no expected results.
 *
 * The adapter runs over the real `@powersync/standalone-client` against a
 * fake sync service. It declares `retry-policy`, because the client retries
 * a failed connection. Its propagation step is the client reading the
 * service's lines, which the fixture's `settle` awaits. The claim is limited
 * to the protocol lines the fake service writes; a claim about the PowerSync
 * service needs a receiving witness against it.
 *
 * Five constructions enforce the original minimum-five reach. Random
 * histories alone reached `field-removed` as few as two times in 200, so each
 * construction delivers it.
 */
import { oracleProperty } from '../../db/tests/oracle-property'
import { eagerLiveSourceCampaign } from '../../db-adapter-conformance/tests/eager-live-source-oracle-suite'
import { constructDirectEagerHistory } from './eager-live-source-history-oracle'
import { directConformanceDriver } from './conformance-driver'

const campaign = eagerLiveSourceCampaign(
  directConformanceDriver(),
  constructDirectEagerHistory,
)
oracleProperty({
  id: `adapter-conformance.eager-live-source.powersync-direct`,
  law: {
    statement: `Initial readiness, complete row and value fidelity, coherent change publications, failure identity, retried-failure health, restart and exactly-once resource release follow the shared eager live-source laws.`,
    authority: `db-adapter-conformance/src/eager-live-source-oracle.ts; adapter law set READY-2/3/4/8/10, HEALTH-1/5, RETRY-1, PUB-1/2/3/5/9, FID-1/4, LIFE-2/5/10, as supported by this receiver's declarations.`,
    limits: `Real @powersync/standalone-client over a fake sync service, eager mode, per-batch changes, seven JSON value kinds and twelve-step grammar. No real sync-service, delivery-error, failure-after-ready, mutation, reload or on-demand claim.`,
  },
  owns: [`src/index.ts#powerSyncCollectionOptions`],
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
