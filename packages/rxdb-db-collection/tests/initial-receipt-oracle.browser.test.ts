// @vitest-environment node
/** Real Chromium receives the same genuine-core receipt cleanup judgment. */
import { afterAll, beforeAll } from 'vitest'
import { registerInitialReceiptConformance } from '../../powersync-direct-collection/tests/initial-receipt-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'
import type { observeRxdbInitialReceipt } from './initial-receipt-driver'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/rxdb-db-collection/tests/rxdb-receiving.html`,
    ready: `runRxdbInitialReceipt`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerInitialReceiptConformance(
  `adapter.rxdb.initial-receipt-cleanup.chromium`,
  async (history) => {
    if (!browser) throw new Error(`RxDB Chromium receiver did not start`)
    const host = browser
    const raw = await captureBrowserHistory(host, () =>
      host.page.evaluate(
        (h) =>
          (
            window as unknown as {
              runRxdbInitialReceipt: typeof observeRxdbInitialReceipt
            }
          ).runRxdbInitialReceipt(h, []),
        history,
      ),
    )
    return {
      ...raw,
      detachedErrors: [...raw.detachedErrors, ...raw.browserErrors],
    }
  },
  {
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
    limits: `Three source keys in real RxDB memory storage, one genuine core receipt held by an optimistic transaction, cleanup before/after application and actual Chromium detached errors. No persistence-wrapper durability, server replication or other RxDB storage engine claim.`,
  },
)
