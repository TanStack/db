// @vitest-environment node
/** Actual Chromium receives the same histories, model, cuts and calibrations. */
import { afterAll, beforeAll } from 'vitest'
import { registerSharedClientConformance } from '../../db-adapter-conformance/tests/shared-client-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  SharedClientHistory,
  SharedClientObservation,
} from '../../db-adapter-conformance/tests/shared-client-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectSharedClient`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerSharedClientConformance(
  `adapter.powersync-direct.shared-client.chromium`,
  async (history, id) => {
    const host = browser
    if (!host)
      throw new Error(`Chromium shared-client receiving host did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id: collectionId }) =>
          (
            window as unknown as {
              runDirectSharedClient: (
                history: SharedClientHistory,
                id: string,
              ) => Promise<SharedClientObservation>
            }
          ).runDirectSharedClient(input, collectionId),
        { history, id },
      ),
    )
  },
  {
    owns: [
      `../powersync-direct-db-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
  },
)
