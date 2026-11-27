// @vitest-environment node
/**
 * RxDB's initial result crosses actual Chromium worker/OPFS deferred acceptance.
 * Native page errors and detached rejections join the raw cleanup observation;
 * the existing receipt owner alone supplies expected outcomes and calibrations.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerInitialReceiptConformance } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/rxdb-db-collection/tests/persisted-initial-receipt.browser.html`,
    ready: `runRxdbPersistedInitialReceipt`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

let sequence = 0
registerInitialReceiptConformance(
  `adapter.rxdb.persisted-initial-receipt.chromium-opfs`,
  async (history) => {
    const host = browser
    if (!host) throw new Error(`RxDB persisted receipt Chromium did not start`)
    const raw = await captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id }) =>
          window.runRxdbPersistedInitialReceipt(input, id),
        { history, id: `rxdb-receipt-opfs-${sequence++}` },
      ),
    )
    return {
      ...raw,
      detachedErrors: [...raw.detachedErrors, ...raw.browserErrors],
    }
  },
  {
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
    limits: `Three source keys including an empty result, actual browser RxDB queries, Chromium worker/OPFS deferred receipt and native detached errors. No deployed replication service, saved-demand completeness, concurrent tabs, or accepted receipt held after admission.`,
  },
)
