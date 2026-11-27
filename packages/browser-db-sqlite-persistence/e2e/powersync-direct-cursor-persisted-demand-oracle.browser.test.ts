// @vitest-environment node
/** Actual Chromium receives the same model, cursor grammar and comparison. */
import { afterAll, beforeAll } from 'vitest'
import { registerCursorPersistedDemand } from '../../powersync-direct-db-collection/tests/cursor-persisted-demand-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-cursor-persisted-demand.opfs.html`,
    ready: `runDirectCursorDemand`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerCursorPersistedDemand(
  `adapter.powersync-direct.persisted-cursor.chromium-opfs`,
  async (history, id) => {
    const host = browser
    if (!host) throw new Error(`Direct cursor OPFS host did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ input, collectionId }) =>
          window.runDirectCursorDemand(input, collectionId),
        { input: history, collectionId: id },
      ),
    )
  },
  {
    owns: [
      `../powersync-direct-db-collection/src/index.ts#powerSyncCollectionOptions`,
      `../powersync-direct-db-collection/src/subsets.ts#createSubsetHandlers`,
      `../db-sqlite-persistence-core/src/persisted.ts`,
    ],
    receivingPath: `Installed SDK in actual Chromium over controlled HTTP with closed/reopened real worker/OPFS storage.`,
  },
)
