// @vitest-environment node
/**
 * Actual Chromium receives the shared on-demand stream family. The bridge
 * transports histories and raw public observations only. The Node-hosted
 * registration retains the same model, grammar, constructions, comparison,
 * calibrations, fixed seed and random run budget as the Node SDK receiver.
 * This page supplies no persistence premise for these unwrapped Collections.
 */
import { afterAll, beforeAll } from 'vitest'
import { registerOnDemandStreamsConformance } from '../../db-adapter-conformance/tests/on-demand-streams-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  OnDemandStreamsHistory,
  OnDemandStreamsState,
  StreamCut,
} from '../../db-adapter-conformance/tests/on-demand-streams-oracle'

type Result = { cuts: Array<StreamCut>; reached: Array<OnDemandStreamsState> }
let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/powersync-direct-receiving.opfs.html`,
    ready: `runDirectOnDemandStreams`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

registerOnDemandStreamsConformance(
  `adapter.powersync-direct.on-demand-streams.chromium`,
  async (history, id) => {
    const host = browser
    if (!host)
      throw new Error(`Chromium on-demand receiving host did not start`)
    return captureBrowserHistory(host, () =>
      host.page.evaluate(
        ({ history: input, id: collectionId }) =>
          (
            window as unknown as {
              runDirectOnDemandStreams: (
                history: OnDemandStreamsHistory,
                id: string,
              ) => Promise<Result>
            }
          ).runDirectOnDemandStreams(input, collectionId),
        { history, id },
      ),
    )
  },
  {
    owns: [
      `../powersync-direct-db-collection/src/index.ts#powerSyncCollectionOptions`,
      `../powersync-direct-db-collection/src/subsets.ts#createSubsetHandlers`,
    ],
    receivingPath: `Real installed SDK in actual Chromium with controlled HTTP; no deployed-service, worker/OPFS, reload or persistence claim.`,
  },
)
