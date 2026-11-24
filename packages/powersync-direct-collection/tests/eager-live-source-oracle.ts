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
 * a failed connection. Subscription argument errors cannot change on one
 * connection, so they do not supply the `delivery-error` capability. Its
 * propagation step is the client reading the
 * service's lines, which the fixture's `settle` awaits. The claim is limited
 * to the protocol lines the fake service writes; a claim about the PowerSync
 * service needs a receiving witness against it.
 *
 * Five constructions enforce the original minimum-five reach and the new
 * changed/unchanged transport recovery and resource observations. Random
 * histories alone reached `field-removed` as few as two times in 200, so each
 * construction delivers it.
 */
import { oracleProperty } from '../../db/tests/oracle-property'
import { eagerLiveSourceCampaign } from '../../db-adapter-conformance/tests/eager-live-source-oracle-suite'
import { constructDirectEagerHistory } from './eager-live-source-history-oracle'
import { directConformanceDriver } from './conformance-driver'

export function registerDirectEagerSource(
  property: string,
  {
    owns,
    receive,
  }: {
    owns: ReadonlyArray<string>
    receive?: Parameters<typeof eagerLiveSourceCampaign>[3]
  },
) {
  const campaign = eagerLiveSourceCampaign(
    directConformanceDriver(),
    constructDirectEagerHistory,
    [
      `transient-failure-recovered-with-row-change`,
      `transient-failure-recovered-without-row-change`,
      `sync-run-resources-released`,
    ],
    receive,
  )
  oracleProperty({
    id: property,
    law: {
      statement: `Initial readiness, complete row and value fidelity, coherent change publications, recovery on changed and unchanged successor checkpoints, retried-failure health, restart and exactly-once release of SDK listeners and leases follow the shared eager live-source laws.`,
      authority: `db-adapter-conformance/src/eager-live-source-oracle.ts; adapter law set READY-2/3/4/8/10, HEALTH-1/5, RETRY-1, PUB-1/2/3/5/9, FID-1/4, LIFE-2/5/10, as supported by this receiver's declarations.`,
      limits: `Real @powersync/standalone-client over a fake sync service, eager mode, per-batch changes, seven JSON value kinds and twelve-element grammar. No real sync-service, failure-after-ready, mutation, reload or on-demand claim.`,
    },
    owns,
    histories: {
      arbitrary: campaign.arbitrary,
      states: campaign.states,
      runs: 400,
      fixedSeeds: [2118],
      constructed: campaign.constructed,
      // Subscription errors are not transient result errors. This lawful replay
      // keeps the original empty-checkpoint recovery observation via reconnect.
      fixed: [
        {
          name: `an unchanged successor checkpoint ends a connection outage`,
          history: [
            { kind: `snapshot`, rows: [] },
            { kind: `transient-failure`, variant: 0 },
            { kind: `changes`, changes: [] },
          ],
        },
      ],
    },
    model: campaign.model,
    driver: campaign.driver,
    check: campaign.check,
    calibrations: [
      ...campaign.calibrations,
      {
        name: `an unchanged successor must clear the old outage`,
        history: {
          fixed: `an unchanged successor checkpoint ends a connection outage`,
        },
        law: `HEALTH-2 (health failureReason)`,
        driver: campaign.staleHealthDriver,
      },
    ],
    timeout: 600000,
  })
}
