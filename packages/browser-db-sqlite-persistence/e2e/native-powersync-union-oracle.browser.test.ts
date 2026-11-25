// @vitest-environment node
/** Actual Chromium SQLite receives the same generated predicate-union law. */
import { afterAll, beforeAll } from 'vitest'
import { registerDemandUnion } from '../../powersync-db-collection/tests/demand-union-oracle-suite'
import { startAdapterChromium } from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/native-powersync-union.opfs.html`,
    ready: `runNativePowerSyncUnion`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerDemandUnion(
  `adapter.powersync.demand-union.chromium`,
  async (history, id) => {
    const host = browser
    if (!host)
      throw new Error(`Native Chromium union receiving host did not start`)
    return host.captureFreshHistory((page) =>
      page.evaluate(
        ({ history: input, id: key }) =>
          window.runNativePowerSyncUnion(input, key),
        { history, id },
      ),
    )
  },
  {
    owns: [
      `../powersync-db-collection/src/powersync.ts#powerSyncCollectionOptions`,
    ],
  },
)
