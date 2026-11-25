// @vitest-environment node
/** Real browser SQLite receives the same generated native hook lifecycle law. */
import { afterAll, beforeAll } from 'vitest'
import { registerPowerSyncHooks } from '../../powersync-db-collection/tests/hook-lifecycle-oracle-suite'
import { startAdapterChromium } from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/native-powersync-receiving.opfs.html`,
    ready: `runNativePowerSyncHooks`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerPowerSyncHooks(
  `adapter.powersync.hook-lifecycle.chromium`,
  async (history, id) => {
    const host = browser
    if (!host)
      throw new Error(`Native Chromium hook receiving host did not start`)
    const observed = await host.captureFreshHistory((page) =>
      page.evaluate(
        ({ history: input, id: key }) =>
          window.runNativePowerSyncHooks(input, key),
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
