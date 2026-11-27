// @vitest-environment node
/**
 * Chromium worker/OPFS supplies actual deferred acceptance and detached-error
 * events for native PowerSync's real browser SQLite startup. Shared registration
 * retains the original receipt grammar, model, comparison and calibrations.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerInitialReceiptConformance } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle-suite'
import { startAdapterChromium } from '../tests/adapter-chromium-host'
import type { InitialReceiptHistory } from '../../powersync-direct-db-collection/tests/initial-receipt-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/native-powersync-receiving.opfs.html`,
    ready: `runNativePowerSyncInitialReceipt`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

let sequence = 0
const receive = async (
  history: InitialReceiptHistory,
  teardownFault?: `cleanup-only` | `mismatch-and-cleanup`,
) => {
  const host = browser
  if (!host)
    throw new Error(`Chromium native receipt receiving host did not start`)
  const result = await host.captureFreshHistory((page) =>
    page.evaluate(
      ({ history: input, id, fault }) =>
        window.runNativePowerSyncInitialReceipt(input, id, fault),
      {
        history,
        id: `native-receipt-browser-${sequence++}`,
        fault: teardownFault,
      },
    ),
  )
  return {
    ...result,
    detachedErrors: [...result.detachedErrors, ...result.browserErrors],
  }
}
registerInitialReceiptConformance(
  `adapter.powersync.initial-receipt-cleanup.persisted-opfs`,
  (history) => receive(history),
  {
    owns: [
      `../powersync-db-collection/src/powersync.ts#powerSyncCollectionOptions`,
    ],
    receiveFault: receive,
    receiveFaultLabel: `actual post-record browser storage failure`,
    receiveFaultDifferences: {
      cleanupOnly: `Injected native receipt storage close failure`,
    },
    limits: `Three source keys including an empty result, native browser PowerSync SQLite reads and cleanup, actual Chromium worker/OPFS deferred receipt and native detached errors. No deployed PowerSync service, concurrent tabs, saved-row durability, or accepted core receipts held by optimistic work.`,
  },
)
