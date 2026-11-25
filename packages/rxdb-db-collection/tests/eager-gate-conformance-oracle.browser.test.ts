// @vitest-environment node
/** Chromium receives real RxDB storage/stream initial gates via one judgment. */
import { afterAll, beforeAll } from 'vitest'
import { registerEagerGateFailureConformance } from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'
import { rxdbEagerGateAdapter } from './eager-gate-driver'
import type { observeEagerGateFailure } from '../../db-adapter-conformance/tests/eager-reload-driver'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/rxdb-db-collection/tests/rxdb-receiving.html`,
    ready: `runRxdbEagerGate`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)
registerEagerGateFailureConformance(
  `adapter.rxdb.eager-gate.chromium`,
  rxdbEagerGateAdapter,
  {
    entries: [`fresh`, `reload`],
    owns: [`src/rxdb.ts#rxdbCollectionOptions`],
    receive: async (history, id) => {
      if (!browser) throw new Error(`RxDB Chromium gate receiver did not start`)
      const host = browser
      const raw = await captureBrowserHistory(host, () =>
        host.page.evaluate(
          ({ h, key }) =>
            (
              window as unknown as {
                runRxdbEagerGate: (
                  history: Parameters<typeof observeEagerGateFailure>[1],
                  id: string,
                ) => ReturnType<typeof observeEagerGateFailure>
              }
            ).runRxdbEagerGate(h, key),
          { h: history, key: id },
        ),
      )
      return { ...raw, receivingErrors: raw.browserErrors }
    },
  },
)
