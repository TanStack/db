/**
 * The existing eager law receives actual installed SDK routing and SSE decoding.
 * The same model, legal histories, public observations and checker remain the
 * judge. Complete wire frames are the transport premise; no live service or
 * arbitrary split-frame claim follows from this receiver.
 */
import { trailBaseSdkConformanceDriver } from './sdk-conformance-driver'
import { observeTrailBaseEagerHistory } from './eager-live-source-framework-oracle'
import { registerTrailBaseEager } from './eager-live-source-oracle-suite'

const driver = trailBaseSdkConformanceDriver()
registerTrailBaseEager(
  {
    property: `adapter-conformance.eager-live-source.trailbase-sdk`,
    defaultRuns: 600,
    owns: [`src/trailbase.ts#trailBaseCollectionOptions`],
    receivingPath: `Real installed SDK routing, JSON list and complete SSE frames at Client.fetch; native ReadableStream. No deployed service or arbitrary split-frame claim.`,
  },
  driver,
  (history, corrupt) => observeTrailBaseEagerHistory(driver, history, corrupt),
)
