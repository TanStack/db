// @vitest-environment node
/** OPFS receives the primary demand-coverage judgment through real Direct SDK loads. */
import { afterAll, beforeAll } from 'vitest'
import { registerDirectPersistedDemand } from '../../powersync-direct-collection/tests/persisted-demand-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-persisted-demand.opfs.html`,
    ready: `runDirectPersistedDemand`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerDirectPersistedDemand(
  `adapter.powersync-direct.persisted-demand.chromium-opfs`,
  async (history, id) => {
    const host = browser
    if (!host) throw new Error(`Direct demand OPFS host did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ input, collectionId }) =>
          window.runDirectPersistedDemand(input, collectionId),
        { input: history, collectionId: id },
      ),
    )
  },
  {
    owns: [
      `../powersync-direct-collection/src/index.ts#powerSyncCollectionOptions`,
      `../powersync-direct-collection/src/subsets.ts#createSubsetHandlers`,
      `../db-sqlite-persistence-core/src/persisted.ts`,
    ],
    receivingPath: `Real installed SDK in actual Chromium over controlled HTTP with public persistedCollectionOptions and closed/reopened real worker/OPFS storage.`,
  },
)
