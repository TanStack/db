/** Installed Node SDK receives the primary on-demand boundary judgment. */
import { registerOnDemandBoundaryConformance } from '../../db-adapter-conformance/tests/on-demand-streams-oracle-suite'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { observeDirectRequestBoundary } from './request-boundary-driver'

registerOnDemandBoundaryConformance(
  `adapter.powersync-direct.request-boundary`,
  async (h, id) => {
    if (
      h.schedule !== `receipt-durable-failure` &&
      h.schedule !== `receipt-abort-later-batch`
    )
      return observeDirectRequestBoundary(h, id)
    const storage = createStartupHost(`node-sqlite`)
    try {
      return await observeDirectRequestBoundary(h, id, storage.persistence)
    } finally {
      storage.close()
    }
  },
  {
    owns: [
      `src/index.ts#powerSyncCollectionOptions`,
      `src/subsets.ts#createSubsetHandlers`,
    ],
  },
)
