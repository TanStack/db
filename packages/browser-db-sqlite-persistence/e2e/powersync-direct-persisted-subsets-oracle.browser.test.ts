// @vitest-environment node
/**
 * Worker/OPFS persistence decorates the actual Chromium SDK receiver. This is
 * the same on-demand grammar, model, comparison and calibrated campaign used
 * by the direct and Node persistence receivers; no narrower browser histories
 * substitute for it. Saved data and reopen durability are outside this law.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerOnDemandStreamsConformance } from '../../db-adapter-conformance/tests/on-demand-streams-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectPersistedOnDemandStreams`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerOnDemandStreamsConformance(
  `adapter.powersync-direct.on-demand-streams.persisted-chromium-opfs`,
  async (history, id) => {
    const host = browser
    if (!host)
      throw new Error(`Chromium persisted on-demand host did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id: collectionId }) =>
          window.runDirectPersistedOnDemandStreams(input, collectionId),
        { history, id },
      ),
    )
  },
  {
    owns: [
      `../powersync-direct-db-collection/src/index.ts#powerSyncCollectionOptions`,
      `../powersync-direct-db-collection/src/subsets.ts#createSubsetHandlers`,
    ],
    receivingPath: `Real installed SDK in actual Chromium with controlled HTTP, public persistence wrapper and actual worker/OPFS storage. No deployed-service or saved-row/restart-durability claim.`,
  },
)
