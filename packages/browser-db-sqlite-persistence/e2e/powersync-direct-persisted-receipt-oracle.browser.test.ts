// @vitest-environment node
/**
 * Actual Chromium worker/OPFS receives the initial receipt cleanup contract
 * through the public persistence wrapper. The shared registration retains its
 * grammar, model, comparison, constructions and calibrations. The page records
 * native unhandled-rejection events, and the host also preserves page errors.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerInitialReceiptConformance } from '../../powersync-direct-collection/tests/initial-receipt-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectPersistedInitialReceipt`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

let sequence = 0
registerInitialReceiptConformance(
  `adapter.powersync-direct.initial-receipt-cleanup.chromium-opfs`,
  async (history) => {
    const host = browser
    if (!host) throw new Error(`Chromium receipt receiving host did not start`)
    const result = await captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id }) =>
          window.runDirectPersistedInitialReceipt(input, id),
        { history, id: `direct-receipt-browser-${sequence++}` },
      ),
    )
    return {
      ...result,
      detachedErrors: [...result.detachedErrors, ...result.browserErrors],
    }
  },
  {
    owns: [
      `../powersync-direct-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
    limits: `Three numeric source keys, one initial transaction and cleanup, actual Chromium worker/OPFS persistence receipt and native detached errors. No deployed PowerSync service, concurrent tabs or saved-row durability claim.`,
  },
)
