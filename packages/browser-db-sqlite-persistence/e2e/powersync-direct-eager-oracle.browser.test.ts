// @vitest-environment node
/**
 * Real Chromium receives the same eager reload and terminal-gate grammars,
 * models, comparisons and calibrations as Node. The page supplies only the
 * receiving production path. No SQLite wrapper runs in these eager histories.
 * Browser errors remain raw observations checked alongside the product result.
 */
import { afterAll, beforeAll } from 'vitest'
import {
  registerEagerGateFailureConformance,
  registerEagerReloadConformance,
} from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import {
  directEagerGateAdapter,
  directEagerReloadAdapter,
} from '../../powersync-direct-db-collection/tests/eager-reload-driver'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  EagerGateHistory,
  EagerGateObservation,
  EagerReloadHistory,
  EagerReloadObservation,
} from '../../db-adapter-conformance/tests/eager-reload-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectEagerReload`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerEagerReloadConformance(
  `adapter.powersync-direct.eager-reload.chromium`,
  directEagerReloadAdapter,
  {
    owns: [
      `../powersync-direct-db-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
    replacement: `truncate`,
    receive: async (history, id, omitTruncate) => {
      const active = browser
      if (!active) throw new Error(`Chromium receiving host did not start`)
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, id: collectionId, omitTruncate: mutant }) =>
            (
              window as unknown as {
                runDirectEagerReload: (
                  history: EagerReloadHistory,
                  id: string,
                  omitTruncate: boolean,
                ) => Promise<EagerReloadObservation>
              }
            ).runDirectEagerReload(input, collectionId, mutant),
          { history, id, omitTruncate },
        ),
      )
      return { ...result, receivingErrors: result.browserErrors }
    },
  },
)
registerEagerGateFailureConformance(
  `adapter.powersync-direct.eager-gate-failure.chromium`,
  directEagerGateAdapter,
  {
    owns: [
      `../powersync-direct-db-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
    receive: async (history, id) => {
      const active = browser
      if (!active) throw new Error(`Chromium receiving host did not start`)
      const result = await captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, id: collectionId }) =>
            (
              window as unknown as {
                runDirectEagerGateFailure: (
                  history: EagerGateHistory,
                  id: string,
                ) => Promise<EagerGateObservation>
              }
            ).runDirectEagerGateFailure(input, collectionId),
          { history, id },
        ),
      )
      return { ...result, receivingErrors: result.browserErrors }
    },
  },
)
