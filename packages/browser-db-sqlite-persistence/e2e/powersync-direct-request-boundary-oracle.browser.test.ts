// @vitest-environment node
/** Chromium receives the exact same boundary grammar and comparison as Node. */
import { afterAll, beforeAll } from 'vitest'
import { registerOnDemandBoundaryConformance } from '../../db-adapter-conformance/tests/on-demand-streams-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  OnDemandBoundaryHistory,
  OnDemandBoundaryObservation,
} from '../../db-adapter-conformance/tests/on-demand-streams-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectRequestBoundary`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerOnDemandBoundaryConformance(
  `adapter.powersync-direct.request-boundary.chromium`,
  async (history, id) => {
    const host = browser
    if (!host) throw new Error(`Chromium request-boundary host did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id: collectionId }) =>
          (
            window as unknown as {
              runDirectRequestBoundary: (
                h: OnDemandBoundaryHistory,
                id: string,
              ) => Promise<OnDemandBoundaryObservation>
            }
          ).runDirectRequestBoundary(input, collectionId),
        { history, id },
      ),
    )
  },
  {
    owns: [
      `../powersync-direct-collection/src/index.ts#powerSyncCollectionOptions`,
      `../powersync-direct-collection/src/subsets.ts#createSubsetHandlers`,
    ],
  },
)
