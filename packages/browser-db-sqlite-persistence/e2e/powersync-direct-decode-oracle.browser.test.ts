/** Chromium receives the shared decoder admission judgment through real SDKs. */
import { afterAll, beforeAll } from 'vitest'
import { registerDecodeRefusal } from '../../db-adapter-conformance/tests/decode-refusal-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  DecodeHistory,
  DecodeObservation,
} from '../../db-adapter-conformance/tests/decode-refusal-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectDecodeRefusal`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerDecodeRefusal(
  `adapter-conformance.decode-refusal.powersync-direct.chromium`,
  async (history, id) => {
    const active = browser
    if (!active) throw new Error(`Chromium receiver not initialized`)
    const captured = await captureBrowserHistory(active, () =>
      active.page.evaluate(
        async ({ history: h, id: collectionId }) =>
          (
            window as unknown as {
              runDirectDecodeRefusal: (
                history: DecodeHistory,
                id: string,
              ) => Promise<DecodeObservation>
            }
          ).runDirectDecodeRefusal(h, collectionId),
        { history, id },
      ),
    )
    return captured
  },
  {
    owns: [
      `../powersync-direct-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
  },
)
