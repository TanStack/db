import { trailBaseConformanceDriver } from './conformance-driver'
import { observeTrailBaseEagerHistory } from './eager-live-source-framework-oracle'
import { registerTrailBaseEager } from './eager-live-source-oracle-suite'

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

registerTrailBaseEager(
  {
    property,
    defaultRuns: 600,
    owns: [`src/trailbase.ts#trailBaseCollectionOptions`],
  },
  driver,
  (history, corruptValues) =>
    observeTrailBaseEagerHistory(driver, history, corruptValues),
)
