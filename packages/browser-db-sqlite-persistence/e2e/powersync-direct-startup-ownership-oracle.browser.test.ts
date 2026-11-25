// @vitest-environment node
/** Chromium receives the same construction grammar and ownership comparison. */
import { afterAll, beforeAll } from 'vitest'
import { registerSharedConstructionConformance } from '../../db-adapter-conformance/tests/shared-client-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  SharedConstructionHistory,
  SharedConstructionObservation,
} from '../../db-adapter-conformance/tests/shared-client-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectConstruction`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerSharedConstructionConformance(
  `adapter.powersync-direct.construction.chromium`,
  async (history, id) => {
    const host = browser
    if (!host) throw new Error(`Construction Chromium host did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id: collectionId }) =>
          (
            window as unknown as {
              runDirectConstruction: (
                h: SharedConstructionHistory,
                id: string,
              ) => Promise<SharedConstructionObservation>
            }
          ).runDirectConstruction(input, collectionId),
        { history, id },
      ),
    )
  },
  {
    owns: [
      `../powersync-direct-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
  },
)
