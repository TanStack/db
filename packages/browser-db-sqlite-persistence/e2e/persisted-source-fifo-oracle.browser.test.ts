// @vitest-environment node
/** Real worker/OPFS receives the primary FIFO grammar and comparison. */
import { afterAll, beforeAll } from 'vitest'
import { registerSourceFifoOrderingOracle } from '../../db-sqlite-persistence-core/tests/persisted-source-fifo-oracle'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type { SourceFifoOrderingHistory } from '../../db-sqlite-persistence-core/tests/persisted-durability-model-oracle'
import type { SourceFifoRunResult } from '../../db-sqlite-persistence-core/tests/persisted-source-fifo-driver'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/persisted-source-fifo.opfs.html`,
    ready: `runPersistedSourceFifo`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerSourceFifoOrderingOracle({
  property: `sqlite-persistence.source-fifo-order.chromium-opfs`,
  owns: [
    `../db-sqlite-persistence-core/src/persisted.ts`,
    `../db-sqlite-persistence-core/src/sqlite-core-adapter.ts`,
  ],
  receivingPath: `Actual Chromium worker/OPFS with the real SQLite adapter and scoped scheduler loans.`,
  constructTogether: true,
  run: async (history) => {
    const host = browser
    if (!host) throw new Error(`Chromium FIFO receiving host did not start`)
    const observed = await captureBrowserHistory(host, () =>
      host.page.evaluate(
        async (input) => ({
          results: await (
            window as unknown as {
              runPersistedSourceFifo: (
                history: SourceFifoOrderingHistory,
              ) => Promise<Array<SourceFifoRunResult>>
            }
          ).runPersistedSourceFifo(input),
        }),
        history,
      ),
    )
    return observed.results.map((result) => ({
      ...result,
      browserErrors: observed.browserErrors,
    }))
  },
})
