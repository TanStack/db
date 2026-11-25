// @vitest-environment node
/** Real browser SQLite receives the same native per-page decoding judgment. */
import { afterAll, beforeAll } from 'vitest'
import {
  registerNativeBatchDecode,
  registerNativeMutationRefusal,
} from '../../powersync-db-collection/tests/batch-decode-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/native-powersync-receiving.opfs.html`,
    ready: `runNativePowerSyncBatchDecode`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerNativeBatchDecode(
  `adapter.powersync.batch-decode.chromium`,
  async (history, id) => {
    const host = browser
    if (!host)
      throw new Error(`Native Chromium decode receiving host did not start`)
    const observed = await captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id: key }) =>
          window.runNativePowerSyncBatchDecode(input, key),
        { history, id },
      ),
    )
    return observed
  },
  {
    owns: [
      `../powersync-db-collection/src/powersync.ts#powerSyncCollectionOptions`,
    ],
  },
)

registerNativeMutationRefusal(
  `adapter.powersync.batch-decode.mutations.chromium`,
  async (history, id) => {
    const host = browser
    if (!host)
      throw new Error(`Native Chromium mutation receiving host did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id: key }) =>
          window.runNativePowerSyncMutationRefusal(input, key),
        { history, id },
      ),
    )
  },
  {
    owns: [
      `../powersync-db-collection/src/powersync.ts#powerSyncCollectionOptions`,
      `../powersync-db-collection/src/PowerSyncTransactor.ts#PowerSyncTransactor.applyTransaction`,
      `../powersync-db-collection/src/PendingOperationStore.ts`,
    ],
  },
)
