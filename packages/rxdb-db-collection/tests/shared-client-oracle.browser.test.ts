// @vitest-environment node
/** Chromium supplies the same real RxCollection shared-provider premises. */
import { afterAll, beforeAll } from 'vitest'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'
import { registerRxdbSharedClient } from './shared-client-oracle'
import type { observeRxdbSharedClient } from './shared-client-driver'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/rxdb-db-collection/tests/rxdb-receiving.html`,
    ready: `runRxdbSharedClient`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerRxdbSharedClient(
  `adapter.rxdb.shared-client.chromium`,
  async (history, id) => {
    if (!browser) throw new Error(`RxDB Chromium receiver did not start`)
    const host = browser
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ h, key }) =>
          (
            window as unknown as {
              runRxdbSharedClient: typeof observeRxdbSharedClient
            }
          ).runRxdbSharedClient(h, key),
        { h: history, key: id },
      ),
    )
  },
  { owns: [`src/rxdb.ts#rxdbCollectionOptions`] },
)
