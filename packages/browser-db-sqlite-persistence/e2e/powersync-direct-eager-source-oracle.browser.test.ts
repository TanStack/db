// @vitest-environment node
/**
 * Actual Chromium receives the eager retry grammar, model, public comparison,
 * 400-run campaigns and calibrations unchanged. The browser supplies only the
 * SDK/transport path and raw observations, including changed/unchanged recovery.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerDirectEagerSource } from '../../powersync-direct-collection/tests/eager-live-source-oracle'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
} from '../../db-adapter-conformance/src'
import type {
  EagerHistoryResult,
  EagerSourceCorruption,
} from '../../db-adapter-conformance/tests/eager-live-source-framework-oracle'

let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectEagerSource`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerDirectEagerSource(
  `adapter-conformance.eager-live-source.powersync-direct.chromium`,
  {
    owns: [
      `../powersync-direct-collection/src/index.ts#powerSyncCollectionOptions`,
    ],
    receive: async (history, corruption, states) => {
      const active = browser
      if (!active)
        throw new Error(`Chromium eager receiving host did not start`)
      return captureBrowserHistory(active, () =>
        active.page.evaluate(
          ({ history: input, corruption: mutant, states: reach }) =>
            (
              window as unknown as {
                runDirectEagerSource: (
                  h: EagerLiveSourceHistory,
                  fault?: EagerSourceCorruption,
                  states?: ReadonlyArray<EagerLiveSourceReachState>,
                ) => Promise<EagerHistoryResult>
              }
            ).runDirectEagerSource(input, mutant, reach),
          { history, corruption, states },
        ),
      )
    },
  },
)
