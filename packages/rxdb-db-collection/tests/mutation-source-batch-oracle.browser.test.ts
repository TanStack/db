// @vitest-environment node
/** Actual Chromium receives the same RxDB CRUD source-batch judgment. */
import { afterAll, beforeAll } from 'vitest'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'
import { registerRxdbMutationSourceBatch } from './mutation-source-batch-oracle'
import type { observeRxdbMutation } from './mutation-driver'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/rxdb-db-collection/tests/rxdb-receiving.html`,
    ready: `runRxdbMutation`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerRxdbMutationSourceBatch(
  `adapter.rxdb.mutation-source-batch.chromium`,
  async (history, id) => {
    if (!browser)
      throw new Error(`RxDB Chromium mutation receiver did not start`)
    const host = browser
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ h, key }) =>
          (
            window as unknown as { runRxdbMutation: typeof observeRxdbMutation }
          ).runRxdbMutation(h, key),
        { h: history, key: id },
      ),
    )
  },
  { owns: [`src/rxdb.ts#rxdbCollectionOptions`] },
)
